# Input guide — what the apps read, with real examples

For the web and mobile tickets. Every example below is copied from `fixtures/library/` (regenerate it with `python3 fixtures/make_fixture.py --check`). The formal spec is `docs/contract/README.md`; the schemas are in `docs/contract/schemas/`. **You never parse these files yourself — `@rh/core` does. This guide is so you know what you are showing.**

## 1. The folder

```
fixtures/library/
├─ library.json            ← list of sources + topics            (read at start)
├─ cards.json              ← all 13 cards                        (read at start)
├─ tag_suggestions.json    ← 4 topic suggestions from the model  (read at start)
├─ reports/latest.json     ← ingest checks per source            (read at start)
├─ topics.yaml             ← the user's topic tree (apps do not need it)
├─ sources/
│  ├─ s_booka/  content.md  meta.json  original.pdf  assets/fig-003.svg
│  ├─ s_blogb/  content.md  meta.json  original.html
│  ├─ s_videoc/ content.md  meta.json  original.info.json  original.en.vtt  assets/slide-*.svg
│  └─ s_bookd/  content.md  meta.json  original.pdf
├─ state/pixel-8.json      ← another device's reading state
├─ state/laptop-web.json   ← another device's reading state
├─ notes/c_0001.md, notes/c_0008.md
└─ inbox/links.txt
```

Four sources: **Book A** (pdf, 559 lines, 14 pages), **Blog B** (blog), **Video C** (video, 48:10), **Book D** (pdf).

## 2. One source in `library.json`

```json
{ "id": "s_booka", "kind": "pdf", "title": "Interpretability Notes", "authors": ["A. Example"],
  "origin": { "filename": "interpretability-notes.pdf" }, "added_at": "2026-09-27T03:10:00Z",
  "status": "ready", "n_lines": 559, "n_cards": 9, "pages": 14, "duration_s": null,
  "keywords": ["3 · Probing", "4 · Features", "5 · Circuits"] }
```
Search uses `title`, `authors`, `origin.url`, `origin.filename`, `kind`, `keywords`, `id` → `searchSources(lib, q)`.

## 3. One card in `cards.json`

```json
{ "id": "c_0003", "rev": 2, "title": "Superposition",
  "what":  "A network stores more ideas than it has neurons, by packing them at almost-right angles.",
  "why":   "Single neurons are confusing. One neuron fires for cats, cars and French text.",
  "how":   "Each feature is a direction. Sparse features rarely fire together, so their directions can overlap a little.",
  "when":  "Any time you look inside a model.",
  "extra": "Like PCA, but with more directions than dimensions: $k > d$.",
  "topics": ["ML/Interpretability/Features"],
  "refs": [ { "source": "s_booka", "start": 168, "end": 181 },
            { "source": "s_videoc", "start": 81,  "end": 97  } ],
  "images": ["sources/s_booka/assets/fig-003.svg", "sources/s_videoc/assets/slide-000750.svg"],
  "created_at": "2026-09-27T03:10:00Z", "updated_at": "2026-09-27T03:10:00Z" }
```

How to show it:

| Card part | Where it comes from | Display |
|---|---|---|
| Title | `title` | serif heading |
| **What** | `what` | the **bold line** (label "WHAT") |
| Why / How / When / Additional info | `why`, `how`, `when`, `extra` | only fields that exist, in this order — use `cardFields(card)` |
| Math | `$k > d$` inside any field | KaTeX |
| Images | `images` (library-relative) | `<img src={lib.url(path)}>` |
| Sources | `refs` | "Interpretability Notes · lines 168–181, p. 5" and "Talk: looking inside LLMs · 12:30–15:10" — use `rangeLabel(await lib.meta(ref.source), ref.start, ref.end)` |
| Topic path | `topics` | "Interpretability › Features" (drop the first level if space is short) |
| "Mark: these are different ideas" | only when `refs.length ≥ 2` | button |

Cards **with fewer fields exist**: `c_0010` has only what / how / when; `c_0004` and `c_0013` have no how. Your layout must not leave gaps.

(The table in §5 was checked by running core on the fixture on 27 Sep.)

## 4. The text: `content.md` + `meta.json`

Book A, lines 166–182 of `sources/s_booka/content.md`:
```
166  ## 4 · Features
167
168  Features supporting text, sentence 1.
…
172  A layer with $n$ neurons can still hold more than $n$ features,
173  if each feature is sparse. Each feature is a direction
174  in activation space, not a single neuron (see Figure 3).
…
181  ![Figure 3: five features in two dimensions](assets/fig-003.svg)
182  Features supporting text, sentence 1.
```
(The fixture pads with "supporting text" lines. Real books have real text.)

`sources/s_booka/meta.json` (parts):
```json
{ "n_lines": 559, "content_bytes": 18643, "anchor_step": 100,
  "anchors": [[1,0],[101,3252],[201,6657],[301,10053],[401,13371],[501,16617]],
  "pages":   [[1,1],[41,2],[81,3],[121,4],[161,5],[201,6], …],
  "toc":     [ {"title":"3 · Probing","level":2,"line":35}, {"title":"4 · Features","level":2,"line":166}, … ],
  "assets":  [ {"path":"assets/fig-003.svg","line":181,"caption":"Figure 3: five features in two dimensions","kind":"figure"} ],
  "times": null }
```

