# Ticket 02 · Mobile app (Android) — detailed version (27 Sep)

**Read these first, in this order (30 min):**
1. [Ticket rules](README.md) — what you may and may not touch.
2. [Input guide](INPUT_GUIDE.md) — what the files look like, with real values.
3. [Prototype guide](PROTOTYPE_GUIDE.md) — how to open the approved UI and where each phone view is (P1, P2, P3, P7, P8).
4. `packages/core/README.md` — the functions you must use (do not re-write them).
5. `apps/mobile/WORKLOG.md` — what the previous agent did (it is out of date; §1 below is correct).

**You own:** `apps/mobile/` only. **Read-only for you:** `docs/`, `packages/core/`, `fixtures/`, `.lavish/`, `apps/web/`. If you need one of those changed, append an entry to `docs/contract/CHANGE_REQUESTS.md` and use a workaround inside `apps/mobile/`.

**This laptop has no Android SDK** (`ANDROID_HOME` is unset, no `adb`, no `gradle`). **Do not install it.** You can create the Android project files and write Kotlin/Java, but you cannot build the APK here. Say so in the README and the final report.

---

## 0. The short version

All phone screens **already exist and pass their tests** in the browser. You have **9 tasks** (section 3; T3b = notes of merged cards):
- **T1** — `DevFS.readRange` + Range support in the dev middleware.
- **T2** — the **RangeFile** native plugin (Kotlin) + its TypeScript wrapper.
- **T3** — `CapacitorFS.readRange` using the plugin.
- **T3b** — show old notes of cards merged into this one (`readNotes` from core).
- **T4** — create the Capacitor `android/` project, and put the **AllFiles** plugin in it. The TypeScript side already calls it, but the native file does not exist yet.
- **T5** — synthetic library with anchors.
- **T6** — re-run perf.
- **T7** — README with APK build steps.
- **T8** — update the worklog.

Do **not** redesign screens or change gestures. They were approved.

---

## 1. What already exists (checked on 27 Sep, 23:23)

### 1.1 Test status

| Command (run in `apps/mobile/`) | Result |
|---|---|
| `npm test` (Vitest) | **45 / 45 pass** |
| `npm run check` (svelte-check) | 0 errors |
| `npm run e2e` (Playwright, 412×915, touch) | **18 / 18 pass** (`e2e/feed.spec.ts` 10, `e2e/screens.spec.ts` 8) |
| `npm run perf` | all targets met (`perf-results/perf.json`): ready median **210 ms** (< 1500), swipe **17.4 ms** (< 100), 15k-line book opens in **97 ms** (< 700) at 60 fps, search **17.6 ms** (< 50) |

### 1.2 Files and what they do

| Path (under `apps/mobile/`) | What it does | Status |
|---|---|---|
| `package.json` | scripts: `scratch`, `dev` (5174), `build`, `preview`, `check`, `test`, `e2e`, `synth`, `perf`, `android:sync`. Capacitor 8 deps: core, android, app, clipboard, filesystem; cli (dev) | done |
| `vite.config.ts` | `base: "./"`, Svelte, `@rh/core` alias, `devfsPlugin(RH_LIBRARY or .scratch/library)` | done |
| `server/devfs-plugin.ts` (80 lines) | Vite middleware: `GET /__lib/f/<path>`, `GET /__lib/ls/<dir>`, `PUT /__lib/f/<path>` | **needs Range (T1)** |
| `server/devfs-rules.ts` (65 lines) | `cleanPath`, `readLibFile`, `listLibDir`, `writeLibFile` (only `state/`, `notes/`, `inbox/`; atomic) | done |
| `src/lib/fs/devfs.ts` (35 lines) | `DevFS implements LibraryFS` over `/__lib` | **needs `readRange` (T1)** |
| `src/lib/fs/capfs.ts` (53 lines) | `CapacitorFS implements LibraryFS` over `@capacitor/filesystem`; atomic write with rename fallback; `url()` via `convertFileSrc`; default path `/storage/emulated/0/Syncthing/library` | **needs `readRange` (T3)** |
| `src/lib/platform.ts` | `isNative`, `copyText`, **`AllFiles` plugin wrapper** (`isGranted`, `openSettings`), `onResume`, `onBackButton`, `store` | TS done; **native side missing (T4)** |
| `src/lib/app.svelte.ts` | app store; line 53 picks `CapacitorFS` on a phone, `DevFS` in a browser; setup, reload polling, device id (`rh.deviceId`, default `android-phone`) | done |
| `src/lib/{feed, gesture, viewTimer, md, router.svelte, stats}.ts` | feed order per scope, drag recogniser, 2 s timer, marked + KaTeX, hash router, % read | done |
| `src/components/{BookText (windowed), Chips, FeedCard, NoteSheet, SearchButton, SourceLines, TagDropdown}.svelte` | as named | done |
| `src/screens/{Feed, Books, Tree, Shelf, Outline, Search, Setup}.svelte` | P1, P2, P3, P7, P8, Search, first-run setup | done |
| `tests/*.test.ts` (7 files) | app-store, capfs (mocked plugin), devfs, feed, gesture, md, viewTimer | add tests (T1, T3) |
| `e2e/{feed, screens, perf}.spec.ts`, `playwright.perf.config.ts` | end-to-end + perf | done |
| `scripts/make-scratch.mjs`, `scripts/gen-synthetic.mjs` | scratch copy; synthetic library | **generator needs anchors (T5)** |
| `android/` | — | **missing (T4)** |
| `capacitor.config.ts` | — | **missing (T4)** |
| `README.md` | — | **missing (T7)** |

