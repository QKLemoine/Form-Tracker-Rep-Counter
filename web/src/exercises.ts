// Port of src/exercises.py and joint_angle() from src/core/PoseEstimationModule.py.
// The right-side joints, ranges and math match Python; the left side is web-only for now.

export interface Point {
  x: number;
  y: number;
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
  /** Interior degrees (0-180): [angle at rest = 0% of the rep, angle at the peak = 100%]. */
  angleRange: readonly [number, number];
  /** True while the range is an uncalibrated placeholder. */
  experimental?: boolean;
}

/** Interior angle in degrees (0-180) at p2. Unsigned, so a limb reads the same whichever side faces the camera. */
export function jointAngle(p1: Point, p2: Point, p3: Point): number {
  const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
  const degrees = Math.abs((radians * 180) / Math.PI);
  return degrees > 180 ? 360 - degrees : degrees;
}

/** Map a joint angle onto 0-100% of the rep, clipped to exactly 0 and 100. The range may run in either direction. */
export function angleToPercent(angle: number, [start, end]: readonly [number, number]): number {
  const fraction = (angle - start) / (end - start);
  return Math.min(1, Math.max(0, fraction)) * 100;
}

export const EXERCISES: Record<string, Exercise> = {
  bicep_curl: {
    name: "bicep_curl",
    label: "Bicep Curl",
    joints: { left: [11, 13, 15], right: [12, 14, 16] }, // shoulder, elbow, wrist
    angleRange: [150, 50],
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
