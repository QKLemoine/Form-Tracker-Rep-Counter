// Form scoring: the approach of src/analytics/form_scoring.py (centre on the hip, scale by torso
// length, align with Dynamic Time Warping), applied to one body side at a time.

import { HIP, SHOULDER, type Exercise, type Point, type Side } from "./exercises";

/** One video frame of one body side: flattened (x, y) pairs relative to that side's hip, in torso lengths. */
export type Frame = number[];

/**
 * The scored points for a side are its shoulder plus the exercise's tracked joints, so the frame
 * captures both the limb and how the torso leans. `point` returns a landmark in pixels.
 */
export function sideFrame(point: (landmark: number) => Point, exercise: Exercise, side: Side): Frame {
  const hip = point(HIP[side]);
  const shoulder = point(SHOULDER[side]);
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const scale = torso > 1e-6 ? torso : 1;
  const landmarks = new Set([SHOULDER[side], ...exercise.joints[side]]);
  landmarks.delete(HIP[side]); // always (0, 0) after centring
  return [...landmarks].flatMap((id) => {
    const p = point(id);
    return [(p.x - hip.x) / scale, (p.y - hip.y) / scale];
  });
}

/** The same movement as seen in a mirror (x flipped). */
export function mirrorFrames(frames: Frame[]): Frame[] {
  return frames.map((frame) => frame.map((value, i) => (i % 2 === 0 ? -value : value)));
}

function frameDistance(a: Frame, b: Frame): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/**
 * Exact Dynamic Time Warping: the mean distance between aligned frames along the cheapest
 * alignment of the two sequences, so reps done at different speeds still compare. Lower is closer.
 */
export function dtwDistance(a: Frame[], b: Frame[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  // Rolling rows of [accumulated cost, alignment length]; ties prefer the diagonal, then a, then b.
  let cost = new Array<number>(b.length + 1).fill(Infinity);
  let steps = new Array<number>(b.length + 1).fill(0);
  cost[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    const nextCost = new Array<number>(b.length + 1).fill(Infinity);
    const nextSteps = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      let best = cost[j - 1];
      let bestSteps = steps[j - 1];
      if (cost[j] < best) [best, bestSteps] = [cost[j], steps[j]];
      if (nextCost[j - 1] < best) [best, bestSteps] = [nextCost[j - 1], nextSteps[j - 1]];
      nextCost[j] = best + frameDistance(a[i - 1], b[j - 1]);
      nextSteps[j] = bestSteps + 1;
    }
    [cost, steps] = [nextCost, nextSteps];
  }
  return cost[b.length] / steps[b.length];
}

/**
 * How far a rep is from the golden rep, whichever arm or camera side either was filmed from:
 * the closer of the rep as seen and its mirror image.
 */
export function repDistance(golden: Frame[], rep: Frame[]): number {
  return Math.min(dtwDistance(golden, rep), dtwDistance(golden, mirrorFrames(rep)));
}

/** Distance (in torso lengths) shown as a 0% match. A first guess, not yet tuned against real good and bad reps. */
export const ZERO_MATCH_DISTANCE = 0.6;

/** A rep's distance from the golden rep as a 0-100 match score. */
export function matchPercent(distance: number): number {
  return Math.round(100 * Math.max(0, 1 - distance / ZERO_MATCH_DISTANCE));
}
