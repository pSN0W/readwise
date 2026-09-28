# Ticket 03 · Backend ingest (GPU machine) — detailed implementation

**Status:** design approved on 28 Sep. **Not started.** Start only when the user says go.

**Read these first, in this order:**
1. [Ticket rules](README.md).
2. `docs/decisions.md` — all product decisions.
3. `docs/contract/README.md` + `docs/contract/schemas/*.json` — **the files you must write**. The schemas are the truth for field names.
4. `fixtures/library/` — a complete example of correct output. Your output must look like this.
5. [Input guide](INPUT_GUIDE.md) — the same files, explained with real values.
6. `.lavish/backend-design.html` — the approved design, with diagrams (open it in a browser; no server needed).
7. [`backend-config.example.yaml`](backend-config.example.yaml) — every config parameter.
8. `docs/research/backend-reuse.md` — tools and their risks.

**You own:** `backend/` only. Everything else is read-only. Need a contract change → append to `docs/contract/CHANGE_REQUESTS.md`.

**Never call a real model.** Use the mock server (§8) for everything. When all tests pass, stop and report; the user gives the real endpoint later.

---

## 0. The short version

A Python command-line tool, `rh`, that runs on the GPU machine:

```
file or link ──► SourceIngestor ──► content.md + meta.json ──► chunks ──► model writes cards ──► checks
                                                                                         │
library.json ◄── publish ◄── apply your marks ◄── merge (model judges pairs) ◄── embed ◄─┘
```

- **One model call per chunk** (plus retries) and **one per merge pair**. Nothing while reading.
- **Every step is saved** in `work.db`, so a crash continues where it stopped.
- **The apps never wait on it.** They see new cards when `library.json` changes.

### The user's choices (28 Sep review)

| Question | Answer | What it means for you |
|---|---|---|
| R1 design | "Things look good" | build this design |
| R2 PDF converter | **marker** | `convert.pdf.engine: marker` is the default. pymupdf4llm stays an option. |
| R3 merge judge sees | **all card fields** | the judge prompt receives all card information (title, what, why, how, when, extra), not source lines |
| R4 YouTube | **deno + yt-dlp-ejs: yes. Whisper fallback: yes. Slide frames: not picked** | `video.slides: false` by default; the code for slides exists but is off |
| R5 run mode | **manual** | no systemd service. The user runs `rh ingest` or `rh watch` by hand |
| Similarity & card fields | **embed brief description only; detail in why/how/when/extra** | embed only the brief description (`what`, < 50 words, checked via `checks.max_description_words`); merge judge receives all card fields. Fields `why`, `how`, `when`, `extra` can be descriptive and detailed |
| Later changes | abstract `SourceIngestor`; **LangChain** for chunking, model calls, embeddings; no Stitch step (Merge rules A + B) | §4, §5, §6, §9 |

---

## 1. Setup

```bash
cd backend
uv sync                          # base + dev deps (no GPU deps)
uv sync --extra pdf --extra video --extra asr   # on the GPU machine only
uv run rh --help
uv run pytest                    # all tests, no network, no GPU
```

`pyproject.toml`:
- `requires-python = ">=3.12"`, script entry `rh = "rh_ingest.cli:app"`.
- **Base deps:**
  - `pydantic>=2`
  - `pyyaml`
  - `typer`
  - `rich`
  - `httpx`
  - `langchain-openai>=1.6`
  - `langchain-text-splitters>=1.1`
  - `faiss-cpu`
  - `numpy`
  - `trafilatura>=2.2`
  - `watchdog`
  - `jsonschema`
- **Extras:**
  - `pdf = ["marker-pdf>=1.8"]`
  - `pdf-fast = ["pymupdf4llm"]`
  - `video = ["yt-dlp[default]", "yt-dlp-ejs", "scenedetect[opencv]", "imagehash", "pillow"]`
  - `asr = ["faster-whisper>=1.2"]`
- **Dev:** `pytest`, `pytest-asyncio`, `respx`, `fastapi`, `uvicorn`, `ruff`.
- Versions: check each one on PyPI on the day you start and pin what you install (`uv lock`). The versions above were right on 27–28 Sep 2026. `langchain-openai` 1.6.6 and `langchain-text-splitters` 1.1.2 were tested by the main session.

deno: on the GPU machine the user installs it (`curl -fsSL https://deno.land/install.sh | sh`). The code checks for it and prints a clear message if it is missing. Tests do not need it.

---

## 2. Package layout

```
backend/
├─ pyproject.toml · uv.lock · README.md · WORKLOG.md
├─ config.example.yaml              ← copy of docs/tickets/backend-config.example.yaml
├─ prompts/cards.md · cards_retry.md · merge.md     ← §7 texts
├─ src/rh_ingest/
│  ├─ cli.py                        typer commands (§10)
│  ├─ config.py                     Settings ← YAML (§3)
│  ├─ contract/models.py            pydantic mirrors of the schemas
│  ├─ contract/writer.py            LibraryWriter (atomic, library.json last)
│  ├─ contract/state.py             StateReader, MergedState (read state/*.json)
│  ├─ workdb.py                     WorkDB (SQLite WAL)
│  ├─ intake/refs.py                SourceRef, source_id()
│  ├─ intake/watcher.py             InboxWatcher
│  ├─ ingest/base.py                SourceIngestor (abstract), DocBuilder, ingestor_for()
│  ├─ ingest/pdf.py · blog.py · youtube.py · markdown.py
│  ├─ chunk.py                      LineChunker (LangChain splitter → line ranges)
│  ├─ llm/client.py                 LLMClient (LangChain ChatOpenAI + OpenAIEmbeddings)
│  ├─ llm/schemas.py                CardDraft, ChunkCards, MergeVerdict
│  ├─ llm/prompts.py                Prompts, number_lines()
│  ├─ extract/checks.py             pure checks + repair
│  ├─ extract/extractor.py          CardExtractor (retry loop)
│  ├─ cards.py                      make cards from drafts, images, ids, rerun matching
│  ├─ merge/index.py                VectorIndex (FAISS)
│  ├─ merge/merger.py               Merger, union_refs()
│  ├─ topics.py                     TopicTree, collect_suggestions()
│  ├─ decisions.py                  DecisionApplier (split marks, topic decisions)
│  ├─ pipeline.py                   Pipeline (stages + checkpoints)
│  └─ mock/server.py                FastAPI mock model server
└─ tests/
   ├─ unit/ · integration/ · contract/
   └─ inputs/  sample.md · blog.html (+ img.png) · video.info.json + video.en.vtt · pdf_pages.json (fake marker output)
```

