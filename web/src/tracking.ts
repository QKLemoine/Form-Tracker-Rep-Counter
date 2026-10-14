// The whole motion pipeline, with no camera or page dependencies: pose landmarks and a timestamp
// go in, each body side's state comes out. Everything the page shows is derived from that state,
// and the tests drive this module directly with recorded landmarks.

import { SIDES, angleToPercent, jointAngle, type AngleRange, type Exercise, type Point, type Side } from "./exercises";
import { HysteresisGate, OneEuroFilter } from "./filters";
import { sideFrame, type Frame } from "./formScoring";
import { DEFAULT_REP_CONFIG, RepTracker, type RepConfig, type RepPhase } from "./repTracker";

/** One pose, indexable by MediaPipe landmark id. */
export interface PoseInput {
  /** Position in the image, normalized to 0-1 per axis, with a visibility score. */
  image: ArrayLike<{ x: number; y: number; visibility?: number }>;
  /** Estimated 3D position in metres. */
  world: ArrayLike<{ x: number; y: number; z: number }>;
}

export interface TrackingConfig {
  /** A hidden side becomes visible once its least visible joint has been at or above this for `visibilityFrames` frames. */
  visibilityEnter: number;
  /** A visible side becomes hidden once that has been below this for `visibilityFrames` frames. Frames below it are never used. */
  visibilityExit: number;
  visibilityFrames: number;
  /** A rep in progress is dropped once its side has gone this long without a usable frame. */
  hiddenGraceMs: number;
  /** After a gap this long the angle filter starts fresh instead of blending in stale values. */
  filterResetMs: number;
  /** One Euro filter settings for the joint angle, in degrees. */
  filterMinCutoff: number;
  filterBeta: number;
  rep: RepConfig;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  visibilityEnter: 0.6,
  visibilityExit: 0.4,
  visibilityFrames: 3,
  hiddenGraceMs: 1000,
  filterResetMs: 500,
  filterMinCutoff: 1,
  filterBeta: 0.01,
  rep: DEFAULT_REP_CONFIG,
};

export interface SideSnapshot {
  /** Whether the camera can see this side's joints well enough to trust them. When false, everything below is frozen. */
  visible: boolean;
  /** True if this frame was used to update the angle and rep state. */
  updated: boolean;
  /** Visibility of each tracked joint this frame, or null if no one is in view. */
  jointVisibility: number[] | null;
  /** This frame's 3D joint angle before smoothing, or null if no one is in view. */
  rawAngle: number | null;
  /** This frame's joint angle measured in the flat image, for comparison only. */
  angle2d: number | null;
  /** The smoothed 3D angle the bar and rep count are based on; holds its last value while hidden. */
  angle: number | null;
  range: AngleRange;
  calibrated: boolean;
  /** 0-100 through the rep; holds its last value while hidden. */
  percent: number;
  phase: RepPhase;
  count: number;
  /** The frames of the rep completed on this frame, for form scoring, or null. */
  completedRep: Frame[] | null;
}

class SideTracker {
  private readonly gate: HysteresisGate;
  private readonly filter: OneEuroFilter;
  private readonly reps: RepTracker<Frame>;
  private calibratedRange: AngleRange | null = null;
  private angle: number | null = null;
  private percent = 0;
  private lastUsedAt = -Infinity;

  constructor(
    private readonly side: Side,
    private readonly exercise: Exercise,
    private readonly config: TrackingConfig,
  ) {
    this.gate = new HysteresisGate(config.visibilityEnter, config.visibilityExit, config.visibilityFrames);
    this.filter = new OneEuroFilter(config.filterMinCutoff, config.filterBeta);
    this.reps = new RepTracker<Frame>(config.rep);
  }

  get range(): AngleRange {
    return this.calibratedRange ?? this.exercise.angleRange;
  }

  setRange(range: AngleRange | null): void {
    this.calibratedRange = range;
    // Progress so far was measured against the old range.
    this.reps.abandonRep();
  }

  abandonRep(): void {
    this.reps.abandonRep();
  }

  update(pose: PoseInput | null, timeMs: number, imageSize: { width: number; height: number }): SideSnapshot {
    const joints = this.exercise.joints[this.side];
    const jointVisibility = pose ? joints.map((id) => pose.image[id].visibility ?? 0) : null;
    const leastVisible = jointVisibility ? Math.min(...jointVisibility) : 0;
    const visible = this.gate.update(leastVisible);

    // Image landmarks are normalized 0-1 per axis; convert to pixels or a non-square frame skews angles and distances.
    const toPixels = (id: number): Point => ({ x: pose!.image[id].x * imageSize.width, y: pose!.image[id].y * imageSize.height });
    const [a, b, c] = joints;
    const rawAngle = pose ? jointAngle(pose.world[a], pose.world[b], pose.world[c]) : null;
    const angle2d = pose ? jointAngle(toPixels(a), toPixels(b), toPixels(c)) : null;

    // A frame is only used while the side is visible and this frame itself is confident: the pose
    // model still reports a guessed position for a hidden limb, and that guess moves like a real rep.
    const usable = pose !== null && rawAngle !== null && visible && leastVisible >= this.config.visibilityExit;
    let completedRep: Frame[] | null = null;
    if (usable) {
      if (timeMs - this.lastUsedAt > this.config.filterResetMs) this.filter.reset();
      this.angle = this.filter.filter(rawAngle, timeMs);
      this.percent = angleToPercent(this.angle, this.range);
      completedRep = this.reps.update(this.percent, sideFrame(toPixels, this.exercise, this.side), timeMs);
      this.lastUsedAt = timeMs;
    } else if (timeMs - this.lastUsedAt > this.config.hiddenGraceMs) {
      this.reps.abandonRep();
    }

    return {
      visible,
      updated: usable,
      jointVisibility,
      rawAngle,
      angle2d,
      angle: this.angle,
      range: this.range,
      calibrated: this.calibratedRange !== null,
      percent: this.percent,
      phase: this.reps.phase,
      count: this.reps.count,
      completedRep,
    };
  }
}

/** Tracks both sides of the body through one exercise. Each side has its own filter, visibility gate, range and rep count. */
export class MotionTracker {
  private readonly sides: Record<Side, SideTracker>;

  constructor(exercise: Exercise, config: TrackingConfig = DEFAULT_TRACKING_CONFIG) {
    this.sides = { left: new SideTracker("left", exercise, config), right: new SideTracker("right", exercise, config) };
  }

  /** Advance by one camera frame. `pose` is null when no one is in view. */
  update(pose: PoseInput | null, timeMs: number, imageSize: { width: number; height: number }): Record<Side, SideSnapshot> {
    return { left: this.sides.left.update(pose, timeMs, imageSize), right: this.sides.right.update(pose, timeMs, imageSize) };
  }

  /** Use a calibrated range for one side, or null to go back to the exercise's default. */
  setRange(side: Side, range: AngleRange | null): void {
    this.sides[side].setRange(range);
  }

  /** Forget any rep in progress on both sides; the next rep must start from rest. */
  abandonReps(): void {
    for (const side of SIDES) this.sides[side].abandonRep();
  }
}
