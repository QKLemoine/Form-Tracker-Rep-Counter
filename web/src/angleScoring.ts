// Form scoring on joint angles: the default scorer, with golden reps stored as v3. The
// position-based scorer in formScoring.ts (golden reps v2) stays available behind ?scorer=position.
//
// Interior angles need none of the position scorer's corrections: they read the same whichever side
// faces the camera and however far away the person stands, so there is no mirroring or torso
// scaling. What they cannot see is anything that keeps the angles but moves the limb, such as a
// knee caving inward (valgus) at an unchanged knee angle; PoseTrack keeps positions for that.

import { SIDES, type BodyAngle, type Exercise, type Side } from "./exercises";
import { dtwDistance, mostTypicalRep, type Frame } from "./formScoring";
import type { AngleName, PoseTrackFrame } from "./poseTrack";
import type { RepSample } from "./tracking";

/** One side's scored angles in one frame, in degrees, in the exercise's scoredAngles order. */
export type AngleFrame = number[];

const sideAngle = (angle: BodyAngle, side: Side): AngleName => (angle === "trunk_lean" ? angle : `${side === "left" ? "l" : "r"}_${angle}`);

/** The scored angles of one side, frame by frame. Frames with any of them missing (no one in view) are left out. */
export function angleFrames(frames: readonly PoseTrackFrame[], exercise: Exercise, side: Side): AngleFrame[] {
  const names = exercise.scoredAngles.map((angle) => sideAngle(angle, side));
  return frames.map((frame) => names.map((name) => frame.angles[name])).filter((values): values is number[] => values.every((v) => v !== null));
}

/** Root mean square difference between two frames' angles, in degrees: how far off a typical angle is. */
function rmsDifference(a: Frame, b: Frame): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

/**
 * How far a rep is from the golden rep, in degrees: the RMS angle difference averaged along the
 * cheapest time alignment (Dynamic Time Warping), so rep speed doesn't matter. The two may come from
 * different sides of the body; each is already that side's own angles.
 */
export function angleRepDistance(golden: AngleFrame[], rep: AngleFrame[]): number {
  return dtwDistance(golden, rep, rmsDifference);
}

/**
 * Distance (RMS degrees) shown as a 0% match. Set from the recorded curls (scorerComparison.test.ts):
 * good reps on the golden rep's own arm sit 2.6-4.8 degrees away (about 70-80%), reps cut off
 * halfway 5.4-11 degrees (about 25-65%), and the same curl filmed from another camera position
 * about 16 (0%). Not yet checked against real bad reps (swinging, elbow drift).
 */
export const ZERO_MATCH_DEGREES = 15;

/** A rep's angle distance from the golden rep as a 0-100 match score. */
export function angleMatchPercent(distance: number): number {
  return Math.round(100 * Math.max(0, 1 - distance / ZERO_MATCH_DEGREES));
}

// Golden reps are kept per arm: the pose model reads the two arms a few degrees apart, which on the
// recorded front-view curls made the other arm's good reps score as badly as half reps on the
// golden rep's own arm. Against its own arm's golden rep, every good rep scored above every half rep.

/** A good rep collected while recording golden reps. */
export interface CollectedRep {
  side: Side;
  samples: RepSample[];
  /** When it completed, in the tracker's milliseconds. */
  at: number;
}

/** For each arm with at least `needed` reps, the most typical of its first `needed` reps by angle distance. */
export function goldenRepsPerArm(reps: readonly CollectedRep[], exercise: Exercise, needed: number): Partial<Record<Side, RepSample[]>> {
  const chosen: Partial<Record<Side, RepSample[]>> = {};
  for (const side of SIDES) {
    const mine = reps.filter((rep) => rep.side === side).slice(0, needed);
    if (mine.length < needed) continue;
    const frames = mine.map((rep) => angleFrames(rep.samples.map((s) => s.pose), exercise, side));
    chosen[side] = mine[mostTypicalRep(frames, angleRepDistance)].samples;
  }
  return chosen;
}

/**
 * Whether recording golden reps should keep going: some arm still has fewer than `needed` reps and
 * has done a good rep within the last `patienceMs` (counting from `startedAt` before its first). An
 * arm out of view, or not exercising, is given up on after that long.
 */
export function collectingGoldenReps(reps: readonly CollectedRep[], startedAt: number, now: number, needed: number, patienceMs: number): boolean {
  return SIDES.some((side) => {
    const mine = reps.filter((rep) => rep.side === side);
    return mine.length < needed && now - (mine.at(-1)?.at ?? startedAt) < patienceMs;
  });
}
