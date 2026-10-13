// Port of the rep-counting state machine in src/analytics/rep_tracker.py.

export class RepTracker {
  /** Completed reps; a rep that has reached the peak but not returned counts as a half. */
  count = 0;
  /** True between reaching the peak and returning to rest (Python's `dir == 1`). */
  pastPeak = false;

  /** Advance by one frame. `percent` is 0-100 through the rep, exactly 0 or 100 at the ends. */
  update(percent: number): void {
    if (percent === 100 && !this.pastPeak) {
      this.count += 0.5;
      this.pastPeak = true;
    }
    if (percent === 0 && this.pastPeak) {
      this.count += 0.5;
      this.pastPeak = false;
    }
  }
}
