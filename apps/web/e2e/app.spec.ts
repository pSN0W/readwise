import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LIB, bookPane, cardsPane, expectState, open, readDisk, readerReady, resetLibrary, tocPane } from "./helpers.ts";

test.beforeEach(async () => { await resetLibrary(); });

test("search as you type, Enter opens W2 Reader", async ({ page }) => {
  await open(page, "#/search");
  await expect(page.locator(".hit")).toHaveCount(4); // empty query lists everything
  const box = page.getByRole("searchbox", { name: "Search sources" });
  await box.fill("focus-and");
  await expect(page.locator(".hit")).toHaveCount(1);
  await expect(page.locator(".hit").first()).toContainText("Focus and Habits");
  await expect(page.locator(".hit").first()).toContainText("% read");
  await box.fill("youtube");
  await expect(page.locator(".hit")).toHaveCount(1);
  await expect(page.locator(".hit").first()).toContainText("Talk: looking inside LLMs");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/read\/s_videoc/);
  await readerReady(page, "s_videoc");
  await expect(bookPane(page).locator(".cue").first()).toBeVisible();
  // a cue's time opens the video at that second
  await expect(bookPane(page).locator('.cue a.ts[href*="t=130s"]')).toHaveAttribute("target", "_blank");
});

test("scroll the book pane: cards and contents follow; scroll cards: book follows", async ({ page }) => {
  await open(page, "#/read/s_booka");
  await readerReady(page, "s_booka");
  // bring the Circuit card (c_0008) start to the top of the book pane
  await bookPane(page).evaluate((el) => {
    const mk = el.querySelector<HTMLElement>('.mk[data-go="c_0008"]')!;
    el.scrollTop = mk.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + 30;
  });
  await expect(cardsPane(page).locator(".rcard.cur")).toHaveAttribute("data-id", "c_0008");
  await expect(tocPane(page).locator('[data-tocid="c_0008"]')).toHaveClass(/cur/);
  const top = await cardsPane(page).evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(100);

  // now scroll the cards pane back to the Linear probe card (c_0001, lines 37-89)
  await cardsPane(page).evaluate((el) => {
    const c = el.querySelector<HTMLElement>('.rcard[data-id="c_0001"]')!;
    el.scrollTop = c.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 30;
  });
  await expect(cardsPane(page).locator(".rcard.cur")).toHaveAttribute("data-id", "c_0001");
  await expect.poll(() => bookPane(page).evaluate((el) => {
    const blocks = [...el.querySelectorAll<HTMLElement>("[data-l]")];
    const top = el.getBoundingClientRect().top + 16;
    const b = blocks.find((x) => x.getBoundingClientRect().bottom > top)!;
    return Number(b.dataset.l);
  })).toBeLessThanOrEqual(89);
  // clicking a contents entry jumps all panes
  await tocPane(page).locator('[data-tocid="c_0006"]').click();
  await expect(cardsPane(page).locator(".rcard.cur")).toHaveAttribute("data-id", "c_0006");
  await expect(bookPane(page).locator(".inr").first()).toBeInViewport();
});

test("deep link ?line= scrolls there and panes can be turned off (remembered)", async ({ page }) => {
  await open(page, "#/read/s_booka?line=400");
  await readerReady(page, "s_booka");
  await expect(bookPane(page).locator('[data-l="400"], [data-l="399"], [data-l="398"]').first()).toBeInViewport();
  await page.getByRole("checkbox", { name: "Contents" }).uncheck();
  await expect(tocPane(page)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Cards" }).uncheck();
  await expect(cardsPane(page)).toHaveCount(0);
  await page.reload();
  await readerReady(page, "s_booka");
  await expect(tocPane(page)).toHaveCount(0);
  await expect(cardsPane(page)).toHaveCount(0);
  await expect(bookPane(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "Contents" }).check();
  await expect(tocPane(page)).toBeVisible();
});

test("copy for deep dive -> clipboard, Explored, state file changed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "#/read/s_booka?card=c_0004");
  await readerReady(page, "s_booka");
  const card = cardsPane(page).locator('.rcard[data-id="c_0004"]');
  await expect(card.locator("[data-state]")).toHaveText("New");
  await card.getByRole("button", { name: "Copy for deep dive" }).click();
  await expect(page.locator(".toast")).toHaveText(/Copied: prompt \+ card \+ \d+ source/);
  await expect(card.locator("[data-state]")).toHaveText("Explored");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("## Card: Polysemantic neuron");
  expect(clip).toContain("## Sources");
  expect(clip).toMatch(/lines \d+–\d+, p\. \d+/);
  await expectState((s) => !!s.cards.c_0004?.explored?.ts, "c_0004 explored on disk");
});

