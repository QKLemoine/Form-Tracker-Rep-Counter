import { expect, it } from "vitest";
import { RepTracker } from "./repTracker";

/** Feeds percents with the frame index as each frame's payload; returns the tracker and any completed reps. */
function run(percents: number[], tracker = new RepTracker<number>()) {
  const reps: number[][] = [];
  percents.forEach((percent, i) => {
    const rep = tracker.update(percent, i);
    if (rep) reps.push(rep);
  });
  return { tracker, reps };
}

it("adds half a rep at the peak", () => {
  const { tracker } = run([0, 100]);
  expect(tracker.count).toBe(0.5);
  expect(tracker.pastPeak).toBe(true);
});

it("completes the rep on returning to rest", () => {
  const { tracker } = run([0, 40, 100, 60, 0]);
  expect(tracker.count).toBe(1);
  expect(tracker.pastPeak).toBe(false);
});

it("does not double count while held at the peak", () => {
  expect(run([0, 100, 100, 100]).tracker.count).toBe(0.5);
});

it("does not count rest frames before any peak", () => {
  expect(run([0, 0, 30, 0]).tracker.count).toBe(0);
});

it("does not count a partial rep that never reaches the peak", () => {
  const { tracker, reps } = run([0, 50, 99, 50, 0]);
  expect(tracker.count).toBe(0);
  expect(reps).toEqual([]);
});

it("counts consecutive reps", () => {
  expect(run([0, 100, 0, 100, 0, 100, 0]).tracker.count).toBe(3);
});

it("returns the frames from first movement to the return to rest", () => {
  //          idx: 0  1  2   3    4   5  6
  const { reps } = run([0, 0, 40, 100, 60, 0, 0]);
  expect(reps).toEqual([[2, 3, 4, 5]]);
});

it("drops frames from a false start before the real rep", () => {
  //          idx: 0  1   2  3   4    5   6
  const { reps } = run([0, 30, 0, 50, 100, 50, 0]);
  expect(reps).toEqual([[3, 4, 5, 6]]);
});

it("returns each rep separately", () => {
  const { reps } = run([0, 100, 0, 100, 0]);
  expect(reps).toEqual([[1, 2], [3, 4]]);
});

it("ignores a rep that was already under way when tracking started", () => {
  //          idx: 0   1    2   3  4    5  6
  const { tracker, reps } = run([60, 100, 50, 0, 100, 40, 0]);
  expect(tracker.count).toBe(1);
  expect(reps).toEqual([[4, 5, 6]]);
});

it("abandonRep forgets a rep in progress but keeps completed reps", () => {
  const { tracker } = run([0, 100, 0, 50, 100, 70]);
  expect(tracker.count).toBe(1.5);
  tracker.abandonRep();
  expect(tracker.count).toBe(1);
  expect(tracker.pastPeak).toBe(false);
  // Returning to rest now must not complete the abandoned rep.
  expect(tracker.update(0, 99)).toBeNull();
  expect(tracker.count).toBe(1);
});

it("after abandonRep, waits for rest before starting the next rep", () => {
  const { tracker } = run([0, 100, 0]);
  tracker.abandonRep();
  // Picked up at 80% on the way up: the rest of this rep is not a full rep.
  const { reps } = run([80, 100, 50, 0, 30, 100, 0], tracker);
  expect(tracker.count).toBe(2);
  expect(reps).toEqual([[4, 5, 6]]);
});
