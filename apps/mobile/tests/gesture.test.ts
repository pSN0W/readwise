import { describe, expect, test } from "vitest";
import { DragRecognizer } from "../src/lib/gesture.ts";

/** Drag from (x0,y0) by (dx,dy) in `steps` moves over `ms` milliseconds. */
function drag(r: DragRecognizer, dx: number, dy: number, ms = 300, steps = 10, x0 = 200, y0 = 400) {
  r.down(x0, y0, 0);
  for (let i = 1; i <= steps; i++) r.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps, (ms * i) / steps);
  return r.up(x0 + dx, y0 + dy, ms);
}

describe("drag recogniser", () => {
  test("drag right past the threshold = next", () => {
    expect(drag(new DragRecognizer(), 140, 8)).toBe("next");
  });
  test("drag left past the threshold = copy", () => {
    expect(drag(new DragRecognizer(), -140, -5)).toBe("copy");
  });
  test("short slow drag snaps back", () => {
    expect(drag(new DragRecognizer(), 60, 0, 600)).toBe("cancel");
    expect(drag(new DragRecognizer(), -60, 0, 600)).toBe("cancel");
  });
  test("fast fling commits below the threshold", () => {
    expect(drag(new DragRecognizer(), 70, 0, 60, 4)).toBe("next");
    expect(drag(new DragRecognizer(), -70, 0, 60, 4)).toBe("copy");
  });
  test("fling that is too short does nothing", () => {
    expect(drag(new DragRecognizer(), 25, 0, 20, 2)).toBe("cancel");
  });
  test("vertical movement = scroll, never next or copy", () => {
    const r = new DragRecognizer();
    expect(drag(r, 30, -250)).toBe("scroll");
    // even if it later drifts sideways a lot
    r.down(200, 400, 0);
    r.move(200, 380, 10);
    expect(r.mode).toBe("vertical");
    r.move(360, 300, 50);
    expect(r.up(360, 300, 60)).toBe("scroll");
  });
  test("horizontal lock stays horizontal", () => {
    const r = new DragRecognizer();
    r.down(200, 400, 0);
    r.move(215, 402, 10);
    expect(r.mode).toBe("horizontal");
    r.move(240, 480, 20);
    expect(r.mode).toBe("horizontal");
  });
  test("tap: no real movement, short press", () => {
    const r = new DragRecognizer();
    r.down(100, 100, 0);
    r.move(103, 102, 50);
    expect(r.up(104, 101, 120)).toBe("tap");
  });
  test("long press is not a tap", () => {
    const r = new DragRecognizer();
    r.down(100, 100, 0);
    expect(r.up(101, 100, 900)).toBe("cancel");
  });
  test("browser cancel (native scroll took over)", () => {
    const r = new DragRecognizer();
    r.down(100, 100, 0);
    r.move(100, 130, 30);
    expect(r.cancel()).toBe("scroll");
    r.down(100, 100, 0);
    expect(r.cancel()).toBe("cancel");
  });
  test("threshold is configurable", () => {
    expect(drag(new DragRecognizer({ threshold: 200 }), 150, 0, 800)).toBe("cancel");
    expect(drag(new DragRecognizer({ threshold: 100 }), 150, 0, 800)).toBe("next");
  });
});