---

## 3. Config (`config.py`)

The full file with comments: [`backend-config.example.yaml`](backend-config.example.yaml).

```python
class Settings(BaseModel):
    library_dir: Path
    work_dir: Path
    llm: LLMSettings
    embeddings: EmbedSettings
    chunking: ChunkSettings
    checks: CheckSettings
    merge: MergeSettings
    topics: TopicSettings
    convert: ConvertSettings
    prompts: PromptPaths
    run: RunSettings
    watch: WatchSettings
    log: LogSettings

    @classmethod
    def load(cls, path: Path | None = None) -> "Settings": ...
```

How `Settings.load` works:
1. Choose the path: `--config` flag, else `$RH_CONFIG`, else `~/.config/reading-helper/config.yaml`.
2. Read the YAML.
3. Apply env overrides named `RH__SECTION__KEY`. Split on `__`, lower-case each part, and parse the value with YAML.
4. Validate with pydantic.
5. Resolve prompt paths relative to the config file's folder.

`api_key` is a `SecretStr`. It is never logged and never written to the library.

Key defaults:
- `checks.max_description_words = 50`: word limit for the brief description (`what`); chunk validation retries if exceeded.
- `embeddings.text = "{what}"`: embeds only the brief description for FAISS similarity check.

**Test** (`tests/unit/test_config.py`):
- defaults load from an empty YAML (including `checks.max_description_words = 50` and `embeddings.text = "{what}"`);
- an env override wins;
- a bad value gives an error message that names the key.

---

## 4. Ingest: `SourceIngestor` (abstract class)

**Its job:** take a link or a file, and save it as `content.md` + `meta.json` + `assets/`.

A subclass writes **three methods**. The base class does everything that must be the same for every source.

```python
class SourceIngestor(ABC):
    kind: ClassVar[Literal["pdf", "blog", "video", "markdown"]]

    def __init__(self, settings: Settings): self.s = settings

    @classmethod
    @abstractmethod
    def can_handle(cls, ref: SourceRef) -> bool: ...

    @abstractmethod
    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult: ...
        # put the original in tmp/: original.pdf | original.html | original.info.json + original.en.vtt | original.md
        # FetchResult(original: Path, extra: list[Path], origin: Origin)

    @abstractmethod
    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo: ...
        # the only real work: call doc.page() / doc.time() / doc.heading() / doc.text() / doc.image()
        # SourceInfo(title, authors, duration_s | None)

    # --- final, not overridden ---
    def ingest(self, ref: SourceRef, writer: LibraryWriter) -> SourceMeta:
        tmp = self.s.work_dir / "tmp" / ref.sid
        fetched = self.fetch(ref, tmp)
        doc = DocBuilder(assets_dir=tmp / "assets")
        info = self.to_markdown(fetched, doc)
        built = doc.build()
        if not any(l.strip() for l in built.lines):
            raise IngestError("no text found")
        return writer.write_source(ref.sid, self.kind, info, fetched, built)

INGESTORS = [YouTubeIngestor, PdfIngestor, MarkdownIngestor, BlogIngestor]   # order matters: blog is the catch-all for URLs

def ingestor_for(ref: SourceRef, s: Settings) -> SourceIngestor:
    for cls in INGESTORS:
        if cls.can_handle(ref):
            return cls(s)
    raise IngestError(f"no ingestor for {ref}")
```

### 4.1 `DocBuilder` — why every ingestor must use it

The page map, the time map, the TOC and the image lines are **line numbers**. If a subclass built the text by hand, the numbers would drift. `DocBuilder` counts lines as it adds them, so the numbers are exact.

```python
class DocBuilder:
    def __init__(self, assets_dir: Path): ...
    lines: list[str]                        # content.md lines, no "\n"

    def page(self, n: int) -> None:         # the NEXT line added starts page n. Store a run only if n changed.
    def time(self, s: float) -> None:       # the NEXT line starts at second s. Every transcript line gets one.
    def heading(self, level: int, title: str) -> int:
        # adds a blank line if the last line is not blank, then "#"*level + " " + title
        # records a toc item {title, level, line}. Returns that line.
    def text(self, block: str) -> int:      # block.split("\n") appended; "\r" removed; returns first line
    def blank(self) -> None:                # one empty line (never two in a row)
    def image(self, src: Path, caption: str, kind: Literal["figure", "slide", "image"], time_s: float | None = None) -> int:
        # copies src → assets/<kind>-NNN.<ext> (NNN = 3 digits; slides: slide-<seconds 6 digits>.<ext>)
        # adds its OWN line "![caption](assets/…)" (blank line before and after)
        # records an asset {path, line, caption, kind, time_s?}
    def build(self) -> BuiltDoc:            # lines, toc, pages | None, times | None, assets
```

`build()` raises if `pages` or `times` are not sorted by line.

Example. The fixture's Book A was built like this:

```python
doc.page(5)                                     # the next line is on page 5
doc.heading(2, "4 · Features")                  # → line 166
doc.text("Features supporting text, …")         # → line 168
doc.image(Path("fig3.svg"), "Figure 3: five features in two dimensions", "figure")   # → line 181
# meta.pages gets [161, 5]; meta.toc gets {title: "4 · Features", level: 2, line: 166};
# meta.assets gets {path: "assets/fig-003.svg", line: 181, …}
```

### 4.2 `LibraryWriter.write_source` (in `contract/writer.py`)

This step runs once per source. It is the only code that creates `sources/<sid>/`.

1. If `sources/<sid>/content.md` already exists, **stop with an error**. `content.md` is immutable. A re-run uses `rh rerun`, which does not convert again.
2. Build the text: `text = "\n".join(lines) + "\n"`. Encode it as UTF-8.
3. Compute the anchors, byte-exact: for line L = 1, 101, 201, … store `[L, byte offset where line L starts]`. Also store `content_bytes = len(encoded)` and `content_sha256`.
4. Write into `sources/<sid>.tmp/`:
   - `original.*` (move it, do not copy);
   - `content.md`;
   - `assets/`;
   - `meta.json`, with every field of `meta.schema.json`. `original_extra` lists the VTT file for video.
5. Rename `sources/<sid>.tmp/` → `sources/<sid>/`. The apps do not see the source yet: it is not in `library.json` until publish.
6. Validate `meta.json` against the schema.

