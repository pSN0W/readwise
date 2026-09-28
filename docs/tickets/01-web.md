# Ticket 01 · Web app (laptop) — detailed version (27 Sep)

**Read these first, in this order (30 min):**
1. [Ticket rules](README.md) — what you may and may not touch.
2. [Input guide](INPUT_GUIDE.md) — what the files look like, with real values.
3. [Prototype guide](PROTOTYPE_GUIDE.md) — how to open the approved UI and where each view is.
4. `packages/core/README.md` — the functions you must use (do not re-write them).
5. `apps/web/WORKLOG.md` — what the previous agent did.

**You own:** `apps/web/` only. **Read-only for you:** `docs/`, `packages/core/`, `fixtures/`, `.lavish/`. If you need one of those changed, append an entry to `docs/contract/CHANGE_REQUESTS.md` and use a workaround inside `apps/web/`.

---

## 0. The short version

Most of the app **already exists and works**. You have **8 tasks** (section 3: T1, T2, T2b, T3–T7). The two important ones are:
- **T1** — the server must answer `Range` requests, and `HttpFS` must get a `readRange` method.
- **T2** — delete the app's own `meta.json` cache and use `lib.meta()` from core.

**T2b** shows old notes of cards merged into this one (`readNotes` from core). The others are cleanup and proof: fix one flaky test, update the synthetic generator, measure performance, write a README, update the worklog.

Do **not** redesign views. Do **not** rename files or change routes that tests use.

---

## 1. What already exists (checked on 27 Sep, 23:23)

### 1.1 Test status

| Command (run in `apps/web/`) | Result |
|---|---|
| `npm test` (Vitest) | **34 / 34 pass** |
| `npm run check` (svelte-check) | 0 errors |
| `npm run e2e` (Playwright) | **11 / 12** in a full run. The test *"W6 coverage, W7 video timeline and W12 report link into the reader"* failed once and passed when run alone → flaky (task T3). |
| `npm run perf` | exists, but numbers were never reported (task T5) |

### 1.2 Files and what they do

| Path (under `apps/web/`) | What it does | Status |
|---|---|---|
| `package.json` | scripts: `predev`, `dev` (port 5173), `build`, `start`, `check`, `test`, `e2e` (port 8788), `synth`, `perf` | done |
| `vite.config.ts` | Svelte plugin, `@rh/core` alias, dev plugin that mounts the server handler | done |
| `server/handler.ts` (242 lines) | all `/library/*` routes: path guard `safeLibraryPath`, `writeKind`, ETag + 304, atomic write, inbox upload (multipart) and links | **needs Range (T1)** |
| `server/index.ts` | production server, `127.0.0.1:8787`, `LIBRARY_DIR` env | done |
| `src/lib/http-fs.ts` (52 lines) | `HttpFS implements LibraryFS`: `readText`, `writeText`, `list`, `url`, `upload`, `addLinks` | **needs `readRange` (T1)** |
| `src/lib/app.svelte.ts` (260 lines) | the app store: opens `Library` + `StateStore`, polling, caches, `metaOf`, `refLabel`, `videoUrlAt` | **remove `metaOf` workaround (T2)** |
| `src/lib/md.ts` | `marked` + KaTeX + DOMPurify | done |
| `src/lib/scroll-sync.ts` | maps top visible block → card → other panes | done |
| `src/lib/viewed.ts` | IntersectionObserver timer (≥ 60 % visible for ≥ 2 s → `markViewed`) | done |
| `src/lib/prefs.ts` | `localStorage` prefs (wrapped in try/catch) | done |
| `src/lib/router.svelte.ts` | hash router | done |
| `src/lib/book.ts` | groups `toBlocks` output into chunks for `content-visibility` | done |
| `src/components/Card.svelte` | the card everywhere (fields, images, sources, chips, actions) | done |
| `src/components/{LazyCard, Note, Palette, SourceLines, TagDropdown}.svelte` | as named | done |
| `src/views/Reader.svelte` (408 lines) | W2 three panes + scroll sync | done |
| `src/views/{Search, Coverage, Video, Focus, Board, Inbox, Report, Settings}.svelte` | Search, W6, W7, W9, W10, W11, W12, Settings | done |
| `src/App.svelte` | top bar, tabs, Ctrl+K, reload banner | done |
| `scripts/scratch.ts` | copies the fixture to `.scratch/<name>`; `--fresh` deletes first | done |
| `scripts/gen-synthetic.ts` | big synthetic library | **needs anchors (T4)** |
| `scripts/perf.ts` | measures targets | done, not reported (T5) |
| `test/{http-fs, scroll-sync, server, viewed}.test.ts` | unit tests | add Range tests (T1) |
| `e2e/app.spec.ts` (12 tests) + `e2e/helpers.ts` | end-to-end | fix flaky one (T3), add one (T1) |
| `README.md` | — | **missing (T6)** |

