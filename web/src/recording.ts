// Landmark recordings: joint coordinates over time, never video. The debug overlay saves them on
// the phone and scripts/extract_landmarks.py writes the same format from a video file, so either
// can be replayed through the tracker as a test fixture.

import type { PoseInput } from "./tracking";

/** Shoulders, elbows, wrists, hips, knees, ankles: every landmark the exercises and scoring use. */
export const RECORDED_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface RecordedFrame {
  /** Milliseconds since the recording started. */
  t: number;
  /** Per recorded landmark: [x, y, visibility] in the image, or null if no one was in view. */
  image: number[][] | null;
  /** Per recorded landmark: [x, y, z] in metres. */
  world: number[][] | null;
}

export interface LandmarkRecording {
  source: string;
  mirrored: boolean;
  width: number;
  height: number;
  landmarkIds: number[];
  frames: RecordedFrame[];
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export function recordFrame(pose: PoseInput | null, t: number): RecordedFrame {
  if (!pose) return { t: round(t, 1), image: null, world: null };
  return {
    t: round(t, 1),
    image: RECORDED_LANDMARKS.map((id) => [round(pose.image[id].x, 4), round(pose.image[id].y, 4), round(pose.image[id].visibility ?? 0, 3)]),
    world: RECORDED_LANDMARKS.map((id) => [round(pose.world[id].x, 4), round(pose.world[id].y, 4), round(pose.world[id].z, 4)]),
  };
}

/** Turn a recording back into the poses the tracker takes, indexable by landmark id. */
export function playback(recording: LandmarkRecording): { t: number; pose: PoseInput | null }[] {
  return recording.frames.map(({ t, image, world }) => {
    if (!image || !world) return { t, pose: null };
    const pose = { image: [] as { x: number; y: number; visibility: number }[], world: [] as { x: number; y: number; z: number }[] };
    recording.landmarkIds.forEach((id, i) => {
      pose.image[id] = { x: image[i][0], y: image[i][1], visibility: image[i][2] };
      pose.world[id] = { x: world[i][0], y: world[i][1], z: world[i][2] };
    });
    return { t, pose };
  });
}
