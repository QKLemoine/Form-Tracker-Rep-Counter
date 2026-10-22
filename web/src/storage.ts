// Golden reps live in the browser's localStorage, one per exercise and scorer. They never leave the device.
//
// Two formats sit side by side under separate keys: v2 for the position scorer (formScoring.ts) and
// v3 for the angle scorer (angleScoring.ts). Each scorer reads and writes only its own key, so a v2
// golden rep is never deleted or overwritten and the position scorer behind ?scorer=position keeps working.

import type { Side } from "./exercises";
import type { Frame } from "./formScoring";
import { ANGLES, type PoseTrack } from "./poseTrack";

export interface GoldenRep {
  /** Which side of the body performed the recorded rep. */
  side: Side;
  frames: Frame[];
}

// The version covers the frame layout in formScoring.ts and which frames make up a rep in
// repTracker.ts; bump it if either changes, so reps recorded under the old rules are not compared.
const key = (exerciseName: string) => `form-trainer:golden:v2:${exerciseName}`;

/** Parse a stored golden rep, returning null for anything missing or malformed. */
export function parseGolden(json: string | null): GoldenRep | null {
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { side, frames } = data as Record<string, unknown>;
  if (side !== "left" && side !== "right") return null;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const width = Array.isArray(frames[0]) ? frames[0].length : 0;
  const wellFormed = frames.every(
    (frame) => Array.isArray(frame) && frame.length === width && frame.every((v) => typeof v === "number" && Number.isFinite(v)),
  );
  if (width === 0 || !wellFormed) return null;
  return { side, frames: frames as Frame[] };
}

function load<T>(storageKey: string, parse: (json: string | null) => T | null): T | null {
  try {
    return parse(localStorage.getItem(storageKey));
  } catch {
    return null; // storage blocked (e.g. private browsing)
  }
}

function save(storageKey: string, value: unknown): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The position scorer's golden rep (v2). */
export function loadGolden(exerciseName: string): GoldenRep | null {
  return load(key(exerciseName), parseGolden);
}

/** Returns false if the browser refused to store it; the rep still works for this visit. */
export function saveGolden(exerciseName: string, golden: GoldenRep): boolean {
  return save(key(exerciseName), golden);
}

/**
 * The angle scorer's golden rep (v3): the rep as a PoseTrack, with positions and every angle, so a
 * later scorer can use angles this one ignores without the rep being recorded again.
 */
export interface AngleGoldenRep {
  /** Which side of the body performed the recorded rep. */
  side: Side;
  /** The rep's frames, with times from the start of the rep. */
  track: PoseTrack;
}

const angleKey = (exerciseName: string) => `form-trainer:golden:v3:${exerciseName}`;

/** Parse a stored v3 golden rep, returning null for anything missing or malformed. */
export function parseAngleGolden(json: string | null): AngleGoldenRep | null {
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { side, track } = data as Record<string, unknown>;
  if (side !== "left" && side !== "right") return null;
  if (typeof track !== "object" || track === null) return null;
  const { format, version, frames } = track as Record<string, unknown>;
  if (format !== "posetrack" || version !== 1 || !Array.isArray(frames) || frames.length === 0) return null;
  const wellFormed = frames.every((frame) => {
    const angles = (frame as Record<string, unknown> | null)?.angles as Record<string, unknown> | undefined;
    return typeof angles === "object" && angles !== null && ANGLES.every((name) => angles[name] === null || Number.isFinite(angles[name]));
  });
  return wellFormed ? { side, track: track as PoseTrack } : null;
}

export function loadAngleGolden(exerciseName: string): AngleGoldenRep | null {
  return load(angleKey(exerciseName), parseAngleGolden);
}

/** Returns false if the browser refused to store it; the rep still works for this visit. */
export function saveAngleGolden(exerciseName: string, golden: AngleGoldenRep): boolean {
  return save(angleKey(exerciseName), golden);
}
