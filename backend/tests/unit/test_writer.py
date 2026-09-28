from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest

from rh_ingest.contract.models import (
    Card,
    CardRef,
    LibraryOrigin,
    LibrarySource,
    LibraryTopic,
    MetaAsset,
    MetaToc,
)
from rh_ingest.contract.validate import validate_library
from rh_ingest.contract.writer import LibraryWriter, compute_anchors


@dataclass
class FakeBuiltDoc:
    lines: list[str]
    toc: list[MetaToc]
    pages: list[list[int | float]] | None
    times: list[list[int | float]] | None
    assets: list[MetaAsset]
    assets_dir: Path | None = None


@dataclass
class FakeSourceInfo:
    title: str
    authors: list[str]


@dataclass
class FakeFetchResult:
    original: Path
    extra: list[Path]


def test_anchor_calculation_with_multibyte(tmp_path: Path):
    lines = [
        "First line · with middle dot",
        "Second line with greek α and em-dash — here",
        "Third line normal text",
    ]
    content_bytes, content_sha256, anchors = compute_anchors(lines, anchor_step=1)

    assert len(anchors) == 3
    assert anchors[0] == [1, 0]

    text = "\n".join(lines) + "\n"
    raw_bytes = text.encode("utf-8")
    assert len(raw_bytes) == content_bytes

    # Check that seeking to each anchor gives exactly that line
    for line_no, byte_offset in anchors:
        expected = lines[line_no - 1]
        line_bytes = raw_bytes[byte_offset:].split(b"\n")[0]
        assert line_bytes.decode("utf-8") == expected


def test_library_writer_write_source_and_commit(tmp_path: Path):
    lib_dir = tmp_path / "library"
    writer = LibraryWriter(lib_dir)

    # Prepare fake source
    dummy_orig = tmp_path / "original.md"
    dummy_orig.write_text("# Book 1\nSome text\n", encoding="utf-8")
    fetched = FakeFetchResult(original=dummy_orig, extra=[])
    built = FakeBuiltDoc(
        lines=["# Book 1", "Some text · with special α characters"],
        toc=[MetaToc(title="Book 1", level=1, line=1)],
        pages=None,
        times=None,
        assets=[],
    )
    info = FakeSourceInfo(title="Book 1", authors=["Author One"])

    # Write source
    meta = writer.write_source("s_test1", "markdown", info, fetched, built)
    assert meta.id == "s_test1"
    assert (lib_dir / "sources" / "s_test1" / "content.md").exists()
    assert (lib_dir / "sources" / "s_test1" / "meta.json").exists()

    # Immutability: writing again raises ValueError
    with pytest.raises(ValueError, match="already exists"):
        writer.write_source("s_test1", "markdown", info, fetched, built)

    # Commit library
    cards = [
        Card(
            id="c_0001",
            rev=1,
            title="Card One",
            what="Short description of card one.",
            why=None,
            how=None,
            when=None,
            extra=None,
            topics=["TopicA"],
            refs=[CardRef(source="s_test1", start=1, end=2)],
            images=[],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    ]
    sources = [
        LibrarySource(
            id="s_test1",
            kind="markdown",
            title="Book 1",
            authors=["Author One"],
            origin=LibraryOrigin(filename="original.md"),
            added_at=datetime.now(UTC),
            status="ready",
            n_lines=2,
            n_cards=1,
        )
    ]
    topics = [LibraryTopic(path="TopicA")]

    gen = writer.commit(cards, [], [], sources, topics)
    assert gen == 1
    assert (lib_dir / "library.json").exists()
    assert (lib_dir / "cards.json").exists()

    # Validate library
    errors = validate_library(lib_dir)
    assert errors == []


def test_validate_detects_errors(tmp_path: Path):
    lib_dir = tmp_path / "bad_library"
    writer = LibraryWriter(lib_dir)

    dummy_orig = tmp_path / "original.md"
    dummy_orig.write_text("line 1\n", encoding="utf-8")
    fetched = FakeFetchResult(original=dummy_orig, extra=[])
    built = FakeBuiltDoc(
        lines=["line 1"],
        toc=[],
        pages=None,
        times=None,
        assets=[],
    )
    writer.write_source("s_test2", "markdown", FakeSourceInfo("Title", []), fetched, built)

    # Card with out of range ref (source only has 1 line, ref asks for 1..5)
    cards = [
        Card(
            id="c_0002",
            rev=1,
            title="Card Two",
            what="Description.",
            refs=[CardRef(source="s_test2", start=1, end=5)],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    ]
    sources = [
        LibrarySource(
            id="s_test2",
            kind="markdown",
            title="Title",
            origin=LibraryOrigin(filename="original.md"),
            added_at=datetime.now(UTC),
            status="ready",
            n_lines=1,
            n_cards=1,
        )
    ]
    writer.commit(cards, [], [], sources, [])

    errors = validate_library(lib_dir)
    assert any("invalid for source s_test2" in e for e in errors)
