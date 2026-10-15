import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION_CONFIG, RangeCalibrator, type CalibrationRep } from "./calibration";

const curl = [150, 90] as const;
const FRAME_MS = 33;

/** Elbow angle over one rep: `rest` -> `top` -> `rest` over `frames` frames, then held at rest. */
const rep = (rest: number, top: number, frames = 60, holdFrames = 15) => [
  ...Array.from({ length: frames }, (_, i) => (rest + top) / 2 + ((rest - top) / 2) * Math.cos((i / (frames - 1)) * 2 * Math.PI)),
  ...new Array<number>(holdFrames).fill(rest),
];
const hold = (angle: number, frames: number) => new Array<number>(frames).fill(angle);

/** Feeds angles one frame apart; `lean` gives the torso lean per frame. Returns every completed rep. */
function feed(calibrator: RangeCalibrator, angles: number[], { lean = (() => 0) as (i: number) => number, startMs = 0 } = {}) {
  const reps: CalibrationRep[] = [];
  angles.forEach((angle, i) => {
    const result = calibrator.add(angle, startMs + i * FRAME_MS, lean(i));
    if (result) reps.push(result);
  });
  return reps;
}

describe("RangeCalibrator", () => {
  it("learns a range from three full reps, with 0% and 100% pulled 10% inward", () => {
    const calibrator = new RangeCalibrator(curl);
    expect(feed(calibrator, [...hold(170, 15), ...rep(170, 60), ...rep(170, 60)])).toHaveLength(2);
    expect(calibrator.result()).toBeNull(); // two reps aren't enough
    feed(calibrator, rep(170, 60), { startMs: 10000 });
    const [rest, top] = calibrator.result()!;
    // Rest 170 and top 60 span 110 degrees; 10% of that is 11.
    expect(Math.abs(rest - 159)).toBeLessThan(2);
    expect(Math.abs(top - 71)).toBeLessThan(2);
  });

  it("takes the middle of the three reps, so one short rep is outvoted", () => {
    const calibrator = new RangeCalibrator(curl);
    feed(calibrator, [...hold(170, 15), ...rep(170, 60), ...rep(170, 100), ...rep(170, 64)]);
    const [, top] = calibrator.result()!;
    // Tops of 60, 100 and 64: the median is 64, so the short rep to 100 doesn't loosen the range much.
    expect(Math.abs(top - (64 + 0.1 * (170 - 64)))).toBeLessThan(2);
  });

  it("ignores a wobble that is too small to be a rep", () => {
    const calibrator = new RangeCalibrator(curl);
    expect(feed(calibrator, [...hold(170, 15), ...rep(170, 150), ...rep(170, 148)])).toEqual([]);
  });

  it("rejects a rep that is too fast and does not use it", () => {
    const calibrator = new RangeCalibrator(curl);
    const [fast] = feed(calibrator, [...hold(170, 15), ...rep(170, 60, 12)]);
    expect(fast).toMatchObject({ accepted: false, reason: "too fast" });
    expect(calibrator.repsCollected).toBe(0);
  });

  it("rejects a rep where the body swings and does not use it", () => {
    const calibrator = new RangeCalibrator(curl);
    // The torso tilts up to 30 degrees through the rep.
    const [swung] = feed(calibrator, [...hold(170, 15), ...rep(170, 60)], { lean: (i) => (i > 15 && i < 60 ? 30 * Math.sin(((i - 15) / 45) * Math.PI) : 0) });
    expect(swung).toMatchObject({ accepted: false, reason: "body swing" });
    expect(calibrator.repsCollected).toBe(0);
  });

  it("accepts a small amount of torso movement", () => {
    const calibrator = new RangeCalibrator(curl);
    const [ok] = feed(calibrator, [...hold(170, 15), ...rep(170, 60)], { lean: (i) => 5 * Math.sin(i / 8) });
    expect(ok.accepted).toBe(true);
  });

  it("takes rest from where the limb usually hangs, not the extreme of its wobble", () => {
    const calibrator = new RangeCalibrator(curl);
    const hanging = (frames: number) => Array.from({ length: frames }, (_, i) => 156 + 2 * Math.sin(i * 1.7) + (i >= 5 && i < 9 ? 15 : 0));
    feed(calibrator, [...hanging(40), ...rep(156, 63), ...hanging(40), ...rep(156, 63), ...hanging(40), ...rep(156, 63)]);
    const [rest] = calibrator.result()!;
    // Hanging at 156 with a 108-degree swing to 63: rest 156, pulled 10% inward = about 147.
    expect(Math.abs(rest - (156 - 0.1 * (156 - 63)))).toBeLessThan(3);
  });

  it("still finishes a rep when the limb straightened fully just before it, then relaxed", () => {
    const calibrator = new RangeCalibrator(curl);
    const stretchThenHang = Array.from({ length: 45 }, (_, i) => (i >= 10 && i < 22 ? 173 : 154 + 2 * Math.sin(i * 1.7)));
    const [done] = feed(calibrator, [...stretchThenHang, ...rep(154, 63)]);
    expect(done).toMatchObject({ accepted: true });
    expect(Math.abs(done.rest - 154)).toBeLessThan(3);
  });

  it("reports each rep's rest and top", () => {
    const calibrator = new RangeCalibrator(curl);
    const [first] = feed(calibrator, [...hold(168, 15), ...rep(168, 58)]);
    expect(first.accepted).toBe(true);
    expect(Math.abs(first.rest - 168)).toBeLessThan(2);
    expect(Math.abs(first.top - 58)).toBeLessThan(2);
  });

  it("works for a range that runs upward", () => {
    const calibrator = new RangeCalibrator([30, 130]);
    feed(calibrator, [...hold(40, 15), ...rep(40, 120), ...rep(40, 120), ...rep(40, 120)]);
    const [rest, top] = calibrator.result()!;
    expect(Math.abs(rest - 48)).toBeLessThan(2);
    expect(Math.abs(top - 112)).toBeLessThan(2);
  });

  it("does not finish a rep that never comes back down", () => {
    const calibrator = new RangeCalibrator(curl);
    const halfRep = rep(170, 60).slice(0, 31); // up to the top and stays there
    expect(feed(calibrator, [...hold(170, 15), ...halfRep, ...hold(60, 30)])).toEqual([]);
  });

  it("needs the number of reps it is configured for", () => {
    const calibrator = new RangeCalibrator(curl, { ...DEFAULT_CALIBRATION_CONFIG, repsNeeded: 1 });
    feed(calibrator, [...hold(170, 15), ...rep(170, 60)]);
    expect(calibrator.result()).not.toBeNull();
  });
});
