# Decisions

Everything agreed with the user in the interview (27 Sep 2026). If a ticket and this file disagree, this file wins; ask before changing it.

## Goal

Read books, blogs and YouTube videos fast. Each source becomes short **concept cards**. The same concept from many sources becomes **one card** that points back to every place it came from. Never read a concept twice. Dig deeper only when you want to.

## Machines

| Machine | Role |
|---|---|
| GPU machine | Runs the **whole ingest pipeline** and all models. Holds the **main copy** of the library. |
| Laptop | Reads (web app). Development happens here against **dummy model servers**. No models run here. |
| Android phone | Reads offline (Capacitor app over the same folder). |
| Sync | One **Syncthing** folder = the library. |

## Ingest (backend, runs once per source)

- Add a source: drop a file into `inbox/`, add a URL to `inbox/links.txt`, or run the `ingest` command. The GPU machine watches the folder.
- Keep exactly **two copies of a source**: the untouched **original** (ground truth) and **`content.md`** (the Markdown the model read). Everything else points into `content.md` by line number. No text is copied into cards.
- Converters: existing tools (Marker/Docling-class for PDF, trafilatura/defuddle-class for blogs, yt-dlp subtitles + chapters, Whisper-class fallback, scene detection for slide frames). No OCR for now.
- Chunking: normal RAG chunks sized for the context window, **~20% overlap**. A card may run into the overlap.
- One model call per chunk → **structured output (JSON schema)**. The model decides how many cards and each card's line range.
- Checks after every call: JSON valid; ranges inside the chunk; **coverage** (at most N consecutive uncovered lines, N in config); no overlaps inside one chunk. Failed chunks retry, then go to the ingest report.
- Card fields: **title** + **what, why, how, when, extra (additional info)**. All five are optional; the model fills only what the source covers. `extra` = anything else worth knowing, model decides. Cards are always English (sources may be other languages).
- Topics: the model picks from the user's **topics YAML** (up to 3 levels, several per card) and may **suggest** new topics. The user accepts / renames / combines / rejects suggestions in the app. Applying them needs no model call.
- Merge: embed each new card → kNN → if similarity ≥ threshold, send both cards to the model → it returns *keep separate* or *one merged card*. Threshold, top-k, prompts, endpoints, tokens, chunk size, coverage limit: **all in one YAML config**.
- Images: attached to the card when inside its line range. The model sees only text and captions.
- `meta.json` has `[line, byte]` **anchors** for every source (every 100 lines), so apps read only the bytes they need. Web uses HTTP Range; **Android uses a small native plugin** (`RangeFile`).
- Nearest-neighbour search for merging: **FAISS** (flat inner-product index on normalised vectors = exact cosine).
- Changing a prompt does not re-run old sources. A command re-runs one source on request. Notes and states stay attached (stable card ids).
- Models: **OpenAI-compatible** chat + embeddings endpoints (base URL + token). Dev/test uses a **deterministic mock server**. Ask the user for the real endpoint only after tests pass.
- Wrong merge: the user taps **"Mark: these are different ideas"**. The next ingest run splits the card and never merges those again.

## Reading (UIs, never call a model)

- States: **New** → **Viewed** (≥ 2 s on screen) → **Deeply explored** (copied for deep dive). **Known** = user mark; shows only the bold line. **Updated** = the card changed after you viewed it (one tag, no diff).
- **My tags** (#revisit, #important, …, user can create more) are personal, stored on the device side, **never sent to a model**.
- Notes: one Markdown note per card, stored next to (not inside) the backend's data.
- Copy for deep dive: one editable prompt + the card + **all** source lines of every source.
- Order: by topic tree (any level) or by source in source order. Book ↔ cards switch. Video "book mode" = transcript + slide images.
- **Search** over resources (name, link, filename, author, anything) on phone and web: interactive, results as you type; opening a result goes to **P8 Book outline** (phone) / **W2 Reader** (web).

## Phone views (from prototype v2)

P1 Feed · P2 Books · P3 Tree (Topics | Books) · P7 My shelf · P8 Book outline · + Search.
Gestures: **drag → next card**, **drag ← copy**, **scroll = read deeper in the card**, **tap = note**, **tag dropdown** at top of card. ‹ back button. Everything on the card is shown (no "Read ▾").

## Web views (from prototype v2)

W2 Reader (contents | book | cards, all scroll together, each pane can be hidden, images in place, works for pdf/blog/video) · W6 Coverage strips · W7 Video timeline · W9 Focus mode (scope: all / source / topic; ← previous, → next) · W10 Tag board · W11 Tag inbox · W12 Ingest report · W14 Command palette (Ctrl+K) · + resource Search.

## Backend changes (27 Sep)

- **No Stitch step.** Cards that the overlap made twice are handled by Merge. Rule A: two cards from the same source whose lines overlap or touch always go to the merge model, whatever their similarity. Rule B: on merge, refs to the same source that overlap or touch are joined into one (1399–1452 + 1441–1470 → 1399–1470). The report lists "overlap pairs kept apart".
- The backend never writes `notes/` or `topics.yaml`. After a merge, the old card's note stays in `notes/<old id>.md`; apps show it read-only on the new card (`readNotes` in core). Accepted topics go into `library.json` topics.

## Backend review answers (28 Sep)

- Design approved. PDF: **marker**. Merge judge sees **fields only**. YouTube: deno + yt-dlp-ejs, **Whisper fallback on**, **slide frames off** by default. Run mode: **manual** (`rh ingest` / `rh watch` by hand, no service).
- Every source type is a subclass of the abstract **`SourceIngestor`** (link/file → Markdown through `DocBuilder`).
- **LangChain** for chunking (`RecursiveCharacterTextSplitter`, wrapped to give line ranges), model calls (`ChatOpenAI.with_structured_output`) and embeddings (`OpenAIEmbeddings`, `check_embedding_ctx_length=False`). FAISS used directly.
- `topics.yaml` is only the user's; accepted topics go to `library.json` topics (contract text fixed). Report gets optional `overlap_pairs_kept_apart`.
- Embed only the brief description (`what`, < 50 words, checked via `checks.max_description_words`) for similarity check. When merging, all card information (title, what, why, how, when, extra) is fed to the LLM. Fields `why`, `how`, `when`, and `extra` can be descriptive and detailed.

## Later (not now)

Custom book composer ("make me a book on interpretability").
