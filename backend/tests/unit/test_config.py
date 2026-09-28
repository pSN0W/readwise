from pathlib import Path

import pytest
from pydantic import ValidationError

from rh_ingest.config import Settings


def test_config_defaults(tmp_path: Path):
    empty_yaml = tmp_path / "config.yaml"
    empty_yaml.write_text("", encoding="utf-8")
    s = Settings.load(empty_yaml)

    assert s.llm.model == "mock-cards"
    assert s.embeddings.text == "{what}"
    assert s.checks.max_description_words == 50
    assert s.checks.max_gap_lines == 20
    assert s.merge.threshold == 0.80
    assert s.merge.judge_sees == "fields"


def test_config_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    yaml_file = tmp_path / "config.yaml"
    yaml_file.write_text("llm:\n  model: from-yaml\n", encoding="utf-8")

    monkeypatch.setenv("RH__LLM__MODEL", "override-model")
    monkeypatch.setenv("RH__CHECKS__MAX_DESCRIPTION_WORDS", "42")
    s = Settings.load(yaml_file)

    assert s.llm.model == "override-model"
    assert s.checks.max_description_words == 42


def test_config_bad_value_error(tmp_path: Path):
    yaml_file = tmp_path / "config.yaml"
    yaml_file.write_text("llm:\n  temperature: not-a-number\n", encoding="utf-8")

    with pytest.raises(ValidationError) as exc:
        Settings.load(yaml_file)
    assert "temperature" in str(exc.value)
