"""Configuration management for Reading Helper backend ingest."""

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr


class LLMSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    base_url: str = "http://127.0.0.1:8801/v1"
    api_key: SecretStr = SecretStr("dev")
    model: str = "mock-cards"
    temperature: float = 0.2
    max_tokens: int = 4096
    timeout_s: float = 180.0
    max_retries: int = 3
    structured_method: Literal["json_schema", "function_calling", "json_mode"] = "json_schema"
    strict: bool = True
    max_parallel: int = 2
    extra_body: dict[str, Any] = Field(default_factory=dict)


class EmbedSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    base_url: str = "http://127.0.0.1:8801/v1"
    api_key: SecretStr = SecretStr("dev")
    model: str = "mock-embed"
    batch: int = 64
    dim: int = 64
    text: str = "{what}"


class ChunkSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    max_tokens: int = 4000
    overlap: float = 0.20
    tokenizer: str = "chars/4"
    separators: list[str] = Field(default_factory=lambda: ["\n# ", "\n## ", "\n### ", "\n\n", "\n"])


class CheckSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    max_gap_lines: int = 20
    max_description_words: int = 50
    max_retries: int = 3
    clamp_lines: int = 3
    trim_overlap_lines: int = 3
    ignore_sections: list[str] = Field(
        default_factory=lambda: [
            "contents",
            "table of contents",
            "index",
            "references",
            "bibliography",
            "acknowledgements",
            "acknowledgments",
            "about the author",
            "copyright",
        ]
    )


class MergeSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    threshold: float = 0.80
    top_k: int = 5
    judge_sees: Literal["fields", "fields+lines"] = "fields"
    overlap_always_judge: bool = True
    touch_gap_lines: int = 1


class TopicSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    max_levels: int = 3
    max_suggestions_per_run: int = 20


class MarkerSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    use_llm: bool = False
    force_ocr: bool = False
    device: str = "cuda"


class PdfSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    engine: Literal["marker", "pymupdf4llm"] = "marker"
    marker: MarkerSettings = Field(default_factory=MarkerSettings)
    min_image_px: int = 64


class BlogSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_agent: str = "reading-helper/0.1"
    timeout_s: float = 30.0
    download_images: bool = True


class VideoSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    subtitle_langs: list[str] = Field(default_factory=lambda: ["en", "en-orig", "en-US"])
    asr_fallback: bool = True
    whisper_model: str = "large-v3-turbo"
    whisper_device: str = "cuda"
    slides: bool = False
    slide_scene_threshold: float = 27.0
    slide_min_gap_s: int = 10
    js_runtime: str = "deno"
    cookies_file: Path | None = None


class ConvertSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pdf: PdfSettings = Field(default_factory=PdfSettings)
    blog: BlogSettings = Field(default_factory=BlogSettings)
    video: VideoSettings = Field(default_factory=VideoSettings)


class PromptPaths(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cards: Path = Path("prompts/cards.md")
    cards_retry: Path = Path("prompts/cards_retry.md")
    merge: Path = Path("prompts/merge.md")


class RunSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    convert_all_first: bool = True
    lock_file: str = "rh.lock"


class WatchSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    settle_s: float = 5.0
    rescan_s: float = 60.0


class LogSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: str = "INFO"


class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    library_dir: Path = Path("/data/Sync/library")
    work_dir: Path = Path("/data/reading-helper-work")
    llm: LLMSettings = Field(default_factory=LLMSettings)
    embeddings: EmbedSettings = Field(default_factory=EmbedSettings)
    chunking: ChunkSettings = Field(default_factory=ChunkSettings)
    checks: CheckSettings = Field(default_factory=CheckSettings)
    merge: MergeSettings = Field(default_factory=MergeSettings)
    topics: TopicSettings = Field(default_factory=TopicSettings)
    convert: ConvertSettings = Field(default_factory=ConvertSettings)
    prompts: PromptPaths = Field(default_factory=PromptPaths)
    run: RunSettings = Field(default_factory=RunSettings)
    watch: WatchSettings = Field(default_factory=WatchSettings)
    log: LogSettings = Field(default_factory=LogSettings)

    @classmethod
    def load(cls, path: Path | None = None) -> "Settings":
        config_path = path
        if config_path is None and "RH_CONFIG" in os.environ:
            config_path = Path(os.environ["RH_CONFIG"])
        if config_path is None:
            default_path = Path.home() / ".config" / "reading-helper" / "config.yaml"
            if default_path.exists():
                config_path = default_path

        data: dict[str, Any] = {}
        base_dir = Path.cwd()
        if config_path and config_path.exists():
            base_dir = config_path.parent
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f)
                if isinstance(loaded, dict):
                    data = loaded

        # Apply environment variable overrides: RH__<SECTION>__<KEY>
        for env_key, env_val in os.environ.items():
            if env_key.startswith("RH__"):
                parts = env_key[4:].lower().split("__")
                val = yaml.safe_load(env_val)
                target = data
                for part in parts[:-1]:
                    if part not in target or not isinstance(target[part], dict):
                        target[part] = {}
                    target = target[part]
                target[parts[-1]] = val

        settings = cls.model_validate(data)

        # Resolve prompt paths relative to the config file's folder if relative
        def resolve_prompt(p: Path) -> Path:
            if p.is_absolute():
                return p
            # Check relative to base_dir
            from_base = (base_dir / p).resolve()
            if from_base.exists():
                return from_base
            # Check relative to cwd
            from_cwd = (Path.cwd() / p).resolve()
            if from_cwd.exists():
                return from_cwd
            return from_base

        settings.prompts.cards = resolve_prompt(settings.prompts.cards)
        settings.prompts.cards_retry = resolve_prompt(settings.prompts.cards_retry)
        settings.prompts.merge = resolve_prompt(settings.prompts.merge)

        return settings