**Anchor test.** For a text with `·`, `α` and `—` in it, reading the file bytes from each anchor must give exactly that line. Check with `open(p, "rb").seek(b)`.

### 4.3 The four ingestors

| Class | `can_handle` | `fetch` | `to_markdown` |
|---|---|---|---|
| `PdfIngestor` | path ends `.pdf` or starts with `%PDF` | copy to `tmp/original.pdf` | page by page, see below |
| `BlogIngestor` | any `http(s)` URL that is not YouTube | `httpx.get` (config user agent, timeout, follow redirects) → `original.html` | trafilatura, see below |
| `YouTubeIngestor` | host is `youtube.com`, `www.youtube.com`, `m.youtube.com` or `youtu.be` | yt-dlp: `original.info.json` + subtitles `original.<lang>.vtt` (no video download) | cues, see below |
| `MarkdownIngestor` | path ends `.md` / `.markdown` / `.txt` | copy to `original.md` | text as is; `#` lines → `heading()`; `![](x)` with a local file → `image()` |

**PdfIngestor, page by page.** This is how the page map stays exact.

- Hide the engine behind a small protocol: `PdfEngine.pages(pdf) -> list[PageMd]`, where `PageMd = (page_no, markdown, images: list[(Path, caption)])`.
  - `MarkerEngine`: marker with `paginate_output=True`. Split its Markdown on marker's page separators, then map each image marker writes to its page.
  - `PyMuPdfEngine`: `pymupdf4llm.to_markdown(pdf, page_chunks=True)`.
- For each page:
  1. `doc.page(page_no)`.
  2. For each Markdown line: `#` lines → `doc.heading()`; `![...](x)` lines → `doc.image(file, caption, "figure")`; other text → `doc.text()`.
  3. Drop images smaller than `min_image_px`.
- Title: PDF metadata title, else the first `#` heading, else the file name. Authors: PDF metadata author, split on `,` `;` `and`.
- **Test without marker:** `tests/inputs/pdf_pages.json` holds 3 fake pages, and a `FakeEngine` returns them. Check `meta.pages == [[1,1],[L2,2],[L3,3]]`. Also check that the text on each line starts on its page.

**BlogIngestor.**
- Run `trafilatura.extract(html, output_format="markdown", include_images=True, include_links=False, with_metadata=True)`.
- For each `![alt](url)`: download it with httpx into assets (skip it on error, and log that) → `doc.image()`.
- Title and author come from trafilatura's metadata. `origin.url` is the URL.
- **Test:** `tests/inputs/blog.html`, with the image served by respx.

**YouTubeIngestor.**
- Use the yt-dlp Python API with:
  - `skip_download=True`
  - `writesubtitles=True`
  - `writeautomaticsub=True`
  - `subtitleslangs=config.subtitle_langs`
  - `subtitlesformat="vtt"`
  - `js_runtimes={"deno": {}}`
  - For the exact option names of the yt-dlp version you install, check its README.
- Parse the VTT (write a small parser: cue time + text). Remove duplicate rolling lines: auto-captions repeat the previous line.
- Merge cues into lines of about 10 s. The fixture uses one line per 10 s: `[12:30] …`.
- Write the lines:
  - For each line: `doc.time(seconds)`, then `doc.text(f"[{m}:{ss:02d}] {text}")`. Use `h:mm:ss` if the video is 1 h or longer.
  - Chapters (`info["chapters"]`) → `doc.heading(2, title)` placed before the first line at or after the chapter start.
- No subtitles and `asr_fallback: true`: download audio only (`format=bestaudio`), run faster-whisper (config model/device), use its segments as cues, then delete the audio.
- `slides: false` (the default): no video download. If `true`: download ≤ 480p video only; PySceneDetect `ContentDetector(threshold)`; one frame per scene, but at most one per `slide_min_gap_s`; phash dedupe (distance ≤ 6 counts as the same); `doc.image(frame, f"Slide at {m}:{ss}", "slide", time_s)` before the first cue at or after that time. Then delete the video.
- `duration_s` = `info["duration"]`. `origin.url` = the canonical `https://www.youtube.com/watch?v=<id>`.
- **Test:** `tests/inputs/video.info.json` + `video.en.vtt`, with yt-dlp mocked (monkeypatch the `YoutubeDL` class). Check that:
  - `times` is sorted;
  - chapter headings are at the right lines;
  - rolling duplicates are removed.

### 4.4 `SourceRef` and source ids (`intake/refs.py`)

```python
@dataclass(frozen=True)
class SourceRef:
    kind_hint: str | None; path: Path | None; url: str | None; sid: str

    @staticmethod
    def from_path(p: Path) -> "SourceRef": ...
        # sid = "s_" + sha256(file bytes).hexdigest()[:10]

    @staticmethod
    def from_url(u: str) -> "SourceRef": ...
        # sid = "s_" + sha256(normalised URL).hexdigest()[:10]
        # normalise: lower-case the host, drop utm_* params and the #fragment;
        # YouTube → "youtube:<video id>"
```

The same file or the same link always gives the same id, so adding it twice does nothing. The id matches the schema pattern `^s_[a-z0-9_]+$`.

---

## 5. Chunking (`chunk.py`) — LangChain inside, line numbers outside

```python
@dataclass(frozen=True)
class Chunk:
    idx: int
    start: int          # first line, inclusive
    end: int            # last line, inclusive
    own_end: int        # lines own_end+1 .. end are also in the next chunk (the overlap zone)

class LineChunker:
    def __init__(self, cfg: ChunkSettings):
        count = (lambda t: len(t) // 4) if cfg.tokenizer == "chars/4" else tiktoken_counter(cfg.tokenizer)
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=cfg.max_tokens, chunk_overlap=int(cfg.max_tokens * cfg.overlap),
            length_function=count, separators=cfg.separators,
            keep_separator="start", add_start_index=True, strip_whitespace=False)

    def split(self, text: str) -> list[Chunk]:
        docs = self.splitter.create_documents([text])
        # char start → line: line = text.count("\n", 0, start) + 1   (precompute line starts + bisect for speed)
        # end line = line of (start + len(piece) - 1)
        # own_end of chunk i = next chunk's start - 1 (last chunk: own_end = end)
```

