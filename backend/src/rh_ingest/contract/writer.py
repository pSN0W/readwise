"""Atomic library writer and validation for the reading helper library contract."""

import hashlib
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rh_ingest.contract.models import (
    Card,
    CardsDocument,
    IngestReport,
    LibraryManifest,
    LibrarySource,
    LibraryTopic,
    RetiredCard,
    SourceMeta,
    TagSuggestion,
    TagSuggestionsDocument,
)


def atomic_write_json(path: Path, data: Any, indent: int = 2) -> None:
    """Atomically write JSON data to path using a .tmp file and fsync."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    payload = (
        data.model_dump_json(indent=indent)
        if hasattr(data, "model_dump_json")
        else json.dumps(data, indent=indent)
    )

    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(payload)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())

    os.replace(tmp_path, path)


def compute_anchors(lines: list[str], anchor_step: int = 100) -> tuple[int, str, list[list[int]]]:
    """Compute content_bytes, content_sha256, and [line, byte] anchors for lines.

    Returns (content_bytes, content_sha256, anchors).
    """
    text = "\n".join(lines) + "\n" if lines else ""
    encoded = text.encode("utf-8")
    content_bytes = len(encoded)
    content_sha256 = hashlib.sha256(encoded).hexdigest()

    anchors: list[list[int]] = []
    current_byte = 0

    for idx, line in enumerate(lines, start=1):
        if idx == 1 or (idx - 1) % anchor_step == 0:
            anchors.append([idx, current_byte])
        current_byte += len(line.encode("utf-8")) + 1  # line + '\n'

    if not anchors:
        anchors.append([1, 0])

    return content_bytes, content_sha256, anchors


class LibraryWriter:
    """Writes sources and commits library updates according to contract rules."""

    def __init__(self, library_dir: Path):
        self.library_dir = Path(library_dir)

    def write_source(
        self,
        sid: str,
        kind: str,
        info: Any,
        fetched: Any,
        built: Any,
        anchor_step: int = 100,
    ) -> SourceMeta:
        """Write sources/<sid>/ atomically.

        content.md is immutable. Raises ValueError if sources/<sid>/content.md exists.
        """
        sources_dir = self.library_dir / "sources"
        final_dir = sources_dir / sid
        if (final_dir / "content.md").exists():
            raise ValueError(f"Source {sid} already exists; content.md is immutable.")

        tmp_dir = sources_dir / f"{sid}.tmp"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # 1. Move/copy original files into tmp_dir
            orig_src = Path(fetched.original)
            orig_dest = tmp_dir / orig_src.name
            if orig_src.exists():
                shutil.copy2(orig_src, orig_dest)

            extra_names: list[str] = []
            for extra_path in getattr(fetched, "extra", []):
                p = Path(extra_path)
                if p.exists():
                    shutil.copy2(p, tmp_dir / p.name)
                    extra_names.append(p.name)

            # 2. Write content.md
            lines = built.lines
            text = "\n".join(lines) + "\n" if lines else ""
            content_path = tmp_dir / "content.md"
            with open(content_path, "wb") as f:
                f.write(text.encode("utf-8"))
                f.flush()
                os.fsync(f.fileno())

            # 3. Handle assets
            assets_dir = tmp_dir / "assets"
            assets_dir.mkdir(exist_ok=True)
            if (
                hasattr(built, "assets_dir")
                and built.assets_dir
                and Path(built.assets_dir).exists()
            ):
                for asset_file in Path(built.assets_dir).glob("*"):
                    if asset_file.is_file():
                        shutil.copy2(asset_file, assets_dir / asset_file.name)

            # 4. Compute anchors
            content_bytes, content_sha256, anchors = compute_anchors(lines, anchor_step=anchor_step)

            # 5. Build SourceMeta
            meta = SourceMeta(
                schema_version=1,
                id=sid,
                kind=kind,  # type: ignore
                title=info.title,
                original=orig_src.name,
                original_extra=extra_names if extra_names else None,
                content_sha256=content_sha256,
                n_lines=len(lines),
                toc=built.toc,
                pages=built.pages,
                times=built.times,
                assets=built.assets,
                content_bytes=content_bytes,
                anchor_step=anchor_step,
                anchors=anchors,
            )

            # 6. Write meta.json
            with open(tmp_dir / "meta.json", "w", encoding="utf-8") as f:
                f.write(meta.model_dump_json(indent=2))
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())

            # 7. Atomic rename tmp_dir -> final_dir
            if final_dir.exists():
                shutil.rmtree(final_dir)
            tmp_dir.rename(final_dir)

            return meta
        except Exception:
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir)
            raise

    def commit(
        self,
        cards: list[Card],
        retired: list[RetiredCard],
        suggestions: list[TagSuggestion],
        sources: list[LibrarySource],
        topics: list[LibraryTopic],
        report: IngestReport | None = None,
    ) -> int:
        """Publish updates atomically, writing library.json last."""
        # 1. Determine generation
        lib_json_path = self.library_dir / "library.json"
        cur_gen = 0
        if lib_json_path.exists():
            try:
                with open(lib_json_path, "r", encoding="utf-8") as f:
                    old_manifest = json.load(f)
                    cur_gen = old_manifest.get("generation", 0)
            except Exception:
                cur_gen = 0
        gen = cur_gen + 1

        # 2. Sort cards by id
        sorted_cards = sorted(cards, key=lambda c: c.id)

        # 3. Write cards.json
        cards_doc = CardsDocument(
            schema_version=1,
            generation=gen,
            cards=sorted_cards,
            retired=retired,
        )
        atomic_write_json(self.library_dir / "cards.json", cards_doc)

        # 4. Write tag_suggestions.json
        tag_doc = TagSuggestionsDocument(
            schema_version=1,
            generation=gen,
            suggestions=suggestions,
        )
        atomic_write_json(self.library_dir / "tag_suggestions.json", tag_doc)

        # 5. Write reports
        if report:
            reports_dir = self.library_dir / "reports"
            reports_dir.mkdir(parents=True, exist_ok=True)
            atomic_write_json(reports_dir / f"{report.run_id}.json", report)
            atomic_write_json(reports_dir / "latest.json", report)

        # 6. Write library.json last
        manifest = LibraryManifest(
            schema_version=1,
            generation=gen,
            updated_at=datetime.now(UTC),
            sources=sources,
            topics=topics,
        )
        atomic_write_json(lib_json_path, manifest)

        return gen
