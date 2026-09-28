"""Utilities for testing and inspecting LLM outputs and model options on content files."""

import re
import time
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import SecretStr
from rich.box import ROUNDED
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from rh_ingest.chunk import Chunk
from rh_ingest.config import CheckSettings, LLMSettings
from rh_ingest.extract.checks import CheckResult, check, repair
from rh_ingest.llm.client import LLMClient, LLMFormatError
from rh_ingest.llm.prompts import Prompts
from rh_ingest.llm.schemas import ChunkCards


@dataclass
class CardReport:
    index: int
    title: str
    what: str
    what_word_count: int
    what_valid: bool
    why: str | None
    how: str | None
    when: str | None
    extra: str | None
    start_line: int
    end_line: int
    topics: list[str]
    suggested_topics: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "title": self.title,
            "what": self.what,
            "what_word_count": self.what_word_count,
            "what_valid": self.what_valid,
            "why": self.why,
            "how": self.how,
            "when": self.when,
            "extra": self.extra,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "topics": self.topics,
            "suggested_topics": self.suggested_topics,
        }


@dataclass
class RunResult:
    model: str
    temperature: float
    structured_method: str
    mode: str
    success: bool
    latency_seconds: float
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cards_count: int
    cards: list[CardReport]
    all_what_valid: bool
    avg_what_words: float
    max_what_words: int
    checks_ok: bool
    checks_feedback: list[str]
    raw_output: str | None
    error: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "temperature": self.temperature,
            "structured_method": self.structured_method,
            "mode": self.mode,
            "success": self.success,
            "latency_seconds": self.latency_seconds,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cards_count": self.cards_count,
            "cards": [c.to_dict() for c in self.cards],
            "all_what_valid": self.all_what_valid,
            "avg_what_words": self.avg_what_words,
            "max_what_words": self.max_what_words,
            "checks_ok": self.checks_ok,
            "checks_feedback": self.checks_feedback,
            "raw_output": self.raw_output,
            "error": self.error,
        }


def count_words(text: str) -> int:
    """Count words in text using word boundaries."""
    if not text:
        return 0
    return len(re.findall(r"\b\w+\b", text))


def extract_title_hint(lines: list[str], default: str = "Sample Document") -> str:
    """Extract first heading or fallback to default."""
    for line in lines:
        cleaned = line.strip()
        if cleaned.startswith("# "):
            return cleaned[2:].strip()
        if cleaned.startswith("## "):
            return cleaned[3:].strip()
    return default


def parse_comma_or_list(values: list[str] | None) -> list[str]:
    """Flattens a list of strings that may contain comma-separated entries."""
    if not values:
        return []
    res = []
    for item in values:
        for part in item.split(","):
            part = part.strip()
            if part:
                res.append(part)
    return res


def evaluate_single_option(
    content_lines: list[str],
    chunk: Chunk,
    title: str,
    topics: list[str],
    model: str,
    temperature: float,
    structured_method: str,
    mode: str,
    base_url: str,
    api_key: str,
    max_desc_words: int,
    max_tokens: int,
    timeout_s: float,
    prompts: Prompts,
    system_prompt_override: str | None,
    cfg_checks: CheckSettings,
) -> RunResult:
    """Executes a single test run against a specific model/temperature configuration."""
    llm_cfg = LLMSettings(
        base_url=base_url,
        api_key=SecretStr(api_key),
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout_s=timeout_s,
        structured_method=structured_method,
    )
    client = LLMClient(llm=llm_cfg, emb=None)

    start_time = time.perf_counter()
    error_msg = None
    raw_output = None
    card_reports: list[CardReport] = []
    checks_ok = False
    checks_feedback: list[str] = []
    all_what_valid = True
    avg_words = 0.0
    max_words = 0

    try:
        if mode == "cards":
            sys_msg, human_msg = prompts.cards(
                title=title,
                lines=content_lines,
                chunk=chunk,
                topics=topics,
                max_desc_words=max_desc_words,
            )
            if system_prompt_override:
                sys_msg = SystemMessage(system_prompt_override)

            messages: list[BaseMessage] = [sys_msg, human_msg]
            res = client.chat_json(ChunkCards, messages)
            drafts = res.cards

            # Run Reading Helper checks & repairs
            drafts = repair(drafts, chunk, cfg_checks)
            check_res: CheckResult = check(drafts, chunk, ignore=set(), cfg=cfg_checks)
            checks_ok = check_res.ok
            checks_feedback = check_res.feedback_lines

            # Word count analysis
            word_counts = []
            for idx, d in enumerate(drafts, start=1):
                wc = count_words(d.what)
                word_counts.append(wc)
                is_valid = bool(d.what and d.what.strip()) and (wc <= max_desc_words)
                if not is_valid:
                    all_what_valid = False

                card_reports.append(
                    CardReport(
                        index=idx,
                        title=d.title,
                        what=d.what,
                        what_word_count=wc,
                        what_valid=is_valid,
                        why=d.why,
                        how=d.how,
                        when=d.when,
                        extra=d.extra,
                        start_line=d.start_line,
                        end_line=d.end_line,
                        topics=d.topics,
                        suggested_topics=d.suggested_topics,
                    )
                )

            if word_counts:
                avg_words = sum(word_counts) / len(word_counts)
                max_words = max(word_counts)
            else:
                all_what_valid = False

        else:  # raw mode
            sys_text = (
                system_prompt_override
                or "You are an expert reading assistant. Analyze the following content."
            )
            messages = [
                SystemMessage(sys_text),
                HumanMessage("\n".join(content_lines)),
            ]
            raw_output = client.chat_text(messages)
            checks_ok = True

    except LLMFormatError as e:
        error_msg = f"Format error: {e.error}\nRaw: {e.raw[:300]}"
    except Exception as e:
        error_msg = str(e)

    elapsed = time.perf_counter() - start_time

    return RunResult(
        model=model,
        temperature=temperature,
        structured_method=structured_method,
        mode=mode,
        success=error_msg is None,
        latency_seconds=round(elapsed, 2),
        prompt_tokens=client.usage.prompt_tokens,
        completion_tokens=client.usage.completion_tokens,
        total_tokens=client.usage.total_tokens,
        cards_count=len(card_reports),
        cards=card_reports,
        all_what_valid=all_what_valid and (len(card_reports) > 0),
        avg_what_words=round(avg_words, 1),
        max_what_words=max_words,
        checks_ok=checks_ok,
        checks_feedback=checks_feedback,
        raw_output=raw_output,
        error=error_msg,
    )


