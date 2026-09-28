import json
from pathlib import Path

from typer.testing import CliRunner

from rh_ingest.chunk import Chunk
from rh_ingest.cli import app
from rh_ingest.config import CheckSettings
from rh_ingest.inspect import count_words, evaluate_single_option, parse_comma_or_list
from rh_ingest.llm.prompts import Prompts

runner = CliRunner()


def test_count_words_and_helpers():
    assert count_words("") == 0
    assert count_words("Hello world") == 2
    assert count_words("Superposition allows more concepts than neurons.") == 6

    parsed = parse_comma_or_list(["gpt-4o-mini, gpt-4o", "claude-3-5"])
    assert parsed == ["gpt-4o-mini", "gpt-4o", "claude-3-5"]
    assert parse_comma_or_list(None) == []


def test_evaluate_single_option_cards(mock_server: str, tmp_path: Path):
    prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
    prompts = Prompts.load(prompts_dir)

    lines = [
        "# Neural Superposition",
        "Neural networks represent features as directions in activation space.",
        "When features exceed dimensions, features are packed in superposition.",
        "This allows more concepts than neurons to be represented simultaneously.",
    ]
    chunk = Chunk(start=1, end=len(lines), own_end=len(lines), idx=0)

    res = evaluate_single_option(
        content_lines=lines,
        chunk=chunk,
        title="Neural Superposition",
        topics=["ML/Features"],
        model="mock-cards",
        temperature=0.2,
        structured_method="json_schema",
        mode="cards",
        base_url=f"{mock_server}/v1",
        api_key="dev",
        max_desc_words=50,
        max_tokens=2048,
        timeout_s=30.0,
        prompts=prompts,
        system_prompt_override=None,
        cfg_checks=CheckSettings(),
    )

    assert res.success is True
    assert res.model == "mock-cards"
    assert res.temperature == 0.2
    assert res.cards_count > 0
    assert res.all_what_valid is True
    assert res.cards[0].what
    assert res.cards[0].what_word_count > 0
    assert res.cards[0].what_word_count <= 50
    assert res.cards[0].what_valid is True
    assert res.latency_seconds >= 0.0
    assert res.total_tokens > 0

    d = res.to_dict()
    assert isinstance(d, dict)
    assert d["cards_count"] == res.cards_count


def test_evaluate_what_word_limit_flagging(mock_server: str):
    prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
    prompts = Prompts.load(prompts_dir)

    lines = [
        "# Concept",
        "Line 1 text for concept testing.",
        "Line 2 text for concept testing.",
    ]
    chunk = Chunk(start=1, end=len(lines), own_end=len(lines), idx=0)

    # Set an artificially tiny word limit: 2 words
    res = evaluate_single_option(
        content_lines=lines,
        chunk=chunk,
        title="Concept",
        topics=[],
        model="mock-cards",
        temperature=0.0,
        structured_method="json_schema",
        mode="cards",
        base_url=f"{mock_server}/v1",
        api_key="dev",
        max_desc_words=2,
        max_tokens=2048,
        timeout_s=30.0,
        prompts=prompts,
        system_prompt_override=None,
        cfg_checks=CheckSettings(max_description_words=2),
    )

    assert res.success is True
    assert res.cards_count > 0
    # Any card with more than 2 words in 'what' should be flagged as what_valid = False
    assert res.cards[0].what_word_count > 2
    assert res.cards[0].what_valid is False
    assert res.all_what_valid is False


def test_evaluate_single_option_raw(mock_server: str):
    prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
    prompts = Prompts.load(prompts_dir)

    lines = ["Explain transformers in one sentence."]
    chunk = Chunk(start=1, end=1, own_end=1, idx=0)

    res = evaluate_single_option(
        content_lines=lines,
        chunk=chunk,
        title="Raw Prompt Test",
        topics=[],
        model="mock-cards",
        temperature=0.5,
        structured_method="json_schema",
        mode="raw",
        base_url=f"{mock_server}/v1",
        api_key="dev",
        max_desc_words=50,
        max_tokens=1024,
        timeout_s=30.0,
        prompts=prompts,
        system_prompt_override="You are a helpful AI.",
        cfg_checks=CheckSettings(),
    )

    assert res.success is True
    assert res.raw_output is not None
    assert len(res.raw_output) > 0


def test_cli_test_model(mock_server: str, tmp_path: Path):
    sample_file = tmp_path / "test_input.md"
    sample_file.write_text(
        "# Attention Mechanisms\n\nSelf-attention connects all tokens.\nKV cache speeds up inference.\n",
        encoding="utf-8",
    )
    out_json = tmp_path / "out.json"

    res = runner.invoke(
        app,
        [
            "test-model",
            str(sample_file),
            "--base-url",
            f"{mock_server}/v1",
            "--api-key",
            "dev",
            "--model",
            "mock-cards",
            "--temperature",
            "0.2",
            "--output",
            str(out_json),
        ],
    )

    assert res.exit_code == 0
    assert "Reading Helper — Model Inspection" in res.stdout
    assert "Extracted Cards" in res.stdout
    assert out_json.exists()

    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["model"] == "mock-cards"
    assert data[0]["cards_count"] > 0


def test_cli_test_model_multi_model_and_json(mock_server: str, tmp_path: Path):
    sample_file = tmp_path / "test_multi.md"
    sample_file.write_text(
        "# Multi-Model Test\nLine one content.\nLine two content.\n",
        encoding="utf-8",
    )

    res = runner.invoke(
        app,
        [
            "test-model",
            str(sample_file),
            "--base-url",
            f"{mock_server}/v1",
            "--api-key",
            "dev",
            "-m",
            "mock-cards,mock-cards-v2",
            "-t",
            "0.0",
            "-t",
            "0.5",
            "--json",
        ],
    )

    assert res.exit_code == 0
    data = json.loads(res.stdout)
    assert isinstance(data, list)
    # 2 models * 2 temperatures = 4 combinations tested!
    assert len(data) == 4
    models_tested = {item["model"] for item in data}
    assert "mock-cards" in models_tested
    assert "mock-cards-v2" in models_tested
