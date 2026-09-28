import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export const APP = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const LIB = resolve(APP, ".scratch/e2e-library");
const FIXTURE = resolve(APP, "../../fixtures/library");

/** Fresh scratch copy of the fixture for each test (the dev server reads it from disk). */
export function resetLibrary(): void {
  rmSync(LIB, { recursive: true, force: true });
  cpSync(FIXTURE, LIB, { recursive: true });
}

export function readLib(p: string): string | null {
  const f = resolve(LIB, p);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}

export function writeLib(p: string, text: string): void {
  writeFileSync(resolve(LIB, p), text);
}

type Entry = { v?: unknown; ts: number; rev?: number };
export function ownState(): { cards: Record<string, Record<string, Entry>>; my_tags?: Record<string, unknown>; copy_prompt?: { v: string } } | null {
  const t = readLib("state/android-phone.json");
  return t ? JSON.parse(t) : null;
}

/** Open the app and wait for the first card. */
export async function openApp(page: Page, hash = "#/feed"): Promise<void> {
  await page.goto(`/${hash}`);
  if (hash.startsWith("#/feed")) await expect(page.getByTestId("card")).toBeVisible({ timeout: 15_000 });
}

/** A real touch drag (touchstart → touchmove… → touchend) through the Chrome DevTools protocol. */
export async function touchDrag(page: Page, x: number, y: number, dx: number, dy: number, ms = 250, steps = 12): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }] });
    await page.waitForTimeout(ms / steps);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Drag the feed card horizontally (dx > 0 = →). */
export async function swipeCard(page: Page, dx: number): Promise<void> {
  const box = (await page.getByTestId("card").boundingBox())!;
  await touchDrag(page, box.x + box.width / 2 - dx / 2, box.y + box.height * 0.6, dx, 4);
}

/** A native touch scroll inside an element: the finger moves up by `distance` (content scrolls down). */
export async function touchScroll(page: Page, testId: string, distance: number): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await touchDrag(page, box.x + box.width / 2, box.y + box.height * 0.8, 0, -distance, 300, 15);
}

export async function currentCardId(page: Page): Promise<string> {
  return (await page.getByTestId("card").getAttribute("data-card-id")) as string;
}
