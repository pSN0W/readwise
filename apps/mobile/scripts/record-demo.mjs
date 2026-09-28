import { chromium } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createServer } from "vite";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const lib = resolve(here, ".scratch/e2e-library");
const fixture = resolve(here, "../../fixtures/library");
const recDir = resolve(here, ".scratch/recordings");

rmSync(lib, { recursive: true, force: true });
cpSync(fixture, lib, { recursive: true });

rmSync(recDir, { recursive: true, force: true });
mkdirSync(recDir, { recursive: true });

process.env.RH_LIBRARY = ".scratch/e2e-library";
const server = await createServer({
  root: here,
  server: { port: 5174 },
});
await server.listen();
console.log("Vite listening on port 5174");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  recordVideo: {
    dir: recDir,
    size: { width: 540, height: 960 },
  },
  permissions: ["clipboard-read", "clipboard-write"],
  hasTouch: true,
  isMobile: true,
});

const page = await context.newPage();

// Touch visualizer helper
await page.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.id = "demo-touch-dot";
    dot.style.cssText = `
      position: fixed;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(43, 92, 138, 0.75) 0%, rgba(43, 92, 138, 0.25) 70%, rgba(43, 92, 138, 0) 100%);
      border: 2px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 0 12px rgba(43, 92, 138, 0.6);
      pointer-events: none;
      z-index: 999999;
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
      transition: transform 0.15s ease, opacity 0.15s ease;
    `;
    document.body.appendChild(dot);

    window.__showTouch = (x, y, active = false) => {
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.opacity = "1";
      dot.style.transform = `translate(-50%, -50%) scale(${active ? 0.9 : 1.15})`;
    };

    window.__hideTouch = () => {
      dot.style.opacity = "0";
      dot.style.transform = "translate(-50%, -50%) scale(0)";
    };
  });
});

async function visualTap(locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(({ x, y }) => window.__showTouch?.(x, y, false), { x, y });
  await page.waitForTimeout(160);
  await page.evaluate(({ x, y }) => window.__showTouch?.(x, y, true), { x, y });
  await locator.click();
  await page.waitForTimeout(180);
  await page.evaluate(() => window.__hideTouch?.());
  await page.waitForTimeout(150);
}

async function visualTouchDrag(x, y, dx, dy, ms = 350, steps = 18) {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(({ x, y }) => window.__showTouch?.(x, y, true), { x, y });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    const curX = x + (dx * i) / steps;
    const curY = y + (dy * i) / steps;
    await page.evaluate(({ x, y }) => window.__showTouch?.(x, y, true), { x: curX, y: curY });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: curX, y: curY }] });
    await page.waitForTimeout(ms / steps);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.evaluate(() => window.__hideTouch?.());
  await cdp.detach();
  await page.waitForTimeout(200);
}

async function visualSwipeCard(dx) {
  const box = await page.getByTestId("card").boundingBox();
  if (!box) return;
  await visualTouchDrag(box.x + box.width / 2 - dx / 2, box.y + box.height * 0.55, dx, 4, 380, 20);
}

async function visualScroll(testId, distance) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) return;
  await visualTouchDrag(box.x + box.width / 2, box.y + box.height * 0.7, 0, -distance, 450, 22);
}

console.log("Navigating to app...");
await page.goto("http://127.0.0.1:5174/#/feed");
await page.waitForSelector('[data-testid="card"]', { timeout: 15000 });
console.log("App ready. Starting demo recording...");

// Scene 1: Reading Feed card (topic and main text first, then scrolling reveals details)
await page.waitForTimeout(1600);
console.log("Scene 1: Reading front of card, then scrolling for details");
await visualScroll("card", 380);
await page.waitForTimeout(1400);
await visualScroll("card", 380);
await page.waitForTimeout(1400);
await visualScroll("card", -700);
await page.waitForTimeout(1000);

// Scene 2: Taking a note
console.log("Scene 2: Taking a note");
await visualTap(page.getByTestId("card-title"));
await page.waitForSelector('[data-testid="note-sheet"]', { timeout: 5000 });
await page.waitForTimeout(800);
await visualTap(page.getByTestId("note-text"));
await page.waitForTimeout(300);
const noteContent = "Key concept: superposition packs more features than neurons ($k > d$).";
for (const char of noteContent) {
  await page.keyboard.type(char, { delay: 35 });
}
await page.waitForTimeout(800);
await visualTap(page.getByTestId("note-save"));
await page.waitForTimeout(1200);

// Scene 2b: Filter by unread
console.log("Scene 2b: Filtering by Unread only");
await visualTap(page.getByTestId("filter-unread"));
await page.waitForTimeout(1400);

