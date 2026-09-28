# Backend Worklog

## Status
- **Current Milestone:** All Milestones (M0 - M11) Completed
- **Status:** Complete

## Completed
- Reviewed Ticket 03 specifications, schemas, contract README, and decisions.
- [M0] Scaffolded backend package: `pyproject.toml`, `.python-version`, `uv sync`, CLI stub, and smoke test passing.
- [M1] `config.py` and `contract/models.py` implemented; all files in `fixtures/library/` load cleanly without errors.
- [M2] `LibraryWriter` (atomic writes, anchor calculations, commit order) and `rh validate` implemented; `fixtures/library/` passes validation cleanly.
- [M3] `WorkDB` SQLite WAL persistence implemented with full table coverage, counters, caching, and reopen persistence verified.
- [M4] Mock model server (`mock/server.py`) and `LLMClient` implemented; integration tests passing for structured outputs, retries on 500, bad JSON formatting error, and embedding normalization & similarity.
- [M5] Ingestion architecture: `DocBuilder`, `SourceIngestor`, and `MarkdownIngestor` implemented; `sample.md` successfully ingested into `content.md` and valid `meta.json`.
- [M6] `LineChunker`, checks, `CardExtractor`, prompts implemented; worked example and retry tests (`gap`, `long_description`, `small_slip`, `bad_json`) passing.
- [M7] `cards.py`, `VectorIndex` (FAISS inner product cosine search with brief description embedding), and `Merger` (Rule A overlap/touch, similarity search, `union_refs`, never-merge filtering, no-chains resolution) implemented and verified with unit tests.
- [M8] `StateReader` (LWW resolution for `split` and `topic_decisions`), `TopicTree` (loading from `topics.yaml` & `library.json`, applying decisions, generating suggestions with similarity matching), `DecisionApplier` (splitting cards with >= 2 members, updating raw card links, `never_merge`), `Pipeline` (end-to-end ingest & rerun flow with report generation and atomic commit), verified with unit tests, end-to-end integration test, and `@rh/core` TypeScript verification via `check_with_core.ts`.
- [M9] `BlogIngestor` (trafilatura markdown extraction and image fetching), `PdfIngestor` (`PdfEngine` protocol with `PageMd`, `FakeEngine` for unit tests, `PyMuPdfEngine`, `MarkerEngine`), and `YouTubeIngestor` (WebVTT subtitle parser, rolling duplicates deduplication, and chapter headings), verified with unit tests.
- [M10] `FileLock` (`fcntl.flock` cross-process mutual exclusion with exit code 2 handling), `InboxWatcher` (settling detection for files and incremental `links.txt` polling), `Pipeline.run_queue()` (`convert_all_first`, parallel chunk extraction, cards creation, embedding, merging, publishing), verified with `test_watcher_and_lock.py` and `test_resume.py` (simulated crash on chunk 3, resumed run skipping cached chunks).
- [M11] Typer CLI commands (`rh ingest`, `rh ingest --inbox`, `rh watch`, `rh rerun`, `rh apply`, `rh report`, `rh validate`, `rh status`, `rh mock-server`), comprehensive documentation in `backend/README.md`, verified with `test_cli.py` and full ruff check/format.

## Next Steps
- Backend ingestion engine implementation is complete and verified across all milestones.


## Open Questions
- None.
