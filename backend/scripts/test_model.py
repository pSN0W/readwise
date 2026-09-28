#!/usr/bin/env python3
"""Script to test and compare LLM models, prompts, and parameters on arbitrary content files.

Usage:
    # Test card extraction on a content file using default model/config:
    uv run python scripts/test_model.py samples/sample_notes.md

    # Test and compare multiple models:
    uv run python scripts/test_model.py samples/sample_notes.md --models gpt-4o-mini,gpt-4o

    # Test different temperatures:
    uv run python scripts/test_model.py samples/sample_notes.md -m gpt-4o-mini -t 0.0 -t 0.7

    # Test with custom base URL (e.g. local Ollama or vLLM):
    uv run python scripts/test_model.py samples/sample_notes.md --base-url http://localhost:11434/v1 --model llama3.2

    # Test raw prompt mode (without card extraction schema):
    uv run python scripts/test_model.py samples/sample_notes.md --mode raw

    # Export results to JSON:
    uv run python scripts/test_model.py samples/sample_notes.md -o comparison.json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Ensure backend/src is on the import path if running standalone
script_dir = Path(__file__).resolve().parent
backend_dir = script_dir.parent
src_dir = backend_dir / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from rich.console import Console  # noqa: E402
from rich.panel import Panel  # noqa: E402

from rh_ingest.chunk import Chunk  # noqa: E402
from rh_ingest.config import Settings  # noqa: E402
from rh_ingest.inspect import (  # noqa: E402
    RunResult,
    evaluate_single_option,
    extract_title_hint,
    parse_comma_or_list,
    print_comparison_table,
    print_run_details,
)
from rh_ingest.llm.prompts import Prompts  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect and test LLM model outputs, parameters, and prompts on input content.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("file", type=Path, help="Path to input text or markdown file")
    parser.add_argument(
        "--models",
        "-m",
        action="append",
        help="Model name(s) to test (e.g. -m gpt-4o-mini -m gpt-4o or -m gpt-4o-mini,gpt-4o)",
    )
    parser.add_argument(
        "--temperatures",
        "-t",
        action="append",
        help="Temperature(s) to test (e.g. -t 0.0 -t 0.7 or -t 0.0,0.7)",
    )
    parser.add_argument(
        "--mode",
        choices=["cards", "raw"],
        default="cards",
        help="Operation mode: 'cards' (structured extraction) or 'raw' (direct prompt)",
    )
    parser.add_argument(
        "--base-url",
        help="Custom LLM API base URL (e.g. http://localhost:11434/v1 for Ollama)",
    )
    parser.add_argument(
        "--api-key",
        help="LLM API key (default: read from RH__LLM__API_KEY or OPENAI_API_KEY env)",
    )
    parser.add_argument(
        "--structured-method",
        choices=["json_schema", "function_calling", "json_mode"],
        help="Structured output method for LangChain",
    )
    parser.add_argument(
        "--lines",
        help="Line range to inspect, e.g. '1:50' or '10:40' (1-indexed)",
    )
    parser.add_argument(
        "--title",
        help="Document title hint (default: extracted from first heading or filename)",
    )
    parser.add_argument(
        "--topics",
        help="Comma-separated topics list to supply in prompt (e.g. 'ML/Attention, Memory')",
    )
    parser.add_argument(
        "--max-desc-words",
        type=int,
        help="Max words allowed for 'what' field (default: 50)",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        help="Max output tokens per LLM call (default: 4096)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        help="Timeout in seconds per LLM call (default: 180.0)",
    )
    parser.add_argument(
        "--system-prompt",
        help="Custom system prompt to override default prompt template",
    )
    parser.add_argument(
        "--prompts-dir",
        type=Path,
        help="Directory containing cards.md and cards_retry.md templates",
    )
    parser.add_argument(
        "--config",
        "-c",
        type=Path,
        help="Path to config.yaml file to load default settings",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Optional path to write full evaluation output as JSON",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON to stdout instead of formatted Rich panels",
    )

    args = parser.parse_args()
    console = Console(file=sys.stderr if args.json else sys.stdout)

    # 1. Load defaults from configuration
    cfg = Settings.load(args.config)

    # 2. Read input file
    input_file: Path = args.file
    if not input_file.exists():
        console.print(f"[bold red]Error:[/bold red] Input file not found: {input_file}")
        sys.exit(1)

    file_text = input_file.read_text(encoding="utf-8")
    all_lines = file_text.splitlines()
    if not all_lines:
        console.print(f"[bold red]Error:[/bold red] Input file is empty: {input_file}")
        sys.exit(1)

    # Slice line range if requested
    start_line = 1
    end_line = len(all_lines)
    if args.lines:
        match = re.match(r"^(\d+):(\d+)$", args.lines.strip())
        if match:
            start_line = max(1, int(match.group(1)))
            end_line = min(len(all_lines), int(match.group(2)))
        else:
            console.print(
                f"[bold red]Invalid --lines format:[/bold red] Expected 'START:END', got {args.lines}"
            )
            sys.exit(1)

    chunk_lines = all_lines[start_line - 1 : end_line]
    doc_title = args.title or extract_title_hint(all_lines, default=input_file.stem)

    topics_list = [t.strip() for t in args.topics.split(",")] if args.topics else []
    max_desc_words = args.max_desc_words or cfg.checks.max_description_words

    # 3. Resolve models to test
    raw_models = parse_comma_or_list(args.models)
    models_to_test = raw_models if raw_models else [cfg.llm.model]

    # Resolve temperatures to test
    raw_temps = parse_comma_or_list(args.temperatures)
    temps_to_test = [float(t) for t in raw_temps] if raw_temps else [cfg.llm.temperature]

    # Resolve connection settings
    base_url = args.base_url or os.environ.get("OPENAI_BASE_URL") or cfg.llm.base_url
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY") or cfg.llm.api_key.get_secret_value()
    structured_method = args.structured_method or cfg.llm.structured_method
    max_tokens = args.max_tokens or cfg.llm.max_tokens
    timeout_s = args.timeout or cfg.llm.timeout_s

    # Prompts
    prompts_dir = args.prompts_dir or backend_dir / "prompts"
    prompts = Prompts.load(prompts_dir)

    chunk = Chunk(
        start=start_line,
        end=end_line,
        own_end=end_line,
        idx=0,
    )

    if not args.json:
        console.print(
            Panel(
                f"[bold cyan]Input File:[/bold cyan] {input_file} ({len(chunk_lines)} lines, range {start_line}..{end_line})\n"
                f"[bold cyan]Document Title:[/bold cyan] {doc_title}\n"
                f"[bold cyan]Models to test:[/bold cyan] {', '.join(models_to_test)}\n"
                f"[bold cyan]Temperatures:[/bold cyan] {', '.join(str(t) for t in temps_to_test)}\n"
                f"[bold cyan]Max 'What' Word Limit:[/bold cyan] {max_desc_words} words\n"
                f"[bold cyan]Endpoint:[/bold cyan] {base_url}",
                title="Reading Helper — Model Inspection",
                border_style="cyan",
            )
        )

    # 4. Run tests
    results: list[RunResult] = []
    for model_name in models_to_test:
        for temp in temps_to_test:
            res = evaluate_single_option(
                content_lines=all_lines,
                chunk=chunk,
                title=doc_title,
                topics=topics_list,
                model=model_name,
                temperature=temp,
                structured_method=structured_method,
                mode=args.mode,
                base_url=base_url,
                api_key=api_key,
                max_desc_words=max_desc_words,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
                prompts=prompts,
                system_prompt_override=args.system_prompt,
                cfg_checks=cfg.checks,
            )
            results.append(res)
            if not args.json:
                print_run_details(res, max_desc_words=max_desc_words, console=console)

    # 5. Summary comparison if multiple options tested
    if not args.json and len(results) > 1:
        print_comparison_table(results, max_desc_words=max_desc_words, console=console)

    # 6. JSON output / Export
    serialized_results = [r.to_dict() for r in results]

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(serialized_results, indent=2), encoding="utf-8")
        if not args.json:
            console.print(f"[bold green]✓ Results written to {args.output}[/bold green]")

    if args.json:
        sys.stdout.write(json.dumps(serialized_results, indent=2) + "\n")


if __name__ == "__main__":
    main()
