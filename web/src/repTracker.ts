// Rep-counting state machine, one instance per body side. It began as a port of
// src/analytics/rep_tracker.py but no longer matches it: Python requires the bar to hit exactly
// 100% then exactly 0%, which a noisy angle estimate often misses by a few degrees.

export interface RepConfig {
  /** At or above this percent the limb is at the top of the rep. */
  topPercent: number;
  /** At or below this percent the limb is at rest. */
  restPercent: number;
  /** Frames in a row a threshold must hold before it counts, so one stray frame can't flip the state. */
  dwellFrames: number;
  /** Anything faster than this, from leaving rest to returning, is a tracking glitch, not a rep. */
  minRepMs: number;
}

// A limb at rest reads several degrees either side of its usual angle, so the rest band is wider than the top band.
export const DEFAULT_REP_CONFIG: RepConfig = { topPercent: 85, restPercent: 25, dwellFrames: 2, minRepMs: 400 };

/**
 * - `unready`: waiting to see the limb at rest, so a rep already under way isn't counted as a full one.
 * - `rest`: at rest.
 * - `lifting`: left rest, not yet at the top.
 * - `peaked`: reached the top; returning to rest completes the rep.
 */
export type RepPhase = "unready" | "rest" | "lifting" | "peaked";

export class RepTracker<Frame> {
  /** Completed reps. */
  count = 0;
  phase: RepPhase = "unready";
  private buffer: Frame[] = [];
  private startedAt = 0;
  private topStreak = 0;
  private restStreak = 0;

  constructor(private readonly config: RepConfig = DEFAULT_REP_CONFIG) {}

  /**
   * Advance by one frame. `percent` is 0-100 through the rep. Returns the frames of the rep that
   * this frame completed (from leaving rest to returning to it), or null.
   */
  update(percent: number, frame: Frame, timeMs: number): Frame[] | null {
    const { topPercent, restPercent, dwellFrames, minRepMs } = this.config;
    this.topStreak = percent >= topPercent ? this.topStreak + 1 : 0;
    this.restStreak = percent <= restPercent ? this.restStreak + 1 : 0;
    const atTop = this.topStreak >= dwellFrames;
    const atRest = this.restStreak >= dwellFrames;

    switch (this.phase) {
      case "unready":
        if (atRest) this.phase = "rest";
        return null;
      case "rest":
        if (percent > restPercent) {
          this.phase = "lifting";
          this.buffer = [frame];
          this.startedAt = timeMs;
        }
        return null;
      case "lifting":
        this.buffer.push(frame);
        if (atTop) {
          this.phase = "peaked";
        } else if (atRest) {
          this.phase = "rest"; // came back down without reaching the top
          this.buffer = [];
        }
        return null;
      case "peaked": {
        this.buffer.push(frame);
        if (!atRest) return null;
        const rep = this.buffer;
        this.phase = "rest";
        this.buffer = [];
        if (timeMs - this.startedAt < minRepMs) return null;
        this.count += 1;
        return rep;
      }
    }
  }

  /** Forget a rep in progress without touching completed reps; the next rep must start from rest. */
  abandonRep(): void {
    this.phase = "unready";
    this.buffer = [];
    this.topStreak = 0;
    this.restStreak = 0;
  }
}
