"""SourceRef and source ID generation for Reading Helper intake."""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def normalize_url(raw_url: str) -> str:
    """Normalize URL by lowercasing host, removing utm_* parameters, and removing fragments."""
    u = urlparse(raw_url)
    netloc = u.netloc.lower()

    # YouTube special canonicalization
    if any(h in netloc for h in ["youtube.com", "youtu.be"]):
        vid_id = None
        if "youtu.be" in netloc:
            vid_id = u.path.strip("/")
        elif "youtube.com" in netloc:
            query = dict(parse_qsl(u.query))
            vid_id = query.get("v")
        if vid_id:
            return f"youtube:{vid_id}"

    # Filter out utm_* params
    filtered_query = []
    for k, v in parse_qsl(u.query, keep_blank_values=True):
        if not k.lower().startswith("utm_"):
            filtered_query.append((k, v))
    query_str = urlencode(filtered_query)

    norm = urlunparse((u.scheme.lower(), netloc, u.path, u.params, query_str, ""))
    return norm


@dataclass(frozen=True)
class SourceRef:
    kind_hint: str | None
    path: Path | None
    url: str | None
    sid: str

    @staticmethod
    def from_path(p: Path, kind_hint: str | None = None) -> "SourceRef":
        p = Path(p).resolve()
        content = p.read_bytes()
        h = hashlib.sha256(content).hexdigest()[:10]
        sid = f"s_{h}"
        return SourceRef(kind_hint=kind_hint, path=p, url=None, sid=sid)

    @staticmethod
    def from_url(u: str, kind_hint: str | None = None) -> "SourceRef":
        norm = normalize_url(u)
        h = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:10]
        sid = f"s_{h}"
        return SourceRef(kind_hint=kind_hint, path=None, url=u, sid=sid)