Rules the wrapper must enforce (and test):
- Every chunk starts at a line start. The separators never include `""` or `" "`, so this holds. A single line longer than a chunk becomes its own chunk; it is never cut.
- The chunks cover lines 1 … n with no holes: `chunk[i+1].start <= chunk[i].end + 1`.
- If LangChain ever returns a hole, fail loudly (a bug), not silently.

Tested by the main session on 28 Sep with `langchain-text-splitters` 1.1.2. 200 lines of ~50 chars, `chunk_size=1500`, `chunk_overlap=300` → chunks at lines 1–29, 25–53, 49–77 (overlap ≈ 5 lines, as expected).

**Test:** the fixture's `s_booka/content.md` with `max_tokens=800` gives the same chunks twice (deterministic), with no holes, each start at a line start.

---

## 6. The model: `LLMClient` (`llm/client.py`) — LangChain inside

```python
class LLMClient:
    def __init__(self, llm: LLMSettings, emb: EmbedSettings):
        self.chat = ChatOpenAI(base_url=llm.base_url, api_key=llm.api_key.get_secret_value(), model=llm.model,
                               temperature=llm.temperature, max_tokens=llm.max_tokens, timeout=llm.timeout_s,
                               max_retries=llm.max_retries, extra_body=llm.extra_body or None)
        self.emb = OpenAIEmbeddings(base_url=emb.base_url, api_key=emb.api_key.get_secret_value(), model=emb.model,
                                    chunk_size=emb.batch,
                                    check_embedding_ctx_length=False)   # MUST: otherwise it sends tiktoken ids,
                                                                        # which non-OpenAI servers reject
        self.usage = Usage()

    def chat_json(self, schema: type[T], system: str, user: str) -> T:
        runnable = self.chat.with_structured_output(schema, method=self.cfg.structured_method,
                                                    include_raw=True, strict=self.cfg.strict if method == "json_schema" else None)
        out = runnable.invoke([SystemMessage(system), HumanMessage(user)])
        # out = {"raw": AIMessage, "parsed": T | None, "parsing_error": Exception | None}
        self.usage.add(out["raw"].usage_metadata)
        if out["parsed"] is None:
            raise LLMFormatError(raw=str(out["raw"].content), error=str(out["parsing_error"]))
        return out["parsed"]

    def embed(self, texts: list[str]) -> np.ndarray:
        v = np.asarray(self.emb.embed_documents(texts), dtype="float32")   # (n, dim)
        v /= np.linalg.norm(v, axis=1, keepdims=True) + 1e-12             # L2-normalise → inner product = cosine
        return v
```

Checked on 28 Sep with `langchain-openai` 1.6.6:
- `with_structured_output(schema, *, method="json_schema" | "function_calling" | "json_mode", include_raw, strict)` exists;
- `OpenAIEmbeddings` has `check_embedding_ctx_length` (default `True`, so you must set it to `False`).

**Schemas the model returns (`llm/schemas.py`).** Keep them flat: no nesting beyond the list, no `$ref`, and no defaults. With strict mode, optional fields must be *required and nullable*.

```python
class CardDraft(BaseModel):
    title: str
    what: str
    why: str | None
    how: str | None
    when: str | None
    extra: str | None
    start_line: int
    end_line: int
    topics: list[str]
    suggested_topics: list[str]

class ChunkCards(BaseModel):
    cards: list[CardDraft]

class MergeVerdict(BaseModel):
    decision: Literal["merge", "separate"]
    reason: str
    title: str | None
    what: str | None
    why: str | None
    how: str | None
    when: str | None
    extra: str | None
    topics: list[str]
```

Empty strings from the model become `None` before a card is saved (the card schema has `minLength: 1`).

**Tests** (`tests/integration/test_llm_client.py`, against the mock server started in a thread with uvicorn on a free port):
- `chat_json(ChunkCards, …)` returns parsed cards;
- the `bad_json` fault → `LLMFormatError` with the raw text;
- the `http500` fault for 2 calls → succeeds on the 3rd (LangChain retries);
- `embed()` returns unit vectors, and the same description (`what`) gives cosine > 0.95.

---

## 7. Prompts (`prompts/*.md`, `llm/prompts.py`)

The prompts are template files. The user may edit them. `Prompts.version` = sha256 of the three files; it is part of every cache key. Changing a prompt does **not** re-run old sources (decision). Only `rh rerun <sid>` does.

`number_lines(lines, start)` gives `"0168| A layer with $n$ neurons…"`: 4 digits, or 5 or more if needed, then `| `.

### `prompts/cards.md` (system part, then user part after `---USER---`)

```
You turn one part of a document into study cards for a fast reader.

Rules:
1. One card = one idea. A paragraph with two ideas gets two cards.
2. start_line and end_line are the numbers at the start of the lines ("0168|" = line 168). Use only numbers you see.
3. Two cards never share a line.
4. Cover every line that has content. Blank lines, page furniture and lines only with a heading may be left out.
   Lines after {own_end} are repeated in the next part; you may leave them out if an idea continues past the end.
5. Fields, all in simple English, even if the text is in another language:
   - title: 2–6 words.
   - what: brief description — small, strictly less than 50 words ({max_description_words} words max) summarizing the core idea.
   - why: why this is needed, why it matters, or the core problem it solves (can be descriptive and detailed).
   - how: how it works, mechanisms, steps, or principles (can be descriptive and detailed).
   - when: when it is useful, applicability, conditions, or prerequisites (can be descriptive and detailed).
   - extra: additional info — nuances, edge cases, examples, warnings, or related ideas (can be descriptive and detailed).
   Use null for why/how/when/extra if the text does not say it. Never invent facts.
6. Keep math as $…$ or $$…$$.
7. topics: pick 1–2 paths from the topic list below, exactly as written. If none fits, use [] and put a new path
   (at most 3 levels, joined by "/") in suggested_topics.

Topic list:
{topics}
---USER---
Document: {title}
Lines {start}–{end}:

{numbered_lines}
```

### `prompts/cards_retry.md` (user message appended to the same conversation)

```
Your answer had these problems:
{problems}
Return the full list of cards again, fixed.
```

`{problems}` comes from `CheckResult.feedback`, one line per problem. For example: `- Lines 1343–1440 have no card. Add cards for them.` / `- Card "A" description ('what') has 62 words; must be under 50 words.` / `- Cards "A" and "B" share lines 1220–1225.` / `- Card "C" uses line 1512, but this part ends at 1500.` / `- The answer was not valid JSON: <error>.`

