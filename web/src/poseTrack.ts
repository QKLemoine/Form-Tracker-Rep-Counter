// PoseTrack: the one format every pose source produces (MediaPipe here, GVHMR after the workout),
// so one scoring engine reads them all. The format is defined in schema/posetrack.schema.json;
// src/posetrack.py implements the same maths, and a test checks the two agree.

import { jointAngle, type Point } from "./exercises";
import { round, type LandmarkRecording } from "./recording";
import type { PoseInput } from "./tracking";

/** The joints of a track, in the order of each frame's positions and confidence. "l"/"r" are the person's own sides. */
export const JOINTS = [
  "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
  "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle",
] as const;
export type JointName = (typeof JOINTS)[number];

/** MediaPipe Pose landmark id of each joint. */
export const MEDIAPIPE_LANDMARK: Record<JointName, number> = {
  l_shoulder: 11, r_shoulder: 12, l_elbow: 13, r_elbow: 14, l_wrist: 15, r_wrist: 16,
  l_hip: 23, r_hip: 24, l_knee: 25, r_knee: 26, l_ankle: 27, r_ankle: 28,
};

export const ANGLES = ["l_elbow", "r_elbow", "l_shoulder", "r_shoulder", "l_hip", "r_hip", "l_knee", "r_knee", "trunk_lean"] as const;
export type AngleName = (typeof ANGLES)[number];

/**
 * The joints each angle is measured from, which also give its confidence (their minimum). A
 * three-joint angle is measured at the middle one; trunk_lean is the line from the hip midpoint to
 * the shoulder midpoint against the up vector.
 */
export const ANGLE_JOINTS: Record<AngleName, readonly JointName[]> = {
  l_elbow: ["l_shoulder", "l_elbow", "l_wrist"],
  r_elbow: ["r_shoulder", "r_elbow", "r_wrist"],
  l_shoulder: ["l_hip", "l_shoulder", "l_elbow"],
  r_shoulder: ["r_hip", "r_shoulder", "r_elbow"],
  l_hip: ["l_shoulder", "l_hip", "l_knee"],
  r_hip: ["r_shoulder", "r_hip", "r_knee"],
  l_knee: ["l_hip", "l_knee", "l_ankle"],
  r_knee: ["r_hip", "r_knee", "r_ankle"],
  trunk_lean: ["l_shoulder", "r_shoulder", "l_hip", "r_hip"],
};

export type Vec3 = [number, number, number];
export type Origin = "observed" | "interpolated" | "rep_prior";
export type CoordinateFrame = "mediapipe_world" | "gvhmr_world";
export type UpSource = "device_gravity" | "image_vertical" | "model_gravity";
export type ConfidenceScale = "mediapipe_visibility" | "vitpose_heatmap";

export interface PoseTrackFrame {
  /** Milliseconds since the track started. */
  t: number;
  /** Per joint, in JOINTS order, in the track's coordinate frame; null when no one is in view. */
  positions: Vec3[] | null;
  /** Per joint, in JOINTS order, on the track's confidence scale; null when no one is in view. */
  confidence: number[] | null;
  /** This frame's up vector, when the track has no fixed one. */
  up?: Vec3;
  angles: Record<AngleName, number | null>;
  /** Null exactly when the angle is null. */
  origin: Record<AngleName, Origin | null>;
}

export interface PoseTrack {
  format: "posetrack";
  version: 1;
  source: string;
  clip?: string;
  exercise: string | null;
  /** True if the video was flipped left-right before pose estimation; then "l_*" is the person's real right side. */
  mirrored: boolean;
  coordinateFrame: CoordinateFrame;
  up: { source: UpSource; vector?: Vec3 };
  confidenceScale: ConfidenceScale;
  joints: typeof JOINTS;
  bodyProfile?: { source: string; boneLengths: Partial<Record<string, number>> };
  frames: PoseTrackFrame[];
}

/** The top of the picture in MediaPipe's world frame, whose y axis points down the image. */
export const MEDIAPIPE_IMAGE_UP: Vec3 = [0, -1, 0];

