"""Prompt templates and line numbering for Reading Helper LLM calls."""

import hashlib
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from rh_ingest.chunk import Chunk


def number_lines(lines: list[str], start: int = 1) -> str:
    """Number lines starting at 1-based index: 0168| Line content."""
    end = start + len(lines) - 1
    width = max(4, len(str(end)))
    res = []
    for idx, line in enumerate(lines, start=start):
        res.append(f"{idx:0{width}d}| {line}")
    return "\n".join(res)


class Prompts:
    """Loads prompt templates and computes SHA256 version for caching."""

    def __init__(self, cards_path: Path, retry_path: Path, merge_path: Path):
        self.cards_template = cards_path.read_text(encoding="utf-8")
        self.retry_template = retry_path.read_text(encoding="utf-8")
        self.merge_template = merge_path.read_text(encoding="utf-8")

        hasher = hashlib.sha256()
        hasher.update(self.cards_template.encode("utf-8"))
        hasher.update(self.retry_template.encode("utf-8"))
        hasher.update(self.merge_template.encode("utf-8"))
        self.version = hasher.hexdigest()

    @classmethod
    def load(cls, dir_path: Path) -> "Prompts":
        return cls(
            cards_path=dir_path / "cards.md",
            retry_path=dir_path / "cards_retry.md",
            merge_path=dir_path / "merge.md",
        )

    @classmethod
    def from_dir(cls, dir_path: Path) -> "Prompts":
        return cls.load(dir_path)

    def cards(
        self,
        title: str,
        lines: list[str],
        chunk: Chunk,
        topics: list[str],
        max_desc_words: int = 50,
    ) -> tuple[SystemMessage, HumanMessage]:
        parts = self.cards_template.split("---USER---")
        sys_tmpl = parts[0].strip()
        user_tmpl = parts[1].strip() if len(parts) > 1 else ""

        topics_str = "\n".join(topics) if topics else "[]"
        sys_msg = (
            sys_tmpl.replace("{own_end}", str(chunk.own_end))
            .replace("{topics}", topics_str)
            .replace("{max_description_words}", str(max_desc_words))
        )

        chunk_lines = lines[chunk.start - 1 : chunk.end]
        numbered = number_lines(chunk_lines, start=chunk.start)

        user_msg = (
            user_tmpl.replace("{title}", title)
            .replace("{start}", str(chunk.start))
            .replace("{end}", str(chunk.end))
            .replace("{numbered_lines}", numbered)
        )
        return SystemMessage(sys_msg), HumanMessage(user_msg)

    def retry(self, problems: list[str]) -> HumanMessage:
        problems_str = "\n".join(f"- {p}" if not p.startswith("-") else p for p in problems)
        content = self.retry_template.replace("{problems}", problems_str)
        return HumanMessage(content)

    def merge(
        self,
        a_source: str,
        a_fields: str,
        b_source: str,
        b_fields: str,
        overlap_note: str = "",
    ) -> tuple[SystemMessage, HumanMessage]:
        content = (
            self.merge_template.replace("{a_source}", a_source)
            .replace("{a_fields}", a_fields)
            .replace("{b_source}", b_source)
            .replace("{b_fields}", b_fields)
            .replace("{overlap_note}", overlap_note)
        )
        return SystemMessage("You are a careful judge merging study cards."), HumanMessage(content)
