import json
import shutil
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.console import Console
from rich.table import Table

from rh_ingest.config import Settings
from rh_ingest.contract.models import IngestReport
from rh_ingest.contract.validate import validate_library
from rh_ingest.intake.refs import SourceRef
from rh_ingest.intake.watcher import InboxWatcher, guess_kind_from_path
from rh_ingest.lock import FileLock, LockError
from rh_ingest.pipeline import Pipeline
from rh_ingest.workdb import Stage

app = typer.Typer(
    name="rh",
    help="Reading Helper backend ingest tool",
    no_args_is_help=True,
)

state: dict[str, Any] = {}


def get_settings() -> Settings:
    return Settings.load(state.get("config_path"))


def get_pipeline() -> Pipeline:
    cfg = get_settings()
    return Pipeline(cfg.library_dir, cfg)


@app.callback()
def main(
    config: Annotated[
        Path | None,
        typer.Option("--config", "-c", help="Path to config.yaml"),
    ] = None,
):
    """Global options callback."""
    state["config_path"] = config


@app.command()
def ingest(
    inputs: Annotated[
        list[str] | None,
        typer.Argument(help="File paths or URLs to ingest"),
    ] = None,
    inbox: Annotated[
        bool,
        typer.Option("--inbox", help="Scan inbox/ folder and ingest all new items"),
    ] = False,
):
    """Ingest new sources, extract cards, merge, and publish."""
    console = Console()
    try:
        cfg = get_settings()
        pipeline = Pipeline(cfg.library_dir, cfg)
        incoming_dir = cfg.work_dir / "incoming"
        incoming_dir.mkdir(parents=True, exist_ok=True)

        if inputs:
            for item in inputs:
                item_str = str(item).strip()
                if item_str.startswith("http://") or item_str.startswith("https://"):
                    lower = item_str.lower()
                    kind = "video" if ("youtube.com" in lower or "youtu.be" in lower) else "blog"
                    ref = SourceRef.from_url(item_str, kind_hint=kind)
                    pipeline.db.add_job(
                        sid=ref.sid,
                        kind=kind,
                        path=None,
                        url=ref.url,
                        stage=Stage.QUEUED,
                    )
                    console.print(f"[green]Enqueued URL:[/green] {item_str} ({ref.sid})")
                else:
                    src_path = Path(item_str).resolve()
                    if not src_path.exists():
                        console.print(f"[bold red]File not found:[/bold red] {src_path}")
                        raise typer.Exit(code=1)
                    dest = incoming_dir / src_path.name
                    shutil.copy2(src_path, dest)
                    kind = guess_kind_from_path(dest)
                    ref = SourceRef.from_path(dest, kind_hint=kind)
                    pipeline.db.add_job(
                        sid=ref.sid,
                        kind=kind,
                        path=str(dest),
                        url=None,
                        stage=Stage.QUEUED,
                    )
                    console.print(f"[green]Enqueued file:[/green] {dest.name} ({ref.sid})")

        if inbox:
            watcher = InboxWatcher(
                cfg.library_dir, cfg.work_dir, pipeline.db, settle_s=cfg.watch.settle_s
            )
            new_refs = watcher.scan_once()
            console.print(f"[cyan]Scanned inbox: found {len(new_refs)} new item(s).[/cyan]")

        pipeline.run_queue()
    except LockError as e:
        console.print(f"[bold red]Lock error:[/bold red] {e}")
        raise typer.Exit(code=2)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command()
def watch():
    """Watch inbox/ for new files and links."""
    console = Console()
    try:
        cfg = get_settings()
        pipeline = Pipeline(cfg.library_dir, cfg)
        watcher = InboxWatcher(
            cfg.library_dir, cfg.work_dir, pipeline.db, settle_s=cfg.watch.settle_s
        )
        watcher.watch(pipeline, rescan_s=cfg.watch.rescan_s)
    except LockError as e:
        console.print(f"[bold red]Lock error:[/bold red] {e}")
        raise typer.Exit(code=2)
    except KeyboardInterrupt:
        console.print("[yellow]Watch stopped cleanly.[/yellow]")
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command()
def rerun(
    sid: Annotated[str, typer.Argument(help="Source ID to re-run")],
):
    """Re-run extraction and merging for an existing source."""
    console = Console()
    try:
        cfg = get_settings()
        pipeline = Pipeline(cfg.library_dir, cfg)
        lock_path = cfg.work_dir / cfg.run.lock_file
        with FileLock(lock_path):
            rep = pipeline.rerun_source(sid)
            console.print(
                f"[bold green]✓ Re-run completed for {sid}: status={rep.status}, cards={rep.cards_created}, merged={rep.cards_merged}[/bold green]"
            )
    except LockError as e:
        console.print(f"[bold red]Lock error:[/bold red] {e}")
        raise typer.Exit(code=2)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command()
