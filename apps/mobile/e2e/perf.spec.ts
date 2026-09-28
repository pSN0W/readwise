// Performance on the synthetic library (50 sources, 5,000 cards, one 15,000-line source with 400 images).
// Targets (ticket 02): ready < 1.5 s · swipe < 100 ms · 15k-line Book opens < 700 ms and scrolls smoothly ·
// search < 50 ms per keystroke. Results go to perf-results/perf.json and the console.
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP, swipeCard, touchDrag, touchScroll } from "./helpers.ts";

const THROTTLE = 4;
const results: Record<string, unknown> = { throttle: `${THROTTLE}x CPU`, viewport: "412x915 @2.625 (Pixel 7), touch" };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const p95 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const r1 = (x: number) => Math.round(x * 10) / 10;

async function throttled(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  return cdp;
}
const perf = (page: Page, name: string) => page.evaluate((n) => ((window as unknown as { __rhPerf?: Record<string, number[]> }).__rhPerf ?? {})[n] ?? [], name);
const markTime = (page: Page, name: string) => page.evaluate((n) => performance.getEntriesByName(n).map((e) => e.startTime), name);

test.beforeAll(() => {
  // the perf run writes this device's state into the synthetic library: start from a clean state
  rmSync(resolve(APP, ".scratch/synth/state/perf-phone.json"), { force: true });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rh.deviceId", "perf-phone"));
});

test("app ready and start-up files", async ({ page }) => {
  const runs: number[] = [];
  let startFiles: string[] = [];
  let laterText: string[] = [];
  for (let i = 0; i < 3; i++) {
    await throttled(page);
    await page.goto("/#/feed");
    await expect(page.getByTestId("card")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => performance.getEntriesByName("rh-ready").length > 0);
    await page.waitForTimeout(1500);
    // library files requested before "ready" and text files after it, from the page's own timeline
    const t = await page.evaluate(() => {
      const ready = performance.getEntriesByName("rh-ready")[0].startTime;
      const lib = performance.getEntriesByType("resource").filter((r) => r.name.includes("/__lib/"))
        .map((r) => ({ f: decodeURIComponent(r.name.split("/__lib/")[1]), t: r.startTime }));
      return { ready, before: lib.filter((r) => r.t <= ready).map((r) => r.f), after: lib.filter((r) => r.t > ready && r.f.endsWith("content.md")).map((r) => r.f) };
    });
    runs.push(t.ready);
    startFiles = t.before;
    laterText = t.after;
    await page.goto("about:blank");
  }
  results.ready_ms = { runs: runs.map(Math.round), median: Math.round(median(runs)), target: "< 1500" };
  results.files_before_ready = startFiles;
  results.text_loaded_after_ready = laterText;
  expect(startFiles.filter((f) => f.endsWith("content.md"))).toEqual([]);
  expect(median(runs)).toBeLessThan(1500);
});

test("P1 swipe to the next card", async ({ page }) => {
  await throttled(page);
  await page.goto("/#/feed");
  await expect(page.getByTestId("card")).toBeVisible({ timeout: 20_000 });
  const wall: number[] = [];
  for (let i = 0; i < 12; i++) {
    const before = await page.getByTestId("card").getAttribute("data-card-id");
    await swipeCard(page, 200);
    const t0 = Date.now();
    await page.waitForFunction((b) => document.querySelector("[data-testid=card]")?.getAttribute("data-card-id") !== b, before);
    wall.push(Date.now() - t0);
  }
  const inApp = await perf(page, "swipe");
  results.swipe_ms = {
    in_app_commit_to_next_frame: { median: r1(median(inApp)), p95: r1(p95(inApp)), n: inApp.length },
    playwright_touchend_to_dom: { median: median(wall), note: "includes CDP round trip" },
    target: "< 100",
  };
  expect(median(inApp)).toBeLessThan(100);
});

