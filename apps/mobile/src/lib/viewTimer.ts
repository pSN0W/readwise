// Runs the "Viewed after 2 s on screen" timer for the card in the feed.
import { VIEWED_AFTER_MS } from "@rh/core";

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (h: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ViewTimer {
  private handle: unknown = null;
  private key: string | null = null;
  private cb: (() => void) | null = null;
  private delay: number;
  private timers: Timers;

  constructor(delay = VIEWED_AFTER_MS, timers: Timers = realTimers) {
    this.delay = delay;
    this.timers = timers;
  }

  /** A card is now on screen. Restarts the timer unless the same card is already being timed. */
  show(key: string, onViewed: () => void): void {
    if (this.key === key && this.handle !== null) return;
    this.clearHandle();
    this.key = key;
    this.cb = onViewed;
    this.start();
  }

  /** App went to background, a sheet covers the card, … The time on screen starts again at resume. */
  pause(): void {
    this.clearHandle();
  }

  resume(): void {
    if (this.key && this.cb && this.handle === null) this.start();
  }

  stop(): void {
    this.clearHandle();
    this.key = null;
    this.cb = null;
  }

  get current(): string | null {
    return this.key;
  }

  private start(): void {
    const cb = this.cb;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.key = null;
      this.cb = null;
      cb?.();
    }, this.delay);
  }

  private clearHandle(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
}