test("tag, note, known and split are written to disk", async ({ page }) => {
  await open(page, "#/focus?card=c_0003");
  const big = page.locator(".rcard.big");
  await expect(big.locator("h2")).toHaveText("Superposition");
  // Progressive disclosure: click reveal-cue to expand details (tags, notes, actions)
  await page.locator(".reveal-cue").click();
  // my tag from the dropdown
  await big.getByLabel("My tags").first().click();
  await big.getByRole("checkbox", { name: "#important" }).check();
  await expectState((s) => s.cards.c_0003.tags.v.includes("important"), "tag on disk");
  // a new tag
  await big.getByLabel("New tag").fill("Deep dive later");
  await big.getByRole("button", { name: "Add", exact: true }).click();
  await expectState((s) => s.cards.c_0003.tags.v.includes("deep dive later") && !!s.my_tags["deep dive later"], "new tag on disk");
  // note: click, type, Ctrl+Enter
  await page.keyboard.press("Escape");
  await big.getByRole("button", { name: "Add a note" }).click();
  await big.getByLabel("Note").fill("Check the **toy model** paper.");
  await big.getByLabel("Note").press("Control+Enter");
  await expect.poll(() => readDisk("notes/c_0003.md")).toBe("Check the **toy model** paper.\n");
  await expect(big.locator(".notebtn strong")).toHaveText("toy model");
  // split (card has 2 refs)
  await big.getByRole("button", { name: /Mark: these are different ideas/ }).click();
  await expect(big.getByRole("button", { name: /Marked · split on next ingest/ })).toBeVisible();
  await expectState((s) => s.cards.c_0003.split.v === true, "split on disk");
  // known
  await big.getByRole("button", { name: "I know this" }).click();
  await expect(big.locator(".st.known")).toBeVisible();
  await expectState((s) => s.cards.c_0003.known.v === true, "known on disk");
});

test("W11 tag inbox: accept and combine", async ({ page }) => {
  await open(page, "#/inbox");
  const s1 = page.locator('[data-sug="t_0001"]');
  await s1.getByRole("button", { name: "Accept" }).click();
  await expect(s1.locator("[data-decision]")).toHaveText("Accepted");
  // shown as applied at once: the new topic is on its cards
  await expect(s1.locator(".applied").first()).toContainText("Dictionary learning");
  await expectState((s) => s.topic_decisions.t_0001.action === "accept", "accept on disk");

  await page.locator('[data-sug="t_0002"] input[type=checkbox]').check();
  await page.locator('[data-sug="t_0003"] input[type=checkbox]').check();
  await page.getByLabel("Combine into").fill("ML › Interpretability › Features");
  await page.getByRole("button", { name: "Combine" }).click();
  await expect(page.locator('[data-sug="t_0003"] [data-decision]')).toHaveText("Combined into ML › Interpretability › Features");
  await expectState((s) => s.topic_decisions.t_0002.action === "combine" && s.topic_decisions.t_0003.path === "ML/Interpretability/Features", "combine on disk");
  await expect(page.locator(".tabs .badge")).toHaveCount(0); // nothing waiting any more
});