### 1.3 Things the previous agent learned (keep them)

- Blocks inside a `content-visibility` chunk have the chunk as `offsetParent`. Use the summed `offsetTop` helper `topIn`, not `el.offsetTop`.
- `content-visibility` items in a flex column shrink to 0 px. They need `flex: none`.
- Scroll sync: ignore only the scroll events that land where the app itself scrolled. A time-based lock drops real user scrolls.
- W2 video: the time stamp of a cue is a link that opens the video at that second (new tab). Clicking the cue *text* syncs the panes. Keep both.

---

## 2. Setup

```bash
cd apps/web
npm install                       # node_modules is local to apps/web
rm -rf .scratch                   # IMPORTANT: the fixture changed on 27 Sep (anchors); copy it again
npm run dev                       # http://127.0.0.1:5173, library = .scratch/dev
npm test && npm run check && npm run e2e
```

Node is v26. It runs `.ts` files directly (type stripping). So `node server/index.ts` works with no build step. Use only syntax that can be erased (no `enum`, no parameter properties).

Production run on any folder:
```bash
npm run build && LIBRARY_DIR=/path/to/library npm start     # http://127.0.0.1:8787
```

---

## 3. Tasks

Do them in order. After each task: run `npm test && npm run check`, then add one line to `apps/web/WORKLOG.md` under "Done".

### T1 · Range reads (server + HttpFS)

