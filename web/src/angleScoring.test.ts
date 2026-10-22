import { describe, expect, it } from "vitest";
import { angleFrames, angleMatchPercent, angleRepDistance, ZERO_MATCH_DEGREES, type AngleFrame } from "./angleScoring";
import { EXERCISES } from "./exercises";
import { ANGLES, type AngleName, type PoseTrackFrame } from "./poseTrack";

const curl = EXERCISES.bicep_curl;

/** A frame with every angle at `base` except those given. */
function frame(angles: Partial<Record<AngleName, number | null>>, base: number | null = 90): PoseTrackFrame {
  const all = Object.fromEntries(ANGLES.map((name) => [name, name in angles ? angles[name]! : base])) as Record<AngleName, number | null>;
  return { t: 0, positions: null, confidence: null, angles: all, origin: Object.fromEntries(ANGLES.map((n) => [n, all[n] === null ? null : "observed"])) as PoseTrackFrame["origin"] };
}

describe("angleFrames", () => {
  it("takes the exercise's scored angles for the side doing the rep, in order", () => {
    const f = frame({ l_elbow: 50, r_elbow: 150, l_shoulder: 20, r_shoulder: 30, trunk_lean: 10 });
    expect(angleFrames([f], curl, "left")).toEqual([[50, 20, 10]]);
    expect(angleFrames([f], curl, "right")).toEqual([[150, 30, 10]]);
    expect(angleFrames([f], EXERCISES.squat, "right")).toEqual([[90, 90, 10]]);
  });

  it("leaves out frames where a scored angle is missing", () => {
    expect(angleFrames([frame({}, null), frame({ l_elbow: 60 })], curl, "left")).toEqual([[60, 90, 90]]);
  });
});

describe("angleRepDistance", () => {
  const rep = (offset = 0, steps = 9): AngleFrame[] =>
    Array.from({ length: steps }, (_, i) => [150 - 100 * Math.sin((i / (steps - 1)) * Math.PI) + offset, 20 + offset, 5 + offset]);

  it("is zero for the same rep, at any speed", () => {
    expect(angleRepDistance(rep(), rep())).toBe(0);
    // 30 frames through 100 degrees step about 3.4 degrees, so samples line up only to within half a step.
    expect(angleRepDistance(rep(0, 30), rep(0, 60))).toBeLessThan(1.5);
  });

  it("is in degrees: every angle 3 degrees off reads 3", () => {
    expect(angleRepDistance(rep(), rep(3))).toBeCloseTo(3);
  });
});

describe("angleMatchPercent", () => {
  it("maps degrees onto 100-0", () => {
    expect(angleMatchPercent(0)).toBe(100);
    expect(angleMatchPercent(ZERO_MATCH_DEGREES / 2)).toBe(50);
    expect(angleMatchPercent(ZERO_MATCH_DEGREES * 2)).toBe(0);
    expect(angleMatchPercent(Infinity)).toBe(0);
  });
});
