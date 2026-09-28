from pathlib import Path

from rh_ingest.chunk import Chunk, LineChunker
from rh_ingest.config import CheckSettings, ChunkSettings
from rh_ingest.extract.checks import check, repair
from rh_ingest.llm.schemas import CardDraft


def test_worked_example_checks():
    """Worked example directly from §9.4 with exact numbers:
    - Chunk = 1201–1500, own_end = 1440.
    - Try 1: cards 1201–1219, 1220–1238, 1239–1342. Gap is 1343–1440 = 98 lines > 20 -> retry.
    - Try 2 adds 1343–1398 and 1399–1452 -> largest gap is 0 -> ok.
    """
    cfg = CheckSettings(max_gap_lines=20, max_description_words=50)
    chunk = Chunk(idx=0, start=1201, end=1500, own_end=1440)
    ignore = set()

    # Try 1
    drafts_try1 = [
        CardDraft(title="Card 1", what="Short description.", start_line=1201, end_line=1219),
        CardDraft(title="Card 2", what="Short description.", start_line=1220, end_line=1238),
        CardDraft(title="Card 3", what="Short description.", start_line=1239, end_line=1342),
    ]
    res1 = check(drafts_try1, chunk, ignore, cfg)
    assert not res1.ok
    assert res1.max_gap_lines == 98
    assert res1.gaps == [[1343, 1440]]
    assert any("Lines 1343–1440 have no card" in fb for fb in res1.feedback_lines)

    # Try 2 adds 1343–1398 and 1399–1452
    drafts_try2 = drafts_try1 + [
        CardDraft(title="Card 4", what="Short description.", start_line=1343, end_line=1398),
        CardDraft(title="Card 5", what="Short description.", start_line=1399, end_line=1452),
    ]
    res2 = check(drafts_try2, chunk, ignore, cfg)
    assert res2.ok
    assert res2.max_gap_lines == 0
    assert res2.gaps == []


def test_description_length_check():
    cfg = CheckSettings(max_gap_lines=20, max_description_words=50)
    chunk = Chunk(idx=0, start=1, end=50, own_end=50)

    # Description over 50 words
    long_desc = "word " * 55
    draft_long = CardDraft(title="Long Card", what=long_desc.strip(), start_line=1, end_line=50)
    res_long = check([draft_long], chunk, set(), cfg)
    assert not res_long.ok
    assert any("description ('what') has 55 words" in fb for fb in res_long.feedback_lines)

    # Description under 50 words
    short_desc = "word " * 40
    draft_short = CardDraft(title="Short Card", what=short_desc.strip(), start_line=1, end_line=50)
    res_short = check([draft_short], chunk, set(), cfg)
    assert res_short.ok


def test_missing_description_check():
    import pytest
    from pydantic import ValidationError

    # Pydantic schema validation: what cannot be empty
    with pytest.raises(ValidationError):
        CardDraft(title="Empty What", what="", start_line=1, end_line=50)

    # Check function validation: missing or whitespace what triggers failure
    cfg = CheckSettings(max_gap_lines=20, max_description_words=50)
    chunk = Chunk(idx=0, start=1, end=50, own_end=50)
    draft = CardDraft(title="Whitespace What", what="   ", start_line=1, end_line=50)
    res = check([draft], chunk, set(), cfg)
    assert not res.ok
    assert any("missing the mandatory required field \"what\"" in fb for fb in res.feedback_lines)


def test_repairs():
    cfg = CheckSettings(clamp_lines=3, trim_overlap_lines=3)
    chunk = Chunk(idx=0, start=10, end=100, own_end=100)

    drafts = [
        # Empty title -> dropped
        CardDraft(title="", what="Some text", start_line=10, end_line=20),
        # Start slips by 2 before chunk.start (start=8) -> clamped to 10
        CardDraft(title="A", what="Desc A", start_line=8, end_line=25),
        # Overlaps by 2 with A (end=25, next start=24) -> trimmed to start at 26
        CardDraft(title="B", what="Desc B", start_line=24, end_line=50),
        # End slips by 2 after chunk.end (end=102) -> clamped to 100
        CardDraft(title="C", what="Desc C", start_line=51, end_line=102),
    ]

    repaired = repair(drafts, chunk, cfg)
    assert len(repaired) == 3
    assert repaired[0].title == "A"
    assert repaired[0].start_line == 10
    assert repaired[1].title == "B"
    assert repaired[1].start_line == 26
    assert repaired[2].title == "C"
    assert repaired[2].end_line == 100


def test_line_chunker_deterministic_and_no_holes():
    content_file = (
        Path(__file__).resolve().parents[3]
        / "fixtures"
        / "library"
        / "sources"
        / "s_booka"
        / "content.md"
    )
    assert content_file.exists(), f"s_booka/content.md not found at {content_file}"
    text = content_file.read_text(encoding="utf-8")

    cfg = ChunkSettings(max_tokens=800, overlap=0.20, tokenizer="chars/4")
    chunker = LineChunker(cfg)

    chunks1 = chunker.split(text)
    chunks2 = chunker.split(text)

    assert len(chunks1) > 0
    # Deterministic
    assert chunks1 == chunks2

    # Check start lines and no holes
    for i in range(len(chunks1)):
        c = chunks1[i]
        assert c.start >= 1
        assert c.start <= c.own_end <= c.end
        if i + 1 < len(chunks1):
            next_c = chunks1[i + 1]
            # No holes rule: next starts before or at current end + 1
            assert next_c.start <= c.end + 1
