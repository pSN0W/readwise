"""YouTube video ingestion with subtitle parsing, rolling deduplication, and chapter TOC."""

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal

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
class Cue:
    start_s: float
    end_s: float
    text: str


def parse_vtt_timestamp(ts: str) -> float:
    """Parse VTT timestamp MM:SS.mmm or HH:MM:SS.mmm to seconds."""
    parts = ts.strip().split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def parse_vtt(text: str) -> list[Cue]:
    """Parse WebVTT content into list of Cues."""
    cues: list[Cue] = []
    blocks = re.split(r"\n\s*\n", text.strip())

    for block in blocks:
        lines = [line_str.strip() for line_str in block.splitlines() if line_str.strip()]
        if not lines:
            continue
        # Check for timestamp line
        ts_line_idx = -1
        for i, line in enumerate(lines):
            if "-->" in line:
                ts_line_idx = i
                break
        if ts_line_idx == -1:
            continue

        ts_parts = lines[ts_line_idx].split("-->")
        start_s = parse_vtt_timestamp(ts_parts[0].split()[0])
        end_s = parse_vtt_timestamp(ts_parts[1].split()[0])

        cue_lines = lines[ts_line_idx + 1 :]
        # Strip WebVTT formatting tags like <c>...</c>, <00:00:01.000>
        cleaned_lines = []
        for cl in cue_lines:
            no_tags = re.sub(r"<[^>]+>", "", cl).strip()
            if no_tags:
                cleaned_lines.append(no_tags)

        cue_text = " ".join(cleaned_lines)
        if cue_text:
            cues.append(Cue(start_s=start_s, end_s=end_s, text=cue_text))

    return cues


def dedupe_rolling_cues(cues: list[Cue]) -> list[Cue]:
    """Remove rolling duplicate phrases/lines common in auto-generated captions."""
    if not cues:
        return []

    deduped: list[Cue] = []
    prev_text = ""

    for c in cues:
        curr_text = c.text.strip()
        if not curr_text:
            continue

        # If current text is identical to previous, skip
        if curr_text == prev_text:
            continue

        # If current text begins with previous text, take the suffix
        if curr_text.startswith(prev_text):
            suffix = curr_text[len(prev_text) :].strip()
            if suffix:
                deduped.append(Cue(start_s=c.start_s, end_s=c.end_s, text=suffix))
                prev_text = curr_text
            continue

        # If previous text ends with the start of current text, trim overlap
        words_prev = prev_text.split()
        words_curr = curr_text.split()
        overlap_found = False

        for k in range(min(len(words_prev), len(words_curr)), 0, -1):
            if words_prev[-k:] == words_curr[:k]:
                suffix = " ".join(words_curr[k:])
                if suffix:
                    deduped.append(Cue(start_s=c.start_s, end_s=c.end_s, text=suffix))
                    prev_text = curr_text
                overlap_found = True
                break

        if not overlap_found:
            deduped.append(c)
            prev_text = curr_text

    return deduped


def format_timestamp(s: float, duration: float) -> str:
    total_sec = int(s)
    if duration >= 3600:
        h = total_sec // 3600
        m = (total_sec % 3600) // 60
        sec = total_sec % 60
        return f"{h}:{m:02d}:{sec:02d}"
    else:
        m = total_sec // 60
        sec = total_sec % 60
        return f"{m}:{sec:02d}"


@register_ingestor
class YouTubeIngestor(SourceIngestor):
    """Ingests YouTube videos using subtitles and chapter metadata."""

    kind: ClassVar[Literal["pdf", "blog", "video", "markdown"]] = "video"

    @classmethod
    def can_handle(cls, ref: SourceRef) -> bool:
        if ref.kind_hint == "video":
            return True
        if ref.url:
            u = ref.url.lower()
            return "youtube.com" in u or "youtu.be" in u
        return False

    def fetch(self, ref: SourceRef, tmp: Path) -> FetchResult:
        # Check if ref is a local test info.json file
        if ref.path and ref.path.name.endswith(".info.json") and ref.path.exists():
            dest = tmp / "original.info.json"
            dest.write_bytes(ref.path.read_bytes())
            extras: list[Path] = []
            # Find matching vtt in same directory
            for vtt_file in ref.path.parent.glob("*.vtt"):
                dest_vtt = tmp / vtt_file.name
                dest_vtt.write_bytes(vtt_file.read_bytes())
                extras.append(dest_vtt)
            return FetchResult(original=dest, extra=extras)

        url = ref.url
        if not url:
            raise IngestError(f"No URL provided for YouTube ref: {ref}")

        try:
            import yt_dlp
        except ImportError as e:
            raise IngestError(
                "yt-dlp is not installed. Install with `uv add 'yt-dlp[default]'`."
            ) from e

        out_prefix = str(tmp / "original")
        ydl_opts = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": getattr(self.s.convert.video, "subtitle_langs", ["en"]),
            "subtitlesformat": "vtt",
            "writeinfojson": True,
            "outtmpl": out_prefix,
            "quiet": True,
            "no_warnings": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        info_json = tmp / "original.info.json"
        if not info_json.exists():
            raise IngestError(f"yt-dlp did not produce {info_json.name}")

        vtt_files = list(tmp.glob("*.vtt"))
        return FetchResult(original=info_json, extra=vtt_files)

    def to_markdown(self, fetched: FetchResult, doc: DocBuilder) -> SourceInfo:
        info_json_path = fetched.original
        info = json.loads(info_json_path.read_text(encoding="utf-8"))

        duration = float(info.get("duration", 0))
        title = info.get("title") or "Untitled Video"
        uploader = info.get("uploader") or info.get("channel")
        authors = [uploader] if uploader else []

        # Find VTT file
        vtt_file = None
        for f in fetched.extra:
            if f.suffix.lower() == ".vtt":
                vtt_file = f
                break
        if not vtt_file:
            vtts = list(info_json_path.parent.glob("*.vtt"))
            if vtts:
                vtt_file = vtts[0]

        if not vtt_file or not vtt_file.exists():
            raise IngestError(f"No VTT subtitle file found for {title}")

        raw_cues = parse_vtt(vtt_file.read_text(encoding="utf-8"))
        cues = dedupe_rolling_cues(raw_cues)

        if not cues:
            raise IngestError(f"No cues extracted from {vtt_file.name}")

        # Chapters sorted by start_time
        chapters = sorted(
            info.get("chapters") or [],
            key=lambda c: float(c.get("start_time", 0)),
        )
        next_chapter_idx = 0

        # Group cues into ~10 second blocks
        blocks: list[tuple[float, str]] = []
        curr_start = cues[0].start_s
        curr_words: list[str] = []

        for c in cues:
            if c.start_s - curr_start >= 10.0 and curr_words:
                blocks.append((curr_start, " ".join(curr_words)))
                curr_start = c.start_s
                curr_words = [c.text]
            else:
                curr_words.append(c.text)

        if curr_words:
            blocks.append((curr_start, " ".join(curr_words)))

        # Emit chapters and lines
        for start_s, block_text in blocks:
            # Emit chapters placed before the first line at or after the chapter start
            while next_chapter_idx < len(chapters):
                ch = chapters[next_chapter_idx]
                ch_start = float(ch.get("start_time", 0))
                if ch_start <= start_s:
                    doc.heading(2, ch.get("title", f"Chapter {next_chapter_idx + 1}"))
                    next_chapter_idx += 1
                else:
                    break

            ts_str = format_timestamp(start_s, duration)
            doc.time(start_s)
            doc.text(f"[{ts_str}] {block_text}")

        return SourceInfo(title=title, authors=authors)
