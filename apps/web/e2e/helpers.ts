import { cp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

export const LIB = resolve(import.meta.dirname, "../.scratch/e2e");
const FIXTURE = resolve(import.meta.dirname, "../../../fixtures/library");

/** Fresh scratch copy of the fixture (the server reads from disk on every request). */
export async function resetLibrary(): Promise<void> {
  await rm(LIB, { recursive: true, force: true });
  await cp(FIXTURE, LIB, { recursive: true });
}

export async function readDisk(path: string): Promise<string | null> {
  try { return await readFile(resolve(LIB, path), "utf8"); } catch { return null; }
}

export async function stateOnDisk(): Promise<any> {
  const t = await readDisk("state/laptop-web.json");
  return t ? JSON.parse(t) : null;
}

/** Wait until this device's state file on disk passes a check (writes are debounced by 1 s). */
export async function expectState(check: (s: any) => boolean, message: string): Promise<void> {
  await expect.poll(async () => { const s = await stateOnDisk(); try { return !!s && check(s); } catch { return false; } },
    { message, timeout: 6000 }).toBe(true);
}

/** Open the app and fail the test on any page error. */
export async function open(page: Page, hash: string, opts: { pollMs?: number } = {}): Promise<void> {
  page.on("pageerror", (e) => { throw e; });
  if (opts.pollMs) await page.addInitScript((ms) => localStorage.setItem("rh.pollMs", String(ms)), opts.pollMs);
  await page.goto("/" + hash);
  await expect(page.locator(".top .brand")).toBeVisible();
}

export const bookPane = (page: Page) => page.locator('[data-pane-el="book"]');
export const cardsPane = (page: Page) => page.locator('[data-pane-el="cards"]');
export const tocPane = (page: Page) => page.locator('[data-pane-el="toc"]');

export async function readerReady(page: Page, sourceId: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-reader-ready", sourceId);
}