def print_run_details(result: RunResult, max_desc_words: int, console: Console) -> None:
    """Renders details of a single run using Rich panels and tables."""
    title_text = Text()
    title_text.append(f"Model: {result.model}", style="bold cyan")
    title_text.append(f" | Temp: {result.temperature}", style="yellow")
    title_text.append(f" | Method: {result.structured_method}", style="magenta")
    title_text.append(f" | Latency: {result.latency_seconds}s", style="green")
    title_text.append(
        f" | Tokens: {result.prompt_tokens} in / {result.completion_tokens} out ({result.total_tokens} total)",
        style="dim",
    )

    console.rule(title_text)

    if not result.success:
        console.print(
            Panel(
                f"[bold red]Execution Failed:[/bold red]\n{result.error}",
                title="Error",
                border_style="red",
            )
        )
        return

    if result.mode == "raw":
        console.print(
            Panel(
                result.raw_output or "",
                title=f"Raw Model Response ({result.model})",
                border_style="green",
            )
        )
        return

    # Cards mode
    console.print(f"\n[bold]Extracted Cards:[/bold] {len(result.cards)} card(s) generated\n")

    for card in result.cards:
        if card.what_valid:
            what_badge = f"[bold green]✓ {card.what_word_count} words (Limit: < {max_desc_words})[/bold green]"
        else:
            what_badge = f"[bold red]✗ {card.what_word_count} words (EXCEEDS {max_desc_words} WORDS OR EMPTY)[/bold red]"

        body_lines = [
            f"[bold cyan]What (Brief Description):[/bold cyan] {what_badge}",
            f"  {card.what}\n",
            f"[bold]Why:[/bold] {card.why}\n",
            f"[bold]How:[/bold] {card.how}\n",
            f"[bold]When:[/bold] {card.when}\n",
        ]

        if card.extra:
            body_lines.append(f"[bold dim]Additional Info:[/bold dim] {card.extra}\n")

        meta_parts = [
            f"[yellow]Lines:[/yellow] {card.start_line}..{card.end_line}",
            f"[blue]Topics:[/blue] {', '.join(card.topics) if card.topics else 'None'}",
            f"[magenta]Suggested Topics:[/magenta] {', '.join(card.suggested_topics) if card.suggested_topics else 'None'}",
        ]
        body_lines.append(" | ".join(meta_parts))

        console.print(
            Panel(
                "\n".join(body_lines),
                title=f"[bold]Card {card.index}: {card.title}[/bold]",
                border_style="green" if card.what_valid else "yellow",
                box=ROUNDED,
            )
        )

    # Validation Checks status
    if result.checks_ok:
        console.print(
            "[bold green]✓ Validation Checks: PASSED (all lines covered, no gaps/overlaps)[/bold green]\n"
        )
    else:
        issues = (
            "\n".join(f"  • {fb}" for fb in result.checks_feedback)
            or "  • Unspecified check failures"
        )
        console.print(
            Panel(
                f"[bold red]Validation Checks: ISSUES FOUND[/bold red]\n{issues}",
                border_style="red",
            )
        )


def print_comparison_table(results: list[RunResult], max_desc_words: int, console: Console) -> None:
    """Renders a side-by-side comparison table for multiple model configurations."""
    table = Table(
        title="\n[bold]Model & Configuration Comparison Summary[/bold]",
        box=ROUNDED,
        header_style="bold cyan",
    )
    table.add_column("Model", style="cyan")
    table.add_column("Temp", justify="right")
    table.add_column("Status")
    table.add_column("Cards", justify="right")
    table.add_column(f"Avg 'What' (limit {max_desc_words})", justify="right")
    table.add_column("What < Limit?", justify="center")
    table.add_column("Checks Valid?", justify="center")
    table.add_column("Tokens (In/Out)", justify="right")
    table.add_column("Latency", justify="right")

    for r in results:
        status_str = "[green]OK[/green]" if r.success else "[red]Error[/red]"
        what_valid_str = (
            "[green]✓ Pass[/green]"
            if (r.success and r.all_what_valid)
            else "[red]✗ Fail[/red]"
            if r.success
            else "-"
        )
        checks_str = (
            "[green]✓ Pass[/green]"
            if (r.success and r.checks_ok)
            else "[yellow]Issues[/yellow]"
            if r.success
            else "-"
        )
        cards_str = str(r.cards_count) if r.success else "-"
        avg_str = (
            f"{r.avg_what_words}w (max {r.max_what_words})"
            if (r.success and r.cards_count > 0)
            else "-"
        )
        tokens_str = f"{r.prompt_tokens}/{r.completion_tokens}" if r.success else "-"
        latency_str = f"{r.latency_seconds}s"

        table.add_row(
            r.model,
            str(r.temperature),
            status_str,
            cards_str,
            avg_str,
            what_valid_str,
            checks_str,
            tokens_str,
            latency_str,
        )

    console.print(table)
