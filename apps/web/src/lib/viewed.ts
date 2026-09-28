// "Viewed" = a card stays at least 60 % visible for VIEWED_AFTER_MS (2 s).
// ViewedTimer is the pure part (unit-tested with fake timers). The Svelte action wires it to
// one shared IntersectionObserver.
import { VIEWED_AFTER_MS } from "@rh/core";

export const VISIBLE_RATIO = 0.6;

export interface TimerApi {
  set: (fn: () => void, ms: number) => unknown;
  clear: (h: unknown) => void;
}

export class ViewedTimer {
  private pending = new Map<string, unknown>();
  private delay: number;
  private onViewed: (id: string) => void;
  private t: TimerApi;
  constructor(onViewed: (id: string) => void, delay = VIEWED_AFTER_MS, timers?: TimerApi) {
    this.onViewed = onViewed;
    this.delay = delay;
    this.t = timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }
  /** Report that a card is (or is not) visible enough. */
  visible(id: string, isVisible: boolean): void {
    const h = this.pending.get(id);
    if (isVisible) {
      if (h !== undefined) return;
      this.pending.set(id, this.t.set(() => { this.pending.delete(id); this.onViewed(id); }, this.delay));
    } else if (h !== undefined) {
      this.t.clear(h);
      this.pending.delete(id);
    }
  }
  isPending(id: string): boolean {
    return this.pending.has(id);
  }
  stop(): void {
    for (const h of this.pending.values()) this.t.clear(h);
    this.pending.clear();
  }
}

/** Is this entry "visible enough"? Tall cards count when they fill 60 % of the viewport. */
export function visibleEnough(ratio: number, visibleHeight: number, viewportHeight: number): boolean {
  return ratio >= VISIBLE_RATIO || (viewportHeight > 0 && visibleHeight >= VISIBLE_RATIO * viewportHeight);
}

let observer: IntersectionObserver | null = null;
let timer: ViewedTimer | null = null;
const idOf = new WeakMap<Element, string>();

/** Call once with the function that marks a card viewed. */
export function initViewed(onViewed: (id: string) => void): void {
  timer?.stop();
  timer = new ViewedTimer(onViewed);
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const id = idOf.get(e.target);
      if (!id || !timer) continue;
      const vh = e.rootBounds?.height ?? window.innerHeight;
      timer.visible(id, e.isIntersecting && visibleEnough(e.intersectionRatio, e.intersectionRect.height, vh));
    }
  }, { threshold: [0, 0.3, 0.6, 0.9, 1] });
}

/** Svelte action: <article use:trackViewed={card.id}>. Pass null to skip. */
export function trackViewed(node: Element, id: string | null) {
  let cur = id;
  const on = () => { if (cur && observer) { idOf.set(node, cur); observer.observe(node); } };
  const off = () => { if (observer) observer.unobserve(node); if (cur) timer?.visible(cur, false); };
  on();
  return {
    update(next: string | null) { off(); cur = next; on(); },
    destroy() { off(); },
  };
}
