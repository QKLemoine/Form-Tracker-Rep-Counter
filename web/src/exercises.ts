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
  /** Default interior degrees (0-180), measured in 3D: [angle at rest = 0% of the rep, angle at the peak = 100%]. */
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

/** Map a joint angle onto 0-100% of the rep, clipped at both ends. The range may run in either direction. */
export function angleToPercent(angle: number, range: AngleRange): number {
  return Math.min(1, Math.max(0, repProgress(angle, range))) * 100;
}

/** A limb must travel at least this far during calibration, or it is taken as not having done the movement. */
export const MIN_CALIBRATION_SPAN_DEGREES = 30;

/**
 * The angle range one limb actually covers, as this camera reads it, from angles sampled in order
 * while the person does a few full reps. The pose model reads the two sides of the body, and
 * different camera positions, several degrees apart, so each side gets its own range instead of
 * sharing `defaults`.
 *
 * The top is the 95th percentile of progress, so a few stray frames can't set it. Rest is the
 * middle of the readings near the extended end, not the extreme: a limb at rest wobbles by several
 * degrees, and a rest angle taken from the far end of that wobble is one it rarely gets back to.
 *
 * Returns null unless the samples show a full rep (near rest, up to the top, back near rest),
 * since the furthest point of half a movement is not the top, or if the limb moved too little.
 */
export function calibrateRange(defaults: AngleRange, angles: number[]): [number, number] | null {
  if (angles.length < 10) return null;
  const [start, end] = defaults;
  const progress = angles.map((angle) => repProgress(angle, defaults));
  const sorted = [...progress].sort((x, y) => x - y);
  const at = (quantile: number) => sorted[Math.round(quantile * (sorted.length - 1))];
  const [extended, top] = [at(0.05), at(0.95)];
  const restCluster = sorted.filter((value) => value <= extended + 0.25 * (top - extended));
  const rest = restCluster[Math.floor(restCluster.length / 2)];
  if ((top - rest) * Math.abs(end - start) < MIN_CALIBRATION_SPAN_DEGREES) return null;

  const nearRest = (value: number) => value <= rest + 0.25 * (top - rest);
  const firstTop = progress.findIndex((value) => value >= top);
  let lastTop = progress.length - 1;
  while (progress[lastTop] < top) lastTop--;
  if (!progress.slice(0, firstTop).some(nearRest) || !progress.slice(lastTop + 1).some(nearRest)) return null;

  return [start + (end - start) * rest, start + (end - start) * top];
}

export const EXERCISES: Record<string, Exercise> = {
  bicep_curl: {
    name: "bicep_curl",
    label: "Bicep Curl",
    joints: { left: [11, 13, 15], right: [12, 14, 16] }, // shoulder, elbow, wrist
    // Used until the person calibrates. The 3D estimate under-reads depth: a full curl bottoms out
    // around 50-60 degrees filmed side-on but only about 82 filmed from the front, so the default
    // peak is a loose 90 and a curl that stops at forearm-level counts until calibration tightens it.
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
