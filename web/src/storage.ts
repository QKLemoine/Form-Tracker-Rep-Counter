// Golden reps live in the browser's localStorage, one per exercise. They never leave the device.

import type { Side } from "./exercises";
import type { Frame } from "./formScoring";

export interface GoldenRep {
  /** Which side of the body performed the recorded rep. */
  side: Side;
  frames: Frame[];
}

// The version covers the frame layout in formScoring.ts; bump it if that changes.
const key = (exerciseName: string) => `form-trainer:golden:v1:${exerciseName}`;

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

export function loadGolden(exerciseName: string): GoldenRep | null {
  try {
    return parseGolden(localStorage.getItem(key(exerciseName)));
  } catch {
    return null; // storage blocked (e.g. private browsing)
  }
}

/** Returns false if the browser refused to store it; the rep still works for this visit. */
export function saveGolden(exerciseName: string, golden: GoldenRep): boolean {
  try {
    localStorage.setItem(key(exerciseName), JSON.stringify(golden));
    return true;
  } catch {
    return false;
  }
}
