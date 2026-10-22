import { describe, expect, it } from "vitest";
import {
  angleFrames,
  angleMatchPercent,
  angleRepDistance,
  collectingGoldenReps,
  goldenRepsPerArm,
  ZERO_MATCH_DEGREES,
  type AngleFrame,
  type CollectedRep,
} from "./angleScoring";
import { EXERCISES, type Side } from "./exercises";
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

describe("golden reps per arm", () => {
  /** A curl on one arm whose elbow bottoms out at `top` degrees, completed at `at` ms. */
  const curlRep = (side: Side, top: number, at: number): CollectedRep => ({
    side,
    at,
    samples: Array.from({ length: 9 }, (_, i) => {
      const elbow = 150 - (150 - top) * Math.sin((i / 8) * Math.PI);
      return { position: [], pose: frame({ [side === "left" ? "l_elbow" : "r_elbow"]: elbow }) };
    }),
  });

  it("picks each arm's most typical rep from its own first three, and skips an arm with fewer", () => {
    const reps = [curlRep("right", 50, 1), curlRep("left", 60, 2), curlRep("right", 52, 3), curlRep("right", 90, 4), curlRep("right", 51, 5), curlRep("left", 61, 6)];
    const chosen = goldenRepsPerArm(reps, curl, 3);
    // Right: 50, 52 and the outlier 90 (the fourth, 51, comes too late); 52 is closest to the other two.
    expect(chosen.right).toBe(reps[2].samples);
    expect(chosen.left).toBeUndefined();
  });

  it("keeps collecting while an arm still lacks reps and has done one recently", () => {
    const wait = 20000;
    const reps = [curlRep("right", 50, 3000), curlRep("right", 50, 6000), curlRep("right", 50, 9000)];
    // Right is done; left has done nothing, so it is waited for until 20 s after recording started.
    expect(collectingGoldenReps(reps, 0, 10000, 3, wait)).toBe(true);
    expect(collectingGoldenReps(reps, 0, 20000, 3, wait)).toBe(false);
    // A left rep at 19 s restarts the wait for the left arm.
    const withLeft = [...reps, curlRep("left", 50, 19000)];
    expect(collectingGoldenReps(withLeft, 0, 25000, 3, wait)).toBe(true);
    expect(collectingGoldenReps(withLeft, 0, 39000, 3, wait)).toBe(false);
    // Both arms done: stop at once.
    const both = [...reps, curlRep("left", 50, 10000), curlRep("left", 50, 11000), curlRep("left", 50, 12000)];
    expect(collectingGoldenReps(both, 0, 12000, 3, wait)).toBe(false);
  });
});
