"""Markdown and plain text ingestor for Reading Helper."""

import re
import shutil
from pathlib import Path
from typing import ClassVar, Literal

from rh_ingest.ingest.base import (
    DocBuilder,
    FetchResult,
    Origin,
    SourceInfo,
    SourceIngestor,
    register_ingestor,
)
from rh_ingest.intake.refs import SourceRef


@register_ingestor
class MarkdownIngestor(SourceIngestor):
    kind: ClassVar[Literal["markdown"]] = "markdown"

    @classmethod
    def can_handle(cls, ref: SourceRef) -> bool:
        if ref.path and ref.path.suffix.lower() in [".md", ".markdown", ".txt"]:
            return True
        return False

    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult:
        if not ref.path or not ref.path.exists():
            raise FileNotFoundError(f"Source file not found: {ref.path}")

        ext = ref.path.suffix or ".md"
        dest = tmp / f"original{ext}"
        shutil.copy2(ref.path, dest)

        # Detect local referenced images and copy to tmp
        extra_files: list[Path] = []
        text = ref.path.read_text(encoding="utf-8")
        for match in re.finditer(r"!\[.*?\]\((.*?)\)", text):
            img_rel = match.group(1).strip()
            if not img_rel.startswith(("http://", "https://", "data:")):
                cand = ref.path.parent / img_rel
                if cand.exists() and cand.is_file():
                    img_dest = tmp / cand.name
                    shutil.copy2(cand, img_dest)
                    extra_files.append(img_dest)

        return FetchResult(original=dest, extra=extra_files, origin=Origin(filename=ref.path.name))

    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo:
        text = fetched.original.read_text(encoding="utf-8")
        lines = text.splitlines()

        title = fetched.original.stem
        # Try to find first H1 heading
        for line in lines:
            m = re.match(r"^#\s+(.*)$", line)
            if m:
                title = m.group(1).strip()
                break

        for line in lines:
            # Heading check
            m_h = re.match(r"^(#{1,6})\s+(.*)$", line)
            if m_h:
                lvl = len(m_h.group(1))
                h_title = m_h.group(2).strip()
                doc.heading(lvl, h_title)
                continue

            # Image check: ![caption](path)
            m_img = re.match(r"^!\[(.*?)\]\((.*?)\)$", line.strip())
            if m_img:
                caption = m_img.group(1)
                img_path_str = m_img.group(2)
                # Resolve image path relative to fetched.original or cwd
                orig_dir = fetched.original.parent
                cand_file = orig_dir / img_path_str
                if not cand_file.exists():
                    cand_file = Path(img_path_str)
                if cand_file.exists():
                    doc.image(cand_file, caption, "image")
                    continue

            # Plain text
            doc.text(line)

        return SourceInfo(title=title, authors=[])
