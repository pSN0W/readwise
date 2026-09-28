from datetime import UTC, datetime
from pathlib import Path

import yaml
from typer.testing import CliRunner

from rh_ingest.cli import app
from rh_ingest.contract.models import (
    CheckStatus,
    CoverageCheckStatus,
    IngestReport,
    ReportSource,
    SourceChecks,
)
from rh_ingest.lock import FileLock
from rh_ingest.workdb import Stage, WorkDB

runner = CliRunner()


def test_cli_help():
    res = runner.invoke(app, ["--help"])
    assert res.exit_code == 0
    assert "Reading Helper backend ingest tool" in res.stdout
    assert "ingest" in res.stdout
    assert "validate" in res.stdout
    assert "status" in res.stdout


def test_cli_validate(tmp_path: Path):
    lib_dir = Path(__file__).resolve().parents[3] / "fixtures" / "library"
    assert lib_dir.exists()

    res = runner.invoke(app, ["validate", str(lib_dir)])
    assert res.exit_code == 0
    assert "valid" in res.stdout

    # Invalid directory
    bad_dir = tmp_path / "bad_lib"
    bad_dir.mkdir()
    res_bad = runner.invoke(app, ["validate", str(bad_dir)])
    assert res_bad.exit_code == 1
    assert "Validation error" in res_bad.stdout


def test_cli_status(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    lib_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        yaml.dump(
            {
                "library_dir": str(lib_dir),
                "work_dir": str(work_dir),
            }
        ),
        encoding="utf-8",
    )

    # Empty DB
    res_empty = runner.invoke(app, ["-c", str(config_path), "status"])
    assert res_empty.exit_code == 0
    assert "No jobs found" in res_empty.stdout

    # Add a job to WorkDB
    db = WorkDB(work_dir / "work.db")
    db.add_job("s_test01", kind="markdown", path="/tmp/test.md", stage=Stage.QUEUED)

    res_jobs = runner.invoke(app, ["-c", str(config_path), "status"])
    assert res_jobs.exit_code == 0
    assert "s_test01" in res_jobs.stdout
    assert "queued" in res_jobs.stdout


def test_cli_report(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    lib_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        yaml.dump(
            {
                "library_dir": str(lib_dir),
                "work_dir": str(work_dir),
            }
        ),
        encoding="utf-8",
    )

    # No report yet
    res_no_rep = runner.invoke(app, ["-c", str(config_path), "report"])
    assert res_no_rep.exit_code == 0
    assert "No latest report found" in res_no_rep.stdout

    # Create dummy latest.json
    rep_dir = lib_dir / "reports"
    rep_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    rep_obj = IngestReport(
        schema_version=1,
        run_id="r_20260928_120000",
        started_at=now,
        finished_at=now,
        sources=[
            ReportSource(
                source="s_abc123",
                title="Test Article",
                status="ok",
                chunks_total=2,
                chunks_ok=2,
                retries=0,
                checks=SourceChecks(
                    json_valid=CheckStatus(ok=True),
                    ranges=CheckStatus(ok=True),
                    overlaps=CheckStatus(ok=True),
                    coverage=CoverageCheckStatus(ok=True, covered_pct=100.0, limit=20, gaps=[]),
                ),
                cards_created=5,
                cards_merged=1,
                splits_applied=0,
            )
        ],
    )
    (rep_dir / "latest.json").write_text(rep_obj.model_dump_json(indent=2), encoding="utf-8")

    res_rep = runner.invoke(app, ["-c", str(config_path), "report"])
    assert res_rep.exit_code == 0
    assert "s_abc123" in res_rep.stdout
    assert "Test Article" in res_rep.stdout

    # Filter by specific sid
    res_sid = runner.invoke(app, ["-c", str(config_path), "report", "s_abc123"])
    assert res_sid.exit_code == 0
    assert "s_abc123" in res_sid.stdout

    res_sid_missing = runner.invoke(app, ["-c", str(config_path), "report", "s_unknown"])
    assert res_sid_missing.exit_code == 0
    assert "not found in latest report" in res_sid_missing.stdout


def test_cli_lock_conflict_exit_code_2(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    lib_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        yaml.dump(
            {
                "library_dir": str(lib_dir),
                "work_dir": str(work_dir),
            }
        ),
        encoding="utf-8",
    )

    lock_file = work_dir / "rh.lock"
    # Acquire lock in this process
    with FileLock(lock_file):
        # Run rh ingest, should hit LockError and exit with code 2
        res = runner.invoke(app, ["-c", str(config_path), "ingest", "--inbox"])
        assert res.exit_code == 2
        assert "Lock error" in res.stdout