### `prompts/merge.md`

```
Two study cards may explain the same idea. Decide.

Card A ({a_source}):
{a_fields}

Card B ({b_source}):
{b_fields}

{overlap_note}
If they explain the same idea: decision = "merge", and write ONE card that keeps every fact from both,
in simple English (fields as in the cards: title, what [brief description < 50 words], why, how, when, extra [descriptive and detailed]; null if unknown).
If they are different ideas, or one is only an example of the other: decision = "separate", other fields null.
reason: one short sentence.
```

`{overlap_note}` is used only for rule-A pairs: `These two cards come from the same document and their lines overlap (A: 1399–1452, B: 1441–1470). This often means one idea was cut in two by a chunk edge.`

`{a_fields}` and `{b_fields}` look like this:

```
title: …
what: …
why: …
how: …
when: …
extra: …
```

It lists all card information fields that are present (`title`, `what`, `why`, `how`, `when`, `extra`), not source lines (R3 = fields).
All card information is fed to the merge LLM so it has the full context to judge whether the two cards describe the same idea and synthesize the merged card, even though only the brief description (`what`) was embedded for candidate retrieval.

---

## 8. Mock model server (`mock/server.py`)

Run it with `rh mock-server --port 8801`. FastAPI. **Deterministic**: the same request always gives the same answer.

| Route | Does |
|---|---|
| `GET /v1/models` | `[mock-cards, mock-embed]` |
| `POST /v1/chat/completions` | reads `response_format.json_schema.name` (LangChain sends the pydantic class name). `ChunkCards` → card answer. `MergeVerdict` → merge answer. `json_mode` or no schema → finds the schema name in the system prompt text. Returns an OpenAI-shaped body with `choices[0].message.content` = JSON string and a `usage` field. |
| `POST /v1/embeddings` | one vector per input, in the OpenAI shape |
| `POST /_mock/faults` | test hook: `{"bad_json": 1, "gap": 2, "http500": 2, …}` = return that fault for the next N matching calls |
| `GET /_mock/calls` | test hook: the list of calls so far (route + schema name) |

**The card answer:**
1. Parse the lines `^(\d{4,})\| (.*)$` from the last user message.
2. Group them into blocks. A block ends at a blank line or before a heading.
3. Join blocks shorter than 5 lines to the next one. Cut blocks longer than 40 lines.
4. Write one card per block:
   - `title` = the first 4 words of its first non-heading line (strip Markdown);
   - `what` = the first sentence (brief description, strictly < 50 words);
   - `why` = `"Needed for " + title + " because it addresses the underlying requirements"` when the block index is even, else null (detailed);
   - `how` = the second sentence or detailed mechanism when present, else null;
   - `when` = null;
   - `extra` = null;
   - lines = the block's first and last line;
   - `topics` = the first topic path from the prompt's "Topic list" whose last part appears in the block (case-insensitive), else `[]` with `suggested_topics = ["Misc/" + first word]`.

**Merge:** `"merge"` if the two titles are equal, ignoring case and spaces, else `"separate"`. The prompt receives all card fields (title, what, why, how, when, extra). When merging: the fields of A, keeping concise `what` (< 50 words), with B's `extra` and details added.

**Embeddings:** tokens = lower-case words of the card's brief description (`{what}`). Vector = the sum of `hash(word) → ±1` over 64 dimensions (seed = sha256 of the word), then normalised. Same words in the description give the same vector, so cards with matching descriptions get very close vectors, and candidate merges happen on purpose.

**Faults:** each changes one answer, so every check path gets tested.

| Fault | What the mock returns |
|---|---|
| `bad_json` | content `"{cards: [oops"` |
| `out_of_range` | the last card's `end_line` + 30 |
| `overlap` | card 2 starts 10 lines inside card 1 |
| `gap` | drops the middle card (gap > 20 lines) |
| `long_description` | card's `what` has > 50 words (tests description word limit check and retry) |
| `small_slip` | end + 2 (must be clamped, no retry) |
| `timeout` | sleep 5 s (tests set timeout 1 s) |
| `http500` | status 500 |

---

## 9. Pipeline in detail

### 9.1 Stages and checkpoints (`pipeline.py`, `workdb.py`)

```python
class Stage(StrEnum):
    QUEUED = "queued"; INGESTED = "ingested"; EXTRACTED = "extracted"
    EMBEDDED = "embedded"; MERGED = "merged"; PUBLISHED = "published"; FAILED = "failed"
```

`WorkDB` = SQLite at `work_dir/work.db`, `PRAGMA journal_mode=WAL`, schema version in `PRAGMA user_version`.

| Table | Columns | Used for |
|---|---|---|
| `jobs` | `sid PK, kind, path, url, stage, attempts, error, created_at, updated_at` | the queue |
| `chunks` | `sid, idx, start, end, own_end, input_hash, ok, tries, result_json, gaps_json, problems_json` — PK `(sid, idx, input_hash)` | resume; cache |
| `raw_cards` | `raw_id PK, sid, start, end, fields_json, chunk_idx, created_at` | what the model wrote, before merge (for split) |
| `card_members` | `card_id, raw_id, pos` — PK `(card_id, raw_id)` | which raw cards make a card |
| `vectors` | `card_id PK, faiss_id, model, dim, text_hash` | embedding cache; index rebuild |
| `merges` | `id, a, b, sim, why, decision, reason, prompt_version, model, created_at` | the verdict cache (the same pair is never asked twice) |
| `never_merge` | `raw_a, raw_b` — PK both | after a split |
| `applied_splits` | `card_id, mark_ts` | apply each split mark once |
| `suggestions` | `id PK, path, card_ids_json, reason, similar_existing, status, created_at` | `status`: open / accepted / renamed / combined / rejected |
| `kv` | `key PK, value` | counters (`next_card`, `next_suggestion`), `links_offset`, `index_model` |

The FAISS index is saved at `work_dir/vectors.faiss` after every change.

### 9.2 `Pipeline.run_queue()` — the order of one `rh ingest` / `rh watch` cycle

1. **Lock.** Take `work_dir/rh.lock` (`fcntl.flock`, non-blocking). If another `rh` is running, print that and exit with code 2.
2. **Ingest all queued jobs** (`run.convert_all_first: true`, so the GPU is not shared with the LLM server):
   - `ingestor_for(ref).ingest(ref, writer)` → stage `INGESTED`.
   - On an error: stage `FAILED` with `error`. Delete `sources/<sid>.tmp/`. Go on with the next job.
