"""Ingestion modules for Reading Helper."""

from rh_ingest.ingest.base import (
    INGESTORS,
    DocBuilder,
    FetchResult,
    IngestError,
    Origin,
    SourceInfo,
    SourceIngestor,
    ingestor_for,
    register_ingestor,
)
from rh_ingest.ingest.blog import BlogIngestor
from rh_ingest.ingest.markdown import MarkdownIngestor
from rh_ingest.ingest.pdf import PdfIngestor
from rh_ingest.ingest.youtube import YouTubeIngestor

__all__ = [
    "INGESTORS",
    "BlogIngestor",
    "DocBuilder",
    "FetchResult",
    "IngestError",
    "MarkdownIngestor",
    "Origin",
    "PdfIngestor",
    "SourceInfo",
    "SourceIngestor",
    "YouTubeIngestor",
    "ingestor_for",
    "register_ingestor",
]
