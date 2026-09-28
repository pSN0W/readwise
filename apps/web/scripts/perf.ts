// Performance check on the synthetic library (ticket 01 targets):
//   first screen < 1 s after server start · W2 opens the 15k-line source < 500 ms ·
//   book pane scrolls at 60 fps · search < 50 ms per keystroke.
// Usage: npm run build && node scripts/gen-synthetic.ts && node scripts/perf.ts
import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const LIB = resolve(process.argv[2] ?? resolve(here, "../.scratch/synth"));
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

await stat(resolve(LIB, "library.json")).catch(() => { throw new Error(`No library at ${LIB}. Run: node scripts/gen-synthetic.ts`); });
await stat(resolve(here, "../dist/index.html")).catch(() => { throw new Error("No build. Run: npm run build"); });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("about:blank");

// 1. First screen: from server spawn to the W2 reader showing its first cards.
const t0 = performance.now();
const server = spawn(process.execPath, [resolve(here, "../server/index.ts")], { env: { ...process.env, LIBRARY_DIR: LIB, PORT: String(PORT) }, stdio: "ignore" });
let up = false;
while (!up) {
  try { up = (await fetch(`${BASE}/library/library.json`, { method: "HEAD" })).ok; } catch { await new Promise((r) => setTimeout(r, 10)); }
}
const tServer = performance.now() - t0;
await page.goto(`${BASE}/#/read`); // W2 on the first source, which is the 15k-line book
await page.locator('[data-pane-el="cards"] .rcard').first().waitFor();
await page.waitForFunction(() => !!document.documentElement.dataset.readerReady);
const firstSource = await page.evaluate(() => document.documentElement.dataset.readerReady);
const tFirst = performance.now() - t0;

// fresh page (empty caches in the app) for the reader timing; start on a view without text
await page.close();
const page2 = await ctx.newPage();
await page2.goto(`${BASE}/#/report`);
await page2.locator("table.chk").waitFor();

// 2. W2 opens the 15,000-line source (first time: fetch + split + blocks + render).
async function openReader(p: Page, id: string): Promise<{ wall: number; app: number; parts: Record<string, number> }> {
  return p.evaluate(async (sid) => {
    const w = window as unknown as { __rhPerf: Record<string, number> };
    const start = performance.now();
    location.hash = `#/read/${sid}`;
    await new Promise<void>((ok) => {
      const check = () => (document.documentElement.dataset.readerReady === sid ? ok() : requestAnimationFrame(check));
      check();
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // painted
    const { readerOpen, readerText, readerBuild, readerDom } = w.__rhPerf;
    return { wall: performance.now() - start, app: readerOpen, parts: { text: readerText, build: readerBuild, dom: readerDom } };
  }, id);
}
const bigFirst = await openReader(page2, "s_big");
await openReader(page2, "s_src02");
const bigCached = await openReader(page2, "s_big");
const bigStats = await page2.evaluate(() => ({
  chunks: document.querySelectorAll('[data-pane-el="book"] .chunk').length,
  blocks: document.querySelectorAll('[data-pane-el="book"] [data-l]').length,
  cards: document.querySelectorAll('[data-pane-el="cards"] .rcard').length,
  domNodes: document.getElementsByTagName("*").length,
}));

// 3. Scroll the book pane (and the cards follow) for ~4 s; measure frame times.
async function scrollFps(p: Page, pane: string, pxPerFrame: number, frames: number) {
  return p.evaluate(async ({ pane, pxPerFrame, frames }) => {
    const el = document.querySelector<HTMLElement>(`[data-pane-el="${pane}"]`)!;
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
      el.scrollTop += pxPerFrame;
    }
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      frames: times.length, avgMs: avg, fps: 1000 / avg, p95Ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted[sorted.length - 1],
      over20ms: times.filter((t) => t > 20).length, scrolledTo: el.scrollTop, scrollHeight: el.scrollHeight,
      cur: document.querySelector('[data-pane-el="cards"] .rcard.cur')?.getAttribute("data-id"),
    };
  }, { pane, pxPerFrame, frames });
}
const scrollBook = await scrollFps(page2, "book", 80, 240);
const scrollCards = await scrollFps(page2, "cards", 80, 240);

