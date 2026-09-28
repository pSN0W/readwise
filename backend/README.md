# Reading Helper — Backend Ingestion Engine (`rh`)

The `rh` ingestion backend runs on the dedicated GPU host to process raw study materials (Markdown files, PDFs, Web blogs, and YouTube videos), extract atomic knowledge cards using structured LLM outputs, deduplicate and merge cards across sources with vector similarity and LLM adjudication, organize topic hierarchies, and publish verified updates atomically to the shared Reading Helper library contract.

---

## Key Features & Architecture

1. **Deterministic Multi-Source Ingestion:**
   - **Markdown:** Direct heading hierarchy extraction, image asset bundling, and anchor indexing.
   - **Web / Blog:** Article extraction via `trafilatura` with local asset preservation.
   - **PDF:** Configurable extraction engines via `PdfEngine` protocol (`marker-pdf` with OCR and `pymupdf4llm`), preserving page mappings.
   - **YouTube / Video:** WebVTT subtitle streaming, automatic chapter TOC generation, and rolling duplicate caption deduplication.

2. **Card Extraction with Validation and Retries:**
   - **Concise Brief Descriptions:** Card `what` description is constrained to < 50 words (`checks.max_description_words: 50`). If exceeded, extractor retries with structured LLM feedback.
   - **Detailed Synthesized Fields:** `why`, `how`, `when`, and `extra` are encouraged to provide rich, descriptive, and actionable explanations.
   - **Gap & Overlap Repair:** Automatic clamping of small line slips and trimming of small overlaps; gaps larger than `checks.max_gap_lines` trigger validation retries with partial fallback acceptance.

3. **Hybrid Embedding & Merge Engine:**
   - **Brief Description Embeddings:** Embeds only the concise description (`{what}`), keeping vector representations focused and avoiding semantic dilution.
   - **Full-Context LLM Merge Judge:** When candidates meet cosine similarity thresholds or overlap in source lines, the LLM merge judge evaluates the complete context (`title`, `what`, `why`, `how`, `when`, `extra`) to produce synthesized merged cards.
   - **Merge Guardrails:** Member tracking (`raw_cards`, `card_members`), `never_merge` constraints from user splits, single-source touching restrictions, and no-chains multi-pair resolution.

4. **Multi-Device State Synchronization & Decisions:**
   - Reads user splits and topic decisions across devices (`library/state/*.json`) using Last-Write-Wins (LWW) conflict resolution.
   - Preserves user edits across re-runs and re-ingestions.

5. **Crash-Resilient Pipeline (`work.db` SQLite WAL):**
   - Resumable pipeline stages: `QUEUED` → `INGESTED` → `EXTRACTED` → `EMBEDDED` → `MERGED` → `PUBLISHED`.
   - Chunk-level caching in `WorkDB`: crashes during extraction skip already completed chunks upon resume.
   - Cross-process concurrency control with `FileLock` (`rh.lock`) exiting with code 2 on collision.

---

## Directory Structure