3. **Extract, per ingested source:**
   1. `chunks = LineChunker.split(content)`.
   2. For each chunk not yet in `chunks` with the same `input_hash`: `CardExtractor.extract()` (§9.3). Save the result.
   3. `max_parallel` chunks at a time (thread pool).
   4. Then stage `EXTRACTED`.
4. **Make cards** (`cards.py`):
   - each draft → a `raw_cards` row → a new card `c_NNNN` (`kv.next_card`, 4 digits, never reused);
   - `refs = [{source: sid, start, end}]`;
   - `topics` = the draft topics that exist in the tree (others move to `suggested_topics`);
   - `images` = `sources/<sid>/` + every asset whose `line` is in `[start, end]`;
   - `rev = 1`.
5. **Embed** the new cards: embed only the brief description (text from `embeddings.text`, default `"{what}"`) → `vectors` + index → stage `EMBEDDED`.
6. **Merge**: `Merger.run(new_ids)` (§9.4) → stage `MERGED`.
7. **Publish** (§9.6) → stage `PUBLISHED`.
8. Release the lock. Print a short summary (sources, cards, merges, warnings) with `rich`.

Crash anywhere, then run again → each stage asks WorkDB first and skips work that is already done. **Test:** kill the run (raise from inside the 3rd chunk call), run again, and check that the mock got calls only for chunks 3 and later (`GET /_mock/calls`).

### 9.3 `CardExtractor.extract()` — the retry loop

```python
def extract(self, sid, title, lines, chunk, topics) -> ChunkResult:
    key = sha256(chunk_text + prompts.version + llm.model + SCHEMA_VERSION)
    if cached := db.chunk_result(sid, chunk.idx, key): return cached
    system, user = prompts.cards(title, lines, chunk, topics)
    messages = [system, user]
    best = None
    for attempt in range(1, cfg.max_retries + 1):
        try:
            drafts = client.chat_json(ChunkCards, messages).cards
        except LLMFormatError as e:
            messages += [assistant(e.raw), user(prompts.retry([f"The answer was not valid JSON: {e.error}"]))]
            continue
        drafts = repair(drafts, chunk, cfg)           # clamp small slips, trim small overlaps, drop empty
        res = check(drafts, chunk, ignore, cfg)
        best = better(best, res)                      # fewer gap lines wins
        if res.ok: break
        messages += [assistant(json(drafts)), user(prompts.retry(res.feedback_lines))]
    result = ChunkResult(drafts=best.drafts if best else [], tries=attempt, ok=bool(best and best.ok), …)
    db.save_chunk(sid, chunk, key, result)
    return result
```

"Partial accept": after the last try, keep the best answer's cards. Their gaps go to the report.

### 9.4 Checks (`extract/checks.py`, pure — no I/O)

| Check | Rule | Repair in code (no retry) | Otherwise |
|---|---|---|---|
| JSON valid | parsed by pydantic | — | retry with the error |
| Ranges | `chunk.start ≤ start ≤ end ≤ chunk.end` | off by ≤ `clamp_lines` → clamp | retry: "Card X uses line N, but this part is A–B." |
| Overlaps | no two cards share a line | overlap ≤ `trim_overlap_lines` → the later card starts after the earlier one ends | retry: "Cards X and Y share lines a–b." |
| Coverage | the largest run of uncovered **content** lines in `chunk.start … chunk.own_end` is ≤ `max_gap_lines` | — | retry: "Lines a–b have no card. Add cards for them." |
| Description length | `card.what` has < 50 words (`len(card.what.split()) <= cfg.max_description_words`) | — | retry: "Card X description ('what') has N words (limit {limit}). Make it concise (less than {limit} words)." |
| Empty | `title` and `what` not blank | drop the card | — |

"Content line" means not blank, not only a heading, and not inside an `ignore_sections` section. `ignore` = the set of non-content line numbers, computed once per source from the TOC and the lines.

**Description check:** `what` is a brief summary of the core idea and must be small, strictly less than 50 words (`checks.max_description_words`, default 50). If the model writes a description exceeding this limit, the check fails and triggers a retry with feedback. In contrast, `why`, `how`, `when`, and `extra` (additional info) can and should be more descriptive and detailed.

**Worked example** (the same as the design page):
- Chunk = 1201–1500, `own_end` = 1440.
- Try 1: cards 1201–1219, 1220–1238, 1239–1342. The gap is 1343–1440 = 98 lines > 20 → retry.
- Try 2 adds 1343–1398 and 1399–1452 → the largest gap is 0 → ok.

This must be a unit test with exactly these numbers.

**Whole-source report check** (after merge): coverage over the whole source, using all the source's refs. `covered_pct` = covered content lines ÷ content lines × 100. `gaps` = every uncovered run of more than 0 content lines. `ok` = the largest gap ≤ limit.

### 9.5 Merge (`merge/merger.py`, `merge/index.py`)

**VectorIndex:**
- `faiss.IndexIDMap2(faiss.IndexFlatIP(dim))`. The FAISS id = the number in the card id (`c_0005` → 5).
- The vectors are normalised, so inner product = cosine, and the search is exact.
- `upsert` = `remove_ids` then `add_with_ids`.
- If `embeddings.model` or `dim` differ from `kv.index_model`, re-embed every card and rebuild (log a warning).
- **Embeds brief description only:** each card's vector is computed from `embeddings.text` (default `"{what}"`). Embedding only the brief description ensures similarity search groups cards sharing the same core concept, without being skewed by lengthy contextual details in other fields.

**`Merger.candidates(new_ids)`:**
1. For each new card: `search(vec, top_k + 1)`. Keep the others with `sim ≥ threshold` → `Pair(a, b, sim, "similar")`.
2. **Rule A:** for each source touched in this run: all pairs of cards (at least one new) that have refs to that source which overlap or touch (`b.start ≤ a.end + touch_gap_lines`) → `Pair(…, "overlap")`, whatever the similarity.
3. Order each pair so that `a` is the older card (smaller number).
4. Drop never-merge pairs and duplicates.
5. Sort: overlap pairs first, then by `sim`, highest first.

**`Merger.run()` and `judge(pair)`:**
- In `judge(pair)`: builds `{a_fields}` and `{b_fields}` containing **all card information**: `title`, `what` (brief description), `why`, `how`, `when`, and `extra` (additional info). The LLM is fed all card fields so it has full context to evaluate whether the cards describe the same idea.

