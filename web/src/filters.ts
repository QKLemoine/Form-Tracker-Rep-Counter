/**
 * One Euro filter (Casiez et al. 2012): a low-pass filter whose cutoff rises with speed, so a
 * still signal is smoothed hard and a fast-moving one is followed with little lag.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  /**
   * @param minCutoff cutoff in Hz when the signal is still; lower is smoother.
   * @param beta how much the cutoff rises per unit of speed (signal units per second).
   * @param derivativeCutoff cutoff in Hz for the speed estimate.
   */
  constructor(
    private readonly minCutoff = 1,
    private readonly beta = 0.01,
    private readonly derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = timeMs;
      return value;
    }
    const dt = Math.max((timeMs - this.t) / 1000, 1e-3);
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
    this.dx += alpha(this.derivativeCutoff) * ((value - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx)) * (value - this.x);
    this.t = timeMs;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/**
 * A boolean that only flips after the input has been past the relevant threshold for `frames`
 * frames in a row, with separate thresholds for turning on and off, so a value hovering near one
 * threshold doesn't flicker.
 */
export class HysteresisGate {
  on = false;
  private streak = 0;

  constructor(
    private readonly enter: number,
    private readonly exit: number,
    private readonly frames: number,
  ) {}

  update(value: number): boolean {
    const wantsFlip = this.on ? value < this.exit : value >= this.enter;
    this.streak = wantsFlip ? this.streak + 1 : 0;
    if (this.streak >= this.frames) {
      this.on = !this.on;
      this.streak = 0;
    }
    return this.on;
  }
}