### 1.3 Things the previous agent learned (keep them)

- **Never run `pkill -f vite`.** It matches your own shell. Use `pkill -f 'bin/[v]ite'`.
- In headless Chromium, `synthesizeScrollGesture` (touch) does not scroll. The tests use `dispatchTouchEvent` drags. Keep that.
- Ghost click: the note sheet opens on the `click` that follows a recognised tap, not on `touchend`.
- The feed order is computed **once per scope**, so a card turning Viewed does not jump.

---

## 2. Setup

```bash
cd apps/mobile
npm install
rm -rf .scratch                   # IMPORTANT: the fixture changed on 27 Sep (anchors); copy it again
npm run dev                       # http://127.0.0.1:5174, library = .scratch/library
npm test && npm run check && npm run e2e
```
Open the dev URL in Chrome, press F12, pick a phone size (Pixel 7) and turn on touch. Node v26 runs `.ts` directly; use only erasable TS syntax.

---

## 3. Tasks

Do them in order. After each: `npm test && npm run check`, then one line in `WORKLOG.md` under "Done".

### T1 · Range reads in the browser dev setup (DevFS)

**Why.** Core reads only the bytes between two anchors when the `LibraryFS` has `readRange` ([Input guide §4](INPUT_GUIDE.md#4-the-text-contentmd--metajson)). In dev the phone app uses `DevFS`, so dev must behave like the phone.

**The interface** (`packages/core/src/fs.ts`, line 18):
```ts
readRange?(path: string, start: number, end: number): Promise<string | null>;
// start inclusive, end exclusive (like Array.slice). UTF-8 text. null if the file is missing.
```

**Step 1 — middleware (`server/devfs-plugin.ts`, the `GET/HEAD` branch).** Today it reads the whole file with `readLibFile` and sends it. Add: if the request has `Range: bytes=a-b`, send only those bytes with **206**.

```ts
// exported for unit tests
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number, last: number;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); last = size - 1; }
  else { start = Number(m[1]); last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > last) return "unsatisfiable";
  return { start, end: last + 1 };
}
```
In the handler, after `const buf = await readLibFile(root, p)`:
```ts
res.setHeader("Accept-Ranges", "bytes");
const range = parseRange(req.headers.range as string | undefined, buf.length);
if (range === "unsatisfiable") { res.setHeader("Content-Range", `bytes */${buf.length}`); return send(416, ""); }
if (range) {
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end - 1}/${buf.length}`);
  return send(206, buf.subarray(range.start, range.end), TYPES[ext] ?? "application/octet-stream");
}
```
(Reading the whole file on the dev server is fine; the point is that the *app* receives only the range, as it will on the phone.) The same `parseRange` is in the web ticket. Copy it; do not import from `apps/web/`.

**Step 2 — client (`src/lib/fs/devfs.ts`).**
```ts
async readRange(path: string, start: number, end: number): Promise<string | null> {
  if (end <= start) return "";
  const r = await this.fetchFn(`${this.base}/f/${enc(path)}`, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (r.status === 206) return new TextDecoder().decode(await r.arrayBuffer());
  if (r.status === 200) return new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()).subarray(start, end));
  throw new Error(`range ${path}: HTTP ${r.status}`);
}
```
**Bytes, not characters:** decode after cutting bytes. `r.text().slice()` is wrong for `·`, `—`, `α`.

**Step 3 — tests (`tests/devfs.test.ts`).**

| Test | Input | Expect |
|---|---|---|
| parseRange | `"bytes=3252-6656"`, 18643 | `{start: 3252, end: 6657}` |
| parseRange | `"bytes=16617-"`, `"bytes=-100"`, `"bytes=20000-"`, `"x=1-2"`, `undefined` | `{16617,18643}`, `{18543,18643}`, `"unsatisfiable"`, `null`, `null` |
| handler 206 | scratch copy, `sources/s_booka/content.md`, `bytes=3252-6656` | 206, `Content-Range: bytes 3252-6656/18643`, 3405 bytes, starts with line 101 |
| DevFS equals full | every anchor pair of `s_booka` and `s_videoc` | `readRange` text === bytes `[a, b)` of `readText` |
| **core uses it** | `Library.open(new DevFS(...))`, `lib.lines("s_booka", 168, 181)` | same 14 lines as `allLines` on a second Library; fetch counter: **1** request with a Range header, **0** full GETs of `content.md` |

And one e2e test in `e2e/feed.spec.ts`: record requests while the P1 feed shows the first card and you scroll to its sources. Every request to `sources/*/content.md` has a `range` header. (P2 Book loads the whole file on purpose; do not test P2 here.)

### T2 · The RangeFile native plugin

**What it is.** A tiny Capacitor plugin, **inside `apps/mobile/`**, with one method. It opens a file, jumps to a byte, reads some bytes, and returns them as text. `@capacitor/filesystem` cannot do this (it only reads whole files).

**TypeScript side — new file `src/lib/fs/rangefile.ts`:**
```ts
// RangeFile: read bytes [start, end) of a file as UTF-8. Native side: android/app/src/main/java/io/onerobot/readinghelper/RangeFilePlugin.kt
import { registerPlugin } from "@capacitor/core";

export interface RangeFilePlugin {
  /** path is absolute ("/storage/emulated/0/Syncthing/library/sources/s_booka/content.md").
   *  Resolves { data: string } (UTF-8), or rejects with code "NOT_FOUND" if the file is missing. */
  read(opts: { path: string; start: number; end: number }): Promise<{ data: string }>;
}
export const RangeFile = registerPlugin<RangeFilePlugin>("RangeFile");
```

**Native side — `android/app/src/main/java/io/onerobot/readinghelper/RangeFilePlugin.kt`** (the `android/` folder is created in T4; write this file there):
```kotlin
package io.onerobot.readinghelper

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.RandomAccessFile