- **Line 172 is on page 5** because `[161, 5]` is the last page run starting at or before 172 → `pageOf(meta, 172) === 5`.
- **Reading lines 168–181 without loading the whole file:** the anchors around them are `[101, 3252]` and `[201, 6657]` → `lib.lines("s_booka", 168, 181)` asks your `LibraryFS.readRange("sources/s_booka/content.md", 3252, 6657)` for those 3.4 KB, then keeps lines 168–181. **Your adapter only has to return the bytes as text; core does the rest.**
- **The book view** needs every line: `lib.allLines(sourceId)` then `toBlocks(sourceId, lines)` gives blocks with line numbers: `heading` (166), `para` (168–174 …), `image` (181, path `sources/s_booka/assets/fig-003.svg`), `math`, `code`, `cue`.

Video C (`sources/s_videoc/content.md`, lines 80–84):
```
80  [12:20] (talking about the topic at 12:20)
81  ![Slide at 12:30: features](assets/slide-000750.svg)
82  [12:30] A layer with $n$ neurons can still hold more than $n$ features,
83  [12:40] if each feature is sparse. Each feature is a direction
84  [12:50] in activation space, not a single neuron (see Figure 3).
```
`meta.json.times` = `[[3,0],[4,0],[5,10],[6,20],…]` (line → seconds). `timeOf(meta, 82) === 750` (12:30). `lineAtTime(meta, 750)` gives the first line at 12:30. The YouTube URL is `library.json → sources[…].origin.url`; open `url + "&t=750s"`.

## 5. State files (who has read what)

`state/pixel-8.json` (parts):
```json
{ "device_id": "pixel-8",
  "cards": { "c_0001": { "viewed": {"rev":1,"ts":1758942600000}, "known": {"v":true,"ts":1758942600000} },
             "c_0005": { "viewed": {"rev":1,"ts":…}, "tags": {"v":["revisit"],"ts":1758942600000} },
             "c_0008": { "viewed": {…}, "explored": {"ts":…}, "tags": {"v":["important"],"ts":…} } } }
```
`state/laptop-web.json` later set `c_0005` tags to `["revisit","confusing"]` (higher `ts`) → merged view shows both tags.

What `st.view(card)` returns for the fixture (use these to check your UI):

| Card | status | known | updated | my tags |
|---|---|---|---|---|
| c_0001 Linear probe | viewed | **yes** | no | – |
| c_0002 Probe accuracy trap | viewed | no | no | – |
| c_0003 Superposition | new | no | no | – |
| c_0005 Sparse autoencoder | viewed | no | **yes** (card rev 2, viewed rev 1) | revisit, confusing |
| c_0008 Induction head | explored | no | no | important |
| c_0010 Attention as lookup | viewed | **yes** | no | – |
| c_0012 Deep focus blocks | new | no | no | important |
| c_0013 Attention residue | viewed | no | no | – |
| all others | new | no | no | – |

Your app writes **only** `state/<its device id>.json` (web: `laptop-web` is taken by the fixture, so the web default is fine to reuse in dev; mobile default `android-phone`). Never write another device's file.

## 6. Other files

- `notes/c_0008.md` = `Compare with copying heads in small models.` → `readNote(fs, "c_0008")`.
- `tag_suggestions.json`: `t_0001` "ML/Interpretability/Dictionary learning" for c_0005, c_0006; `t_0004` is already rejected in `laptop-web.json`, so `openSuggestions` returns 3.
- `reports/latest.json`: Book A has status **warning**: coverage gaps `[[161,167],[303,314],[470,508]]`, limit 20 → the 39-line gap 470–508 is over the limit (show red).
- `cards.json.retired`: `c_0099 → c_0005`. A state entry for `c_0099` must show on `c_0005` (core does it via `resolveId`).

## 7. How to get a fresh copy to test with

Never write into `fixtures/library/`. Each app has a script that copies it to a git-ignored scratch folder:

| App | Command | Scratch folder |
|---|---|---|
| web | `npm run dev` (runs `scripts/scratch.ts` first) | `apps/web/.scratch/dev` |
| web e2e | done by `e2e/helpers.ts → resetLibrary()` before each test | `apps/web/.scratch/e2e` |
| mobile | `npm run scratch` or `npm run dev` | `apps/mobile/.scratch/library` |

After the fixture changes (it did on 27 Sep: anchors added), **delete your scratch folders** so they are copied again.

## 8. Big synthetic library (performance)

Both apps have a generator: `npm run synth` → `.scratch/synth` (50 sources, one with 15,000 lines and 400 images, 5,000 cards). **After 27 Sep the generator must also write `content_bytes`, `anchor_step` and `anchors` in each `meta.json`** (one `[line, byte]` every 100 lines, byte = UTF-8 offset of the line start), or range reads fall back to whole files.
