"""Base ingestion classes and DocBuilder for Reading Helper."""

import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar, Literal

from rh_ingest.config import Settings
from rh_ingest.contract.models import MetaAsset, MetaToc, SourceMeta
from rh_ingest.contract.writer import LibraryWriter
from rh_ingest.intake.refs import SourceRef


class IngestError(Exception):
    pass


@dataclass
class BuiltDoc:
    lines: list[str]
    toc: list[MetaToc]
    pages: list[list[int | float]] | None
    times: list[list[int | float]] | None
    assets: list[MetaAsset]
    assets_dir: Path


@dataclass
class SourceInfo:
    title: str
    authors: list[str] = field(default_factory=list)
    duration_s: float | None = None
    pages: int | None = None


@dataclass
class Origin:
    filename: str | None = None
    url: str | None = None


@dataclass
class FetchResult:
    original: Path
    extra: list[Path] = field(default_factory=list)
    origin: Origin = field(default_factory=Origin)


class DocBuilder:
    """Document builder that keeps exact line numbers for TOC, pages, times, and assets."""

    def __init__(self, assets_dir: Path):
        self.assets_dir = Path(assets_dir)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.lines: list[str] = []
        self._toc: list[MetaToc] = []
        self._pages: list[list[int | float]] = []
        self._times: list[list[int | float]] = []
        self._assets: list[MetaAsset] = []
        self._pending_page: int | None = None
        self._pending_time: float | None = None
        self._image_counter = 0

    def page(self, n: int) -> None:
        """The NEXT line added starts page n. Store a run only if n changed."""
        self._pending_page = n

    def time(self, s: float) -> None:
        """The NEXT line starts at second s."""
        self._pending_time = s

    def _before_add_line(self) -> None:
        next_line_no = len(self.lines) + 1
        if self._pending_page is not None:
            if not self._pages or self._pages[-1][1] != self._pending_page:
                self._pages.append([next_line_no, self._pending_page])
            self._pending_page = None

        if self._pending_time is not None:
            self._times.append([next_line_no, self._pending_time])
            self._pending_time = None

    def blank(self) -> None:
        """Add one empty line (never two in a row)."""
        if self.lines and self.lines[-1] != "":
            self.lines.append("")

    def heading(self, level: int, title: str) -> int:
        """Add a blank line if last line is not blank, then heading line.

        Records a toc item {title, level, line}. Returns the line number (1-based).
        """
        if self.lines and self.lines[-1] != "":
            self.blank()
        self._before_add_line()
        line_no = len(self.lines) + 1
        self.lines.append(f"{'#' * level} {title}")
        self._toc.append(MetaToc(title=title, level=level, line=line_no))
        return line_no

    def text(self, block: str) -> int:
        """Append block split by newline; \r removed. Returns first line number (1-based)."""
        clean = block.replace("\r", "")
        parts = clean.split("\n")
        first_line = len(self.lines) + 1
        for idx, part in enumerate(parts):
            self._before_add_line()
            self.lines.append(part)
        return first_line

    def image(
        self,
        src: Path,
        caption: str,
        kind: Literal["figure", "slide", "image"],
        time_s: float | None = None,
    ) -> int:
        """Copies src -> assets/<kind>-NNN.<ext>. Adds its own markdown image line.

        Returns the image's line number (1-based).
        """
        src = Path(src)
        ext = src.suffix or ".png"
        self._image_counter += 1

        if kind == "slide" and time_s is not None:
            sec_int = int(time_s)
            dest_name = f"slide-{sec_int:06d}{ext}"
        else:
            dest_name = f"{kind}-{self._image_counter:03d}{ext}"

        dest_path = self.assets_dir / dest_name
        if src.exists():
            shutil.copy2(src, dest_path)

        if self.lines and self.lines[-1] != "":
            self.blank()

        self._before_add_line()
        img_line = len(self.lines) + 1
        rel_path = f"assets/{dest_name}"
        self.lines.append(f"![{caption}]({rel_path})")
        self.blank()

        self._assets.append(
            MetaAsset(
                path=rel_path,
                line=img_line,
                caption=caption,
                kind=kind,
                time_s=time_s,
            )
        )
        return img_line

    def build(self) -> BuiltDoc:
        # Verify pages sorted
        if self._pages:
            for i in range(len(self._pages) - 1):
                if self._pages[i][0] >= self._pages[i + 1][0]:
                    raise IngestError(f"Pages runs not strictly sorted by line: {self._pages}")

        # Verify times sorted
        if self._times:
            for i in range(len(self._times) - 1):
                if self._times[i][0] >= self._times[i + 1][0]:
                    raise IngestError(f"Times runs not strictly sorted by line: {self._times}")

        return BuiltDoc(
            lines=list(self.lines),
            toc=list(self._toc),
            pages=self._pages if self._pages else None,
            times=self._times if self._times else None,
            assets=list(self._assets),
            assets_dir=self.assets_dir,
        )


class SourceIngestor(ABC):
    """Abstract base class for all source ingestors."""

    kind: ClassVar[Literal["pdf", "blog", "video", "markdown"]]

    def __init__(self, settings: Settings):
        self.s = settings

    @classmethod
    @abstractmethod
    def can_handle(cls, ref: SourceRef) -> bool: ...

    @abstractmethod
    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult: ...

    @abstractmethod
    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo: ...

    def ingest(self, ref: SourceRef, writer: LibraryWriter) -> SourceMeta:
        tmp = self.s.work_dir / "tmp" / ref.sid
        tmp.mkdir(parents=True, exist_ok=True)
        fetched = self.fetch(ref, tmp)
        doc = DocBuilder(assets_dir=tmp / "assets")
        info = self.to_markdown(fetched, doc)
        built = doc.build()
        if not any(line_str.strip() for line_str in built.lines):
            raise IngestError("no text found")
        return writer.write_source(ref.sid, self.kind, info, fetched, built)


# Registry of ingestors populated as modules are created
INGESTORS: list[type[SourceIngestor]] = []


def register_ingestor(cls: type[SourceIngestor]) -> type[SourceIngestor]:
    if cls not in INGESTORS:
        INGESTORS.append(cls)
    return cls


def ingestor_for(ref: SourceRef, s: Settings) -> SourceIngestor:
    for cls in INGESTORS:
        if cls.can_handle(ref):
            return cls(s)
    raise IngestError(f"No ingestor can handle source reference: {ref}")
