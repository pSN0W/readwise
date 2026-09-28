import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ViewedTimer, visibleEnough } from "../src/lib/viewed.ts";

describe("viewed timer (2 s at >= 60 %)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("fires after 2 s on screen", () => {
    const seen: string[] = [];
    const t = new ViewedTimer((id) => seen.push(id));
    t.visible("c_1", true);
    vi.advanceTimersByTime(1999);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["c_1"]);
  });
  test("leaving the screen before 2 s cancels; coming back restarts", () => {
    const seen: string[] = [];
    const t = new ViewedTimer((id) => seen.push(id));
    t.visible("c_1", true);
    vi.advanceTimersByTime(1500);
    t.visible("c_1", false);
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([]);
    t.visible("c_1", true);
    vi.advanceTimersByTime(1000);
    t.visible("c_1", true); // repeated "visible" does not restart the clock
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(["c_1"]);
  });
  test("several cards run on their own clocks; stop() clears all", () => {
    const seen: string[] = [];
    const t = new ViewedTimer((id) => seen.push(id));
    t.visible("a", true);
    vi.advanceTimersByTime(1000);
    t.visible("b", true);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(["a"]);
    expect(t.isPending("b")).toBe(true);
    t.stop();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(["a"]);
  });
  test("visible enough: 60 % of the card, or a tall card filling 60 % of the screen", () => {
    expect(visibleEnough(0.6, 100, 800)).toBe(true);
    expect(visibleEnough(0.59, 100, 800)).toBe(false);
    expect(visibleEnough(0.3, 500, 800)).toBe(true);
    expect(visibleEnough(0.3, 400, 800)).toBe(false);
  });
});
