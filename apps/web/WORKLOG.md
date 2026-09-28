# Web app worklog (ticket 01)

Resume from here after a crash. Newest step at the bottom of "Done".

## Done
- Read ticket rules, decisions, contract + schemas, core README/src, ticket 01, prototype (web views W2–W14).
- `packages/core`: `npm test` → 15/15 pass (Node 26).

- Scaffold: package.json (deps local to apps/web), Vite 8 + Svelte 5 + TS strict, `@rh/core` alias.
- Server: `server/handler.ts` (routes, path guard, ETag, atomic writes, inbox upload/links), used by Vite dev plugin and `server/index.ts` (prod, 127.0.0.1:8787). Node 26 runs the .ts directly.
- `scripts/scratch.ts` copies the fixture to `.scratch/<name>` (predev does it).
- App: `src/lib/` (http-fs, md = marked+KaTeX+DOMPurify, scroll-sync, viewed timer, prefs, router, app store, book chunk builder),
  `src/components/` (Card, TagDropdown, Note, SourceLines, Palette), `src/views/` (Search, Reader W2, Coverage W6, Video W7, Focus W9, Board W10, Inbox W11, Report W12, Settings).
- `svelte-check` 0 errors; `vite build` OK.

- Smoke run in Chromium: all views render on the fixture, no console errors. Screenshots checked against prototype.
- Unit tests (Vitest): `npm test` → 34/34 pass (server guard + write rules + routes, HttpFS fake + real server with core, scroll-sync mapping, viewed timer).

- E2E (Playwright, `e2e/app.spec.ts`, port 8788, `.scratch/e2e` reset before each test): 12/12 pass.
  Bugs found + fixed on the way: (1) blocks inside a `content-visibility` chunk have the chunk as offsetParent → use summed offsetTop (`topIn`);
  (2) content-visibility items in a flex column shrank to 0 px → `flex:none`; (3) a time lock dropped real user scrolls → now only ignore scroll events that land where the app scrolled.

- **T1 Range reads** (27 Sep): server returns 206 for HTTP Range requests (`parseRange` utility, Accept-Ranges header); `HttpFS.readRange` sends Range requests with `cache: "no-store"` and decodes bytes with TextDecoder; falls back to 200 with byte slicing. 8 new unit tests (parseRange basic/open/suffix/past/junk, GET 206, GET 416, Range+guard) + 4 readRange tests (anchor pairs, lib.lines spy, 200 fallback, multi-byte). Total: 46 tests pass.
- **T2 Remove meta workaround** (27 Sep): `metaOf()` now calls `lib.meta()` from core (which loads only meta.json, cache of 256) instead of `readJSON`. Removed `readJSON` import from app.svelte.ts. Labels still show "lines 168–181, p. 5".
- **T2b Show merged notes** (27 Sep): `Note.svelte` uses `readNotes(lib, fs, cardId)` from core. Old notes from retired cards appear read-only below the editor with "From merged card c_XXXX" label. E2e test added.
- **T3 Flaky e2e test** (27 Sep): Split the combined W6+W7+W12 test into 3 independent tests. Added `data-testid` to Coverage, Video, Report views. Each test now waits for view-specific ready markers before clicking. 14 e2e tests, 0 failures with --repeat-each=5.
- **T4 Synthetic anchors** (27 Sep): `gen-synthetic.ts` now computes `content_bytes`, `anchor_step=100`, and `anchors` ([line,byte] every 100 lines) for each source. Content ends with `\n`. Unit test validates anchor byte offsets against actual file content.
- **T5 Performance targets** (28 Sep): Measured on synthetic library (50 sources, 5,000 cards, 15k-line book). All limits met:
  - First screen after server start: 420.2 ms (< 1 s)
  - W2 opens 15k-line book: 178.9 ms (< 500 ms)
  - Scroll frame rate: 60 fps (p95 frame 17.8 ms, 0 frames >20 ms)
  - Search per keystroke: 16.7 ms (< 50 ms)
  - Focus view 10 cards content.md: 84.4 KB (< 100 KB)
  Written to `perf-results/perf.json` and `README.md`.
- **T6 README** (27 Sep): Written with sections: what it is, commands, LIBRARY_DIR, server routes, views, performance table with real numbers, known limits.
- **T7 Worklog** (28 Sep): All tasks T1–T7 complete. 47 unit tests pass, 16 e2e tests pass.

## In progress
- Screenshots and demo video showing the app working across all views.

## Next
- Deliver video and screenshots to user.

## Open questions / decisions made alone
- Fixture bug: `sources/s_videoc/assets/slide-002400.svg` has an unescaped `&` ("Q&A"), so browsers cannot show it. Not ours to fix (fixture is read-only) → noted in README.
- W2 video: the time stamp of a cue is a link that opens the video at that second (new tab); clicking the cue text syncs the panes instead. Ticket says "clicking a cue opens the YouTube URL"; this keeps both behaviours.
- **Resolved:** Card source labels need `meta.json`. Previous workaround using `readJSON` removed; now uses `lib.meta()` from core which loads only meta.json.