test("W9 focus: arrow keys move, passing a card marks it Viewed", async ({ page }) => {
  await open(page, "#/focus?scope=source:s_bookd");
  const pos = page.getByTestId("focus-pos");
  await expect(pos).toHaveText("1 / 3");
  const first = await page.locator(".rcard.big").getAttribute("data-id");
  await page.keyboard.press("ArrowRight");
  await expect(pos).toHaveText("2 / 3");
  await expectState((s) => !!s.cards[first!]?.viewed, "first card viewed on disk");
  await page.keyboard.press("ArrowLeft");
  await expect(pos).toHaveText("1 / 3");
  await page.getByRole("button", { name: "Previous card" }).click();
  await expect(pos).toHaveText("3 / 3");
  // T opens my tags, N opens the note
  await page.keyboard.press("t");
  await expect(page.locator(".rcard.big .ddpanel")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a card on screen for 2 s becomes Viewed", async ({ page }) => {
  await open(page, "#/read/s_bookd");
  await readerReady(page, "s_bookd");
  const c = cardsPane(page).locator('.rcard[data-id="c_0011"]');
  await expect(c.locator("[data-state]")).toHaveText("New");
  await c.scrollIntoViewIfNeeded();
  await expect(c.locator("[data-state]")).toHaveText("Viewed", { timeout: 5000 });
  await expectState((s) => s.cards.c_0011.viewed.rev >= 1, "viewed on disk");
});

test("Ctrl+K palette finds a card and opens it", async ({ page }) => {
  await open(page, "#/report");
  await page.keyboard.press("Control+k");
  const input = page.getByLabel("Search everything");
  await expect(input).toBeFocused();
  await input.fill("induction");
  await expect(page.locator(".pal .item").first()).toContainText("Induction head");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pal")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/read\/s_\w+\?line=\d+&card=c_\d+/);
  await readerReady(page, "s_booka");
  await expect(cardsPane(page).locator(".rcard.cur h3")).toHaveText("Induction head");
  // topics and my tags are in the palette too
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search everything").fill("import");
  await expect(page.locator(".pal .item").first()).toContainText("#important");
});

test("W6 coverage link into the reader", async ({ page }) => {
  await open(page, "#/coverage");
  await expect(page.getByTestId("coverage-view")).toBeVisible();
  await expect(page.locator('.strip[data-sid="s_booka"] .seg2[data-id="c_0003"]')).toBeVisible();
  await page.locator('.strip[data-sid="s_booka"] .seg2[data-id="c_0003"]').click();
  await expect(page.getByTestId("coverage-detail").locator("h3")).toHaveText("Superposition");
  await expect(page.locator('.strip[data-sid="s_booka"] .gap2.long')).not.toHaveCount(0);
});

test("W7 video timeline link into the reader", async ({ page }) => {
  await open(page, "#/video/s_videoc");
  await expect(page.getByTestId("video-view")).toBeVisible();
  await expect(page.locator('.span[data-id="c_0005"]')).toBeVisible();
  await page.locator('.span[data-id="c_0005"]').click();
  await expect(page.getByTestId("video-detail").locator("h3")).toHaveText("Sparse autoencoder");
  await expect(page.locator(".tr.hl").first()).toBeVisible();
});

test("W12 report link into the reader", async ({ page }) => {
  await open(page, "#/report");
  await expect(page.getByTestId("report-view")).toBeVisible();
  await expect(page.getByRole("link", { name: "L470–508 (39)" })).toBeVisible();
  await page.getByRole("link", { name: "L470–508 (39)" }).click();
  await expect(page).toHaveURL(/#\/read\/s_booka\?line=470/);
  await readerReady(page, "s_booka");
  await expect(bookPane(page).locator('.gapmk[data-gap="470"]')).toBeInViewport();
});

test("reload banner after generation goes up", async ({ page }) => {
  await open(page, "#/read/s_booka", { pollMs: 400 });
  await readerReady(page, "s_booka");
  await expect(page.getByRole("status").filter({ hasText: "New cards arrived" })).toHaveCount(0);
  // backend writes cards.json first, library.json last (contract §2)
  const cards = JSON.parse(await readFile(resolve(LIB, "cards.json"), "utf8"));
  cards.generation = 8;
  cards.cards.find((c: { id: string }) => c.id === "c_0002").title = "Probe accuracy trap (updated)";
  await writeFile(resolve(LIB, "cards.json"), JSON.stringify(cards));
  const lib = JSON.parse(await readFile(resolve(LIB, "library.json"), "utf8"));
  lib.generation = 8;
  await writeFile(resolve(LIB, "library.json"), JSON.stringify(lib));
  const banner = page.locator(".banner");
  await expect(banner).toContainText("New cards arrived", { timeout: 5000 });
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect(banner).toHaveCount(0);
  await expect(cardsPane(page).locator('.rcard[data-id="c_0002"] h3')).toHaveText("Probe accuracy trap (updated)");
});

test("settings: copy prompt and my tags are saved to the state file", async ({ page }) => {
  await open(page, "#/settings");
  await page.getByLabel("Copy prompt").fill("Explain like I am new to this.");
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expectState((s) => s.copy_prompt.v === "Explain like I am new to this.", "prompt on disk");
  await page.locator("section").filter({ hasText: "My tags" }).getByLabel("New tag").fill("exam");
  await page.getByRole("button", { name: "Create tag" }).click();
  await expect(page.locator(".ptag", { hasText: "#exam" })).toBeVisible();
  await page.getByRole("button", { name: "Delete #exam" }).click();
  await expectState((s) => s.my_tags.exam.deleted === true, "tag deleted on disk");
});

test("cards read only a range of content.md in Focus view", async ({ page }) => {
  const requests: { url: string; range: string | null }[] = [];
  page.on("request", (req) => {
    if (req.url().includes("content.md")) {
      requests.push({ url: req.url(), range: req.headers()["range"] ?? null });
    }
  });
  await open(page, "#/focus?card=c_0003");
  // Expand details to trigger SourceLines component
  await page.locator(".reveal-cue").click();
  // Wait for source lines to render (SourceLines component fetches content.md)
  await expect(page.locator(".rcard.big .snip .ln-row").first()).toBeVisible({ timeout: 8000 });
  // Every request to content.md should have a Range header
  const contentRequests = requests.filter((r) => r.url.includes("content.md"));
  expect(contentRequests.length).toBeGreaterThan(0);
  for (const r of contentRequests) {
    expect(r.range).not.toBeNull();
  }
});

test("T2b: notes of merged cards are shown read-only", async ({ page }) => {
  // c_0099 is retired into c_0005 in the fixture; write a note for c_0099
  await writeFile(resolve(LIB, "notes/c_0099.md"), "Old note from merged card\n");
  await open(page, "#/focus?card=c_0005");
  await expect(page.locator(".rcard.big h2")).toHaveText("Sparse autoencoder");
  // Expand details to show notes
  await page.locator(".reveal-cue").click();
  // The merged note should appear
  await expect(page.locator(".merged-note")).toContainText("From merged card c_0099");
  await expect(page.locator(".merged-note")).toContainText("Old note from merged card");
});

test("opens Focus mode by default on root URL", async ({ page }) => {
  await open(page, "");
  // Focus mode should be visible by default
  await expect(page.locator(".focus-bar")).toBeVisible();
  await expect(page.locator(".rcard.big")).toBeVisible();
  await expect(page.getByTestId("focus-pos")).toBeVisible();
});

test("Focus mode search filter filters cards as you type", async ({ page }) => {
  await open(page, "#/focus");
  const pos = page.getByTestId("focus-pos");
  await expect(pos).toHaveText("1 / 13"); // 13 total cards in fixture
  const search = page.getByLabel("Search cards in focus mode");
  await search.fill("superposition");
  await expect(pos).toHaveText("1 / 2"); // c_0003 title + c_0005 why
  await expect(page.locator(".rcard.big h2")).toHaveText("Superposition");
  // Clear search restores total count
  await page.locator(".clear-btn").click();
  await expect(pos).toHaveText("1 / 13");
});

test("Focus mode status, tag, and notes filters", async ({ page }) => {
  await open(page, "#/focus");
  const pos = page.getByTestId("focus-pos");
  await expect(pos).toHaveText("1 / 13");

  // Filter by status: Already read (c_0001, c_0002, c_0005, c_0008, c_0010, c_0013)
  await page.locator("#w9status").selectOption("read");
  await expect(pos).toHaveText("1 / 6");

  // Filter by status: New / Unread (13 - 6 = 7)
  await page.locator("#w9status").selectOption("unread");
  await expect(pos).toHaveText("1 / 7");

  // Filter by Known (c_0001, c_0010 in pixel-8.json)
  await page.locator("#w9status").selectOption("known");
  await expect(pos).toHaveText("1 / 2");
  await expect(page.locator(".rcard.big h2")).toHaveText("Linear probe");

  // Reset filters
  await page.locator("#w9status").selectOption("all");
  await expect(pos).toHaveText("1 / 13");

  // Filter by tags: #important (c_0008, c_0012)
  await page.locator("#w9tag").selectOption("important");
  await expect(pos).toHaveText("1 / 2");

  // Reset via button
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(pos).toHaveText("1 / 13");

  // Filter by notes: With notes
  // Write a note for c_0003
  await writeFile(resolve(LIB, "notes/c_0003.md"), "test note\n");
  // Re-open to pick up note
  await open(page, "#/focus");
  await page.locator("#w9notes").selectOption("with-notes");
  // c_0003 has a note, and c_0005 has retired c_0099 note if present
  const countWithNotes = await pos.innerText();
  expect(countWithNotes).toMatch(/\d+ \/ [1-9]\d*/);
});

test("progressive scroll reveal: topic and main text first, details on scroll or cue click", async ({ page }) => {
  await open(page, "#/focus?card=c_0003");
  const big = page.locator(".rcard.big");

  // Topic and main text (what) are visible immediately
  await expect(big.locator(".path")).toHaveText("Interpretability › Features");
  await expect(big.locator("h2")).toHaveText("Superposition");
  await expect(big.locator(".what")).toBeVisible();

  // Reveal cue is visible, details are hidden initially
  const cue = page.locator(".reveal-cue");
  await expect(cue).toBeVisible();
  await expect(big.locator(".card-details")).toHaveCount(0);

  // Scroll down to reveal details
  await big.hover();
  await page.mouse.wheel(0, 150);
  await expect(cue).toHaveCount(0);
  await expect(big.locator(".card-details")).toBeVisible();
  await expect(big.getByText("Why", { exact: true })).toBeVisible();
  await expect(big.getByText("Sources", { exact: true })).toBeVisible();

  // Moving to next card resets reveal state
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".reveal-cue")).toBeVisible();
  await expect(page.locator(".rcard.big .card-details")).toHaveCount(0);

  // Clicking the cue reveals details
  await page.locator(".reveal-cue").click();
  await expect(page.locator(".rcard.big .card-details")).toBeVisible();
});