// 4. Search: per keystroke in the top search box, from input to painted results.
await page2.evaluate(() => { location.hash = "#/search"; });
await page2.locator(".hit").first().waitFor();
const search = await page2.evaluate(async () => {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const w = window as unknown as { __rhPerf: Record<string, number> };
  const out: { ch: string; ms: number; core: number; hits: number }[] = [];
  for (const q of ["notes on model", "field", "youtube synth1"]) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const ch of q) {
      const t = performance.now();
      input.value += ch;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r)); // next frame: results rendered
      out.push({ ch, ms: performance.now() - t, core: w.__rhPerf.searchMs, hits: document.querySelectorAll(".hit").length });
    }
  }
  const ms = out.map((x) => x.ms).sort((a, b) => a - b);
  return { keystrokes: out.length, avgMs: ms.reduce((a, b) => a + b, 0) / ms.length, maxMs: ms[ms.length - 1], coreMaxMs: Math.max(...out.map((x) => x.core)) };
});

// 5. Palette (searchAll over 5,000 cards + topics + sources), per keystroke.
await page2.keyboard.press("Control+k");
await page2.locator(".pal input").waitFor();
const palette = await page2.evaluate(async () => {
  const input = document.querySelector<HTMLInputElement>(".pal input")!;
  const ms: number[] = [];
  for (const ch of "model sparse") {
    const t = performance.now();
    input.value += ch;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { keystrokes: ms.length, avgMs: ms.reduce((a, b) => a + b, 0) / ms.length, maxMs: ms[ms.length - 1] };
});

// 6. Focus view: bytes of content.md fetched for the first 10 cards (fresh page so no in-memory cache)
await page2.close();
const page3 = await ctx.newPage();
let focusBytes = 0;
page3.on("response", async (res) => {
  if (res.url().includes("content.md")) {
    try {
      const b = await res.body();
      focusBytes += b.length;
    } catch {}
  }
});
await page3.goto(`${BASE}/#/focus?scope=source:s_big`);
await page3.locator(".rcard.big").waitFor();
await page3.waitForFunction(() => !!document.querySelector(".rcard.big .snip .ln-row"));
for (let i = 0; i < 9; i++) {
  await page3.keyboard.press("ArrowRight");
  await page3.waitForFunction(() => !!document.querySelector(".rcard.big .snip .ln-row"));
}

server.kill();
await browser.close();

const r = (n: number) => Math.round(n * 10) / 10;
const results = {
  library: LIB,
  serverReadyMs: r(tServer),
  firstScreenMs: r(tFirst),
  firstScreenSource: firstSource,
  bigReaderOpenMs: { firstTime: r(bigFirst.wall), firstTimeInApp: r(bigFirst.app), again: r(bigCached.wall),
    partsFirst: Object.fromEntries(Object.entries(bigFirst.parts).map(([k, v]) => [k, r(v)])) },
  bigReaderDom: bigStats,
  scrollBook: { ...scrollBook, avgMs: r(scrollBook.avgMs), fps: r(scrollBook.fps), p95Ms: r(scrollBook.p95Ms), maxMs: r(scrollBook.maxMs) },
  scrollCards: { ...scrollCards, avgMs: r(scrollCards.avgMs), fps: r(scrollCards.fps), p95Ms: r(scrollCards.p95Ms), maxMs: r(scrollCards.maxMs) },
  searchPerKeystroke: { ...search, avgMs: r(search.avgMs), maxMs: r(search.maxMs), coreMaxMs: r(search.coreMaxMs) },
  palettePerKeystroke: { ...palette, avgMs: r(palette.avgMs), maxMs: r(palette.maxMs) },
  focusContentBytesKB: r(focusBytes / 1024),
};
const { mkdir } = await import("node:fs/promises");
await mkdir(resolve(here, "../perf-results"), { recursive: true });
await writeFile(resolve(here, "../perf-results/perf.json"), JSON.stringify(results, null, 2));
await writeFile(resolve(here, "../.scratch/perf-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(`
target                               measured
first screen after server start <1s  ${results.firstScreenMs} ms (server up in ${results.serverReadyMs} ms)
W2 opens 15k-line source <500 ms     ${results.bigReaderOpenMs.firstTime} ms first time, ${results.bigReaderOpenMs.again} ms again
book pane scroll 60 fps              ${results.scrollBook.fps} fps avg, p95 frame ${results.scrollBook.p95Ms} ms, ${results.scrollBook.over20ms}/${results.scrollBook.frames} frames >20 ms
cards pane scroll                    ${results.scrollCards.fps} fps avg, p95 frame ${results.scrollCards.p95Ms} ms
search per keystroke <50 ms          ${results.searchPerKeystroke.avgMs} ms avg, ${results.searchPerKeystroke.maxMs} ms max (core ${results.searchPerKeystroke.coreMaxMs} ms)
palette per keystroke                ${results.palettePerKeystroke.avgMs} ms avg, ${results.palettePerKeystroke.maxMs} ms max
Focus view 10 cards content.md <100K ${results.focusContentBytesKB} KB`);

