import subprocess
from pathlib import Path

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


def test_pipeline_end_to_end(mock_server: str, tmp_path: Path):
    lib_dir = tmp_path / "library"
    lib_dir.mkdir(parents=True, exist_ok=True)

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_seconds=5.0,
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    work_dir = tmp_path / "work"
    cfg = Settings(
        library_dir=lib_dir,
        work_dir=work_dir,
        llm=llm_cfg,
        embeddings=emb_cfg,
        chunking=ChunkSettings(target_lines=150, overlap_lines=20),
        checks=CheckSettings(max_gap_lines=50, max_description_words=50, max_retries=3),
        merge=MergeSettings(threshold=0.8, top_k=5, overlap_always_judge=True, touch_gap_lines=0),
    )

    sample_md = Path(__file__).resolve().parents[1] / "inputs" / "sample.md"
    assert sample_md.exists()

    # 1. Ingest markdown source
    ref = SourceRef.from_path(sample_md, kind_hint="markdown")
    from rh_ingest.ingest.base import ingestor_for

    ingestor = ingestor_for(ref, cfg)
    from rh_ingest.contract.writer import LibraryWriter

    writer = LibraryWriter(lib_dir)
    meta = ingestor.ingest(ref, writer)
    sid = ref.sid
    content_lines = (
        (lib_dir / "sources" / sid / "content.md").read_text(encoding="utf-8").splitlines()
    )

    # 2. Run pipeline ingest
    pipeline = Pipeline(lib_dir, cfg)
    rep_src = pipeline.ingest_source(sid=sid, meta=meta, lines=content_lines)

    assert rep_src.status in ("ok", "warning")
    assert rep_src.cards_created > 0
    assert rep_src.chunks_ok == rep_src.chunks_total

    # 3. Validate library contract with Python validator
    errors = validate_library(lib_dir)
    assert errors == [], f"Validation errors: {errors}"

    # 4. Verify with @rh/core via check_with_core.ts
    check_script = Path(__file__).resolve().parents[1] / "contract" / "check_with_core.ts"
    proc = subprocess.run(
        ["node", str(check_script), str(lib_dir)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        f"check_with_core failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    )
    assert "OK: verified library" in proc.stdout

    # 5. Test rerun of the source
    pipeline_rerun = Pipeline(lib_dir, cfg)
    rep_rerun = pipeline_rerun.rerun_source(sid=sid)
    assert rep_rerun.status in ("ok", "warning")

    # Re-validate with Python validator and check_with_core
    errors_rerun = validate_library(lib_dir)
    assert errors_rerun == [], f"Validation errors after rerun: {errors_rerun}"

    proc_rerun = subprocess.run(
        ["node", str(check_script), str(lib_dir)],
        capture_output=True,
        text=True,
    )
    assert proc_rerun.returncode == 0, (
        f"check_with_core failed after rerun:\nSTDOUT:\n{proc_rerun.stdout}\nSTDERR:\n{proc_rerun.stderr}"
    )
