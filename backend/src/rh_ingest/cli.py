import json
import shutil
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from rh_ingest.chunk import Chunk
from rh_ingest.config import Settings
from rh_ingest.contract.models import IngestReport
from rh_ingest.contract.validate import validate_library
from rh_ingest.inspect import (
    evaluate_single_option,
    extract_title_hint,
    parse_comma_or_list,
    print_comparison_table,
    print_run_details,
)
from rh_ingest.intake.refs import SourceRef
from rh_ingest.intake.watcher import InboxWatcher, guess_kind_from_path
from rh_ingest.llm.prompts import Prompts
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


@app.command("test-model")
def test_model_command(
    file: Annotated[Path, typer.Argument(help="Path to input text or markdown file")],
    models: Annotated[
        list[str] | None,
        typer.Option(
            "--model",
            "-m",
            help="Model name(s) to test (can be specified multiple times or comma-separated)",
        ),
    ] = None,
    temperatures: Annotated[
        list[float] | None,
        typer.Option("--temperature", "-t", help="Temperature(s) to test"),
    ] = None,
    mode: Annotated[
        str,
        typer.Option(
            "--mode",
            help="Operation mode: 'cards' (structured extraction) or 'raw' (direct prompt)",
        ),
    ] = "cards",
    base_url: Annotated[
        str | None,
        typer.Option("--base-url", help="Custom LLM API base URL"),
    ] = None,
    api_key: Annotated[
        str | None,
        typer.Option("--api-key", help="LLM API key"),
    ] = None,
    structured_method: Annotated[
        str | None,
        typer.Option(
            "--structured-method",
            help="Structured output method: json_schema, function_calling, json_mode",
        ),
    ] = None,
    lines: Annotated[
        str | None,
        typer.Option("--lines", help="Line range to inspect, e.g. '1:50'"),
    ] = None,
    title: Annotated[
        str | None,
        typer.Option("--title", help="Document title hint"),
    ] = None,
    topics: Annotated[
        str | None,
        typer.Option("--topics", help="Comma-separated topics list to supply in prompt"),
    ] = None,
    max_desc_words: Annotated[
        int | None,
        typer.Option("--max-desc-words", help="Max words allowed for 'what' field (default: 50)"),
    ] = None,
    max_tokens: Annotated[
        int | None,
        typer.Option("--max-tokens", help="Max output tokens per LLM call"),
    ] = None,
    timeout: Annotated[
        float | None,
        typer.Option("--timeout", help="Timeout in seconds per LLM call"),
    ] = None,
    system_prompt: Annotated[
        str | None,
        typer.Option("--system-prompt", help="Custom system prompt override"),
    ] = None,
    prompts_dir: Annotated[
        Path | None,
        typer.Option("--prompts-dir", help="Directory containing cards.md templates"),
    ] = None,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output", "-o", help="Optional path to write full evaluation output as JSON"
        ),
    ] = None,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output raw JSON to stdout"),
    ] = False,
):
    """Test and compare LLM model options, parameters, and prompts on input content."""
    import os
    import re
    import sys

    console = Console(file=sys.stderr if json_output else sys.stdout)
    cfg = get_settings()

    if not file.exists():
        console.print(f"[bold red]Error:[/bold red] Input file not found: {file}")
        raise typer.Exit(code=1)

    file_text = file.read_text(encoding="utf-8")
    all_lines = file_text.splitlines()
    if not all_lines:
        console.print(f"[bold red]Error:[/bold red] Input file is empty: {file}")
        raise typer.Exit(code=1)

    start_line = 1
    end_line = len(all_lines)
    if lines:
        match = re.match(r"^(\d+):(\d+)$", lines.strip())
        if match:
            start_line = max(1, int(match.group(1)))
            end_line = min(len(all_lines), int(match.group(2)))
        else:
            console.print(
                f"[bold red]Invalid --lines format:[/bold red] Expected 'START:END', got {lines}"
            )
            raise typer.Exit(code=1)

    chunk_lines = all_lines[start_line - 1 : end_line]
    doc_title = title or extract_title_hint(all_lines, default=file.stem)
    topics_list = [t.strip() for t in topics.split(",")] if topics else []
    max_desc_words_val = max_desc_words or cfg.checks.max_description_words

    raw_models = parse_comma_or_list(models)
    models_to_test = raw_models if raw_models else [cfg.llm.model]

    if temperatures:
        temps_to_test = temperatures
    else:
        temps_to_test = [cfg.llm.temperature]

    target_base_url = base_url or os.environ.get("OPENAI_BASE_URL") or cfg.llm.base_url
    target_api_key = (
        api_key or os.environ.get("OPENAI_API_KEY") or cfg.llm.api_key.get_secret_value()
    )
    target_method = structured_method or cfg.llm.structured_method
    target_max_tokens = max_tokens or cfg.llm.max_tokens
    target_timeout = timeout or cfg.llm.timeout_s

    p_dir = prompts_dir or cfg.prompts.cards.parent
    prompts = Prompts.load(p_dir)

    chunk = Chunk(
        start=start_line,
        end=end_line,
        own_end=end_line,
        idx=0,
    )

    if not json_output:
        console.print(
            Panel(
                f"[bold cyan]Input File:[/bold cyan] {file} ({len(chunk_lines)} lines, range {start_line}..{end_line})\n"
                f"[bold cyan]Document Title:[/bold cyan] {doc_title}\n"
                f"[bold cyan]Models to test:[/bold cyan] {', '.join(models_to_test)}\n"
                f"[bold cyan]Temperatures:[/bold cyan] {', '.join(str(t) for t in temps_to_test)}\n"
                f"[bold cyan]Max 'What' Word Limit:[/bold cyan] {max_desc_words_val} words\n"
                f"[bold cyan]Endpoint:[/bold cyan] {target_base_url}",
                title="Reading Helper — Model Inspection",
                border_style="cyan",
            )
        )

    results = []
    for model_name in models_to_test:
        for temp in temps_to_test:
            res = evaluate_single_option(
                content_lines=all_lines,
                chunk=chunk,
                title=doc_title,
                topics=topics_list,
                model=model_name,
                temperature=temp,
                structured_method=target_method,
                mode=mode,
                base_url=target_base_url,
                api_key=target_api_key,
                max_desc_words=max_desc_words_val,
                max_tokens=target_max_tokens,
                timeout_s=target_timeout,
                prompts=prompts,
                system_prompt_override=system_prompt,
                cfg_checks=cfg.checks,
            )
            results.append(res)
            if not json_output:
                print_run_details(res, max_desc_words=max_desc_words_val, console=console)

    if not json_output and len(results) > 1:
        print_comparison_table(results, max_desc_words=max_desc_words_val, console=console)

    serialized_results = [r.to_dict() for r in results]
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(serialized_results, indent=2), encoding="utf-8")
        if not json_output:
            console.print(f"[bold green]✓ Results written to {output}[/bold green]")

    if json_output:
        sys.stdout.write(json.dumps(serialized_results, indent=2) + "\n")


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
