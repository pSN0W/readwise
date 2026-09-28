# Mobile app worklog (ticket 02)

## Status (updated 28 Sep)

### Test & Check Status
| Command (run in `apps/mobile/`) | Result |
|---|---|
| `npm test` (Vitest) | **57 / 57 pass** (8 test files: gesture, feed, app-store, devfs, capfs, timer, md, synth) |
| `npm run check` (svelte-check) | **0 errors, 0 warnings** |
| `npm run e2e` (Playwright, 412×915, touch) | **22 / 22 pass** (`e2e/feed.spec.ts` 14, `e2e/screens.spec.ts` 8) |
| `npm run perf` | **All targets met** (`perf-results/perf.json`): ready median **185 ms** (< 1500), swipe **16.5 ms** (< 100), content.md 10 cards **25.4 KB** (< 100 KB), 15k-line book opens in **110 ms** (< 700) at 60 fps, search **20.4 ms** (< 50) |

### Summary of Completed Tasks
- **T1**: Implemented `DevFS.readRange` and HTTP 206/416 partial range support (`parseRange`) in `server/devfs-plugin.ts` and `src/lib/fs/devfs.ts`. Added Range unit tests in `tests/devfs.test.ts` and Range request verification in `e2e/feed.spec.ts`.
- **T2**: Created native `RangeFile` plugin TypeScript interface and registration (`src/lib/fs/rangefile.ts`). Implemented native Java `RangeReader.java` and `RangeFilePlugin.java`.
- **T3**: Implemented `CapacitorFS.readRange` in `src/lib/fs/capfs.ts` using `RangeFile` with robust fallback to `readText` byte slice for older APKs. Added unit tests for all 5 cases in `tests/capfs.test.ts`.
- **T3b**: Added support for displaying old notes of retired cards merged into active cards via `readNotes` from `@rh/core` in `src/components/NoteSheet.svelte` and `src/components/FeedCard.svelte`. Added E2E verification in `e2e/feed.spec.ts`.
- **T4**: Initialized Capacitor Android project (`capacitor.config.ts`, `cap add android`). Added storage permissions (`MANAGE_EXTERNAL_STORAGE`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`) to `AndroidManifest.xml`. Authored `AllFilesPlugin.java` and registered `RangeFilePlugin` and `AllFilesPlugin` in `MainActivity.java`. Added `android:open` script in `package.json`. Verified `npm run android:sync`. Authored `RangeReaderTest.java`.
- **T5**: Updated `scripts/gen-synthetic.mjs` with anchor generation (`ANCHOR_STEP = 100`, `content_bytes`, `anchors`). Added unit test in `tests/synth.test.ts` verifying byte offsets start with exact line text.
- **T6**: Updated performance test suite in `e2e/perf.spec.ts` to count bytes of `content.md` fetched during card swipes. Re-ran `npm run perf` on synthetic library (5/5 pass, 25.4 KB fetched vs < 100 KB target). Updated `perf-results/perf.json`.
- **T7**: Created comprehensive `README.md` with dev commands, library discovery, APK build instructions, perf benchmark table, and environment notices.
- **Demo Video & Emulator**: Added responsive desktop mobile phone emulator styling to `app.css` and authored `scripts/record-demo.mjs`. Captured 50-second complete interactive demo video (`apps/mobile/demo.mp4`, 1.3 MB) demonstrating feed card reading, KaTeX math formulas, inline SVG diagrams, source range lines, note editing & saving, touch swipes, books list & outline toggle, topic tree drill-down, real-time search, and shelf settings.
- **Topics & Navigation Icons**: Renamed "Tree" tab to "Topics" across navigation and screen headers (with backwards-compatible route aliasing for `#/tree`). Added lightweight, semantic SVG icons for all 4 navigation tabs (`Feed`, `Books`, `Topics`, `Shelf`) with vertical icon+text layout.
- **Viewed Filters & Progressive Disclosure**: Added real-time filter pills (`All`, `Unread`, `Read`) in the Feed so users can filter out viewed cards and only read unread cards. Redesigned FeedCard into a dedicated hero section (topic, tags, title, bold main text) that fills the initial screen, with all additional details (`WHY`, `HOW`, `WHEN`, math, figures, notes, source lines) revealed as you scroll down.

### Key Learnings & Environment Notes
- **Never run `pkill -f vite`**: Matches the calling shell. Use `pkill -f 'bin/[v]ite'`.
- In headless Chromium, `synthesizeScrollGesture` (touch) does not scroll; `dispatchTouchEvent` drags are used.
- Ghost click: the note sheet opens on the `click` that follows a recognised tap, not on `touchend`.
- Feed order is computed once per scope to avoid cards jumping upon state transitions.
- **Android SDK absent**: Gradle APK build (`assembleDebug`) and `RangeReaderTest` were not executed here as the host environment lacks the Android SDK / Gradle. Java files and Android project are fully synchronized in `android/`.

## In progress
- None (all ticket 02 tasks T1–T8 and T3b complete).

## Next
- Run `./gradlew assembleDebug` and `adb install` on a machine with Android SDK / Studio.
