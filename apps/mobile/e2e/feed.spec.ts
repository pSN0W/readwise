import { expect, test } from "@playwright/test";
import { currentCardId, openApp, ownState, readLib, resetLibrary, swipeCard, touchDrag, touchScroll, writeLib } from "./helpers.ts";

test.beforeEach(() => resetLibrary());

test("drag → shows the next card", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("pos")).toHaveText("1 / 13");
  const first = await currentCardId(page);
  expect(first).toBe("c_0003"); // New first, source order
  await swipeCard(page, 180);
  await expect(page.getByTestId("pos")).toHaveText("2 / 13");
  expect(await currentCardId(page)).toBe("c_0004");
  await expect(page.getByTestId("card-title")).toHaveText("Polysemantic neuron");
  // ‹ goes back
  await page.getByTestId("prev").click();
  expect(await currentCardId(page)).toBe(first);
});

test("a short drag snaps back and keeps the card", async ({ page }) => {
  await openApp(page);
  await swipeCard(page, 50);
  await page.waitForTimeout(300);
  expect(await currentCardId(page)).toBe("c_0003");
  await expect(page.getByTestId("note-sheet")).toHaveCount(0);
});

test("drag ← copies for deep dive: clipboard, Explored, state file on disk", async ({ page }) => {
  await openApp(page);
  expect(ownState()).toBeNull();
  await swipeCard(page, -180);
  await expect(page.getByTestId("toast")).toContainText("Copied: prompt + card + 2 sources");
  expect(await currentCardId(page)).toBe("c_0003"); // copy does not move on
  await expect(page.getByTestId("state-chip")).toHaveText("Explored");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("You are my tutor");
  expect(clip).toContain("## Card: Superposition");
  expect(clip).toContain("### Interpretability Notes — lines 168–181");
  expect(clip).toContain("### Talk: looking inside LLMs");
  await expect.poll(() => ownState()?.cards.c_0003?.explored?.ts, { timeout: 5000 }).toBeGreaterThan(0);
});

test("vertical scroll inside the card reads deeper and does not change the card", async ({ page }) => {
  await openApp(page);
  const card = page.getByTestId("card");
  expect(await card.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await touchScroll(page, "card", 500);
  await expect.poll(() => card.evaluate((e) => e.scrollTop)).toBeGreaterThan(100);
  // a vertical drag with some sideways drift is still a scroll
  const box = (await card.boundingBox())!;
  await touchDrag(page, box.x + 150, box.y + 600, 40, -300);
  await page.waitForTimeout(300);
  expect(await currentCardId(page)).toBe("c_0003");
  await expect(page.getByTestId("pos")).toHaveText("1 / 13");
  await expect(page.getByTestId("note-sheet")).toHaveCount(0);
  // the sources with their lines are at the bottom of the card
  await expect(page.getByTestId("snip").first()).toContainText("Interpretability Notes · lines 168–181, p. 5");
});

test("tap opens the note; save writes notes/<id>.md", async ({ page }) => {
  await openApp(page);
  const box = (await page.getByTestId("card-title").boundingBox())!;
  await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
  await expect(page.getByTestId("note-sheet")).toBeVisible();
  await page.getByTestId("note-text").fill("Check **superposition** again.\n\n$k > d$");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("note-sheet")).toHaveCount(0);
  await expect.poll(() => readLib("notes/c_0003.md")).toBe("Check **superposition** again.\n\n$k > d$\n");
  await expect(page.getByTestId("note-preview")).toContainText("Check superposition again");
});

test("tag dropdown writes my tags to this device's state file", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("tag-dd").click();
  const panel = page.getByTestId("tag-panel");
  await panel.locator('input[data-tag="revisit"]').check();
  await panel.getByLabel("New tag").fill("#Exam Prep");
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("tagrow")).toContainText("#revisit");
  await expect(page.getByTestId("tagrow")).toContainText("#exam prep");
  await expect.poll(() => ownState()?.cards.c_0003?.tags?.v, { timeout: 5000 }).toEqual(["revisit", "exam prep"]);
  expect(ownState()?.my_tags?.["exam prep"]).toBeTruthy();
});

test("Viewed after 2 s on screen", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("state-chip")).toHaveText("New");
  await expect(page.getByTestId("state-chip")).toHaveText("Viewed", { timeout: 4000 });
  await expect.poll(() => ownState()?.cards.c_0003?.viewed?.rev, { timeout: 5000 }).toBe(2);
});

test("mark different ideas on a merged card", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("split-btn").scrollIntoViewIfNeeded();
  await page.getByTestId("split-btn").click();
  await expect(page.getByTestId("split-btn")).toContainText("split on next ingest");
  await expect.poll(() => ownState()?.cards.c_0003?.split?.v, { timeout: 5000 }).toBe(true);
});

test("scope select: one source in source order", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("scope").selectOption("src:s_bookd");
  await expect(page.getByTestId("pos")).toHaveText("1 / 3");
  await expect(page.getByTestId("card-title")).toHaveText("Habit loop");
});

test("reload banner after the backend bumps generation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rh.pollMs", "400"));
  await openApp(page);
  await expect(page.getByTestId("reload-banner")).toHaveCount(0);
  for (const f of ["cards.json", "library.json"]) {
    const j = JSON.parse(readLib(f)!);
    j.generation = 8;
    if (f === "cards.json") j.cards[0].title = "Linear probe (updated)";
    const { writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { LIB } = await import("./helpers.ts");
    writeFileSync(resolve(LIB, f), JSON.stringify(j));
  }
  await expect(page.getByTestId("reload-banner")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("reload-banner")).toContainText("New cards");
  await page.getByTestId("reload-banner").getByRole("button", { name: "Reload" }).click();
  await expect(page.getByTestId("reload-banner")).toHaveCount(0);
  expect(await currentCardId(page)).toBe("c_0003");
});

