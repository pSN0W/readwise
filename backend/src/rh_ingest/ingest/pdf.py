"""PDF ingestion supporting multiple engines (Marker, PyMuPDF, FakeEngine for tests)."""

import json
import logging
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar, Literal, Protocol

from rh_ingest.config import Settings
from rh_ingest.ingest.base import (
    DocBuilder,
    FetchResult,
    IngestError,
    SourceInfo,
    SourceIngestor,
    register_ingestor,
)
from rh_ingest.intake.refs import SourceRef

logger = logging.getLogger(__name__)


@dataclass
class PageMd:
    page_no: int
    markdown: str
    images: list[tuple[Path, str]] = field(default_factory=list)  # (image_path, caption)


class PdfEngine(Protocol):
    def pages(self, pdf_path: Path) -> list[PageMd]: ...


class FakeEngine:
    """Fake PDF engine for fast, reproducible tests without GPU or large models."""

    def __init__(self, pages_or_json: list[PageMd] | Path | list[dict]):
        if isinstance(pages_or_json, Path):
            data = json.loads(pages_or_json.read_text(encoding="utf-8"))
            self._pages = [PageMd(**p) for p in data]
        elif (
            isinstance(pages_or_json, list) and pages_or_json and isinstance(pages_or_json[0], dict)
        ):
            self._pages = [PageMd(**p) for p in pages_or_json]
        else:
            self._pages = list(pages_or_json)  # type: ignore

    def pages(self, pdf_path: Path) -> list[PageMd]:
        return self._pages


class PyMuPdfEngine:
    """Fast CPU PDF extraction using pymupdf4llm."""

    def pages(self, pdf_path: Path) -> list[PageMd]:
        try:
            import pymupdf4llm
        except ImportError as e:
            raise IngestError(
                "pymupdf4llm is not installed. Install with `uv add pymupdf4llm`."
            ) from e

        chunks = pymupdf4llm.to_markdown(str(pdf_path), page_chunks=True)
        pages_out: list[PageMd] = []
        for c in chunks:
            page_no = c.get("metadata", {}).get("page", len(pages_out) + 1)
            text = c.get("text", "")
            pages_out.append(PageMd(page_no=page_no, markdown=text, images=[]))
        return pages_out


class MarkerEngine:
    """High quality Deep Learning PDF extraction using marker-pdf."""

    def pages(self, pdf_path: Path) -> list[PageMd]:
        try:
            from marker.converters.pdf import PdfConverter
            from marker.models import create_model_dict
        except ImportError as e:
            raise IngestError(
                "marker-pdf is not installed. Install with `uv add marker-pdf`."
            ) from e

        converter = PdfConverter(artifact_dict=create_model_dict())
        rendered = converter(str(pdf_path))
        full_md = rendered.markdown
        # Split on page breaks if marker includes them, or return as single page
        return [PageMd(page_no=1, markdown=full_md, images=[])]


@register_ingestor
class PdfIngestor(SourceIngestor):
    """Ingests PDF documents page by page into lines and anchors."""

    kind: ClassVar[Literal["pdf", "blog", "video", "markdown"]] = "pdf"

    def __init__(self, settings: Settings, engine: PdfEngine | None = None):
        super().__init__(settings)
        self.engine = engine

    @classmethod
    def can_handle(cls, ref: SourceRef) -> bool:
        if ref.kind_hint == "pdf":
            return True
        if ref.path and ref.path.suffix.lower() == ".pdf":
            return True
        return False

    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult:
        if not ref.path or not ref.path.exists():
            raise IngestError(f"PDF source reference must have a local path: {ref}")
        dest = tmp / "original.pdf"
        shutil.copy2(ref.path, dest)
        return FetchResult(original=dest, extra=[])

    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo:
        engine = self.engine
        if engine is None:
            engine_choice = getattr(self.s.convert.pdf, "engine", "fake")
            if engine_choice == "pymupdf":
                engine = PyMuPdfEngine()
            elif engine_choice == "marker":
                engine = MarkerEngine()
            else:
                # Default fallback
                engine = PyMuPdfEngine()

        pages = engine.pages(fetched.original)
        if not pages:
            raise IngestError(f"No pages extracted from {fetched.original.name}")

        first_heading: str | None = None

        for p in pages:
            doc.page(p.page_no)
            for line in p.markdown.splitlines():
                stripped = line.strip()
                if not stripped:
                    doc.blank()
                    continue

                m_h = re.match(r"^(#{1,6})\s+(.*)$", stripped)
                if m_h:
                    level = len(m_h.group(1))
                    h_text = m_h.group(2).strip()
                    if first_heading is None:
                        first_heading = h_text
                    doc.heading(level, h_text)
                    continue

                m_img = re.match(r"^!\[(.*?)\]\((.*?)\)$", stripped)
                if m_img:
                    caption = m_img.group(1).strip()
                    img_path_str = m_img.group(2).strip()
                    img_file = Path(img_path_str)
                    if not img_file.is_absolute():
                        img_file = fetched.original.parent / img_path_str

                    if img_file.exists():
                        doc.image(img_file, caption or "Figure", "figure")
                        continue

                doc.text(line)

        title = first_heading or fetched.original.stem.replace("-", " ").replace("_", " ").title()
        return SourceInfo(title=title, authors=[])
