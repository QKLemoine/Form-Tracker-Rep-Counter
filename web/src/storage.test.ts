import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANGLES, mediapipeHeader, type PoseTrackFrame } from "./poseTrack";
import { loadAngleGolden, loadGolden, parseAngleGolden, parseGolden, saveAngleGolden, saveGolden, type AngleGoldenRep, type GoldenRep } from "./storage";

const golden: GoldenRep = { side: "right", frames: [[0, -1, 0.5, 0.25], [0, -1, 0.5, 0.5]] };

it("parses what it stores", () => {
  expect(parseGolden(JSON.stringify(golden))).toEqual(golden);
});

it("ignores fields it does not know", () => {
  expect(parseGolden(JSON.stringify({ ...golden, ranges: { left: [150, 78] } }))).toEqual(golden);
});

it.each([
  ["nothing stored", null],
  ["not JSON", "{oops"],
  ["not an object", "42"],
  ["unknown side", JSON.stringify({ side: "middle", frames: golden.frames })],
  ["no frames", JSON.stringify({ side: "left", frames: [] })],
  ["empty frames", JSON.stringify({ side: "left", frames: [[], []] })],
  ["ragged frames", JSON.stringify({ side: "left", frames: [[1, 2], [1]] })],
  ["non-numeric values", JSON.stringify({ side: "left", frames: [[1, "2"]] })],
  ["non-finite values", '{"side":"left","frames":[[1,null]]}'],
])("rejects %s", (_name, json) => {
  expect(parseGolden(json)).toBeNull();
});

function stubStorage(overrides: Partial<Storage> = {}) {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    ...overrides,
  });
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

it("round-trips a golden rep per exercise", () => {
  expect(saveGolden("bicep_curl", golden)).toBe(true);
  expect(loadGolden("bicep_curl")).toEqual(golden);
  expect(loadGolden("squat")).toBeNull();
});

it("survives the browser blocking storage", () => {
  const blocked = () => {
    throw new DOMException("denied", "SecurityError");
  };
  stubStorage({ getItem: blocked, setItem: blocked });
  expect(saveGolden("bicep_curl", golden)).toBe(false);
  expect(loadGolden("bicep_curl")).toBeNull();
});

describe("v3 golden reps (angle scorer)", () => {
  const frame = (elbow: number): PoseTrackFrame => ({
    t: 0,
    positions: null,
    confidence: null,
    angles: Object.fromEntries(ANGLES.map((n) => [n, n === "r_elbow" ? elbow : 90])) as PoseTrackFrame["angles"],
    origin: Object.fromEntries(ANGLES.map((n) => [n, "observed"])) as PoseTrackFrame["origin"],
  });
  const angleGolden: AngleGoldenRep = { side: "right", track: { ...mediapipeHeader("mediapipe-pose-full", "bicep_curl", false), frames: [frame(150), frame(60)] } };

  it("parses what it stores", () => {
    expect(parseAngleGolden(JSON.stringify(angleGolden))).toEqual(angleGolden);
  });

  it.each([
    ["unknown side", { ...angleGolden, side: "middle" }],
    ["no track", { side: "left" }],
    ["not a PoseTrack", { ...angleGolden, track: { ...angleGolden.track, format: "other" } }],
    ["another PoseTrack version", { ...angleGolden, track: { ...angleGolden.track, version: 2 } }],
    ["no frames", { ...angleGolden, track: { ...angleGolden.track, frames: [] } }],
    ["a non-numeric angle", { ...angleGolden, track: { ...angleGolden.track, frames: [{ ...frame(1), angles: { ...frame(1).angles, l_knee: "x" } }] } }],
  ])("rejects %s", (_name, value) => {
    expect(parseAngleGolden(JSON.stringify(value))).toBeNull();
  });

  it("is stored under its own key and never touches the v2 golden rep", () => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) });
    saveGolden("bicep_curl", golden);
    const v2Before = items.get("form-trainer:golden:v2:bicep_curl");
    expect(saveAngleGolden("bicep_curl", angleGolden)).toBe(true);
    expect(saveAngleGolden("bicep_curl", { ...angleGolden, side: "left" })).toBe(true);
    expect(items.get("form-trainer:golden:v2:bicep_curl")).toBe(v2Before);
    expect(loadGolden("bicep_curl")).toEqual(golden);
    expect(loadAngleGolden("bicep_curl")).toEqual({ ...angleGolden, side: "left" });
    expect([...items.keys()].sort()).toEqual(["form-trainer:golden:v2:bicep_curl", "form-trainer:golden:v3:bicep_curl"]);
  });
});