const point = ([x, y, z]: readonly number[]): Point => ({ x, y, z });
const midpoint = (a: readonly number[], b: readonly number[]): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Every angle of one pose, in degrees, unrounded. `positions` are in JOINTS order. */
export function computeAngles(positions: readonly (readonly number[])[], up: readonly number[]): Record<AngleName, number> {
  const at = (joint: JointName) => positions[JOINTS.indexOf(joint)];
  const angles = {} as Record<AngleName, number>;
  for (const name of ANGLES) {
    if (name === "trunk_lean") continue;
    const [a, b, c] = ANGLE_JOINTS[name].map(at);
    angles[name] = jointAngle(point(a), point(b), point(c));
  }
  const hips = midpoint(at("l_hip"), at("r_hip"));
  const shoulders = midpoint(at("l_shoulder"), at("r_shoulder"));
  angles.trunk_lean = jointAngle(point(shoulders), point(hips), point([hips[0] + up[0], hips[1] + up[1], hips[2] + up[2]]));
  return angles;
}

/** An angle's confidence: the least confident of the joints it is measured from, or null if no one is in view. */
export function angleConfidence(frame: PoseTrackFrame, angle: AngleName): number | null {
  if (!frame.confidence) return null;
  return Math.min(...ANGLE_JOINTS[angle].map((joint) => frame.confidence![JOINTS.indexOf(joint)]));
}

const emptyAngles = () => Object.fromEntries(ANGLES.map((name) => [name, null])) as Record<AngleName, null>;

/** One frame from measured positions and confidences: every angle is observed, rounded to 0.01 degrees. */
export function observedFrame(t: number, positions: Vec3[] | null, confidence: number[] | null, up: readonly number[]): PoseTrackFrame {
  if (!positions || !confidence) return { t, positions: null, confidence: null, angles: emptyAngles(), origin: emptyAngles() };
  const raw = computeAngles(positions, up);
  const angles = Object.fromEntries(ANGLES.map((name) => [name, round(raw[name], 2)])) as Record<AngleName, number>;
  const origin = Object.fromEntries(ANGLES.map((name) => [name, "observed"])) as Record<AngleName, Origin>;
  return { t, positions, confidence, angles, origin };
}

/**
 * One frame from a live MediaPipe pose (null when no one is in view), measured against the image's
 * vertical. MediaPipe always returns every landmark; a pose missing any joint (a partial test pose)
 * gives an empty frame.
 */
export function frameFromPose(pose: PoseInput | null, t: number): PoseTrackFrame {
  const complete = pose !== null && JOINTS.every((joint) => pose.world[MEDIAPIPE_LANDMARK[joint]] && pose.image[MEDIAPIPE_LANDMARK[joint]]);
  if (!complete) return observedFrame(round(t, 1), null, null, MEDIAPIPE_IMAGE_UP);
  const positions = JOINTS.map((joint) => {
    const p = pose.world[MEDIAPIPE_LANDMARK[joint]];
    return [round(p.x, 4), round(p.y, 4), round(p.z, 4)] as Vec3;
  });
  const confidence = JOINTS.map((joint) => round(pose.image[MEDIAPIPE_LANDMARK[joint]].visibility ?? 0, 3));
  return observedFrame(round(t, 1), positions, confidence, MEDIAPIPE_IMAGE_UP);
}

/** A track's header for MediaPipe world landmarks, measured against the image's vertical. */
export function mediapipeHeader(source: string, exercise: string | null, mirrored: boolean): Omit<PoseTrack, "frames"> {
  return {
    format: "posetrack",
    version: 1,
    source,
    exercise,
    mirrored,
    coordinateFrame: "mediapipe_world",
    up: { source: "image_vertical", vector: MEDIAPIPE_IMAGE_UP },
    confidenceScale: "mediapipe_visibility",
    joints: JOINTS,
  };
}

/** Convert a landmark recording (see recording.ts) to a PoseTrack. */
export function fromRecording(recording: LandmarkRecording, source: string, exercise: string | null): PoseTrack {
  const column = JOINTS.map((joint) => {
    const i = recording.landmarkIds.indexOf(MEDIAPIPE_LANDMARK[joint]);
    if (i < 0) throw new Error(`recording has no landmark ${MEDIAPIPE_LANDMARK[joint]} (${joint})`);
    return i;
  });
  const frames = recording.frames.map(({ t, image, world }) =>
    image && world
      ? observedFrame(t, column.map((i) => [...world[i]] as Vec3), column.map((i) => image[i][2]), MEDIAPIPE_IMAGE_UP)
      : observedFrame(t, null, null, MEDIAPIPE_IMAGE_UP),
  );
  return { ...mediapipeHeader(source, exercise, recording.mirrored), clip: recording.source, frames };
}
