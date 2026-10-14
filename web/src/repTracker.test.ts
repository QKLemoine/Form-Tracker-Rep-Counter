import { expect, it } from "vitest";
import { RepTracker } from "./repTracker";

/** Feeds one percent per frame, `stepMs` apart, with the frame index as the payload. */
function run(percents: number[], { tracker = new RepTracker<number>(), stepMs = 100, startMs = 0 } = {}) {
  const reps: number[][] = [];
  percents.forEach((percent, i) => {
    const rep = tracker.update(percent, i, startMs + i * stepMs);
    if (rep) reps.push(rep);
  });
  return { tracker, reps };
}

it("counts a rep from rest to the top and back", () => {
  const { tracker, reps } = run([0, 0, 50, 100, 100, 50, 0, 0]);
  expect(tracker.count).toBe(1);
  expect(tracker.phase).toBe("rest");
  // From leaving rest to settling back at rest.
  expect(reps).toEqual([[2, 3, 4, 5, 6, 7]]);
});

it("counts a rep that plateaus short of 100%", () => {
  // The old rule needed exactly 100 and exactly 0; a noisy angle often tops out around 90 and bottoms out around 5.
  expect(run([4, 6, 50, 88, 91, 89, 50, 7, 3]).tracker.count).toBe(1);
});

it("does not count a rep that stops well short of the top", () => {
  const { tracker, reps } = run([0, 0, 50, 80, 80, 80, 50, 0, 0]);
  expect(tracker.count).toBe(0);
  expect(reps).toEqual([]);
  expect(tracker.phase).toBe("rest");
});

it("moves through the phases", () => {
  const tracker = new RepTracker<number>();
  const phases = [50, 0, 0, 40, 90, 90, 40, 0, 0].map((percent, i) => {
    tracker.update(percent, i, i * 100);
    return tracker.phase;
  });
  expect(phases).toEqual(["unready", "unready", "rest", "lifting", "lifting", "peaked", "peaked", "peaked", "rest"]);
});

it("does not double count when the bar wobbles around the top threshold", () => {
  expect(run([0, 0, 90, 90, 84, 90, 84, 90, 84, 0, 0]).tracker.count).toBe(1);
});

it("does not start reps when the bar wobbles around the rest threshold", () => {
  expect(run([0, 0, 24, 26, 24, 26, 24, 26, 24, 0, 0]).tracker.count).toBe(0);
});

it("ignores a single stray frame at the top", () => {
  expect(run([0, 0, 50, 100, 50, 50, 0, 0]).tracker.count).toBe(0);
});

it("ignores a single stray frame at rest in the middle of a rep", () => {
  const { tracker } = run([0, 0, 90, 90, 0, 90, 90, 50, 0, 0]);
  expect(tracker.count).toBe(1);
});

it("discards a rep faster than a person can move", () => {
  // Top and back in 150 ms is a tracking glitch.
  expect(run([0, 0, 90, 90, 0, 0], { stepMs: 30 }).tracker.count).toBe(0);
  // The same shape over 2.5 s is a rep.
  expect(run([0, 0, 90, 90, 0, 0], { stepMs: 500 }).tracker.count).toBe(1);
});

it("counts consecutive reps separately", () => {
  const { tracker, reps } = run([0, 0, 90, 90, 50, 0, 0, 90, 90, 50, 0, 0, 90, 90, 50, 0, 0]);
  expect(tracker.count).toBe(3);
  expect(reps).toHaveLength(3);
});

it("ignores a rep that was already under way when tracking started", () => {
  const { tracker, reps } = run([60, 90, 90, 50, 0, 0, 50, 90, 90, 50, 0, 0]);
  expect(tracker.count).toBe(1);
  expect(reps).toEqual([[6, 7, 8, 9, 10, 11]]);
});

it("abandonRep forgets a rep in progress but keeps completed reps", () => {
  const { tracker } = run([0, 0, 90, 90, 50, 0, 0, 50, 90, 90]);
  expect(tracker.count).toBe(1);
  expect(tracker.phase).toBe("peaked");
  tracker.abandonRep();
  expect(tracker.phase).toBe("unready");
  // Returning to rest now must not complete the abandoned rep.
  run([0, 0], { tracker, startMs: 5000 });
  expect(tracker.count).toBe(1);
});

it("after abandonRep, waits for rest before starting the next rep", () => {
  const { tracker } = run([0, 0, 90, 90, 50, 0, 0]);
  tracker.abandonRep();
  // Picked up at 80% on the way up: the rest of this rep is not a full rep.
  const { reps } = run([80, 90, 90, 50, 0, 0, 30, 90, 90, 50, 0, 0], { tracker, startMs: 5000 });
  expect(tracker.count).toBe(2);
  expect(reps).toEqual([[6, 7, 8, 9, 10, 11]]);
});

it("uses the thresholds it is given", () => {
  const strict = new RepTracker<number>({ topPercent: 95, restPercent: 5, dwellFrames: 1, minRepMs: 0 });
  run([0, 50, 90, 50, 0], { tracker: strict });
  expect(strict.count).toBe(0);
  run([0, 50, 96, 50, 3], { tracker: strict, startMs: 1000 });
  expect(strict.count).toBe(1);
});