```python
for pair in pairs:
    pair = resolve(pair)                # if a or b was merged away earlier in this run, use the card it went into
    if pair.a == pair.b or db.is_never_merge(pair.a, pair.b): continue
    v = db.cached_verdict(pair, prompts.version, model) or judge(pair)   # 1 model call with all card fields
    db.log_merge(pair, v)
    if v.decision == "merge": apply(pair, v)
    elif pair.why == "overlap": stats.kept_apart_overlap.append((pair.a, pair.b))
```

**`apply(pair, v)`** — `a` keeps its id:
- `a.title / what / why / how / when / extra` ← the verdict. Merged `what` keeps a concise brief description (< 50 words), while `why / how / when / extra` preserve and synthesize full details from both cards. Empty → keep `a`'s old value for `title` and `what`; the other fields become `None`.
- `a.refs = union_refs(a.refs + b.refs)` (**rule B**).
- `a.images` = `a.images` + `b.images`, no repeats, sorted by (source, line).
- `a.topics` = the union of both.
- `a.rev += 1`; `a.updated_at` = now.
- `card_members[a] += card_members[b]`.
- `retired += {id: b, into: [a]}`.
- Remove `b` from the cards and from the index. Re-embed `a` (embeds updated `a.what`).
- **Do not touch `notes/` or `state/`.** The apps show `b`'s note on `a` (`readNotes` in `@rh/core`), because `retired` says `b → a`.

**`union_refs(refs)`:** sort by (source order of first appearance, start). Join neighbours of the same source when `next.start ≤ prev.end + 1`.

Example: `[s_booka 1399–1452, s_blogb 40–79, s_booka 1441–1470]` → `[s_booka 1399–1470, s_blogb 40–79]`.

**Tests:**
- `union_refs` on the example above;
- two twins from overlapping chunks (the mock gives them equal titles) → merged into one card with the joined range;
- a rule-A pair with different titles → kept apart and listed in the report;
- no chains: A≈B merged, then B≈C → judged as (A, C) with the merged A.

### 9.6 Apply your marks + publish (`decisions.py`, `topics.py`, `contract/writer.py`)

**Read the state:** `StateReader(library).load()` reads every `state/*.json`. It skips `*.tmp` and conflict copies are included (same rules as core).
- `split` per card: the value with the highest `ts` wins.
- `topic_decisions` per suggestion id: the highest `ts` wins.

**Split** (card `X` has `split.v == true`, `split.ts > applied_splits[X]`, and ≥ 2 members):
- Members are sorted by `raw_id`. The first member stays on `X`: `X`'s fields and refs = that raw card, `rev + 1`.
- Every other member → a new card with a new id, made from its raw card, then embedded.
- `never_merge` for every pair of members. Record `applied_splits[X] = ts`.
- No model call.
- The user's state and note stay on `X`. The new cards show as New.

**Topic decisions** (`accept` / `rename` / `combine` / `reject`; the fields are in the state schema):
- `accept` → add `path` to the tree; add it to the suggestion's cards.
- `rename` → the same, with the new `path`.
- `combine` → one path replaces several suggestions: all their cards get it.
- `reject` → `status = rejected`; the same path is never suggested again.
- The tree = `topics.yaml` (**read only**) + `library.json` `topics` + accepted paths. Write it back **only** as `library.json` `topics`.

**New suggestions:**
- Group `suggested_topics` of this run's cards by path. Also add paths that are not valid (more than 3 levels → keep the first 3).
- Skip rejected paths and paths already in the tree.
- `similar_existing` = the closest tree path (`difflib.get_close_matches`, cutoff 0.6).
- `id` = `t_NNNN`. At most `max_suggestions_per_run` new ones.

**Publish** (`LibraryWriter.commit`):
1. `gen = current library.json generation + 1`. For an empty library, the first generation is 1.
2. Write, each atomic (`.tmp`, `fsync`, rename), each validated against its schema first:
   1. `cards.json` (`generation = gen`; `retired` kept and appended; cards sorted by id);
   2. `tag_suggestions.json` (open suggestions only);
   3. `reports/<run_id>.json` and `reports/latest.json`;
   4. **last:** `library.json` (`generation = gen`, `updated_at`, sources, topics).
3. Source entries: `status: "ready"` (failed jobs: `"failed"` with `n_lines: 0`, `n_cards: 0`).
   - `n_cards` = the cards with a ref to it.
   - `pages` = the last page number (pdf).
   - `duration_s` (video).
   - `keywords` = TOC titles of level ≤ 2, at most 10.
4. `run_id` = `r_YYYYMMDD_HHMMSS` (UTC).

Report per source, following `report.schema.json`:

| Field | How it is filled |
|---|---|
| `status` | `ok` / `warning` (any check not ok) / `failed` / `skipped` (already published, nothing to do) |
| `chunks_total`, `chunks_ok`, `retries` | from the extract step |
| `checks` | whole-source results (§9.4) |
| `cards_created`, `cards_merged`, `splits_applied` | from the steps above |
| `overlap_pairs_kept_apart` | **new field (optional)**, added to the schema on 28 Sep |
| `errors` | error messages |

### 9.7 Re-run one source (`rh rerun <sid>`)

The text is not converted again: `content.md` stays.

1. Extract again with the current prompt (a new `input_hash`, so no cache hit).
2. **Match new raw cards to old cards** of this source (`cards.match_by_overlap`): a new raw card matches the old card whose ref to this source overlaps it most, if the overlap is ≥ 50 % of the smaller range.
   - Matched, and the card has only this source → it keeps the id; the fields and the ref come from the new raw card; `rev + 1` if any text changed.
   - Matched, and the card has other sources too (it was merged) → only this source's ref is replaced; the text stays.
   - A new raw card with no match → a new card.
   - An old card with no match → retired `into` the new cards whose ranges overlap it. If none overlap, `into: []` (the schema allows it; the card and its state simply go away).
3. Then embed, merge and publish as usual.

**Test:** re-run the sample with a changed mock title for one block → the same id, `rev 2`, and the state still applies.

### 9.8 Inbox (`intake/watcher.py`)

- `inbox/<file>` (anything except `links.txt` and `*.tmp`): once its size has not changed for `settle_s`:
  1. move it to `work_dir/incoming/<name>` (the inbox empties = the user sees it was taken);
  2. `SourceRef.from_path` → `enqueue`.
