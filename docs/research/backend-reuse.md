# Backend reuse research (27 Sep 2026)

Done by a research agent. [V] = checked on a web page that day. [U] = the agent's own reading; verify before depending on it.

| Need | Pick | Why / notes |
|---|---|---|
| PDF → Markdown (math) | **marker-pdf 2.x** (code Apache-2.0; weights modified OpenRAIL-M: free for personal use / orgs < $5M) [V] | Best LaTeX. JSON has page_id + bbox per block; `--paginate_output` puts page separators in the Markdown [V]. GPU. |
| PDF fast path (prose) | **pymupdf4llm** (AGPL-3.0) [V] | `page_chunks=True` gives one dict per page → easiest line→page map. Weak math. Optional extra. |
| PDF alternative | docling (MIT) [V] | Clean provenance model; formula enrichment slower. Keep behind the converter interface. |
| Blog → Markdown | **trafilatura 2.2** (Apache-2.0) [V] | `include_images=True, output_format="markdown"` keeps `![]()` in place; download images ourselves with httpx. defuddle (JS) as fallback. |
| YouTube | **yt-dlp** Python API, VTT subtitles + `info["chapters"]` [V] | Needs a JS runtime (deno) + yt-dlp-ejs since late 2025; PO-token plugin `bgutil-ytdlp-pot-provider` if blocked [V]. Update often. |
| ASR fallback | **faster-whisper 1.2** large-v3-turbo (MIT) [V] | GPU. |
| Slide frames | **PySceneDetect 0.7** + **imagehash** phash [V] | Download a ≤480p video-only stream to temp, detect, keep frames, delete video. |
| Structured output | plain **openai** SDK, `response_format={"type":"json_schema",...,"strict":true}` + pydantic validate + own retry loop | vLLM, SGLang, llama.cpp support json_schema [V]; **Ollama /v1 json_schema unconfirmed** [U] → test early. Keep schema flat, no `$ref`. |
| Chunking | **own ~60-line line chunker** | Token budget, cut at headings/blank lines, 20% overlap, number lines in the prompt (`0042| …`). |
| Vector search | **numpy brute force**, float16 vectors in SQLite blobs | 200k × 1024 × 2 B ≈ 400 MB; seconds for all-pairs. sqlite-vec optional. |
| Watcher / queue / resume | **watchdog** + **one SQLite (WAL) work DB**: jobs + chunk checkpoints keyed by input hash | Idempotent resume for free. |
| Mock LLM server | **own FastAPI mock** (~150 lines) + **respx** for unit tests | No existing mock does json_schema + embeddings deterministically [V]. |
| Patterns to borrow | llm-wiki-compiler (MIT): line-range citations + lint; LightRAG (MIT): merge = collect pieces, summarise with LLM, keep source ids | Nobody does kNN → LLM judge → merged card; we write it. nashsu/llm_wiki is GPL: ideas only. |
| Tooling | uv, ruff, pytest, pydantic v2 + pydantic-settings, typer, httpx, rich | |

## Top risks

1. YouTube access breaks (JS runtime, PO tokens, yt-dlp churn). Keep ASR fallback working.
2. Structured-output differences between servers (Ollama, llama.cpp limits, thinking models add text). Minimal schema, always validate.
3. Line→page map drift. Build it from our own page-by-page join; test lines against PDF text.
4. Marker weights licence and VRAM shared with the LLM server. Run converter and LLM one after the other.
5. Small local models fail coverage/overlap checks in a loop. Cap retries; accept partially; repair small gaps/overlaps in code.
