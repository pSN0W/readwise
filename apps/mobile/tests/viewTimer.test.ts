import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VIEWED_AFTER_MS } from "@rh/core";
import { ViewTimer } from "../src/lib/viewTimer.ts";

describe("viewed timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("fires after 2 s on screen", () => {
    const t = new ViewTimer();
    const cb = vi.fn();
    t.show("c1", cb);
    vi.advanceTimersByTime(VIEWED_AFTER_MS - 1);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  test("moving to the next card before 2 s does not mark the first", () => {
    const t = new ViewTimer();
    const a = vi.fn(), b = vi.fn();
    t.show("a", a);
    vi.advanceTimersByTime(1500);
    t.show("b", b);
    vi.advanceTimersByTime(1500);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(b).toHaveBeenCalledTimes(1);
  });
  test("showing the same card again does not restart the clock", () => {
    const t = new ViewTimer();
    const cb = vi.fn();
    t.show("a", cb);
    vi.advanceTimersByTime(1500);
    t.show("a", cb);
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  test("pause (sheet open, app hidden) and resume starts the 2 s again", () => {
    const t = new ViewTimer();
    const cb = vi.fn();
    t.show("a", cb);
    vi.advanceTimersByTime(1500);
    t.pause();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
    t.resume();
    vi.advanceTimersByTime(1999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  test("stop cancels", () => {
    const t = new ViewTimer();
    const cb = vi.fn();
    t.show("a", cb);
    t.stop();
    t.resume();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
    expect(t.current).toBeNull();
  });
});