- `inbox/links.txt`: read the bytes after `kv.links_offset`. Every line that starts with `http` → `from_url` → `enqueue`. Save the new offset.
  - The apps only append to this file.
  - If the file got shorter (the user cleared it), reset the offset to 0.
- `rh watch`: watchdog on `inbox/`, plus a rescan every `rescan_s`. After each settled batch: `run_queue()`. Ctrl+C stops it cleanly (lock released).

---

## 10. CLI (`cli.py`, typer)

| Command | Does |
|---|---|
| `rh ingest <file|url>...` | enqueue each (a file is copied into `work_dir/incoming/` first), then `run_queue()` |
| `rh ingest --inbox` | scan the inbox once, then `run_queue()` |
| `rh watch` | the inbox loop (§9.8). The user starts it by hand (R5 = manual). |
| `rh rerun <sid>` | §9.7 |
| `rh apply` | only step 9.6 (your marks) + publish. No new sources. |
| `rh report [<sid>]` | print `reports/latest.json` as a table |
| `rh validate` | validate every library file against the schemas and check every card ref is inside its source; exit code 1 on any problem |
| `rh status` | the jobs table (stage, error) |
| `rh mock-server [--port 8801]` | §8 |

The global option `--config PATH`. Exit codes: 0 ok, 1 error, 2 another `rh` is running.

---

## 11. Tests (all run with `uv run pytest`; no network, no GPU)

| Level | Folder | What |
|---|---|---|
| Unit | `tests/unit/` | config; `DocBuilder` maps + anchors (with multi-byte text); `SourceRef` ids + URL normalising; `LineChunker` (no holes, line starts, deterministic); every check + repair (including description word count limit check `max_description_words` and the worked example); `union_refs`; `candidates` rule A; `match_by_overlap`; state merge (the same cases as `packages/core/test/core.test.ts` "merge rules across devices"); `TopicTree` + suggestions; VTT parser (rolling duplicates, `h:mm:ss`) |
| Integration | `tests/integration/` | mock server in a thread: `LLMClient` (all faults, including `long_description` retry); `CardExtractor` retry paths (`gap` → retry → ok; `long_description` → retry → ok; `small_slip` → no retry; `bad_json` ×3 → partial); a full `rh ingest tests/inputs/sample.md` into a temp library; crash + resume; split mark → split applied; topic decision → applied; re-run keeps ids |
| Contract | `tests/contract/` | (1) every file in the temp library validates against `docs/contract/schemas`; (2) **`@rh/core` can read it**: `node tests/contract/check_with_core.ts <library>` opens it, calls `lib.lines()` for every ref, `buildDeepDivePrompt` for every card and `coverage` for every source, and exits 1 on any error. Node 26 runs `.ts` directly; import core from `../../../packages/core/src/index.ts`. |

Put `tests/inputs/sample.md` in the repo: about 300 lines, 3 headings, one image, one `$…$` formula, two paragraphs with the same topic (so a merge happens), and text with `·` and `—`.

---

## 12. Order of work (milestones)

After each one: tests pass, one line in `backend/WORKLOG.md`.

| # | Milestone | Done when |
|---|---|---|
| M0 | scaffold: `pyproject`, `uv sync`, ruff, empty CLI | `uv run rh --help` works |
| M1 | `config.py`, `contract/models.py` | the models load every file in `fixtures/library/` without errors |
| M2 | `LibraryWriter` (atomic, anchors, commit order) + `rh validate` | `rh validate fixtures/library` passes (read-only!) |
| M3 | `WorkDB` | the table tests pass; reopen keeps the data |
| M4 | mock server + `LLMClient` | integration tests for all faults pass |
| M5 | `DocBuilder`, `SourceIngestor`, `MarkdownIngestor` | the sample becomes `content.md` + a valid `meta.json` |
| M6 | `LineChunker`, checks, `CardExtractor`, prompts | the worked example + retry tests pass |
| M7 | cards, `VectorIndex`, `Merger` | the merge tests pass |
| M8 | `StateReader`, `DecisionApplier`, topics, publish, report | the full ingest of the sample validates; core can read it |
| M9 | `BlogIngestor`, `PdfIngestor` (fake engine), `YouTubeIngestor` (mocked yt-dlp) | their unit tests pass |
| M10 | `InboxWatcher`, `rh watch`, lock, resume test | a crash + resume only re-does the unfinished chunks |
| M11 | `README.md`: install on the GPU machine (uv, deno, CUDA extras), config, every command, how to point it at the real endpoint | the user can follow it |

**Stop after M11.** Report to the main session:
- test counts;
- what was not run: marker, yt-dlp and Whisper for real;
- the list of things to try on the GPU machine with the real endpoint:
  1. `rh ingest` one short PDF;
  2. one blog link;
  3. one YouTube link;
  4. `rh report`.

---

## 13. Pitfalls

- **`check_embedding_ctx_length=False`** on `OpenAIEmbeddings`. Without it, LangChain sends token ids, and non-OpenAI servers fail.
- **Embedding brief description vs Merge inputs:** Embeddings for similarity check encode only the brief description (`what`, text from `embeddings.text: "{what}"`). Do not embed the whole card. But when evaluating candidates in merge, feed all card fields (`title`, `what`, `why`, `how`, `when`, `extra`) to the merge LLM so it has the complete context. Check that `what` stays concise (< 50 words via `checks.max_description_words`), while other fields can be descriptive and detailed.
- **Strict JSON schema:** optional fields must be required + nullable (`str | None` with no default). Otherwise strict mode rejects the schema.
- Some local servers only half-support `json_schema`. That is why `structured_method` is in the config. Always keep `include_raw=True`, so a bad answer becomes retry feedback, not a crash.
- Thinking models may put text before the JSON. Use `extra_body` to turn thinking off, or `json_mode`.
- **Line numbers are 1-based and inclusive everywhere.** Python slices are 0-based and exclusive: `lines[start-1:end]`.
- **Bytes, not characters,** for anchors (`len(line.encode())`).
- `content.md` is never rewritten. Nothing in the backend writes `notes/`, `state/`, `inbox/` (except moving files out of it) or `topics.yaml`.
- `library.json` is always last. A crash before it means the apps still see the old, consistent library.
- Never write into `fixtures/library/`. Tests use `tmp_path` copies.
- Marker and the LLM server share the GPU. `convert_all_first: true` runs them one after the other.