/** Pure part, no Android types, so it can be unit-tested on a plain JVM. */
object RangeReader {
    /** Bytes [start, end) of the file. end is clamped to the file size. Throws NoSuchFileException if missing. */
    fun read(path: String, start: Long, end: Long): ByteArray {
        val f = File(path)
        if (!f.isFile) throw java.nio.file.NoSuchFileException(path)
        RandomAccessFile(f, "r").use { raf ->
            val size = raf.length()
            val s = start.coerceIn(0, size)
            val e = end.coerceIn(s, size)
            val out = ByteArray((e - s).toInt())
            raf.seek(s)
            raf.readFully(out)
            return out
        }
    }
}

@CapacitorPlugin(name = "RangeFile")
class RangeFilePlugin : Plugin() {
    @PluginMethod
    fun read(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required", "BAD_ARGS")
        val start = call.getLong("start") ?: return call.reject("start is required", "BAD_ARGS")
        val end = call.getLong("end") ?: return call.reject("end is required", "BAD_ARGS")
        if (end - start > 16L * 1024 * 1024) return call.reject("range too large (> 16 MB)", "TOO_LARGE")
        // File reads must not run on the main thread.
        bridge.execute {
            try {
                val bytes = RangeReader.read(path, start, end)
                call.resolve(JSObject().put("data", String(bytes, Charsets.UTF_8)))
            } catch (e: java.nio.file.NoSuchFileException) {
                call.reject("not found: $path", "NOT_FOUND")
            } catch (e: Exception) {
                call.reject(e.message ?: "read failed", "IO_ERROR", e)
            }
        }
    }
}
```
If `PluginCall.getLong` does not exist in the installed Capacitor 8 version, use `call.getInt(...)?.toLong()` (files are < 2 GB). Check the Capacitor 8 Android API in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java`.

