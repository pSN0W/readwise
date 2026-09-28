import { expect, test } from "@playwright/test";
import { currentCardId, ownState, resetLibrary, swipeCard, touchScroll } from "./helpers.ts";

test.beforeEach(() => resetLibrary());

test("search → P8 outline; card result → P1", async ({ page }) => {
  await page.goto("/#/feed");
  await page.getByTestId("search-btn").click();
  const input = page.getByTestId("search-input");
  await expect(input).toBeFocused();
  // empty query lists every source
  await expect(page.locator("[data-result-source]")).toHaveCount(4);
  await input.pressSequentially("focus-and");
  await expect(page.locator("[data-result-source]")).toHaveCount(1); // file name match
  await input.fill("youtube");
  await expect(page.locator("[data-result-source]")).toHaveText([/Talk: looking inside LLMs/]); // URL match
  await input.fill("B. Blogger");
  await expect(page.locator("[data-result-source]")).toHaveText([/A post about probes/]); // author match
  await input.fill("habits");
  const row = page.locator('[data-result-source="s_bookd"]');
  await expect(row).toContainText("book · D. Writer · 3 cards");
  await row.click();
  await expect(page).toHaveURL(/#\/outline\/s_bookd/);
  const list = page.getByTestId("outline-list");
  await expect(list).toContainText("Part 1 · Habits");
  await expect(list.locator("[data-open]")).toHaveText([/Habit loop/, /Deep focus blocks/, /Attention residue/]);
  // gaps: 46 lines before the first card (over the limit of 20 → red), 2 at the end
  await expect(page.getByTestId("gap").first()).toHaveText("⚠ 46 lines with no card (L1–46)");
  await expect(page.getByTestId("gap").first()).toHaveClass(/bad/);
  await expect(page.getByTestId("gap").last()).not.toHaveClass(/bad/);
  // tap a concept → P1 at that card, scoped to the source
  await list.locator('[data-open="c_0012"]').click();
  await expect(page.getByTestId("card")).toHaveAttribute("data-card-id", "c_0012");
  await expect(page.getByTestId("pos")).toHaveText("2 / 3");

  await page.getByTestId("search-btn").click();
  await page.getByTestId("search-input").fill("induction");
  await page.locator('[data-result-card="c_0008"]').click();
  await expect(page.getByTestId("card")).toHaveAttribute("data-card-id", "c_0008");
});

test("P8 source picker and cards list", async ({ page }) => {
  await page.goto("/#/outline/s_booka");
  await expect(page.getByTestId("outline-list")).toContainText("3 · Probing");
  await expect(page.locator('[data-open="c_0001"]')).toBeVisible();
  await page.getByTestId("outline-src").selectOption("s_videoc");
  await expect(page).toHaveURL(/#\/outline\/s_videoc/);
  await expect(page.getByTestId("outline-list")).toContainText("Attention");
});

test("P2 Books: list, Book ↔ Cards, ● marker jumps to the card", async ({ page }) => {
  await page.goto("/#/books");
  const row = page.locator('[data-source="s_booka"]');
  await expect(row).toContainText("9 cards");
  await expect(row).toContainText("% read");
  await row.click();
  const book = page.getByTestId("book");
  await expect(book).toContainText("A probe is a small linear classifier trained on activations.");
  await expect(book.locator("h2.bh", { hasText: "3 · Probing" })).toHaveCount(1);
  // the image sits at its line
  await expect(book.locator('img[src*="fig-003.svg"]')).toHaveCount(1);
  // scroll the book with touch, then tap the ● of "Circuit"
  await touchScroll(page, "book", 400);
  await expect.poll(() => book.evaluate((e) => e.scrollTop)).toBeGreaterThan(50);
  await book.locator('[data-mk="c_0007"]').click();
  await expect(page.getByTestId("mode-cards")).toHaveAttribute("aria-pressed", "true");
  const hl = page.locator('[data-open="c_0007"]');
  await expect(hl).toHaveClass(/hl/);
  await expect(hl).toBeInViewport();
  // Cards in book view; merged cards say "also in"
  await expect(page.locator('[data-open="c_0001"]')).toContainText("Linear probe");
  await expect(page.locator('[data-open="c_0005"]')).toContainText("also in A post about probes, Talk: looking inside LLMs");
  // back to Book
  await page.getByTestId("mode-book").click();
  await expect(page.getByTestId("book")).toBeVisible();
  // Cards → tap opens P1 scoped to this source
  await page.getByTestId("mode-cards").click();
  await page.locator('[data-open="c_0009"]').click();
  await expect(page.getByTestId("card")).toHaveAttribute("data-card-id", "c_0009");
  await expect(page.getByTestId("scope")).toHaveValue("src:s_booka");
});

test("P2 Book for a video: transcript cues and slide images", async ({ page }) => {
  await page.goto("/#/books/s_videoc?mode=book");
  const book = page.getByTestId("book");
  await expect(book.locator(".ts").first()).toHaveText("0:00");
  await expect(book.locator('img[src*="slide-000130.svg"]')).toHaveCount(1);
});

test("P3 Tree: Topics and Books", async ({ page }) => {
  await page.goto("/#/tree");
  const list = page.getByTestId("tree-list");
  await expect(list.locator("[data-node]")).toHaveText([/Mind ›/, /ML ›/]);
  await list.locator('[data-node="ML"]').click();
  await list.locator('[data-node="Interpretability"]').click();
  await expect(page.getByTestId("crumbs")).toHaveText(/All\s*›\s*ML\s*›\s*Interpretability/);
  const features = list.locator('[data-node="Features"]');
  await expect(features).toContainText("4 cards");
  await features.click();
  await expect(list.locator("[data-open]")).toHaveCount(4);
  await page.getByTestId("crumbs").getByRole("button", { name: "ML" }).click();
  await expect(list.locator("[data-node]")).toHaveText([/Interpretability ›/, /Transformers ›/]);
  // leaf row opens P1
  await list.locator('[data-node="Transformers"]').click();
  await list.locator('[data-node="Attention"]').click();
  await list.locator('[data-open="c_0010"]').click();
  await expect(page.getByTestId("card")).toHaveAttribute("data-card-id", "c_0010");
  await expect(page.getByTestId("scope")).toHaveValue("topic:ML/Transformers/Attention");

  await page.goto("/#/tree");
  await page.getByTestId("kind-books").click();
  await list.locator('[data-node="s_booka"]').click();
  await expect(list.locator("[data-node]")).toHaveText([/3 · Probing/, /4 · Features/, /5 · Circuits/]);
  await list.locator('[data-node="5 · Circuits"]').click();
  await expect(list.locator("[data-open]")).toHaveText([/Circuit/, /Induction head/, /Activation patching/]);
  await list.locator('[data-open="c_0008"]').click();
  expect(await currentCardId(page)).toBe("c_0008");
});

test("P3 Tree shows accepted topic suggestions at once", async ({ page }) => {
  await page.goto("/#/tree");
  const list = page.getByTestId("tree-list");
  await list.locator('[data-node="ML"]').click();
  await list.locator('[data-node="Interpretability"]').click();
  await expect(list.locator('[data-node="Dictionary learning"]')).toHaveCount(0);
  await page.evaluate(async (mod) => {
    const { app } = await import(/* @vite-ignore */ mod);
    app.st.decideTopic("t_0001", "accept");
  }, "/src/lib/app.svelte.ts");
  await expect(list.locator('[data-node="Dictionary learning"]')).toContainText("2 cards");
});

test("P7 Shelf: tags, notes, copy prompt, settings", async ({ page }) => {
  await page.goto("/#/shelf");
  // fixture: c_0005 has #revisit (pixel-8 + laptop), c_0012 #important
  await expect(page.locator('[data-shelf="revisit"]')).toContainText("card");
  await page.getByLabel("New tag").fill("exam");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator('[data-shelf="exam"]')).toContainText("0 cards");
  await expect.poll(() => ownState()?.my_tags?.exam).toBeTruthy();
  await page.locator('[data-shelf="important"]').click();
  await expect(page.locator('[data-open="c_0012"]')).toBeVisible();
  await page.goBack();
  await page.getByTestId("my-notes").click();
  await expect(page.locator('[data-open="c_0001"]')).toContainText("✎");
  await page.goBack();
  await page.getByTestId("prompt").fill("Explain like I am new. Short.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => ownState()?.copy_prompt?.v, { timeout: 5000 }).toBe("Explain like I am new. Short.");
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete #exam" }).click();
  await expect(page.locator('[data-shelf="exam"]')).toHaveCount(0);
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByLabel("Device id")).toHaveValue("android-phone");
});

test("changing the device id writes a new state file", async ({ page }) => {
  await page.goto("/#/shelf/settings");
  await page.getByLabel("Device id").fill("my-pixel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("toast")).toContainText("Device id: my-pixel");
  await page.goto("/#/feed");
  await swipeCard(page, -180);
  const { readLib } = await import("./helpers.ts");
  await expect.poll(() => readLib("state/my-pixel.json"), { timeout: 5000 }).toContain('"explored"');
});
