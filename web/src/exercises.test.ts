import { describe, expect, it } from "vitest";
import {
  CALIBRATION_MARGIN_DEGREES,
  DEFAULT_EXERCISE,
  EXERCISES,
  SIDES,
  angleToPercent,
  calibratedRange,
  furthestSustained,
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
    // RepTracker compares against exactly 0 and 100.
    expect(angleToPercent(beyondStart, range)).toBe(0);
    expect(angleToPercent(beyondEnd, range)).toBe(100);
  });
});

describe("calibration", () => {
  const curl = [150, 90] as const;

  it("repProgress is unclipped", () => {
    expect(repProgress(150, curl)).toBeCloseTo(0);
    expect(repProgress(90, curl)).toBe(1);
    expect(repProgress(60, curl)).toBe(1.5);
    expect(repProgress(170, curl)).toBeCloseTo(-1 / 3);
  });

  it("furthestSustained ignores a few outlier frames", () => {
    const progress = [0, 0.5, 0.9, 0.9, 0.9, 0.9, 0.9, 3, 0.4];
    expect(furthestSustained(progress)).toBe(0.9);
    expect(furthestSustained([0.2, 0.7])).toBe(0.2);
    expect(furthestSustained([])).toBe(-Infinity);
  });

  it("sets the peak just short of where the limb got to", () => {
    // Reached 82 degrees (short of the default 90): the peak moves out to 90.
    expect(calibratedRange(curl, repProgress(82, curl))).toEqual([150, 82 + CALIBRATION_MARGIN_DEGREES]);
    // Reached 55 degrees: the peak tightens to 63, so a half curl no longer counts.
    expect(calibratedRange(curl, repProgress(55, curl))).toEqual([150, 55 + CALIBRATION_MARGIN_DEGREES]);
  });

  it("works for a range that runs upward", () => {
    expect(calibratedRange([30, 130], repProgress(120, [30, 130]))).toEqual([30, 120 - CALIBRATION_MARGIN_DEGREES]);
  });

  it("makes a rep that reaches the same position count as 100%", () => {
    const range = calibratedRange(curl, repProgress(97, curl))!;
    expect(angleToPercent(97, range)).toBe(100);
    expect(angleToPercent(99, range)).toBe(100);
    expect(angleToPercent(115, range)).toBeLessThan(100);
  });

  it("is null when the limb did not do the rep", () => {
    expect(calibratedRange(curl, repProgress(140, curl))).toBeNull();
    expect(calibratedRange(curl, -Infinity)).toBeNull();
    expect(calibratedRange(curl, NaN)).toBeNull();
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
