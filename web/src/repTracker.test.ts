import { expect, it } from "vitest";
import { RepTracker } from "./repTracker";

function run(percents: number[]): RepTracker {
  const tracker = new RepTracker();
  percents.forEach((p) => tracker.update(p));
  return tracker;
}

it("adds half a rep at the peak", () => {
  const tracker = run([100]);
  expect(tracker.count).toBe(0.5);
  expect(tracker.pastPeak).toBe(true);
});

it("completes the rep on returning to rest", () => {
  const tracker = run([0, 40, 100, 60, 0]);
  expect(tracker.count).toBe(1);
  expect(tracker.pastPeak).toBe(false);
});

it("does not double count while held at the peak", () => {
  expect(run([100, 100, 100]).count).toBe(0.5);
});

it("does not count rest frames before any peak", () => {
  expect(run([0, 0, 30, 0]).count).toBe(0);
});

it("does not count a partial rep that never reaches the peak", () => {
  expect(run([0, 50, 99, 50, 0]).count).toBe(0);
});

it("counts consecutive reps", () => {
  expect(run([0, 100, 0, 100, 0, 100, 0]).count).toBe(3);
});
