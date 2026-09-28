from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from rh_ingest.config import (
    CheckSettings,
    ChunkSettings,
    EmbedSettings,
    LLMSettings,
    MergeSettings,
    Settings,
)
from rh_ingest.contract.validate import validate_library
from rh_ingest.intake.refs import SourceRef
from rh_ingest.pipeline import Pipeline
from rh_ingest.workdb import Stage


def test_resume_skips_cached_chunks(mock_server: str, tmp_path: Path):
    # 1. Reset mock server
    httpx.post(f"{mock_server}/_mock/reset")

    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    lib_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_s=5.0,
        max_parallel=1,  # Sequential so chunk 1, 2 run before 3
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    cfg = Settings(
        library_dir=lib_dir,
        work_dir=work_dir,
        llm=llm_cfg,
        embeddings=emb_cfg,
        chunking=ChunkSettings(max_tokens=60, overlap=0.1),
        checks=CheckSettings(max_gap_lines=50, max_description_words=50, max_retries=1),
        merge=MergeSettings(threshold=0.8, top_k=5, overlap_always_judge=True, touch_gap_lines=0),
    )

    # 2. Create a test markdown file with ~100 lines to produce >= 3 chunks
    doc_lines = ["# Title of Document", ""]
    for section_idx in range(1, 5):
        doc_lines.append(f"## Section {section_idx}")
        for p in range(1, 15):
            doc_lines.append(
                f"This is paragraph {p} in section {section_idx} explaining concept {section_idx}."
            )
        doc_lines.append("")

    doc_file = work_dir / "sample.md"
    doc_file.write_text("\n".join(doc_lines), encoding="utf-8")

    # 3. Initialize pipeline and enqueue job
    pipeline1 = Pipeline(lib_dir, cfg)
    ref = SourceRef.from_path(doc_file, kind_hint="markdown")
    pipeline1.db.add_job(
        sid=ref.sid,
        kind="markdown",
        path=str(doc_file),
        url=None,
        stage=Stage.QUEUED,
    )

    # 4. Inject a crash when extracting chunk 3
    orig_extract = pipeline1.extractor.extract

    def failing_extract(*args, **kwargs):
        chunk = kwargs.get("chunk") or args[3]
        if chunk.idx == 3:
            raise RuntimeError("Crash on chunk 3 for test_resume")
        return orig_extract(*args, **kwargs)

    pipeline1.extractor.extract = failing_extract

    with pytest.raises(RuntimeError, match="Crash on chunk 3"):
        pipeline1.run_queue()

    # Verify that chunk 1 and 2 were cached in WorkDB
    rows = pipeline1.db.conn.execute(
        "SELECT idx, ok FROM chunks WHERE sid = ?", (ref.sid,)
    ).fetchall()
    saved_chunk_indices = [r["idx"] for r in rows]
    assert 1 in saved_chunk_indices
    assert 2 in saved_chunk_indices
    assert 3 not in saved_chunk_indices

    # Verify job is still at INGESTED stage
    job = pipeline1.db.get_job(ref.sid)
    assert job["stage"] == Stage.INGESTED

    # 5. Clear mock server calls before resuming
    httpx.post(f"{mock_server}/_mock/reset")

    # 6. Resume pipeline in a new instance (simulating restart after crash)
    pipeline2 = Pipeline(lib_dir, cfg)
    reports = pipeline2.run_queue()

    assert len(reports) == 1
    assert reports[0].source == ref.sid
    assert reports[0].status in ("ok", "warning")

    # 7. Check calls made to mock server in the resumed run
    calls_resp = httpx.get(f"{mock_server}/_mock/calls").json()
    calls = calls_resp.get("calls", [])

    # Filter for chat completions
    chat_calls = [c for c in calls if c.get("route") == "/v1/chat/completions"]

    # Verify that in chat_calls, no message contains "Section 1" from chunk 1
    for call in chat_calls:
        user_msgs = [
            m.get("content", "")
            for m in call.get("data", {}).get("messages", [])
            if m.get("role") == "user"
        ]
        user_text = "\n".join(user_msgs)
        # If this call was for ChunkCards extraction, verify it was NOT for chunk 1
        if "ChunkCards" in user_text or "numbered_lines" in user_text or "Lines " in user_text:
            assert "## Section 1" not in user_text, (
                "Chunk 1 was re-extracted despite being cached in DB!"
            )

    # 8. Verify library is valid
    errs = validate_library(lib_dir)
    assert errs == []