```
backend/
├── pyproject.toml              # Dependencies and CLI entrypoint (rh)
├── src/rh_ingest/
│   ├── cli.py                  # Typer CLI application
│   ├── config.py               # Pydantic Settings and YAML loader
│   ├── lock.py                 # Cross-process non-blocking flock
│   ├── workdb.py               # SQLite WAL database (jobs, chunks, vectors, merges)
│   ├── cards.py                # Card models, overlap calculations, matching
│   ├── chunk.py                # LineChunker for token-based windowing
│   ├── pipeline.py             # Core pipeline (run_queue, rerun_source, apply)
│   ├── topics.py               # TopicTree, tag suggestions, fuzzy matching
│   ├── decisions.py            # Device state decision applier (splits, never_merge)
│   ├── contract/
│   │   ├── models.py           # Contract schema models (Card, Source, Report)
│   │   ├── writer.py           # Atomic writer with fsync and rename
│   │   ├── validate.py         # Pure-Python contract validator
│   │   └── state.py            # StateReader and MergedState
│   ├── extract/
│   │   ├── extractor.py        # CardExtractor with retry loop
│   │   └── checks.py           # Pure line-range, gap, and word count checks
│   ├── ingest/
│   │   ├── base.py             # DocBuilder, SourceIngestor base, registry
│   │   ├── markdown.py         # Markdown ingestor
│   │   ├── blog.py             # Blog ingestor (trafilatura)
│   │   ├── pdf.py              # PDF ingestor (marker / pymupdf4llm)
│   │   └── youtube.py          # YouTube WebVTT ingestor with deduplication
│   ├── intake/
│   │   ├── refs.py             # SourceRef and URL normalization
│   │   └── watcher.py          # InboxWatcher with settling detection
│   ├── llm/
│   │   ├── client.py           # OpenAI-compatible client with retry & faults
│   │   ├── prompts.py          # Prompt templates for cards, retry, and merge
│   │   └── schemas.py          # Pydantic structured output models
│   └── mock/
│       └── server.py           # Deterministic FastAPI mock model server
└── tests/                      # Unit, integration, and contract tests
```

---

## CLI Reference

Run `rh --help` or `uv run rh <command>`:

```bash
# Ingest specific files or URLs:
uv run rh ingest article.pdf https://example.com/blog-post

# Ingest all settled items from library/inbox/:
uv run rh ingest --inbox

# Run watch daemon on library/inbox/ and inbox/links.txt:
uv run rh watch

# Re-run extraction and merging for an existing source:
uv run rh rerun s_3a8b2c1d90

# Apply user splits / topic decisions from library/state/ and republish:
uv run rh apply

# Show latest ingest report table:
uv run rh report [optional_sid]

# Validate library schemas and reference ranges:
uv run rh validate [/path/to/library]

# Show status of all jobs in work.db:
uv run rh status

# Launch local deterministic mock model server for testing/development:
uv run rh mock-server --port 8801

# Inspect and test model output on a content file:
uv run rh test-model samples/sample_notes.md

# Compare multiple models side-by-side:
uv run rh test-model samples/sample_notes.md --model gpt-4o-mini,gpt-4o

# Test with custom endpoint (e.g. local Ollama or vLLM) and temperatures:
uv run rh test-model samples/sample_notes.md --base-url http://localhost:11434/v1 -m llama3.2 -t 0.0 -t 0.7

# Run via standalone script:
uv run python scripts/test_model.py samples/sample_notes.md --output results.json
```

### Exit Codes:
- `0`: Success
- `1`: Validation error, missing file, or extraction failure
- `2`: Lock error (`rh.lock` is currently held by another running process)

---

## Configuration

Configuration is loaded from `~/.config/reading-helper/config.yaml` or specified via `--config /path/to/config.yaml` (or `RH_CONFIG` environment variable).

Example configuration:

```yaml
library_dir: "/data/Sync/library"
work_dir: "/data/reading-helper-work"

llm:
  base_url: "http://127.0.0.1:8801/v1"
  api_key: "dev"
  model: "qwen-2.5-72b-instruct"
  timeout_s: 180.0
  max_parallel: 2

embeddings:
  base_url: "http://127.0.0.1:8801/v1"
  api_key: "dev"
  model: "text-embedding-3-small"
  dim: 64
  text: "{what}"

chunking:
  max_tokens: 4000
  overlap: 0.20

checks:
  max_gap_lines: 20
  max_description_words: 50
  max_retries: 3
  clamp_lines: 3
  trim_overlap_lines: 3

merge:
  threshold: 0.80
  top_k: 5
  overlap_always_judge: true
  touch_gap_lines: 1

watch:
  settle_s: 5.0
  rescan_s: 60.0
```

---

## Running Tests

All unit, integration, and contract tests are 100% deterministic, require zero GPU, and run with zero external network access:

```bash
cd backend
uv run pytest
```

Linting and formatting:
```bash
uv run ruff check .
uv run ruff format .
```