**Register it** in `android/app/src/main/java/io/onerobot/readinghelper/MainActivity.kt` (or `.java`, whichever `cap add` creates):
```kotlin
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(RangeFilePlugin::class.java)
        registerPlugin(AllFilesPlugin::class.java)   // T4
        super.onCreate(savedInstanceState)            // register BEFORE super.onCreate
    }
}
```

**Kotlin support.** A fresh Capacitor 8 project may be Java-only. Either (a) add the Kotlin Gradle plugin to `android/build.gradle` and `android/app/build.gradle`, or (b) write both plugins in **Java** instead (same logic; `RandomAccessFile` works the same). **Pick (b) Java if you are unsure** — it avoids Gradle changes you cannot test here. Write down which one you picked.

**JVM unit test for `RangeReader`.** Put it at `android/app/src/test/java/io/onerobot/readinghelper/RangeReaderTest.(kt|java)`: a temp file with `"a·b\nline2\n"`; read `[0, 5)` → the bytes of `"a·b\n"` (· is 2 bytes); read past the end → clamped; missing file → `NoSuchFileException`. It needs Gradle, so **it cannot run here**. As a check that *can* run here, port the same 3 cases to a Vitest test of a TS function with the same rules (T3 has one: the fake plugin).

### T3 · `CapacitorFS.readRange`

In `src/lib/fs/capfs.ts`:
```ts
import { RangeFile } from "./rangefile.ts";
…
async readRange(path: string, start: number, end: number): Promise<string | null> {
  if (end <= start) return "";
  try {
    return (await RangeFile.read({ path: this.abs(path), start, end })).data;
  } catch (e) {
    if ((e as { code?: string }).code === "NOT_FOUND") return null;
    // Plugin missing (old APK) or other error: fall back to the whole file, cut by bytes.
    const all = await this.readText(path);
    if (all === null) return null;
    return new TextDecoder().decode(new TextEncoder().encode(all).subarray(start, end));
  }
}
```
**Why the fallback:** if an APK was built before the plugin existed, the app still works; it is just slower.

**Tests (`tests/capfs.test.ts`).** It already mocks `@capacitor/filesystem`. Also mock `./rangefile.ts` (`vi.mock`):

| Case | Mock does | Expect |
|---|---|---|
| normal | `read` returns `{data: "line 101…"}` | that text; `read` got the absolute path `ROOT + "/sources/s_booka/content.md"`, 3252, 6657 |
| missing | `read` rejects with `{code: "NOT_FOUND"}` | `null`; `readFile` **not** called |
| plugin missing | `read` rejects with `{code: "UNIMPLEMENTED"}` | falls back to `readFile`; text = bytes [start, end) of the file |
| multi-byte | fallback with text `"a·b\nc\n"`, range [0, 5) | `"a·b\n"` |
| empty | start = end | `""`, no calls |

### T3b · Show notes of merged cards

**Why.** When the backend merges card b into card a, it does **not** move `notes/c_b.md` (the backend never writes `notes/`). `cards.json → retired` says `b → [a]`. The app must show b's old note under a's note.

**Core has it (added 27 Sep):** `readNotes(lib, fs, cardId)` → `[{id, text, own}]`. The first item is the card's own note (editable). The others are old notes (`own: false`), only those with text.

**Where:** `src/components/NoteSheet.svelte` (and the note line on `FeedCard.svelte`). Today it calls `readNote(fs, id)`. Change it to `readNotes(app.lib, fs, id)`. Show each `own: false` note below the editor, read-only, with a small label "From merged card c_0099". Editing still writes only the own note (`writeNote`).

**Test:** in the scratch library write `notes/c_0099.md` = "Old note". Open card c_0005 (c_0099 is retired into it in the fixture). Expect the label and the text. Add this to an e2e test.

### T4 · The Capacitor Android project

```bash
cd apps/mobile
```
1. Create `capacitor.config.ts`:
   ```ts
   import type { CapacitorConfig } from "@capacitor/cli";
   const config: CapacitorConfig = {
     appId: "io.onerobot.readinghelper",
     appName: "Reading Helper",
     webDir: "dist",
     android: { allowMixedContent: false },
   };
   export default config;
   ```