// Scene 2c: Textbox with options (type directly in textbox to filter options)
console.log("Scene 2c: Textbox with options (combobox)");
await visualTap(page.getByTestId("scope-filter-input"));
await page.waitForSelector('[data-testid="scope-panel"]', { timeout: 3000 });
await page.waitForTimeout(600);
for (const char of "Focus") {
  await page.keyboard.type(char, { delay: 60 });
}
await page.waitForTimeout(1000);
await visualTap(page.getByTestId("scope-panel").getByRole("option").first());
await page.waitForTimeout(1400);

// Tag dropdown with filter textbox
await visualTap(page.getByTestId("tag-dd"));
await page.waitForSelector('[data-testid="tag-panel"]', { timeout: 3000 });
await page.waitForTimeout(600);
for (const char of "conf") {
  await page.keyboard.type(char, { delay: 60 });
}
await page.waitForTimeout(1000);
await visualTap(page.getByTestId("tag-dd")); // toggle close
await page.waitForTimeout(800);

// Scene 3: Swiping cards
console.log("Scene 3: Swiping cards");
await visualSwipeCard(180); // Next card
await page.waitForTimeout(1400);

await visualSwipeCard(-180); // Copy & mark explored
await page.waitForTimeout(1600);

await visualSwipeCard(180); // Next card
await page.waitForTimeout(1200);

// Scene 4: Books tab
console.log("Scene 4: Books screen with filter textbox");
await visualTap(page.getByRole("link", { name: "Books" }));
await page.waitForTimeout(1200);
await visualTap(page.getByTestId("books-filter-input"));
await page.waitForTimeout(400);
for (const char of "Interp") {
  await page.keyboard.type(char, { delay: 60 });
}
await page.waitForTimeout(1000);
await visualTap(page.locator('button[data-source="s_booka"]'));
await page.waitForTimeout(1400);
// Switch to Cards view
await visualTap(page.getByTestId("mode-cards"));
await page.waitForTimeout(1000);
await visualScroll("source-cards", 220);
await page.waitForTimeout(1000);
// Switch back to Book text
await visualTap(page.getByTestId("mode-book"));
await page.waitForTimeout(1000);
await visualTap(page.getByTestId("books-back"));
await page.waitForTimeout(1000);

// Scene 5: Topics
console.log("Scene 5: Topics");
await visualTap(page.getByRole("link", { name: "Topics" }));
await page.waitForTimeout(1200);
// Click on first topic row
const firstTopic = page.locator(".plist .row-i").first();
if (await firstTopic.isVisible()) {
  await visualTap(firstTopic);
  await page.waitForTimeout(1200);
}

// Scene 6: Search
console.log("Scene 6: Search");
await visualTap(page.getByTestId("search-btn"));
await page.waitForSelector('[data-testid="search-input"]', { timeout: 5000 });
await page.waitForTimeout(600);
for (const char of "sparse") {
  await page.keyboard.type(char, { delay: 70 });
}
await page.waitForTimeout(1400);
// Tap on the first matching card result
const firstCardResult = page.locator('[data-result-card]').first();
if (await firstCardResult.isVisible()) {
  await visualTap(firstCardResult);
  await page.waitForTimeout(1500);
}

// Scene 7: Shelf & Settings
console.log("Scene 7: Shelf");
await visualTap(page.getByRole("link", { name: "Shelf" }));
await page.waitForTimeout(1500);
// Return to feed
await visualTap(page.getByRole("link", { name: "Feed" }));
await page.waitForTimeout(1800);

console.log("Walkthrough finished. Finalizing video...");
const video = page.video();
await page.close();
await context.close();
await browser.close();
await server.close();

const videoPath = await video?.path();
console.log("Raw recording saved at:", videoPath);

if (videoPath && existsSync(videoPath)) {
  const mp4Path = resolve(here, "demo.mp4");
  const artifactPath = "/home/pratyaksh/.gemini/antigravity-cli/brain/d4ca8848-4619-4815-af58-19032292cad5/demo.mp4";
  console.log(`Converting ${videoPath} to ${mp4Path}...`);
  execSync(`ffmpeg -y -i "${videoPath}" -c:v libx264 -pix_fmt yuv420p -profile:v high -level:v 4.0 -preset slow -crf 22 -movflags +faststart "${mp4Path}"`);
  console.log(`Demo video converted to MP4: ${mp4Path}`);
  
  // Copy to artifact directory
  cpSync(mp4Path, artifactPath);
  console.log(`Demo video copied to artifact directory: ${artifactPath}`);
}

console.log("Done!");
