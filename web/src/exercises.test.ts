import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXERCISE,
  EXERCISES,
  SIDES,
  angleToPercent,
  calibrateRange,
  jointAngle,
  repProgress,
  type Point,
} from "./exercises";

const pt = (x: number, y: number): Point => ({ x, y });

describe("jointAngle", () => {
  it.each([
    [pt(0, -1), pt(0, 0), pt(1, 0), 90],
    [pt(0, -1), pt(0, 0), pt(0, 1), 180],
    [pt(1, 1), pt(0, 0), pt(1, 0), 45],
  ])("is the interior angle", (p1, p2, p3, expected) => {
    expect(jointAngle(p1, p2, p3)).toBeCloseTo(expected);
  });

  it("ignores foreshortening when given depth", () => {
    // An upper arm hanging down and a forearm pointing straight at the camera: a true right angle.
    // Its 2D image is degenerate (the wrist sits on the elbow); a forearm tilted slightly up reads as fully closed.
    const shoulder = { x: 0, y: -1, z: 0 };
    const elbow = { x: 0, y: 0, z: 0 };
    expect(jointAngle(shoulder, elbow, { x: 0, y: 0, z: -1 })).toBeCloseTo(90);
    const tilted = { x: 0, y: -0.1, z: -1 };
    expect(jointAngle(shoulder, elbow, tilted)).toBeCloseTo(84.3, 1);
    expect(jointAngle(pt(0, -1), pt(0, 0), pt(tilted.x, tilted.y))).toBeCloseTo(0);
  });

  it("treats a zero-length segment as straight instead of NaN", () => {
    expect(jointAngle(pt(0, 0), pt(0, 0), pt(1, 0))).toBe(180);
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
    expect(angleToPercent(beyondStart, range)).toBe(0);
    expect(angleToPercent(beyondEnd, range)).toBe(100);
  });
});

describe("calibration", () => {
  const curl = [150, 90] as const;
  /** Angles sampled over two reps between `rest` and `top`, with the given per-frame noise. */
  const reps = (rest: number, top: number, noise = 0) =>
    Array.from({ length: 120 }, (_, i) => (rest + top) / 2 + ((rest - top) / 2) * Math.cos((i / 60) * 2 * Math.PI) + noise * Math.sin(i * 12.9898));

  it("repProgress is unclipped", () => {
    expect(repProgress(150, curl)).toBeCloseTo(0);
    expect(repProgress(90, curl)).toBe(1);
    expect(repProgress(60, curl)).toBe(1.5);
    expect(repProgress(170, curl)).toBeCloseTo(-1 / 3);
  });

  it("finds the range a limb actually covers", () => {
    const [rest, top] = calibrateRange(curl, reps(170, 60))!;
    expect(rest).toBeGreaterThan(160);
    expect(rest).toBeLessThanOrEqual(170);
    expect(top).toBeLessThan(70);
    expect(top).toBeGreaterThanOrEqual(60);
  });

  it("gives each side its own range when the camera reads them differently", () => {
    // The same real movement, read as 172->52 on one side and 165->88 on the other.
    const left = calibrateRange(curl, reps(172, 52))!;
    const right = calibrateRange(curl, reps(165, 88))!;
    expect(angleToPercent(60, left)).toBeGreaterThan(90);
    expect(angleToPercent(60, right)).toBe(100);
    // With its own range the right side now reaches the top where the shared default left it short.
    expect(angleToPercent(96, curl)).toBe(90);
    expect(angleToPercent(96, right)).toBeGreaterThan(85);
    // And the left side no longer fills early.
    expect(angleToPercent(90, curl)).toBe(100);
    expect(angleToPercent(90, left)).toBeLessThan(75);
  });

  it("is not thrown off by a few stray frames", () => {
    const clean = calibrateRange(curl, reps(170, 60))!;
    const withOutliers = calibrateRange(curl, [...reps(170, 60), 5, 8, 179, 180])!;
    // The strays read 5-180 degrees; the range moves by a couple of degrees at most.
    expect(Math.abs(withOutliers[0] - clean[0])).toBeLessThan(3);
    expect(Math.abs(withOutliers[1] - clean[1])).toBeLessThan(3);
  });

  it("works for a range that runs upward", () => {
    const [rest, top] = calibrateRange([30, 130], reps(40, 120))!;
    expect(rest).toBeLessThan(50);
    expect(top).toBeGreaterThan(110);
  });

  it("takes rest from where the limb usually hangs, not the extreme of its wobble", () => {
    // Hanging at about 165 but wobbling out to 175 now and then, with one rep in the middle.
    const hanging = (i: number) => 165 + (i % 7 === 0 ? 10 : 2 * Math.sin(i));
    const angles = [...Array.from({ length: 80 }, (_, i) => hanging(i)), ...reps(165, 60).slice(0, 61), ...Array.from({ length: 80 }, (_, i) => hanging(i))];
    const [rest] = calibrateRange(curl, angles)!;
    expect(rest).toBeLessThan(170);
    expect(rest).toBeGreaterThan(160);
  });

  it("is null for half a movement, whose furthest point is not the top", () => {
    const full = reps(170, 60).slice(0, 61); // rest -> top -> rest
    expect(calibrateRange(curl, full)).not.toBeNull();
    expect(calibrateRange(curl, full.slice(0, 22))).toBeNull(); // only the way up, stopping partway
    expect(calibrateRange(curl, full.slice(40))).toBeNull(); // only the way down
  });

  it("is null when the limb did not do the movement", () => {
    expect(calibrateRange(curl, reps(170, 155))).toBeNull();
    expect(calibrateRange(curl, [170, 60])).toBeNull();
    expect(calibrateRange(curl, [])).toBeNull();
  });
});

describe("EXERCISES", () => {
  it("includes the default exercise", () => {
    expect(EXERCISES[DEFAULT_EXERCISE]).toBeDefined();
  });

  it.each(Object.entries(EXERCISES))("%s is well formed", (key, exercise) => {
    expect(exercise.name).toBe(key);
    expect(exercise.label).not.toBe("");
    for (const side of SIDES) {
      expect(exercise.joints[side]).toHaveLength(3);
      for (const joint of exercise.joints[side]) {
        expect(Number.isInteger(joint) && joint >= 0 && joint <= 32).toBe(true);
      }
    }
    // MediaPipe numbers left landmarks odd and the matching right landmark one higher.
    expect(exercise.joints.right).toEqual(exercise.joints.left.map((joint) => joint + 1));
    const [start, end] = exercise.angleRange;
    expect(start).not.toBe(end);
    for (const angle of [start, end]) {
      expect(angle >= 0 && angle <= 180).toBe(true);
    }
  });

  it("uses the same right-side joints as the Python registry", () => {
    // src/exercises.py tracks the right side only. Angle ranges are not compared: Python's are for 2D angles.
    expect(EXERCISES.bicep_curl.joints.right).toEqual([12, 14, 16]);
    expect(EXERCISES.squat.joints.right).toEqual([24, 26, 28]);
  });
});
