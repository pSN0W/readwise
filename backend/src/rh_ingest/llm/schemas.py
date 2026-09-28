"""Pydantic schemas returned by the model for structured output."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CardDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    what: str = Field(
        min_length=1,
        description="Brief description (< 50 words). Mandatory required field.",
    )
    why: str | None = None
    how: str | None = None
    when: str | None = None
    extra: str | None = None
    start_line: int
    end_line: int
    topics: list[str] = Field(default_factory=list)
    suggested_topics: list[str] = Field(default_factory=list)


class ChunkCards(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cards: list[CardDraft] = Field(default_factory=list)


class MergeVerdict(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: Literal["merge", "separate"]
    reason: str
    title: str | None = None
    what: str | None = None
    why: str | None = None
    how: str | None = None
    when: str | None = None
    extra: str | None = None
    topics: list[str] = Field(default_factory=list)
