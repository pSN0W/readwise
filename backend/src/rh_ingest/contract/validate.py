"""Library validation for Reading Helper."""

import hashlib
import json
from pathlib import Path

from rh_ingest.contract.models import (
    CardsDocument,
    DeviceState,
    IngestReport,
    LibraryManifest,
    SourceMeta,
    TagSuggestionsDocument,
)


def validate_library(library_dir: Path) -> list[str]:
    """Validate a library folder against contract schemas and consistency rules.

    Returns a list of error messages (empty if completely valid).
    """
    errors: list[str] = []
    lib_path = Path(library_dir)

    if not lib_path.exists() or not lib_path.is_dir():
        return [f"Library directory does not exist: {lib_path}"]

    # 1. library.json
    manifest_file = lib_path / "library.json"
    manifest: LibraryManifest | None = None
    if not manifest_file.exists():
        errors.append("Missing library.json")
    else:
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            manifest = LibraryManifest.model_validate(data)
        except Exception as e:
            errors.append(f"Invalid library.json: {e}")

    # 2. cards.json
    cards_file = lib_path / "cards.json"
    cards_doc: CardsDocument | None = None
    if not cards_file.exists():
        errors.append("Missing cards.json")
    else:
        try:
            with open(cards_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            cards_doc = CardsDocument.model_validate(data)
        except Exception as e:
            errors.append(f"Invalid cards.json: {e}")

    # Generation check
    if manifest and cards_doc:
        if manifest.generation != cards_doc.generation:
            errors.append(
                f"Generation mismatch: library.json is {manifest.generation} but cards.json is {cards_doc.generation}"
            )

    # 3. tag_suggestions.json (optional)
    tags_file = lib_path / "tag_suggestions.json"
    if tags_file.exists():
        try:
            with open(tags_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            TagSuggestionsDocument.model_validate(data)
        except Exception as e:
            errors.append(f"Invalid tag_suggestions.json: {e}")

    # 4. reports/ (optional)
    reports_dir = lib_path / "reports"
    if reports_dir.exists():
        for r_file in reports_dir.glob("*.json"):
            try:
                with open(r_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                IngestReport.model_validate(data)
            except Exception as e:
                errors.append(f"Invalid report file {r_file.name}: {e}")

    # 5. sources/
    source_lines: dict[str, int] = {}
    sources_dir = lib_path / "sources"
    if manifest:
        for s in manifest.sources:
            s_dir = sources_dir / s.id
            if not s_dir.exists():
                errors.append(f"Source folder missing for {s.id}: {s_dir}")
                continue

            meta_file = s_dir / "meta.json"
            content_file = s_dir / "content.md"

            if not content_file.exists():
                errors.append(f"Missing content.md for source {s.id}")
                continue

            content_bytes = content_file.read_bytes()
            content_sha256 = hashlib.sha256(content_bytes).hexdigest()
            try:
                content_text = content_bytes.decode("utf-8")
                lines = content_text.splitlines()
            except Exception as e:
                errors.append(f"Failed to decode content.md for {s.id}: {e}")
                continue

            source_lines[s.id] = len(lines)

            if not meta_file.exists():
                errors.append(f"Missing meta.json for source {s.id}")
                continue

            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    m_data = json.load(f)
                meta = SourceMeta.model_validate(m_data)

                if meta.id != s.id:
                    errors.append(f"Meta id {meta.id} does not match source id {s.id}")
                if meta.n_lines != len(lines):
                    errors.append(
                        f"Source {s.id} meta.n_lines ({meta.n_lines}) != actual lines ({len(lines)})"
                    )
                if meta.content_bytes != len(content_bytes):
                    errors.append(
                        f"Source {s.id} meta.content_bytes ({meta.content_bytes}) != actual bytes ({len(content_bytes)})"
                    )
                if meta.content_sha256 != content_sha256:
                    errors.append(f"Source {s.id} meta.content_sha256 != actual sha256")

                # Validate anchors
                if not meta.anchors or meta.anchors[0] != [1, 0]:
                    errors.append(f"Source {s.id} first anchor must be [1, 0]")

                with open(content_file, "rb") as cf:
                    for line_no, byte_offset in meta.anchors:
                        if not (1 <= line_no <= len(lines)):
                            errors.append(f"Source {s.id} anchor line {line_no} out of bounds")
                            continue
                        cf.seek(byte_offset)
                        expected_line = lines[line_no - 1].encode("utf-8")
                        read_line = cf.readline().rstrip(b"\r\n")
                        if read_line != expected_line:
                            errors.append(
                                f"Source {s.id} anchor at line {line_no} (byte {byte_offset}) read mismatch: "
                                f"expected {expected_line[:30]!r}, got {read_line[:30]!r}"
                            )

                # Validate assets exist
                for asset in meta.assets:
                    asset_path = s_dir / asset.path
                    if not asset_path.exists():
                        errors.append(f"Source {s.id} asset file missing: {asset.path}")

            except Exception as e:
                errors.append(f"Invalid meta.json for source {s.id}: {e}")

    # 6. Validate cards refs
    if cards_doc:
        for card in cards_doc.cards:
            for ref in card.refs:
                if ref.source not in source_lines:
                    errors.append(f"Card {card.id} references unknown source {ref.source}")
                    continue
                max_lines = source_lines[ref.source]
                if not (1 <= ref.start <= ref.end <= max_lines):
                    errors.append(
                        f"Card {card.id} ref range {ref.start}-{ref.end} invalid for source {ref.source} (1..{max_lines})"
                    )

    # 7. state/*.json (optional)
    state_dir = lib_path / "state"
    if state_dir.exists():
        for st_file in state_dir.glob("*.json"):
            try:
                with open(st_file, "r", encoding="utf-8") as f:
                    s_data = json.load(f)
                DeviceState.model_validate(s_data)
            except Exception as e:
                errors.append(f"Invalid state file {st_file.name}: {e}")

    return errors
