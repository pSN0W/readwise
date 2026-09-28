// Drag recogniser for the feed card. Pure: feed it pointer positions and times, it decides.
//   drag →  = "next"      drag ← = "copy"
//   vertical movement = "scroll" (the browser scrolls the card; we do nothing)
//   no real movement, short press = "tap" (open note)
export type Decision = "next" | "copy" | "tap" | "scroll" | "cancel";
export type Mode = "idle" | "pending" | "horizontal" | "vertical";

export interface GestureOptions {
  /** Distance that commits a drag (px). */
  threshold: number;
  /** Movement below this is still a tap (px). */
  slop: number;
  /** A fast flick commits even below threshold (px per ms). */
  flingVelocity: number;
  /** A fling must still move at least this far (px). */
  flingMinDistance: number;
  /** Longest press that still counts as a tap (ms). */
  tapMaxMs: number;
}

export const DEFAULT_GESTURE: GestureOptions = { threshold: 90, slop: 10, flingVelocity: 0.6, flingMinDistance: 40, tapMaxMs: 500 };

export class DragRecognizer {
  opts: GestureOptions;
  mode: Mode = "idle";
  x0 = 0;
  y0 = 0;
  t0 = 0;
  dx = 0;
  dy = 0;
  private samples: { x: number; t: number }[] = [];

  constructor(opts: Partial<GestureOptions> = {}) {
    this.opts = { ...DEFAULT_GESTURE, ...opts };
  }

  down(x: number, y: number, t: number): void {
    this.mode = "pending";
    this.x0 = x; this.y0 = y; this.t0 = t;
    this.dx = 0; this.dy = 0;
    this.samples = [{ x, t }];
  }

  /** Returns the current mode. In "horizontal" mode the UI moves the card by `dx`. */
  move(x: number, y: number, t: number): Mode {
    if (this.mode === "idle") return this.mode;
    this.dx = x - this.x0;
    this.dy = y - this.y0;
    this.samples.push({ x, t });
    if (this.samples.length > 6) this.samples.shift();
    if (this.mode === "pending") {
      const ax = Math.abs(this.dx), ay = Math.abs(this.dy);
      if (ax > this.opts.slop && ax > ay) this.mode = "horizontal";
      else if (ay > this.opts.slop) this.mode = "vertical";
    }
    return this.mode;
  }

  /** Horizontal speed over the last samples (px/ms, signed). */
  velocity(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt : 0;
  }

  up(x: number, y: number, t: number): Decision {
    const mode = this.mode;
    if (mode !== "idle") this.move(x, y, t);
    const m = this.mode;
    this.mode = "idle";
    if (m === "vertical") return "scroll";
    if (m === "pending") {
      return t - this.t0 <= this.opts.tapMaxMs ? "tap" : "cancel";
    }
    if (m !== "horizontal") return "cancel";
    const v = this.velocity();
    const { threshold, flingVelocity, flingMinDistance } = this.opts;
    if (this.dx >= threshold || (this.dx >= flingMinDistance && v >= flingVelocity)) return "next";
    if (this.dx <= -threshold || (this.dx <= -flingMinDistance && v <= -flingVelocity)) return "copy";
    return "cancel";
  }

  /** The browser took over (e.g. native scroll started). */
  cancel(): Decision {
    const m = this.mode;
    this.mode = "idle";
    return m === "vertical" ? "scroll" : "cancel";
  }
}
