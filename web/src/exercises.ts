// Port of src/exercises.py and joint_angle() from src/core/PoseEstimationModule.py, with two
// differences: both body sides are tracked, and rep angles are measured in 3D (Python measures the
// right side in the 2D image), so angle ranges here are tuned for 3D and can differ from Python's.

export interface Point {
  x: number;
  y: number;
  /** Depth, when measuring in 3D. */
  z?: number;
}

export type Side = "left" | "right";
export const SIDES: readonly Side[] = ["left", "right"];

/** MediaPipe Pose landmark ids of each side's shoulder and hip. */
export const SHOULDER: Record<Side, number> = { left: 11, right: 12 };
export const HIP: Record<Side, number> = { left: 23, right: 24 };

export interface Exercise {
  name: string;
  label: string;
  /** Per side, the MediaPipe Pose landmark ids forming the tracked joint angle (the middle one is the vertex). */
  joints: Record<Side, readonly [number, number, number]>;
  /** Interior degrees (0-180), measured in 3D: [angle at rest = 0% of the rep, angle at the peak = 100%]. */
  angleRange: AngleRange;
  /** True while the range is an uncalibrated placeholder. */
  experimental?: boolean;
}

/**
 * Interior angle in degrees (0-180) at p2, in 2D or 3D. Unsigned, so a limb reads the same whichever
 * side faces the camera. Given 3D points it is also unaffected by foreshortening: a forearm swinging
 * toward the camera looks shorter in the image, which makes the 2D angle close too early.
 */
export function jointAngle(p1: Point, p2: Point, p3: Point): number {
  const u = [p1.x - p2.x, p1.y - p2.y, (p1.z ?? 0) - (p2.z ?? 0)];
  const v = [p3.x - p2.x, p3.y - p2.y, (p3.z ?? 0) - (p2.z ?? 0)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (lengths === 0) return 180;
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

export type AngleRange = readonly [number, number];

/** How far through the rep an angle is, as an unclipped fraction: 0 at rest, 1 at the peak, more beyond it. */
export function repProgress(angle: number, [start, end]: AngleRange): number {
  return (angle - start) / (end - start);
}

/** Map a joint angle onto 0-100% of the rep, clipped to exactly 0 and 100. The range may run in either direction. */
export function angleToPercent(angle: number, range: AngleRange): number {
  return Math.min(1, Math.max(0, repProgress(angle, range))) * 100;
}

/** The furthest progress that was held for at least `frames` frames, so one jittery frame can't set it. */
export function furthestSustained(progress: number[], frames = 5): number {
  if (progress.length === 0) return -Infinity;
  const descending = [...progress].sort((a, b) => b - a);
  return descending[Math.min(frames, descending.length) - 1];
}

/** How far short of a person's own furthest position still counts as the top of a rep. */
export const CALIBRATION_MARGIN_DEGREES = 8;

/**
 * A range whose peak is where this person's limb actually got to, as the camera reads it, less a
 * margin. The pose model's 3D estimate reads the two sides of the body up to about 10 degrees
 * apart, so each side is calibrated separately. `furthest` is progress along `range` (see
 * repProgress). Returns null if the limb did not get at least halfway, i.e. it did not do the rep.
 */
export function calibratedRange(range: AngleRange, furthest: number): [number, number] | null {
  if (!(furthest >= 0.5) || !Number.isFinite(furthest)) return null;
  const [start, end] = range;
  const reached = start + (end - start) * furthest;
  return [start, reached - Math.sign(end - start) * CALIBRATION_MARGIN_DEGREES];
}

export const EXERCISES: Record<string, Exercise> = {
  bicep_curl: {
    name: "bicep_curl",
    label: "Bicep Curl",
    joints: { left: [11, 13, 15], right: [12, 14, 16] }, // shoulder, elbow, wrist
    // The 3D estimate under-reads depth: a full curl bottoms out around 50-60 degrees filmed side-on
    // but only about 82 filmed from the front (forearm toward the camera). The peak is set at 90 so a
    // full curl registers from either view, at the cost of counting a curl that stops at forearm-level.
    angleRange: [150, 90],
  },
  squat: {
    name: "squat",
    label: "Squat",
    joints: { left: [23, 25, 27], right: [24, 26, 28] }, // hip, knee, ankle
    angleRange: [170, 90],
    experimental: true,
  },
};

export const DEFAULT_EXERCISE = "bicep_curl";