test("bytes of content.md fetched while swiping 10 cards", async ({ page }) => {
  await throttled(page);
  let contentBytes = 0;
  page.on("response", async (res) => {
    if (res.url().includes("/__lib/f/sources/") && res.url().includes("/content.md")) {
      const b = await res.body().catch(() => Buffer.alloc(0));
      contentBytes += b.length;
    }
  });

  await page.goto("/#/feed");
  await expect(page.getByTestId("card")).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 10; i++) {
    const card = page.getByTestId("card");
    const canScroll = await card.evaluate((e) => e.scrollHeight > e.clientHeight);
    if (canScroll) {
      await touchScroll(page, "card", 300).catch(() => {});
      await page.waitForTimeout(50);
    }
    const before = await card.getAttribute("data-card-id");
    await swipeCard(page, 200);
    await page.waitForFunction((b) => document.querySelector("[data-testid=card]")?.getAttribute("data-card-id") !== b, before).catch(() => {});
    await page.waitForTimeout(50);
  }

  results.bytes_content_md_10_cards = {
    bytes: contentBytes,
    kb: r1(contentBytes / 1024),
    target: "< 100 KB",
  };
  expect(contentBytes).toBeLessThan(100 * 1024);
});

test("P2 Book of the 15,000-line source: open and scroll", async ({ page }) => {
  await throttled(page);
  await page.goto("/#/books");
  const row = page.locator('[data-source="s_big"]');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await page.waitForFunction(() => performance.getEntriesByName("rh-book-ready").length > 0, null, { timeout: 20_000 });
  const [open] = await markTime(page, "rh-book-open");
  const [ready] = await markTime(page, "rh-book-ready");
  const nodes = await page.getByTestId("book").evaluate((e) => ({ chunks: e.querySelectorAll("[data-chunk]").length, domNodes: e.querySelectorAll("*").length, height: e.scrollHeight }));

  // Smoothness 1: programmatic scroll of 60,000 px, 150 px per frame, frame times recorded in the page.
  const frames = await page.getByTestId("book").evaluate(async (el) => {
    const times: number[] = [];
    let last = performance.now();
    for (let y = 0; y < 60_000; y += 150) {
      el.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    return times;
  });
  // Smoothness 2: real touch flings, frame times from a rAF loop.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = []; w.__stop = false;
    let last = performance.now();
    const loop = (t: number) => { w.__frames.push(t - last); last = t; if (!w.__stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const box = (await page.getByTestId("book").boundingBox())!;
  for (let i = 0; i < 8; i++) await touchDrag(page, box.x + box.width / 2, box.y + box.height * 0.85, 0, -600, 120, 8);
  await page.waitForTimeout(800);
  const touchFrames = await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __stop: boolean }; w.__stop = true; return w.__frames.slice(1); });
  const fps = (f: number[]) => r1(1000 / (f.reduce((a, b) => a + b, 0) / f.length));
  const long = (f: number[]) => r1((100 * f.filter((x) => x > 50).length) / f.length);
  results.book_15k = {
    open_ms: Math.round(ready - open), target: "< 700",
    dom: nodes,
    scroll_programmatic: { frames: frames.length, avg_fps: fps(frames), median_frame_ms: r1(median(frames)), p95_frame_ms: r1(p95(frames)), pct_frames_over_50ms: long(frames) },
    scroll_touch: { frames: touchFrames.length, avg_fps: fps(touchFrames), median_frame_ms: r1(median(touchFrames)), p95_frame_ms: r1(p95(touchFrames)), pct_frames_over_50ms: long(touchFrames) },
  };
  expect(ready - open).toBeLessThan(700);
});

test("search per keystroke", async ({ page }) => {
  await throttled(page);
  await page.goto("/#/search");
  const input = page.getByTestId("search-input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => { (window as unknown as { __rhPerf: Record<string, number[]> }).__rhPerf = {}; });
  for (const q of ["model lay", "big book", "s_src4", "example.com/video"]) {
    await input.fill("");
    await input.pressSequentially(q, { delay: 120 });
    await page.waitForTimeout(200);
  }
  const all = await perf(page, "search");
  const compute = await perf(page, "search-compute");
  // skip the empty-query runs from fill("")
  results.search_ms = {
    keystroke_to_results_on_screen: { median: r1(median(all)), p95: r1(p95(all)), max: r1(Math.max(...all)), n: all.length },
    core_search_compute: { median: r1(median(compute)), p95: r1(p95(compute)) },
    target: "< 50",
  };
  expect(median(all)).toBeLessThan(50);
});

test.afterAll(() => {
  const dir = resolve(APP, "perf-results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "perf.json"), JSON.stringify(results, null, 2) + "\n");
  console.log("\nPERF RESULTS\n" + JSON.stringify(results, null, 2));
});