**Why.** A card points at e.g. lines 168–181 of a 15,000-line book. Core can read only the bytes between two anchors (about 3–7 KB) instead of the whole file (maybe 1 MB). It does this only if the `LibraryFS` has `readRange`. See [Input guide §4](INPUT_GUIDE.md#4-the-text-contentmd--metajson).

**The interface you implement** (from `packages/core/src/fs.ts`, line 18):
```ts
readRange?(path: string, start: number, end: number): Promise<string | null>;
// start = first byte (inclusive), end = byte after the last one (exclusive). Same as Array.slice.
// Return the bytes decoded as UTF-8 text. Return null if the file does not exist.
```
Core only calls it with anchor byte offsets. Anchors are always at line starts, so the range never cuts a UTF-8 character in half.

**Step 1 — server (`server/handler.ts`, inside `handle()`, the `GET/HEAD` branch, around line 175–190).**

Now (before):
```
stat → ETag → if-none-match → 304 | 200 + whole file
```
Change to:
```
stat → ETag → if-none-match → 304
     → if a Range header is present and valid → 206 + only those bytes
     → else 200 + whole file (as now)
```
Add a small exported pure function so it can be unit-tested:
```ts
/** "bytes=3252-6656" → {start: 3252, end: 6657} (end exclusive). null = no/invalid range → send whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;       // "bytes=-" or multi-range "a-b,c-d" → ignore, send 200
  let start: number, last: number;
  if (m[1] === "") { const n = Number(m[2]); start = Math.max(0, size - n); last = size - 1; }   // "bytes=-500" = last 500
  else { start = Number(m[1]); last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > last) return "unsatisfiable";
  return { start, end: last + 1 };
}
```
In `handle()`:
```ts
headers["Accept-Ranges"] = "bytes";
const range = parseRange(req.headers.range, st.size);
if (range === "unsatisfiable") {
  res.writeHead(416, { ...headers, "Content-Range": `bytes */${st.size}` }); res.end(); return;
}
if (range) {
  headers["Content-Range"] = `bytes ${range.start}-${range.end - 1}/${st.size}`;
  headers["Content-Length"] = String(range.end - range.start);
  res.writeHead(206, headers);
  if (method === "HEAD") { res.end(); return; }
  // createReadStream's `end` is INCLUSIVE
  await new Promise<void>((ok, fail) =>
    createReadStream(full, { start: range.start, end: range.end - 1 }).on("error", fail).on("end", ok).pipe(res));
  return;
}
// ...existing 200 path unchanged...
```
Rules:
- The 304 check stays first. (The client sends `cache: "no-store"` for ranges, so it will not send `If-None-Match` anyway.)
- Only `GET` and `HEAD` look at `Range`.
- The path guard runs before all of this (it already does).

**Step 2 — client (`src/lib/http-fs.ts`).** Add:
```ts
/** Bytes [start, end) of a file as UTF-8 text, via an HTTP Range request. null if the file is missing. */
async readRange(path: string, start: number, end: number): Promise<string | null> {
  if (end <= start) return "";
  const r = await this.f(this.base + enc(path), {
    headers: { Range: `bytes=${start}-${end - 1}` },
    cache: "no-store",                     // never mix a cached 200 body with a range
  });
  if (r.status === 404) return null;
  if (r.status === 206) return new TextDecoder().decode(await r.arrayBuffer());
  if (r.status === 200) {                  // server ignored the range: cut it ourselves
    const all = new Uint8Array(await r.arrayBuffer());
    return new TextDecoder().decode(all.subarray(start, end));
  }
  throw new Error(`Range read failed (${r.status}): ${path}`);
}
```
Decode with `TextDecoder` on the bytes. **Do not** use `r.text()` then `slice` — that counts characters, not bytes, and breaks on `·`, `—` and math symbols.

**Step 3 — Vite dev server.** `vite.config.ts` mounts the same handler, so dev gets Range for free. Check it: `curl -s -H 'Range: bytes=3252-6656' -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:5173/library/sources/s_booka/content.md` → `206 3405`.

**Step 4 — tests.**

In `test/server.test.ts` add:

| Test | Input | Expect |
|---|---|---|
| parseRange basic | `"bytes=3252-6656"`, size 18643 | `{start: 3252, end: 6657}` |
| parseRange open end | `"bytes=16617-"`, 18643 | `{start: 16617, end: 18643}` |
| parseRange suffix | `"bytes=-100"`, 18643 | `{start: 18543, end: 18643}` |
| parseRange past end | `"bytes=20000-20010"`, 18643 | `"unsatisfiable"` |
| parseRange junk | `"items=1-2"`, `"bytes=1-2,5-6"`, `undefined` | `null` |
| GET with Range | real handler on a scratch copy, `sources/s_booka/content.md`, `bytes=3252-6656` | status 206, `Content-Range: bytes 3252-6656/18643`, body length 3405 bytes, body starts with the text of line 101 |
| GET 416 | `bytes=99999-` | 416 |
| Range + path guard | `/library/../package.json` with Range | 403 (guard first) |

In `test/http-fs.test.ts` add:
- `readRange` against the real server equals `readText(...)` bytes `[start, end)` for **every** anchor pair of `s_booka`.
- **The core check:** open `Library` over `HttpFS` on the scratch copy. Call `lib.lines("s_booka", 168, 181)`. Expect the same 14 lines as `lib.allLines("s_booka")` gives for 168–181 (compare with a second `Library` instance, so caches do not mix). Wrap `fetch` to count requests: expect **one** request with a `Range` header and **zero** plain GETs for `content.md`.
- A fake fetch returning 200 (server without Range) → still the right text.
- A line with multi-byte characters: build a small text with `·` and `α` in a `MemoryFS`-like fake server, read a range, compare.

In `e2e/app.spec.ts` add one test *"cards read only a range of content.md"*: record `page.on("request")`. Open `#/focus`. Wait for the source lines of the first card. Expect every request to `sources/*/content.md` to have a `range` header. (The Focus view shows source lines but not the whole book. W2 loads the whole book on purpose, so do not test W2 here.)

**Done when:** all of the above pass, and in the browser dev tools (Network tab) the Focus view shows `206` responses for `content.md`.

### T2 · Remove the meta.json workaround

**Why.** Before 27 Sep, `lib.meta()` also loaded the whole `content.md`, so the previous agent wrote its own `meta.json` cache. Core is fixed now: `lib.meta()` loads only `meta.json` (cache of 256). Two caches = double memory and a chance to show different data.

**Where.** `src/lib/app.svelte.ts` around line 142–165: `metaOf()`, the fields `metas`, `metaLoading`, `metaTick`, and the import of `readJSON` if nothing else uses it.

**Keep the same public API**, so components do not change: `app.refLabel(r: CardRef): string` is used in `Card.svelte` (lines 61, 66) and `SourceLines.svelte` (line 28). It must stay **synchronous**, because Svelte templates call it.

Before → now:
```ts
// before: own cache
metaOf(id) { … readJSON(fs, `sources/${id}/meta.json`) … }

// now: core's cache, plus a reactive tick so the label updates when meta arrives
private metaReady = new Map<string, SourceMeta>();   // only a "has loaded" map; the data lives in core
metaTick = $state(0);
metaOf(sourceId: string): SourceMeta | null {
  void this.metaTick;
  const m = this.metaReady.get(sourceId);
  if (m) return m;
  const lib = this.lib;
  if (lib && !this.metaLoading.has(sourceId)) {
    this.metaLoading.add(sourceId);
    lib.meta(sourceId)
      .then((meta) => { this.metaReady.set(sourceId, meta); this.metaTick++; })
      .catch(() => {})                                // missing meta → label stays "lines a–b"
      .finally(() => this.metaLoading.delete(sourceId));
  }
  return null;
}
```
(Holding the same object that core returns is fine; it is one object, not a copy.) Clear `metaReady` when the library reloads (where the store already resets its other caches after `hasUpdate()`).

Also delete the "Open questions" line about this in `WORKLOG.md` and say it is resolved.

**Test.** Add to `test/http-fs.test.ts` (or a new `test/app-meta.test.ts` if the store is hard to import): count fetches while showing labels for all 13 cards → zero requests for `content.md`, one per `meta.json`.

**Done when:** `grep -n "readJSON.*meta.json" src` finds nothing, labels still show "lines 168–181, p. 5", and all tests pass.

### T2b · Show notes of merged cards

**Why.** When the backend merges card b into card a, it does **not** move `notes/c_b.md` (the backend never writes `notes/`). `cards.json → retired` says `b → [a]`. The app must show b's old note under a's note.

**Core has it (added 27 Sep):** `readNotes(lib, fs, cardId)` → `[{id, text, own}]`. The first item is the card's own note (editable). The others are old notes (`own: false`), only those with text.

**Where:** `src/components/Note.svelte`. Today it calls `readNote(fs, id)`. Change it to `readNotes(app.lib, fs, id)`. Show each `own: false` note below the editor, read-only, with a small label "From merged card c_0099". Editing still writes only the own note (`writeNote`).

**Test:** in the scratch library write `notes/c_0099.md` = "Old note". Open card c_0005 (c_0099 is retired into it in the fixture). Expect the label and the text. Add this to an e2e test.

### T3 · Fix the flaky end-to-end test

**The test.** `e2e/app.spec.ts` line 185, *"W6 coverage, W7 video timeline and W12 report link into the reader"*. It has 3 parts (W6 click, W7 click, W12 link). It failed once in a full run and passed alone.

**How to find the cause (do these, write what you find in the worklog):**
1. Run it 20 times in a full run: `npx playwright test --repeat-each=5`. Then alone: `npx playwright test -g "W6 coverage" --repeat-each=20`.
2. When it fails, open the trace: `npx playwright show-trace test-results/<folder>/trace.zip`. Note which of the 3 parts failed.
3. Likely causes, in order:
   - **Clicking before the view is ready.** `page.goto("/#/video/s_videoc")` after a hash page only changes the hash. The old view may still be on screen. Fix: after each `goto`, wait for a view-specific ready marker (for example `await expect(page.getByTestId("video-view")).toBeVisible()` — add `data-testid` to the view root if missing), then for the element.
   - **Meta arriving late.** Spans in W7 need `lib.meta("s_videoc")` (times). If the click lands during a re-render, it hits an old node. Fix: `await expect(page.locator('.span[data-id="c_0005"]')).toBeVisible()` before `.click()`, and make the view render spans only after meta is loaded.
   - **Scroll into view in W2.** `toBeInViewport()` on `.gapmk[data-gap="470"]` can run before the reader's jump finishes. Use `readerReady()` (already there) and then `await expect(...).toBeInViewport({ timeout: 5000 })`.
4. **Split the test into 3 tests** (W6, W7, W12). A failure then names the view.

**Not allowed:** `waitForTimeout`, `retries` in the config, or deleting checks.

**Done when:** `npx playwright test --repeat-each=5` passes 5 × 13+ tests with 0 failures.

### T4 · Synthetic library with anchors

**Why.** `scripts/gen-synthetic.ts` writes `meta.json` without `content_bytes`, `anchor_step` and `anchors`. Then core cannot read ranges and falls back to whole files, so the perf test measures the old way.

**Change.** Where the generator writes each source's `content.md` and `meta.json`:
```ts
const ANCHOR_STEP = 100;
const enc = new TextEncoder();
let byte = 0; const anchors: [number, number][] = [];
lines.forEach((line, i) => {
  const lineNo = i + 1;
  if ((lineNo - 1) % ANCHOR_STEP === 0) anchors.push([lineNo, byte]);
  byte += enc.encode(line).length + 1;         // +1 for "\n"
});
const text = lines.join("\n") + "\n";           // the file MUST end with "\n" so content_bytes === byte
meta.content_bytes = enc.encode(text).length;   // must equal `byte`
meta.anchor_step = ANCHOR_STEP;
meta.anchors = anchors;
```
Check against the rule the Python fixture uses (`fixtures/make_fixture.py`, search `ANCHOR_STEP`): the anchor for line L is the byte offset where line L starts, and there is one every 100 lines starting at line 1. If `content.md` does not end with `\n` in the generator today, make it end with one.

**Test.** Add a unit test: generate a tiny library (2 sources) into a temp folder, then for every anchor `[L, b]` check that reading the file bytes from `b` gives exactly line L. Also validate one generated `meta.json` against `docs/contract/schemas/meta.schema.json` if a JSON-schema validator is already a dev dependency; otherwise check the three fields exist and are numbers.

### T5 · Measure and report performance

Run `npm run synth && npm run perf`. Write the results to `apps/web/perf-results/perf.json` and a table in the README:

| Target | Limit | Measured |
|---|---|---|
| first screen after server start | < 1 s | |
| W2 opens the 15,000-line source | < 500 ms | |
| W2 scroll | 60 fps (frame time p95 < 17 ms) | |
| search per keystroke | < 50 ms | |
| **new:** Focus view, bytes of `content.md` fetched for the first 10 cards | < 100 KB | |

If a number misses its limit, say so in the README and the worklog. Do not change the limit.

### T6 · README.md

Write `apps/web/README.md` (one page). Sections: what it is; commands (the table in §2); how to point it at a real library (`LIBRARY_DIR`); server routes (copy the table in §5.1); where each view lives (the table in §1.2, short); perf table (T5); known limits.

### T7 · Worklog and final report

Update `apps/web/WORKLOG.md`: move items to "Done", list decisions made alone, list open questions. Final message to the main session: what changed, test counts, perf table, anything not done.

---

## 4. Optional (only if T1–T7 are done; ask first in the worklog "Open questions")

- **Add source from the web app.** The server already has `POST /library/inbox/` (upload) and `POST /library/inbox/links`, and `HttpFS.upload()` / `addLinks()` exist, but there is **no screen** for them. A small "＋ Add" button in the top bar that opens a dialog: drop files (PDF, HTML, MD), or paste URLs (one per line). Show "Saved to inbox. The GPU machine picks it up on its next run." This is not in the approved prototype, so it is optional.

---

## 5. Reference: the full behaviour (already built — use to check, not to rebuild)

### 5.1 Server routes (`server/handler.ts`)

| Route | Does | Status codes |
|---|---|---|
| `GET /` and assets | the built app (`dist/`) | 200 |
| `GET /library/<path>` | a file from `LIBRARY_DIR`; `ETag` + `If-None-Match` → 304; **`Range` → 206 (T1)** | 200, 206, 304, 403, 404, 416 |
| `GET /library/<dir>/?list` | JSON array of file names; hides `*.tmp` and `.syncthing.*` | 200 |
| `PUT /library/state/<device_id>.json` | atomic write; body must be JSON with `device_id` equal to the file name | 204, 400, 403 |
| `PUT /library/notes/<card_id>.md` | atomic write | 204, 403 |
| `POST /library/inbox/` | multipart upload into `inbox/` (unique names) | 200 `{saved: [...]}` |
| `POST /library/inbox/links` | append http(s) URLs to `inbox/links.txt` | 200 `{added: n}` |
| anything else that writes | refused | 403 |
| path with `..`, `\`, NUL, absolute | refused | 403 |

Binds to `127.0.0.1` only.

### 5.2 Views

| View | Route | File | Prototype | Must do |
|---|---|---|---|---|
| Search | `#/search` | `views/Search.svelte` | (none; like W14 list) | results as you type (`searchSources`); match title, author, URL, file name, keywords; row = title, kind icon, author, origin, cards, % read; Enter / click → W2; empty query = all sources, newest first |
| W2 Reader | `#/read/<id>?line=N&card=c_x` | `views/Reader.svelte` | `wReader` main:258 | Contents (toc + card titles) · Book (`toBlocks`: heading, para, math, code, image at its line, video cue with time + slide) · Cards (source order). Panes scroll together. Each pane on/off (remembered per source kind). Source switcher. `?line=` scrolls there. Video: cue time = link to YouTube at that second |
| W6 Coverage | `#/coverage` | `views/Coverage.svelte` | `wCoverage` extra:2 | strip per source; cards coloured by state; gaps hatched; gaps > limit red; click → card detail |
| W7 Video | `#/video/<id>` | `views/Video.svelte` | `wVideo` extra:22 | slides on a time axis; cards as spans (`timeOf`); transcript; click span → highlight lines + card |
| W9 Focus | `#/focus` | `views/Focus.svelte` | `wFocus` main:303 | one big card, scope select, ← → buttons and keys, `C` copy, `T` tags, `N` note; → marks viewed |
| W10 Board | `#/board` | `views/Board.svelte` | `wBoard` extra:34 | columns = my tags + "no tag"; drag changes first tag; create tag |
| W11 Inbox | `#/inbox` | `views/Inbox.svelte` | `wInbox` extra:49 | `openSuggestions`; Accept / Rename / Reject; tick several → Combine; `st.decideTopic` |
| W12 Report | `#/report` | `views/Report.svelte` | `wHealth` extra:63 | table of 4 checks per source; gap links → W2 at that line |
| W14 Palette | Ctrl+K | `components/Palette.svelte` | `wPalette` main:324 | `searchAll`; arrows + Enter |
| Settings | `#/settings` | `views/Settings.svelte` | `buildShelf` main:197 (prompt part) | copy prompt, device id, my tags, theme |

Global: poll `lib.hasUpdate()` every 10 s → banner "New cards arrived · Reload" (keeps scroll position).

### 5.3 Card behaviour (every place a card appears)

| Thing | Rule | Core call |
|---|---|---|
| Fields | title, bold What, then Why / How / When / Additional info, only those present | `cardFields(card)` |
| Chip | New / Viewed / Explored | `st.view(card).status` |
| Known | collapse to title + bold line | `st.setKnown(card, v)`, `view.known` |
| Updated | small tag when the card changed since you viewed it | `view.updated` |
| Viewed | ≥ 60 % visible for ≥ 2 s | `st.markViewed(card)` |
| Copy for deep dive | prompt + card + all source lines → clipboard → Explored → toast "Copied: prompt + card + N sources". Clipboard refused → dialog with the text | `buildDeepDivePrompt(lib, card, st.copyPrompt())`, `st.markExplored(card)` |
| My tags | dropdown, checkboxes + create; personal, never sent anywhere | `st.toggleTag`, `st.createTag` |
| Note | click to edit Markdown; Ctrl+Enter or blur saves; show Syncthing conflict copies | `writeNote`, `readNote`, `listNotes` |
| Wrong merge | only when ≥ 2 refs: "Mark: these are different ideas" → "Marked · split on next ingest" | `st.setSplit(card, true)` |

**Expected on the fixture** — see the table in [Input guide §5](INPUT_GUIDE.md#5-state-files-who-has-read-what).

---

## 6. How to test by hand (5 minutes)

```bash
cd apps/web && rm -rf .scratch && npm run dev
```
Open http://127.0.0.1:5173 and check:

| # | Do | Expect |
|---|---|---|
| 1 | type `inter` in Search | "Interpretability Notes" first; Enter opens W2 |
| 2 | in W2, click TOC "4 · Features" | book pane jumps to line 166; cards pane shows "Superposition" |
| 3 | scroll the book pane | cards pane follows |
| 4 | on Superposition, press copy | toast "Copied: prompt + card + 2 sources"; chip → Explored; `.scratch/dev/state/laptop-web.json` has `c_0003.explored` |
| 5 | Focus view, card c_0005 | "Updated" tag, tags revisit + confusing |
| 6 | Network tab in Focus | `content.md` requests are **206**, a few KB each (after T1) |
| 7 | edit `.scratch/dev/library.json`, raise `generation` by 1 | within 10 s the banner "New cards arrived · Reload" |

## 7. Definition of done

- [ ] T1, T2, T2b, T3–T7 done; each has a worklog line.
- [ ] `npm test`, `npm run check` pass; `npx playwright test --repeat-each=5` has 0 failures.
- [ ] No `readJSON(... meta.json)` left in `src/`.
- [ ] Perf table filled in the README; any miss is stated.
- [ ] Nothing written outside `apps/web/`. `fixtures/library/` unchanged (`git status` or compare file times).

## 8. Pitfalls

- **Never write into `fixtures/library/`.** Tests use `.scratch/*`.
- **Bytes, not characters**, for ranges (see T1 step 2).
- `createReadStream({ end })` is **inclusive**; `readRange(start, end)` is **exclusive**. Off-by-one here gives a missing or extra "\n" and a wrong line count.
- Do not kill processes with `pkill -f vite` (it can kill your own shell). Use `pkill -f 'bin/[v]ite'`.
- Do not add a network call at run time (fonts are bundled, no CDN).