def apply():
    """Apply device marks (splits and topic decisions) and republish."""
    console = Console()
    try:
        cfg = get_settings()
        pipeline = Pipeline(cfg.library_dir, cfg)
        pipeline.apply_decisions()
        console.print(
            "[bold green]✓ Applied device state decisions and republished library.[/bold green]"
        )
    except LockError as e:
        console.print(f"[bold red]Lock error:[/bold red] {e}")
        raise typer.Exit(code=2)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command()
def report(
    sid: Annotated[str | None, typer.Argument(help="Optional source ID")] = None,
):
    """Show the latest ingest report or report for a specific source."""
    console = Console()
    try:
        cfg = get_settings()
        report_path = cfg.library_dir / "reports" / "latest.json"
        if not report_path.exists():
            console.print(f"[yellow]No latest report found at {report_path}[/yellow]")
            return

        data = json.loads(report_path.read_text(encoding="utf-8"))
        ingest_rep = IngestReport.model_validate(data)

        sources = ingest_rep.sources
        if sid:
            sources = [s for s in sources if s.source == sid]
            if not sources:
                console.print(
                    f"[yellow]Source {sid} not found in latest report ({ingest_rep.run_id}).[/yellow]"
                )
                return

        table = Table(
            title=f"Ingest Report: {ingest_rep.run_id} ({ingest_rep.started_at.strftime('%Y-%m-%d %H:%M:%S')})"
        )
        table.add_column("Source", style="cyan")
        table.add_column("Title")
        table.add_column("Status")
        table.add_column("Chunks", justify="right")
        table.add_column("Cards", justify="right")
        table.add_column("Merged", justify="right")
        table.add_column("Splits", justify="right")

        for s in sources:
            st_color = "green" if s.status == "ok" else "yellow"
            table.add_row(
                s.source,
                s.title[:35],
                f"[{st_color}]{s.status}[/{st_color}]",
                f"{s.chunks_ok}/{s.chunks_total}",
                str(s.cards_created),
                str(s.cards_merged),
                str(s.splits_applied),
            )
        console.print(table)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command()
def validate(
    library_dir: Annotated[
        Path | None, typer.Argument(help="Library directory to validate")
    ] = None,
):
    """Validate library schema integrity and ref ranges."""
    console = Console()
    target_dir = library_dir
    if target_dir is None:
        cfg = get_settings()
        target_dir = cfg.library_dir

    errors = validate_library(target_dir)
    if errors:
        for err in errors:
            console.print(f"[bold red]Validation error:[/bold red] {err}")
        raise typer.Exit(code=1)

    console.print(f"[bold green]✓ Library at {target_dir} is valid.[/bold green]")


@app.command()
def status():
    """Show status of jobs in workdb."""
    console = Console()
    try:
        cfg = get_settings()
        pipeline = Pipeline(cfg.library_dir, cfg)
        jobs = pipeline.db.list_jobs()
        if not jobs:
            console.print("[cyan]No jobs found in WorkDB.[/cyan]")
            return

        table = Table(title="WorkDB Jobs Status")
        table.add_column("SID", style="cyan")
        table.add_column("Kind")
        table.add_column("Stage")
        table.add_column("Attempts", justify="right")
        table.add_column("Target / URL")
        table.add_column("Error", style="red")

        for j in jobs:
            stage_str = j["stage"]
            st_color = (
                "green"
                if stage_str == "published"
                else "red"
                if stage_str == "failed"
                else "yellow"
            )
            target = j["url"] or (Path(j["path"]).name if j["path"] else "")
            table.add_row(
                j["sid"],
                j["kind"] or "",
                f"[{st_color}]{stage_str}[/{st_color}]",
                str(j["attempts"]),
                target[:40],
                (j["error"] or "")[:40],
            )
        console.print(table)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command("mock-server")
def mock_server(
    port: Annotated[int, typer.Option("--port", "-p", help="Port to listen on")] = 8801,
):
    """Run local deterministic mock model server for development and testing."""
    import uvicorn

    from rh_ingest.mock.server import app as mock_app

    uvicorn.run(mock_app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    app()
