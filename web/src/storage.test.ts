import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadGolden, parseGolden, saveGolden, type GoldenRep } from "./storage";

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
