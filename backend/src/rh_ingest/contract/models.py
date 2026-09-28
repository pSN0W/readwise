"""Pydantic models mirroring the JSON schemas in docs/contract/schemas/."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# -------------------------------------------------------------------------
# library.schema.json
# -------------------------------------------------------------------------


class LibraryOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str | None = None
    filename: str | None = None


class LibrarySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^s_[a-z0-9_]+$")
    kind: Literal["pdf", "blog", "video", "markdown"]
    title: str
    authors: list[str] = Field(default_factory=list)
    origin: LibraryOrigin
    added_at: datetime
    status: Literal["processing", "ready", "failed"]
    n_lines: int = Field(ge=0)
    n_cards: int = Field(ge=0)
    pages: int | None = None
    duration_s: float | None = None
    keywords: list[str] = Field(default_factory=list)


class LibraryTopic(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(pattern=r"^[^/]+(/[^/]+){0,2}$")


class LibraryManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    generation: int = Field(ge=0)
    updated_at: datetime
    sources: list[LibrarySource] = Field(default_factory=list)
    topics: list[LibraryTopic] = Field(default_factory=list)


# -------------------------------------------------------------------------
# cards.schema.json
# -------------------------------------------------------------------------


class CardRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern=r"^s_[a-z0-9_]+$")
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class Card(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^c_[A-Za-z0-9_]+$")
    rev: int = Field(ge=1)
    title: str = Field(min_length=1)
    what: str | None = Field(default=None, min_length=1)
    why: str | None = Field(default=None, min_length=1)
    how: str | None = Field(default=None, min_length=1)
    when: str | None = Field(default=None, min_length=1)
    extra: str | None = Field(default=None, min_length=1)
    topics: list[str] = Field(default_factory=list)
    refs: list[CardRef] = Field(min_length=1)
    images: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class RetiredCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^c_[A-Za-z0-9_]+$")
    into: list[str] = Field(default_factory=list)


class CardsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    generation: int = Field(ge=0)
    cards: list[Card] = Field(default_factory=list)
    retired: list[RetiredCard] = Field(default_factory=list)


# -------------------------------------------------------------------------
# meta.schema.json
# -------------------------------------------------------------------------


class MetaToc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    level: int = Field(ge=1, le=6)
    line: int = Field(ge=1)


class MetaAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    line: int = Field(ge=1)
    caption: str | None = None
    kind: Literal["figure", "slide", "image"]
    time_s: float | None = None


class SourceMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    id: str = Field(pattern=r"^s_[a-z0-9_]+$")
    kind: Literal["pdf", "blog", "video", "markdown"]
    title: str
    original: str
    original_extra: list[str] | None = None
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    n_lines: int = Field(ge=0)
    toc: list[MetaToc] = Field(default_factory=list)
    pages: list[list[int | float]] | None = None
    times: list[list[int | float]] | None = None
    assets: list[MetaAsset] = Field(default_factory=list)
    content_bytes: int = Field(ge=0)
    anchor_step: int = Field(ge=1)
    anchors: list[list[int]] = Field(min_length=1)


# -------------------------------------------------------------------------
# tag_suggestions.schema.json
# -------------------------------------------------------------------------


class TagSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^t_[A-Za-z0-9_]+$")
    path: str = Field(pattern=r"^[^/]+(/[^/]+){0,2}$")
    card_ids: list[str] = Field(default_factory=list)
    reason: str | None = None
    similar_existing: str | None = Field(default=None, pattern=r"^[^/]+(/[^/]+){0,2}$")
    created_at: datetime


class TagSuggestionsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    generation: int = Field(ge=0)
    suggestions: list[TagSuggestion] = Field(default_factory=list)


# -------------------------------------------------------------------------
# report.schema.json
# -------------------------------------------------------------------------


class CheckStatus(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool
    detail: str | None = None


class CoverageCheckStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    covered_pct: float
    limit: int
    gaps: list[list[int]]
    detail: str | None = None


class SourceChecks(BaseModel):
    model_config = ConfigDict(extra="forbid")
    json_valid: CheckStatus
    ranges: CheckStatus
    overlaps: CheckStatus
    coverage: CoverageCheckStatus


class ReportSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern=r"^s_[a-z0-9_]+$")
    title: str
    status: Literal["ok", "warning", "failed", "skipped"]
    chunks_total: int
    chunks_ok: int
    retries: int
    checks: SourceChecks
    cards_created: int
    cards_merged: int
    splits_applied: int
    errors: list[str] = Field(default_factory=list)
    overlap_pairs_kept_apart: list[list[str]] | None = None


class IngestReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    run_id: str
    started_at: datetime
    finished_at: datetime
    sources: list[ReportSource] = Field(default_factory=list)


# -------------------------------------------------------------------------
# state.schema.json
# -------------------------------------------------------------------------


class StateViewed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rev: int = Field(ge=1)
    ts: int = Field(ge=0)


class StateExplored(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ts: int = Field(ge=0)


class StateKnown(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: bool
    ts: int = Field(ge=0)


class StateTags(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: list[str]
    ts: int = Field(ge=0)


class StateSplit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: bool
    ts: int = Field(ge=0)


class CardState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    viewed: StateViewed | None = None
    explored: StateExplored | None = None
    known: StateKnown | None = None
    tags: StateTags | None = None
    split: StateSplit | None = None


class TopicDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["accept", "rename", "combine", "reject"]
    path: str | None = Field(default=None, pattern=r"^[^/]+(/[^/]+){0,2}$")
    ts: int = Field(ge=0)


class CopyPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    v: str
    ts: int = Field(ge=0)


class MyTag(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ts: int = Field(ge=0)
    deleted: bool | None = None


class DeviceState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    device_id: str = Field(pattern=r"^[a-z0-9-]+$")
    updated_at: int = Field(ge=0)
    copy_prompt: CopyPrompt | None = None
    my_tags: dict[str, MyTag] = Field(default_factory=dict)
    cards: dict[str, CardState] = Field(default_factory=dict)
    topic_decisions: dict[str, TopicDecision] = Field(default_factory=dict)
