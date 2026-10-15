// Learns one limb's angle range from the person's own reps. The pose model reads the two sides of
// the body, and different camera positions, several degrees apart, so each side gets its own range
// instead of sharing the exercise's default.
//
// It watches the smoothed joint angle for full reps (rest -> top -> rest), checks each one, and
// once it has enough good reps takes the median rest and top, so one sloppy rep is outvoted.

import type { AngleRange } from "./exercises";

export interface CalibrationConfig {
  /** Good reps needed before the range is set. */
  repsNeeded: number;
  /** A movement smaller than this (degrees) is a wobble, not a rep. */
  minSpanDegrees: number;
  /** How far (degrees) the angle must move from rest before a rep is taken to have started. */
  riseDegrees: number;
  /** A rep faster than this, leaving rest to returning, is a swing or a glitch. */
  minRepMs: number;
  /** A rep where the torso tilts more than this (degrees, in the image) is a body swing. */
  maxTorsoSwingDegrees: number;
  /**
   * Fraction of the measured range to pull 0% and 100% inward, so a full rep sits at a flat 100%
   * instead of flickering just under the furthest point reached while calibrating.
   */
  inset: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  repsNeeded: 3,
  minSpanDegrees: 30,
  riseDegrees: 15,
  minRepMs: 600,
  maxTorsoSwingDegrees: 20,
  inset: 0.1,
};

export type RepRejection = "too fast" | "body swing";

/** What the calibrator made of one completed rep. Angles are in degrees. */
export interface CalibrationRep {
  accepted: boolean;
  reason?: RepRejection;
  rest: number;
  top: number;
}

interface Sample {
  /** Distance from the default rest angle toward the default top, in degrees. */
  x: number;
  t: number;
  lean: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Keeps at most this many samples while waiting at rest. */
const MAX_IDLE_SAMPLES = 300;
/** Rest needs at least this much reading before a rep can start, so a few frames can't set it. */
const MIN_REST_MS = 300;
/** A rep that hasn't come back down this long after it started was not read correctly; start over. */
const MAX_REP_MS = 8000;
/** A rep is complete once the limb is back within this fraction of its span of the lowest point before it. */
const RETURN_FRACTION = 0.3;

export class RangeCalibrator {
  private samples: Sample[] = [];
  /** Set once the limb has started a rep: the index of the frame where it did. */
  private startIndex = -1;
  private peakIndex = -1;
  private readonly reps: { rest: number; top: number }[] = [];

  /** @param defaults the exercise's default range; only its direction is used. */
  constructor(
    private readonly defaults: AngleRange,
    private readonly config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
  ) {}

  /** Good reps collected so far. */
  get repsCollected(): number {
    return this.reps.length;
  }

  get repsNeeded(): number {
    return this.config.repsNeeded;
  }

  private get direction(): number {
    return Math.sign(this.defaults[1] - this.defaults[0]);
  }

  /**
   * Feed one frame: the smoothed joint angle and the torso's lean from vertical, both in degrees.
   * Returns the rep this frame completed, or null.
   */
  add(angle: number, timeMs: number, torsoLean: number): CalibrationRep | null {
    const x = (angle - this.defaults[0]) * this.direction;
    this.samples.push({ x, t: timeMs, lean: torsoLean });
    const last = this.samples.length - 1;

    if (this.startIndex < 0) {
      // At rest: a rep starts when the angle moves clearly away from the lowest point seen.
      if (this.samples.length > MAX_IDLE_SAMPLES) this.samples.splice(0, this.samples.length - MAX_IDLE_SAMPLES);
      const lowest = Math.min(...this.samples.map((s) => s.x));
      if (timeMs - this.samples[0].t >= MIN_REST_MS && x - lowest >= this.config.riseDegrees) {
        this.startIndex = last;
        this.peakIndex = last;
      }
      return null;
    }

    if (timeMs - this.samples[this.startIndex].t > MAX_REP_MS) {
      // Stuck, most likely on a misread rest level. Keep the last second as the new rest.
      this.samples = this.samples.filter((s) => s.t >= timeMs - 1000);
      this.startIndex = -1;
      return null;
    }

    if (x > this.samples[this.peakIndex].x) this.peakIndex = last;
    const peakX = this.samples[this.peakIndex].x;
    const low = Math.min(...this.samples.slice(0, this.peakIndex + 1).map((s) => s.x));
    const span = peakX - low;
    // Not back down yet. Measured from the lowest point rather than a rest level, so a limb that
    // straightened fully for a moment before the rep, then relaxed, still completes it.
    if (x > low + RETURN_FRACTION * span) return null;

    const samples = this.samples;
    const peakIndex = this.peakIndex;
    this.samples = [samples[last]];
    this.startIndex = -1;
    this.peakIndex = -1;
    if (span < this.config.minSpanDegrees) return null; // a wobble, not a rep

    // When the limb left rest: the last reading before the top that was still near the bottom.
    let left = peakIndex;
    while (left > 0 && samples[left].x > low + 0.25 * span) left--;
    // Rest: the middle of the readings between reps, not the extreme of the wobble at rest.
    const rest = median(samples.slice(0, left + 1).map((s) => s.x));
    // Top: the middle of the readings held near the furthest point.
    const top = median(samples.slice(left, last + 1).filter((s) => s.x >= peakX - 0.05 * span).map((s) => s.x));

    const durationMs = samples[last].t - samples[left].t;
    const leans = samples.slice(left, last + 1).map((s) => s.lean);
    const swing = Math.max(...leans) - Math.min(...leans);

    const toAngle = (value: number) => this.defaults[0] + value * this.direction;
    const result: CalibrationRep = { accepted: true, rest: toAngle(rest), top: toAngle(top) };
    if (durationMs < this.config.minRepMs) Object.assign(result, { accepted: false, reason: "too fast" });
    else if (swing > this.config.maxTorsoSwingDegrees) Object.assign(result, { accepted: false, reason: "body swing" });
    else if (this.reps.length < this.config.repsNeeded) this.reps.push({ rest, top });
    return result;
  }

  /**
   * Forget the rep in progress and the readings so far, keeping good reps already collected. For
   * when the limb has been out of view: readings from either side of a gap aren't one movement.
   */
  restart(): void {
    this.samples = [];
    this.startIndex = -1;
    this.peakIndex = -1;
  }

  /** The calibrated range once enough good reps are in, otherwise null. */
  result(): [number, number] | null {
    if (this.reps.length < this.config.repsNeeded) return null;
    const rest = median(this.reps.map((rep) => rep.rest));
    const top = median(this.reps.map((rep) => rep.top));
    const span = top - rest;
    if (span < this.config.minSpanDegrees) return null;
    const toAngle = (value: number) => this.defaults[0] + value * this.direction;
    return [toAngle(rest + this.config.inset * span), toAngle(top - this.config.inset * span)];
  }
}