2. `npm run build && npx cap add android`. This creates `android/` **without** the SDK (it only copies templates). If it fails because the SDK is missing, write down the exact error in the worklog and stop T4 at this step; everything else in T4 is plain file edits you can still do after a successful `cap add`.
3. `npx cap sync android` → copies `dist/` into `android/app/src/main/assets/public`.
4. **Manifest** (`android/app/src/main/AndroidManifest.xml`), inside `<manifest>`:
   ```xml
   <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:ignore="ScopedStorage" />
   <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
   ```
   Add `xmlns:tools="http://schemas.android.com/tools"` on `<manifest>` if it is not there. No `INTERNET` permission is needed by the app (Capacitor's template may add it; leave it, the app makes no calls).
5. **AllFiles plugin** (`android/app/src/main/java/io/onerobot/readinghelper/AllFilesPlugin.(kt|java)`). `src/lib/platform.ts` (lines ~19–33) already calls it with this API:
   ```ts
   isGranted(): Promise<{ granted: boolean }>;
   openSettings(): Promise<void>;
   ```
   Native:
   - `isGranted`: `Build.VERSION.SDK_INT >= 30 ? Environment.isExternalStorageManager() : true` (below Android 11 the manifest permission is enough).
   - `openSettings`: start `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` with `Uri.parse("package:" + context.packageName)`; if that throws, start `Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION`. Resolve at once.
6. Register both plugins in `MainActivity` (see T2).
7. Add `android/.gitignore` entries from the template (build outputs); keep `android/` itself in the repo.
8. `package.json` → add a script `"android:open": "cap open android"` (for the user's machine).

**Done when:** `android/` exists with the manifest lines, both plugins, and `MainActivity` registering them; `npx cap sync android` succeeds; `npm run build` still works. The APK is **not** built here.

### T5 · Synthetic library with anchors

`scripts/gen-synthetic.mjs` writes `meta.json` without `content_bytes`, `anchor_step`, `anchors`. Add them the same way as the Python fixture (`fixtures/make_fixture.py`, search `ANCHOR_STEP`):
```js
const ANCHOR_STEP = 100, enc = new TextEncoder();
let byte = 0; const anchors = [];
lines.forEach((line, i) => {
  if (i % ANCHOR_STEP === 0) anchors.push([i + 1, byte]);   // line numbers start at 1
  byte += enc.encode(line).length + 1;                      // + "\n"
});
const text = lines.join("\n") + "\n";                       // must end with "\n"
meta.content_bytes = enc.encode(text).length;               // === byte
meta.anchor_step = ANCHOR_STEP; meta.anchors = anchors;
```
Unit test: generate 2 small sources into a temp folder; for each anchor `[L, b]`, the file's bytes from `b` start with exactly line L.

### T6 · Re-run performance

`npm run perf`. Update `perf-results/perf.json`. Add one new number: **bytes of `content.md` fetched** while swiping through the first 10 cards of the synthetic library (count response sizes in the perf spec). Target < 100 KB. Before T1 this was the whole file.

### T7 · README.md

`apps/mobile/README.md`, one page:
- What it is, and the dev commands (§2).
- How the app finds the library: the Setup screen asks for the folder path (default `/storage/emulated/0/Syncthing/library`) and needs **All files access**.
- **APK build steps for the user's machine** (not run here):
  ```bash
  # needs Android Studio (or SDK + JDK 21) on the machine
  cd apps/mobile
  npm install && npm run android:sync
  cd android && ./gradlew assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
  adb install -r app/build/outputs/apk/debug/app-debug.apk
  ./gradlew test                               # runs RangeReaderTest
  ```
  Then on the phone: install Syncthing-Fork, share the library folder from the GPU machine, open the app, set the path, allow All files access.
- The perf table (T6).
- Known limits: APK not built in this environment; the Kotlin/Java unit test not run here.

### T8 · Worklog and final report

Rewrite `apps/mobile/WORKLOG.md` so it matches §1 plus your work. Final message to the main session: changes, test counts, perf, what was not run (APK, Gradle test).

---

## 4. Reference: the full behaviour (already built — use to check, not to rebuild)

### 4.1 Screens

Bottom tabs: **Feed · Books · Tree · Shelf**. A search button in the top bar on every tab.

| Screen | File | Prototype | Must do |
|---|---|---|---|
| P1 Feed | `screens/Feed.svelte`, `components/FeedCard.svelte` | `buildFeed` main:119 | One card fills the screen. **Drag → = next. Drag ← = copy for deep dive. Vertical scroll = read deeper** (What → Why → How → When → Additional info → images → sources with their lines → "mark different ideas"). **Tap = note.** Tag dropdown at the top. Top bar: ‹ previous, scope select (Everything / a source / a topic), "3 / 120", Known toggle. Hints while dragging "NEXT →" / "← COPY". Threshold ~90 px or a fast fling. Order: New, then Viewed/Explored, Known last; computed once per scope. Viewed after 2 s. |
| P2 Books | `screens/Books.svelte`, `components/BookText.svelte` | `buildBooks` main:159 | list (title, kind, author, cards, % bar) → **Book / Cards** switch. Book = whole `content.md` (`toBlocks`), images at their line, video transcript with slides, ● marker per card → tap opens the card. Cards = source order; Known = one line; "also in …"; tap → P1 scoped to this source |
| P3 Tree | `screens/Tree.svelte` | `buildTree` main:182 | Topics / Books switch; 3 levels; count + % bar; breadcrumbs; leaf → P1 |
| P7 Shelf | `screens/Shelf.svelte` | `buildShelf` main:197 | my tags as shelves with counts; My notes; copy prompt editor; create / delete tags; Settings (library path, device id) |
| P8 Outline | `screens/Outline.svelte` | `buildOutline` main:216 | source picker; TOC with concepts under headings; chips; Known faded; gaps "N lines with no card", red if > limit; tap → P1 |
| Search | `screens/Search.svelte` | (none) | full screen, keyboard opens at once; `searchSources` as you type; row = title, kind, author, cards, % read; **tap → P8**; second section "Cards" (`searchAll`) → P1 |
| Setup | `screens/Setup.svelte` | (none) | first run on a phone: folder path + "Test"; All files access screen with a button that calls `openAllFilesSettings()` |

Reload: on app resume and every 30 s, `lib.hasUpdate()` → banner "New cards · Reload".

### 4.2 Card behaviour

Same rules as the web ticket §5.3 ([link](01-web.md#53-card-behaviour-every-place-a-card-appears)), with touch: copy uses `@capacitor/clipboard` on the phone and `navigator.clipboard` in dev (`copyText` in `platform.ts`).

**Expected on the fixture:** [Input guide §5](INPUT_GUIDE.md#5-state-files-who-has-read-what).

---

## 5. How to test by hand (5 minutes)

```bash
cd apps/mobile && rm -rf .scratch && npm run dev     # Chrome, F12, Pixel 7, touch on
```

| # | Do | Expect |
|---|---|---|
| 1 | Feed, drag the card to the right | next card |
| 2 | drag to the left | toast "Copied…"; chip → Explored; `.scratch/library/state/android-phone.json` has `explored` for that card |
| 3 | scroll up inside a card | same card, you see Why / How / … / sources with line text |
| 4 | tap the card | note sheet; type, save → `.scratch/library/notes/<id>.md` |
| 5 | search button, type `talk` | "Talk: looking inside LLMs"; tap → P8 outline of the video |
| 6 | Books → Interpretability Notes → Book | Figure 3 at line 181; ● markers; tap one → that card |
| 7 | Network tab while in Feed (after T1) | `content.md` requests are **206**, a few KB |
| 8 | raise `generation` in `.scratch/library/library.json` | within 30 s the banner "New cards · Reload" |

## 6. Definition of done

- [ ] T1–T8 and T3b done, each with a worklog line.
- [ ] `npm test`, `npm run check`, `npm run e2e` pass (18 + the new range test).
- [ ] `android/` exists with both plugins registered and the manifest permissions; `npx cap sync android` works.
- [ ] README has APK steps and says clearly the APK and Gradle tests were **not run here**.
- [ ] Nothing written outside `apps/mobile/`. `fixtures/library/` unchanged.

## 7. Pitfalls

- Plugin names must match exactly: `registerPlugin("RangeFile")` ↔ `@CapacitorPlugin(name = "RangeFile")`; `"AllFiles"` ↔ `@CapacitorPlugin(name = "AllFiles")`.
- Register plugins **before** `super.onCreate()`.
- Do file I/O off the main thread (`bridge.execute { … }`).
- `readRange` end is **exclusive**. `RandomAccessFile.readFully(buf)` reads exactly `buf.size` bytes.
- Paths passed to the plugin are **absolute** (`this.abs(path)`), not `file://` URLs.
- `pkill -f 'bin/[v]ite'`, never `pkill -f vite`.
