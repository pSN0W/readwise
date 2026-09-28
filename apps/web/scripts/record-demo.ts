import { spawn, execSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { scratchCopy } from "./scratch.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const MEDIA_DIR = resolve(here, "../media");
const SCREENSHOTS_DIR = resolve(MEDIA_DIR, "screenshots");
const RAW_VIDEO_DIR = resolve(MEDIA_DIR, "raw-video");
const ARTIFACT_DIR = "/home/pratyaksh/.gemini/antigravity-cli/brain/b711f6e9-a541-4333-9e7f-501cffe92522";

async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  await mkdir(RAW_VIDEO_DIR, { recursive: true });

  console.log("Preparing fresh scratch library...");
  const libDir = await scratchCopy("demo", true);

  console.log("Starting server...");
  const server = spawn(process.execPath, [resolve(here, "../server/index.ts")], {
    env: { ...process.env, LIBRARY_DIR: libDir, PORT: String(PORT) },
    stdio: "ignore",
  });

  let up = false;
  while (!up) {
    try {
      up = (await fetch(`${BASE}/library/library.json`, { method: "HEAD" })).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  console.log("Server ready at " + BASE);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: RAW_VIDEO_DIR,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();

  async function snap(name: string, pauseMs = 1200) {
    await page.waitForTimeout(pauseMs);
    const p = resolve(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: p });
    console.log(`Saved screenshot: ${name}.png`);
  }

  // 1. Focus view by default on root URL
  console.log("Navigating to root URL (default view: Focus mode)...");
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".focus-bar");
  await page.waitForSelector(".rcard.big");
  await snap("01_focus_mode_default");

  // 1b. Progressive scroll reveal on unread card (c_0003: Superposition)
  console.log("Demonstrating progressive disclosure on card...");
  await page.goto(`${BASE}/#/focus?card=c_0003`);
  await page.waitForSelector(".reveal-cue");
  await snap("02_focus_card_unrevealed");

  // Reveal details (why, how, when, sources)
  await page.locator(".reveal-cue").click();
  await page.waitForSelector(".card-details");
  await snap("03_focus_card_revealed");

  // 2. Search in filter
  console.log("Demonstrating search filter in Focus mode...");
  const searchFilter = page.getByLabel("Search cards in focus mode");
  await searchFilter.fill("superposition");
  await page.waitForTimeout(400);
  await snap("04_focus_search_filter");
  await page.locator(".clear-btn").click();
  await page.waitForTimeout(300);

  // 3. Filterable Dropdown Textbox: Focus Status filter
  console.log("Demonstrating filterable textbox dropdown for status...");
  const statusInput = page.locator('input.fsel-input[aria-label="Status"]');
  await statusInput.click();
  await statusInput.fill("read");
  await page.waitForTimeout(400);
  await snap("05_focus_dropdown_textbox_filtered");
  await page.locator('.fsel-dropdown .fsel-opt').first().click();
  await page.waitForTimeout(300);

  // 4. Focus to Reader shortcut (R)
  console.log("Demonstrating R shortcut to jump from Focus to Reader mode...");
  await page.locator("body").click();
  await page.keyboard.press("r");
  await page.waitForFunction(() => document.documentElement.dataset.readerReady === "s_booka");
  await page.waitForSelector('[data-pane-el="cards"] .rcard');
  await snap("06_reader_via_shortcut_r");

  // 4b. Reader Source filter text box: typing to filter books out
  console.log("Demonstrating Source filter text box in Reader mode...");
  const srcInput = page.locator('input.fsel-input[aria-label="Source"]');
  await srcInput.click();
  await srcInput.fill("video");
  await page.waitForTimeout(400);
  await snap("07_reader_source_textbox_filter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 4c. Reader to Focus shortcut (F)
  console.log("Demonstrating F shortcut to return from Reader to Focus mode...");
  await page.locator("body").click();
  await page.keyboard.press("f");
  await page.waitForSelector(".focus-bar");
  await snap("08_focus_returned_via_shortcut_f");

  // Reset filters if any active
  const resetBtn = page.getByRole("button", { name: "Reset" });
  if (await resetBtn.isVisible()) {
    await resetBtn.click();
    await page.waitForTimeout(300);
  }

  // 5. Search view
  console.log("Navigating to Search view...");
  await page.goto(`${BASE}/#/search`);
  await page.waitForSelector(".hit");
  await snap("09_search_overview");

  const searchBox = page.getByRole("searchbox", { name: "Search sources" });
  await searchBox.fill("inter");
  await page.waitForTimeout(400);
  await snap("10_search_filtered");

  // 6. W2 Reader view (Book A)
  console.log("Navigating to W2 Reader...");
  await page.goto(`${BASE}/#/read/s_booka`);
  await page.waitForFunction(() => document.documentElement.dataset.readerReady === "s_booka");
  await page.waitForSelector('[data-pane-el="cards"] .rcard');
  await snap("11_reader_booka_start");

  // Scroll reader
  console.log("Scrolling reader to Superposition card...");
  await page.locator('[data-pane-el="book"]').evaluate((el) => {
    el.scrollTop = 1200;
  });
  await page.waitForTimeout(600);
  await snap("12_reader_booka_scrolled");

  // 7. W2 Video Reader (Video C)
  console.log("Navigating to Video Reader...");
  await page.goto(`${BASE}/#/read/s_videoc`);
  await page.waitForFunction(() => document.documentElement.dataset.readerReady === "s_videoc");
  await page.waitForSelector(".cue");
  await snap("13_reader_video_c");

  // 8. W6 Coverage view
  console.log("Navigating to Coverage view...");
  await page.goto(`${BASE}/#/coverage`);
  await page.waitForSelector(".strip");
  await snap("14_coverage_overview");

  await page.locator('.strip[data-sid="s_booka"] .seg2[data-id="c_0003"]').click();
  await page.waitForSelector('[data-testid="coverage-detail"] h3');
  await snap("15_coverage_card_detail");

  // 9. W7 Video Timeline view
  console.log("Navigating to Video Timeline...");
  await page.goto(`${BASE}/#/video/s_videoc`);
  await page.waitForSelector('[data-testid="video-view"]');
  await page.waitForSelector(".span");
  await snap("16_video_timeline");

  // 10. W10 Board view
  console.log("Navigating to Board view...");
  await page.goto(`${BASE}/#/board`);
  await page.waitForSelector(".kcol");
  await snap("17_board_kanban");

  // 11. W11 Inbox view
  console.log("Navigating to Inbox view...");
  await page.goto(`${BASE}/#/inbox`);
  await page.waitForSelector(".sugg");
  await snap("18_inbox_suggestions");

  // 12. W12 Report view
  console.log("Navigating to Ingest Report view...");
  await page.goto(`${BASE}/#/report`);
  await page.waitForSelector(".chk");
  await snap("19_report_checks");

  // 13. W14 Palette
  console.log("Opening Command Palette...");
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".pal input");
  await page.getByLabel("Search everything").fill("super");
  await page.waitForTimeout(400);
  await snap("20_command_palette");
  await page.keyboard.press("Escape");

  // 14. Settings
  console.log("Navigating to Settings view...");
  await page.goto(`${BASE}/#/settings`);
  await page.waitForSelector("section");
  await snap("21_settings_view");

  await page.waitForTimeout(1000);

  // Close context to save video
  console.log("Closing page & saving video...");
  await page.close();
  await context.close();
  await browser.close();
  server.kill();

  // Find recorded video from Playwright
  const videoFiles = await readdir(RAW_VIDEO_DIR);
  const recordedWebm = videoFiles.find((f) => f.endsWith(".webm"));

  const finalMp4 = resolve(MEDIA_DIR, "reading_helper_demo.mp4");
  const slideshowMp4 = resolve(MEDIA_DIR, "reading_helper_slideshow.mp4");

  if (recordedWebm) {
    const rawPath = resolve(RAW_VIDEO_DIR, recordedWebm);
    console.log(`Converting Playwright recording ${rawPath} to MP4...`);
    execSync(`ffmpeg -y -i "${rawPath}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 22 "${finalMp4}"`, { stdio: "inherit" });
    console.log(`Created live interaction demo: ${finalMp4}`);
  }

  // Generate slideshow video from screenshots (2 seconds per image, high quality)
  console.log("Building slideshow video from screenshots with ffmpeg...");
  const screenshotFiles = (await readdir(SCREENSHOTS_DIR)).filter((f) => f.endsWith(".png")).sort();
  const listFile = resolve(MEDIA_DIR, "frames.txt");
  const lines: string[] = [];
  for (const f of screenshotFiles) {
    lines.push(`file '${resolve(SCREENSHOTS_DIR, f)}'`);
    lines.push(`duration 2.5`);
  }
  // Repeat last frame for concat demuxer
  if (screenshotFiles.length) {
    lines.push(`file '${resolve(SCREENSHOTS_DIR, screenshotFiles[screenshotFiles.length - 1])}'`);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(listFile, lines.join("\n"));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -vf "fps=25,format=yuv420p" -c:v libx264 -preset fast -crf 20 "${slideshowMp4}"`, { stdio: "inherit" });
  console.log(`Created slideshow video: ${slideshowMp4}`);

  // Copy videos and screenshots to artifact dir
  console.log(`Copying media to artifact directory: ${ARTIFACT_DIR}...`);
  await mkdir(resolve(ARTIFACT_DIR, "media/screenshots"), { recursive: true });
  await cp(SCREENSHOTS_DIR, resolve(ARTIFACT_DIR, "media/screenshots"), { recursive: true });
  if (recordedWebm) {
    await cp(finalMp4, resolve(ARTIFACT_DIR, "reading_helper_demo.mp4"));
  }
  await cp(slideshowMp4, resolve(ARTIFACT_DIR, "reading_helper_slideshow.mp4"));

  console.log("Demo recording and video generation complete!");
}

main().catch((err) => {
  console.error("Error generating demo video:", err);
  process.exit(1);
});
