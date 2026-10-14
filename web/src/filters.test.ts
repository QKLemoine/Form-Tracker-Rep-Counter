import { describe, expect, it } from "vitest";
import { HysteresisGate, OneEuroFilter } from "./filters";

const FRAME_MS = 33;
/** Deterministic pseudo-noise in [-1, 1]. */
const noise = (i: number) => Math.sin(i * 12.9898) * Math.cos(i * 4.1414);
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

describe("OneEuroFilter", () => {
  it("passes the first value through", () => {
    expect(new OneEuroFilter().filter(123, 0)).toBe(123);
  });

  it("leaves a steady signal alone", () => {
    const filter = new OneEuroFilter();
    const out = Array.from({ length: 30 }, (_, i) => filter.filter(90, i * FRAME_MS));
    out.forEach((value) => expect(value).toBeCloseTo(90));
  });

  it("smooths jitter on a still signal", () => {
    const filter = new OneEuroFilter();
    const raw = Array.from({ length: 90 }, (_, i) => 160 + 6 * noise(i));
    const smoothed = raw.map((value, i) => filter.filter(value, i * FRAME_MS));
    expect(spread(smoothed.slice(30))).toBeLessThan(spread(raw.slice(30)) / 2);
  });

  it("follows a curl-speed movement without lagging far behind", () => {
    // 170 -> 50 degrees in one second, then held.
    const filter = new OneEuroFilter();
    const target = (i: number) => Math.max(50, 170 - 120 * ((i * FRAME_MS) / 1000));
    const smoothed = Array.from({ length: 60 }, (_, i) => filter.filter(target(i), i * FRAME_MS));
    // Mid-movement it trails by a bounded amount, and it settles on the held value.
    expect(Math.abs(smoothed[15] - target(15))).toBeLessThan(15);
    expect(smoothed[59]).toBeCloseTo(50, 0);
  });

  it("starts fresh after reset", () => {
    const filter = new OneEuroFilter();
    filter.filter(170, 0);
    filter.filter(170, FRAME_MS);
    filter.reset();
    expect(filter.filter(60, 2 * FRAME_MS)).toBe(60);
  });
});

describe("HysteresisGate", () => {
  const feed = (gate: HysteresisGate, values: number[]) => values.map((value) => gate.update(value));

  it("turns on only after enough frames above the enter threshold", () => {
    expect(feed(new HysteresisGate(0.6, 0.4, 3), [0.9, 0.9, 0.9, 0.9])).toEqual([false, false, true, true]);
  });

  it("does not turn on for a value hovering between the thresholds", () => {
    expect(feed(new HysteresisGate(0.6, 0.4, 3), [0.45, 0.55, 0.5, 0.58, 0.45, 0.55]).some(Boolean)).toBe(false);
  });

  it("does not turn on for brief spikes", () => {
    expect(feed(new HysteresisGate(0.6, 0.4, 3), [0.9, 0.9, 0.1, 0.9, 0.9, 0.1]).some(Boolean)).toBe(false);
  });

  it("stays on through a brief dip and through values between the thresholds", () => {
    const gate = new HysteresisGate(0.6, 0.4, 3);
    feed(gate, [0.9, 0.9, 0.9]);
    expect(feed(gate, [0.1, 0.1, 0.9, 0.5, 0.45, 0.5, 0.45])).toEqual([true, true, true, true, true, true, true]);
  });

  it("turns off after enough frames below the exit threshold", () => {
    const gate = new HysteresisGate(0.6, 0.4, 3);
    feed(gate, [0.9, 0.9, 0.9]);
    expect(feed(gate, [0.1, 0.1, 0.1, 0.1])).toEqual([true, true, false, false]);
  });
});