test("sources in feed use Range requests for content.md", async ({ page }) => {
  const contentRequests: { url: string; hasRange: boolean }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/sources/") && url.endsWith("/content.md")) {
      contentRequests.push({ url, hasRange: Boolean(req.headers()["range"]) });
    }
  });

  await openApp(page);
  const card = page.getByTestId("card");
  await touchScroll(page, "card", 600);
  await expect(page.getByTestId("snip").first()).toBeVisible({ timeout: 5000 });

  expect(contentRequests.length).toBeGreaterThan(0);
  for (const r of contentRequests) {
    expect(r.hasRange).toBe(true);
  }
});

test("shows old notes of retired cards merged into this one", async ({ page }) => {
  writeLib("notes/c_0099.md", "Old note from c_0099\n");
  await openApp(page, "#/feed?card=c_0005");
  expect(await currentCardId(page)).toBe("c_0005");

  // check note preview on the card
  await expect(page.getByTestId("note-preview")).toContainText("From merged card c_0099");
  await expect(page.getByTestId("note-preview")).toContainText("Old note from c_0099");

  // open note sheet
  const box = (await page.getByTestId("card-title").boundingBox())!;
  await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
  await expect(page.getByTestId("note-sheet")).toBeVisible();
  await expect(page.getByTestId("merged-note")).toContainText("From merged card c_0099");
  await expect(page.getByTestId("merged-note")).toContainText("Old note from c_0099");

  // own note is empty and editable
  await page.getByTestId("note-text").fill("My own note on c_0005");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("note-sheet")).toHaveCount(0);
  await expect.poll(() => readLib("notes/c_0005.md")).toBe("My own note on c_0005\n");
  expect(readLib("notes/c_0099.md")).toBe("Old note from c_0099\n");
});

test("filter cards by viewed/unread status", async ({ page }) => {
  await openApp(page);
  // Default is All (13 cards in fixture: 7 new, 6 viewed/explored/known)
  await expect(page.getByTestId("filter-all")).toContainText("All");
  await expect(page.getByTestId("filter-unread")).toContainText("Unread");
  await expect(page.getByTestId("filter-viewed")).toContainText("Read");

  // Filter by Unread
  await page.getByTestId("filter-unread").click();
  await expect(page.getByTestId("filter-unread")).toHaveClass(/on/);
  await expect(page.getByTestId("pos")).toHaveText("1 / 7");
  await expect(page.getByTestId("state-chip")).toHaveText("New");

  // Filter by Read
  await page.getByTestId("filter-viewed").click();
  await expect(page.getByTestId("filter-viewed")).toHaveClass(/on/);
  await expect(page.getByTestId("pos")).toHaveText("1 / 6");

  // Switch back to All
  await page.getByTestId("filter-all").click();
  await expect(page.getByTestId("filter-all")).toHaveClass(/on/);
  await expect(page.getByTestId("pos")).toContainText("/ 13");
});

test("card displays topic and main text first, revealing details on scroll", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("card-front")).toBeVisible();
  await expect(page.getByTestId("card-title")).toHaveText("Superposition");
  await expect(page.getByTestId("card-front")).toContainText("A network stores more ideas than it has neurons");

  // Scroll down reveals details and source lines
  await touchScroll(page, "card", 400);
  await expect(page.getByTestId("card-details")).toBeVisible();
  await expect(page.getByTestId("snip").first()).toBeVisible();
});

test("dropdowns are filterable by typing text in feed, outline, and tags", async ({ page }) => {
  await openApp(page);

  // 1. Scope dropdown filtering
  await page.getByTestId("scope-trigger").click();
  await expect(page.getByTestId("scope-panel")).toBeVisible();

  const scopeFilter = page.getByTestId("scope-filter-input");
  await scopeFilter.fill("Focus and Habits");
  await expect(page.getByTestId("scope-panel").getByRole("option")).toHaveCount(1);
  await expect(page.getByTestId("scope-panel").getByRole("option")).toContainText("Focus and Habits");

  // Select Focus and Habits
  await page.getByTestId("scope-panel").getByRole("option").click();
  await expect(page.getByTestId("scope-panel")).toBeHidden();
  await expect(page.getByTestId("card-title")).toHaveText("Habit loop");

  // 2. Tag dropdown filtering
  await page.getByTestId("tag-dd").click();
  await expect(page.getByTestId("tag-panel")).toBeVisible();
  const tagFilter = page.getByTestId("tag-filter-input");
  await tagFilter.fill("conf");
  await expect(page.getByTestId("tag-panel").locator("label")).toHaveCount(1);
  await expect(page.getByTestId("tag-panel").locator("label")).toContainText("#confusing");

  // 3. Outline source dropdown filtering
  await page.goto("/#/outline");
  await expect(page.getByTestId("outline")).toBeVisible();
  await page.getByTestId("outline-src-trigger").click();
  await expect(page.getByTestId("outline-src-panel")).toBeVisible();
  const srcFilter = page.getByTestId("outline-src-filter-input");
  await srcFilter.fill("Focus");
  await expect(page.getByTestId("outline-src-panel").getByRole("option")).toHaveCount(1);
  await expect(page.getByTestId("outline-src-panel").getByRole("option")).toContainText("Focus and Habits");
  await page.getByTestId("outline-src-panel").getByRole("option").click();
  await expect(page.getByTestId("outline-src-panel")).toBeHidden();
  await expect(page.getByTestId("outline-src-filter-input")).toHaveValue("Focus and Habits");
});