test("dropdowns are filterable by typing text in filter input", async ({ page }) => {
  await open(page, "#/focus");
  const pos = page.getByTestId("focus-pos");
  await expect(pos).toHaveText("1 / 13");

  // 1. Focus Status filter dropdown text box
  const statusInput = page.locator('input.fsel-input[aria-label="Status"]');
  await statusInput.click();
  const dropdown = page.locator(".fsel-dropdown");
  await expect(dropdown).toBeVisible();

  // Type "read" to filter options
  await statusInput.fill("read");

  // Filtered options: only "Already read" and "New / Unread"
  const opts = dropdown.locator(".fsel-opt");
  await expect(opts).toHaveCount(2);
  await expect(opts.first()).toContainText("Already read");

  // Select "Already read"
  await opts.first().click();
  await expect(dropdown).toHaveCount(0);
  await expect(statusInput).toHaveValue("Already read");
  await expect(pos).toHaveText("1 / 6");

  // 2. Focus Scope filter dropdown with optgroups
  const scopeInput = page.locator('input.fsel-input[aria-label="Scope"]');
  await scopeInput.click();
  await expect(dropdown).toBeVisible();
  await scopeInput.fill("circ");

  // Matches "One topic" group and "ML › Interpretability › Circuits"
  await expect(dropdown.locator(".fsel-opt")).toHaveCount(1);
  await expect(dropdown.locator(".fsel-opt")).toContainText("ML › Interpretability › Circuits");
  await page.keyboard.press("Enter");
  await expect(dropdown).toHaveCount(0);
  await expect(scopeInput).toHaveValue("ML › Interpretability › Circuits");

  // 3. Reader Source filter dropdown: type to filter a lot of books/sources out
  await open(page, "#/read/s_booka");
  await readerReady(page, "s_booka");
  const srcInput = page.locator('input.fsel-input[aria-label="Source"]');
  await srcInput.click();
  await expect(dropdown).toBeVisible();
  await srcInput.fill("video");
  await expect(dropdown.locator(".fsel-opt")).toHaveCount(1);
  await expect(dropdown.locator(".fsel-opt")).toContainText("Talk: looking inside LLMs video");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/read\/s_videoc/);
});

test("Focus to Reader shortcut (R) and Reader to Focus shortcut (F)", async ({ page }) => {
  await open(page, "#/focus?card=c_0003");
  await expect(page.locator(".focus-bar")).toBeVisible();

  // Press R in Focus mode -> navigates to Reader view at card anchor
  await page.keyboard.press("r");
  await expect(page).toHaveURL(/#\/read\/s_booka\?.*card=c_0003/);
  await readerReady(page, "s_booka");
  await expect(cardsPane(page).locator(".rcard.cur")).toHaveAttribute("data-id", "c_0003");

  // Press F in Reader mode -> navigates back to Focus mode on current card
  await page.keyboard.press("f");
  await expect(page).toHaveURL(/#\/focus\?card=c_0003/);
  await expect(page.locator(".focus-bar")).toBeVisible();
  await expect(page.locator(".rcard.big h2")).toHaveText("Superposition");
});

