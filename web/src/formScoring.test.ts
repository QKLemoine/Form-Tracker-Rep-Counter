import { describe, expect, it } from "vitest";
import { EXERCISES, type Point, type Side } from "./exercises";
import { dtwDistance, matchPercent, mirrorFrames, repDistance, sideFrame, ZERO_MATCH_DISTANCE, type Frame } from "./formScoring";

const curl = EXERCISES.bicep_curl;

/** A stick figure in pixels: hips at `origin`, torso `size` tall, forearm raised by `bend` (0 = hanging, 1 = level). */
function body(bend: number, { origin = { x: 0, y: 0 }, size = 100, facing = 1 } = {}): (landmark: number) => Point {
  const at = (dx: number, dy: number): Point => ({ x: origin.x + facing * dx * size, y: origin.y + dy * size });
  const points: Record<number, Point> = {};
  for (const [side, offset] of [["left", 0.2], ["right", -0.2]] as [Side, number][]) {
    const [shoulder, elbow, wrist] = curl.joints[side];
    points[side === "left" ? 23 : 24] = at(offset, 0);
    points[shoulder] = at(offset, -1);
    points[elbow] = at(offset, -0.5);
    points[wrist] = at(offset + 0.4 * Math.sin((bend * Math.PI) / 2), -0.5 + 0.4 * Math.cos((bend * Math.PI) / 2));
  }
  return (landmark) => points[landmark];
}

const rep = (side: Side, options = {}, steps = 9): Frame[] =>
  Array.from({ length: steps }, (_, i) => sideFrame(body(Math.sin((i / (steps - 1)) * Math.PI), options), curl, side));

describe("sideFrame", () => {
  it("is relative to the hip in torso lengths", () => {
    // Right side: shoulder straight above the hip, elbow halfway, wrist hanging 0.4 below the elbow.
    const frame = sideFrame(body(0), curl, "right");
    [0, -1, 0, -0.5, 0, -0.1].forEach((expected, i) => expect(frame[i]).toBeCloseTo(expected));
  });

  it("does not depend on where the person stands or how big they appear", () => {
    const near = sideFrame(body(0.5, { origin: { x: 900, y: 400 }, size: 300 }), curl, "left");
    const far = sideFrame(body(0.5, { origin: { x: 50, y: 60 }, size: 40 }), curl, "left");
    near.forEach((value, i) => expect(value).toBeCloseTo(far[i]));
  });

  it("uses the shoulder, knee and ankle for a squat", () => {
    const point = (landmark: number): Point => ({ x: landmark, y: landmark * 2 });
    expect(sideFrame(point, EXERCISES.squat, "left")).toHaveLength(6);
  });
});

describe("dtwDistance", () => {
  const seq = (...values: number[]): Frame[] => values.map((v) => [v]);

  it("is zero for identical sequences", () => {
    expect(dtwDistance(seq(0, 1, 2, 1, 0), seq(0, 1, 2, 1, 0))).toBe(0);
  });

  it("is zero for the same movement at a different speed", () => {
    expect(dtwDistance(seq(0, 1, 2, 1, 0), seq(0, 0, 1, 1, 2, 2, 2, 1, 0))).toBe(0);
  });

  it("is the mean distance along the alignment", () => {
    // Aligns one-to-one: every frame is 1 apart, over 3 steps.
    expect(dtwDistance(seq(0, 10, 0), seq(1, 11, 1))).toBeCloseTo(1);
    // Cheapest alignment pairs 0-1, 1-1, 2-2, 2-3: total 2 over 4 steps.
    expect(dtwDistance(seq(0, 1, 2), seq(1, 2, 3))).toBeCloseTo(0.5);
  });

  it("grows as the movement differs more", () => {
    const golden = seq(0, 1, 2, 1, 0);
    expect(dtwDistance(golden, seq(0, 1, 4, 1, 0))).toBeGreaterThan(dtwDistance(golden, seq(0, 1, 2.5, 1, 0)));
  });

  it("is infinite when either sequence is empty", () => {
    expect(dtwDistance([], seq(1))).toBe(Infinity);
    expect(dtwDistance(seq(1), [])).toBe(Infinity);
  });
});

describe("repDistance", () => {
  it("is zero for the other arm doing the mirror-image rep", () => {
    // Facing the camera, the left arm's movement is the right arm's mirrored.
    const golden = rep("right");
    const leftArm = mirrorFrames(rep("right"));
    expect(dtwDistance(golden, leftArm)).toBeGreaterThan(0.1);
    expect(repDistance(golden, leftArm)).toBeCloseTo(0);
  });

  it("is zero for the same rep filmed from the other side", () => {
    expect(repDistance(rep("right"), rep("right", { facing: -1 }))).toBeCloseTo(0);
  });

  it("is much smaller for the same rep at a different speed than for a rep that stops halfway", () => {
    const slower = repDistance(rep("right", {}, 30), rep("right", {}, 60));
    const half = Array.from({ length: 30 }, (_, i) => sideFrame(body(0.5 * Math.sin((i / 29) * Math.PI)), curl, "right"));
    expect(slower).toBeLessThan(0.02);
    expect(repDistance(rep("right", {}, 30), half)).toBeGreaterThan(slower * 5);
  });
});

describe("matchPercent", () => {
  it("maps distance onto 100-0", () => {
    expect(matchPercent(0)).toBe(100);
    expect(matchPercent(ZERO_MATCH_DISTANCE / 2)).toBe(50);
    expect(matchPercent(ZERO_MATCH_DISTANCE)).toBe(0);
    expect(matchPercent(ZERO_MATCH_DISTANCE * 3)).toBe(0);
    expect(matchPercent(Infinity)).toBe(0);
  });
});
