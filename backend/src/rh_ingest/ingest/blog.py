"""BlogIngestor using httpx and trafilatura to ingest web articles."""

import logging
import re
from pathlib import Path
from typing import ClassVar, Literal

import httpx
import trafilatura

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


@register_ingestor
class BlogIngestor(SourceIngestor):
    """Ingests blog posts and HTML articles via trafilatura."""

    kind: ClassVar[Literal["pdf", "blog", "video", "markdown"]] = "blog"

    @classmethod
    def can_handle(cls, ref: SourceRef) -> bool:
        if ref.kind_hint == "blog":
            return True
        if ref.url:
            u = ref.url.lower()
            return not ("youtube.com" in u or "youtu.be" in u)
        return False

    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult:
        if ref.path and ref.path.exists() and ref.path.suffix.lower() in (".html", ".htm"):
            dest = tmp / "original.html"
            dest.write_bytes(ref.path.read_bytes())
            return FetchResult(original=dest, extra=[])

        url = ref.url
        if not url:
            raise IngestError(f"No URL provided for blog ref: {ref}")

        headers = {"User-Agent": self.s.convert.blog.user_agent}
        try:
            with httpx.Client(
                follow_redirects=True, timeout=self.s.convert.blog.timeout_s
            ) as client:
                resp = client.get(url, headers=headers)
                resp.raise_for_status()
                html = resp.text
        except Exception as e:
            raise IngestError(f"Failed to fetch blog URL {url}: {e}") from e

        dest = tmp / "original.html"
        dest.write_text(html, encoding="utf-8")
        return FetchResult(original=dest, extra=[])

    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo:
        html = fetched.original.read_text(encoding="utf-8")
        extracted_md = trafilatura.extract(
            html,
            output_format="markdown",
            include_images=True,
            include_links=False,
            with_metadata=True,
        )

        if not extracted_md or not extracted_md.strip():
            raise IngestError(f"Trafilatura could not extract text from {fetched.original.name}")

        meta = trafilatura.extract_metadata(html)
        title = meta.title if meta and meta.title else None
        authors = [meta.author] if meta and meta.author else []

        # Parse lines
        img_idx = 0
        first_heading: str | None = None

        with httpx.Client(timeout=10.0) as client:
            for line in extracted_md.splitlines():
                stripped = line.strip()
                if not stripped:
                    doc.blank()
                    continue

                # Headings: ^(#{1,6})\s+(.*)$
                m_h = re.match(r"^(#{1,6})\s+(.*)$", stripped)
                if m_h:
                    level = len(m_h.group(1))
                    h_text = m_h.group(2).strip()
                    if first_heading is None:
                        first_heading = h_text
                    doc.heading(level, h_text)
                    continue

                # Image: ^!\[(.*?)\]\((.*?)\)$
                m_img = re.match(r"^!\[(.*?)\]\((.*?)\)$", stripped)
                if m_img:
                    alt = m_img.group(1).strip()
                    img_url = m_img.group(2).strip()
                    # Try to download image if it's http/https
                    if img_url.startswith("http://") or img_url.startswith("https://"):
                        img_idx += 1
                        ext = Path(img_url.split("?")[0]).suffix or ".png"
                        if ext.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                            ext = ".png"
                        img_tmp = doc.assets_dir / f"download_{img_idx}{ext}"
                        doc.assets_dir.mkdir(parents=True, exist_ok=True)
                        try:
                            r = client.get(img_url)
                            if r.status_code == 200:
                                img_tmp.write_bytes(r.content)
                                doc.image(img_tmp, alt or "Figure", "image")
                                continue
                        except Exception as e:
                            logger.warning("Could not download image %s: %s", img_url, e)

                doc.text(line)

        final_title = title or first_heading or "Untitled Blog Post"
        return SourceInfo(title=final_title, authors=authors)
