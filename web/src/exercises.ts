// Port of src/exercises.py and joint_angle() from src/core/PoseEstimationModule.py.
// Keep the two in step: same joints, same ranges, same math.

export interface Point {
  x: number;
  y: number;
}

export interface Exercise {
  name: string;
  label: string;
  /** MediaPipe Pose landmark ids forming the tracked joint angle (the middle one is the vertex). */
  joints: readonly [number, number, number];
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
    joints: [12, 14, 16], // right shoulder, elbow, wrist
    angleRange: [150, 50],
  },
  squat: {
    name: "squat",
    label: "Squat",
    joints: [24, 26, 28], // right hip, knee, ankle
    angleRange: [170, 90],
    experimental: true,
  },
};

export const DEFAULT_EXERCISE = "bicep_curl";
