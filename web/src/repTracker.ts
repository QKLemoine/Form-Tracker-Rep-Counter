// Port of the rep-counting state machine in src/analytics/rep_tracker.py, one instance per body side.
// Unlike Python it buffers every rep (not only once a golden rep exists), drops the buffer whenever
// the limb is back at rest, and only starts a rep from rest, so a rep is never missing its beginning
// or carrying leftover frames.

export class RepTracker<Frame> {
  /** Completed reps; a rep that has reached the peak but not returned counts as a half. */
  count = 0;
  /** True between reaching the peak and returning to rest (Python's `dir == 1`). */
  pastPeak = false;
  private buffer: Frame[] = [];
  /** False until the limb has been seen at rest, so a rep already under way is not counted as a full one. */
  private ready = false;

  /**
   * Advance by one frame. `percent` is 0-100 through the rep, exactly 0 or 100 at the ends.
   * Returns the frames of the rep that this frame completed, or null.
   */
  update(percent: number, frame: Frame): Frame[] | null {
    if (!this.ready) {
      if (percent !== 0) return null;
      this.ready = true;
    }
    if (percent > 0 || this.pastPeak) {
      this.buffer.push(frame);
    } else {
      this.buffer = [];
    }

    if (percent === 100 && !this.pastPeak) {
      this.count += 0.5;
      this.pastPeak = true;
    }
    if (percent === 0 && this.pastPeak) {
      this.count += 0.5;
      this.pastPeak = false;
      const rep = this.buffer;
      this.buffer = [];
      return rep;
    }
    return null;
  }

  /** Forget a rep in progress (and its half count) without touching completed reps; the next rep must start from rest. */
  abandonRep(): void {
    this.ready = false;
    this.buffer = [];
    this.pastPeak = false;
    this.count = Math.floor(this.count);
  }
}
