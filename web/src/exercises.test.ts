import { describe, expect, it } from "vitest";
import { DEFAULT_EXERCISE, EXERCISES, angleToPercent, jointAngle, type Point } from "./exercises";

const pt = (x: number, y: number): Point => ({ x, y });

describe("jointAngle", () => {
  it.each([
    [pt(0, -1), pt(0, 0), pt(1, 0), 90],
    [pt(0, -1), pt(0, 0), pt(0, 1), 180],
    [pt(1, 1), pt(0, 0), pt(1, 0), 45],
  ])("is the interior angle", (p1, p2, p3, expected) => {
    expect(jointAngle(p1, p2, p3)).toBeCloseTo(expected);
  });

  it("is the same for a mirrored view", () => {
    const [shoulder, elbow, wrist] = [pt(0, -10), pt(0, 0), pt(7, 5)];
    const mirror = (p: Point) => pt(-p.x, p.y);
    expect(jointAngle(mirror(shoulder), mirror(elbow), mirror(wrist))).toBeCloseTo(jointAngle(shoulder, elbow, wrist));
  });
});

describe("angleToPercent", () => {
  it("maps an ascending range", () => {
    expect(angleToPercent(90, [60, 120])).toBe(50);
  });

  it("maps a descending range", () => {
    expect(angleToPercent(150, [150, 50])).toBe(0);
    expect(angleToPercent(100, [150, 50])).toBe(50);
    expect(angleToPercent(50, [150, 50])).toBe(100);
  });

  it.each([
    [[150, 50] as const, 160, 40],
    [[50, 150] as const, 40, 160],
  ])("clips to exactly 0 and 100 beyond %j", (range, beyondStart, beyondEnd) => {
    // RepTracker compares against exactly 0 and 100.
    expect(angleToPercent(beyondStart, range)).toBe(0);
    expect(angleToPercent(beyondEnd, range)).toBe(100);
  });
});

describe("EXERCISES", () => {
  it("includes the default exercise", () => {
    expect(EXERCISES[DEFAULT_EXERCISE]).toBeDefined();
  });

  it.each(Object.entries(EXERCISES))("%s is well formed", (key, exercise) => {
    expect(exercise.name).toBe(key);
    expect(exercise.label).not.toBe("");
    for (const joint of exercise.joints) {
      expect(Number.isInteger(joint) && joint >= 0 && joint <= 32).toBe(true);
    }
    const [start, end] = exercise.angleRange;
    expect(start).not.toBe(end);
    for (const angle of [start, end]) {
      expect(angle >= 0 && angle <= 180).toBe(true);
    }
  });

  it("matches the Python registry", () => {
    // Mirrors src/exercises.py; update both together.
    expect(EXERCISES.bicep_curl).toMatchObject({ joints: [12, 14, 16], angleRange: [150, 50] });
    expect(EXERCISES.squat).toMatchObject({ joints: [24, 26, 28], angleRange: [170, 90] });
  });
});
