from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from pydantic import SecretStr

from rh_ingest.config import EmbedSettings, LLMSettings, MergeSettings
from rh_ingest.contract.models import Card, CardRef
from rh_ingest.llm.client import LLMClient
from rh_ingest.llm.prompts import Prompts
from rh_ingest.merge.index import VectorIndex
from rh_ingest.merge.merger import Merger, union_refs
from rh_ingest.workdb import WorkDB


def test_union_refs_worked_example():
    """Worked example directly from §9.5:
    [s_booka 1399–1452, s_blogb 40–79, s_booka 1441–1470] ->
    [s_booka 1399–1470, s_blogb 40–79]
    Preserves source order of first appearance.
    """
    refs = [
        CardRef(source="s_booka", start=1399, end=1452),
        CardRef(source="s_blogb", start=40, end=79),
        CardRef(source="s_booka", start=1441, end=1470),
    ]
    merged = union_refs(refs)
    assert len(merged) == 2
    assert merged[0] == CardRef(source="s_booka", start=1399, end=1470)
    assert merged[1] == CardRef(source="s_blogb", start=40, end=79)


def test_union_refs_touching_and_disjoint():
    # Touching: 100-120 and 121-140 (touch_gap_lines=0 -> 121 <= 120 + 1)
    refs_touching = [
        CardRef(source="s_1", start=100, end=120),
        CardRef(source="s_1", start=121, end=140),
    ]
    assert union_refs(refs_touching) == [CardRef(source="s_1", start=100, end=140)]

    # Disjoint: 100-120 and 125-140
    refs_disjoint = [
        CardRef(source="s_1", start=100, end=120),
        CardRef(source="s_1", start=125, end=140),
    ]
    assert union_refs(refs_disjoint) == [
        CardRef(source="s_1", start=100, end=120),
        CardRef(source="s_1", start=125, end=140),
    ]


def test_vector_index_basic(tmp_path: Path):
    idx = VectorIndex(dim=4)
    # Card 1 and Card 2
    v1 = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
    v2 = np.array([0.0, 1.0, 0.0, 0.0], dtype=np.float32)
    idx.upsert("c_0001", v1)
    idx.upsert("c_0002", v2)

    # Search for something close to v1
    res = idx.search(np.array([0.9, 0.1, 0.0, 0.0], dtype=np.float32), top_k=2)
    assert len(res) == 2
    assert res[0][0] == "c_0001"
    assert res[0][1] > 0.9

    # Save and reload
    save_file = tmp_path / "test.faiss"
    idx.save(save_file)
    idx_loaded = VectorIndex.load(save_file, dim=4)
    res_loaded = idx_loaded.search(v1, top_k=1)
    assert res_loaded[0][0] == "c_0001"

    # Delete
    idx_loaded.delete("c_0001")
    res_after_del = idx_loaded.search(v1, top_k=2)
    assert len(res_after_del) == 1
    assert res_after_del[0][0] == "c_0002"


def _make_card(cid: str, title: str, what: str, sid: str, start: int, end: int) -> Card:
    now = datetime.now(UTC)
    return Card(
        id=cid,
        rev=1,
        title=title,
        what=what,
        why="Why detail",
        how="How detail",
        when="When detail",
        extra="Extra detail",
        topics=["ML"],
        refs=[CardRef(source=sid, start=start, end=end)],
        images=[],
        created_at=now,
        updated_at=now,
    )


def test_merger_twins_from_overlapping_chunks(mock_server: str, tmp_path: Path):
    """Two twins from overlapping chunks (mock gives equal titles) -> merged into one card with joined range."""
    db = WorkDB(tmp_path / "work.db")
    db.save_raw_card("raw_1", "s_paper", 100, 130, {}, 0)
    db.save_raw_card("raw_2", "s_paper", 125, 160, {}, 1)
    db.link_card_members("c_0001", ["raw_1"])
    db.link_card_members("c_0002", ["raw_2"])

    c1 = _make_card(
        "c_0001", "Self-Attention", "Brief description of self-attention.", "s_paper", 100, 130
    )
    c2 = _make_card(
        "c_0002", "Self-Attention", "Brief description of self-attention.", "s_paper", 125, 160
    )
    cards = {"c_0001": c1, "c_0002": c2}
    retired = []

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_seconds=5.0,
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    client = LLMClient(llm_cfg, emb_cfg)
    prompts = Prompts.load(Path(__file__).parents[2] / "prompts")

    index = VectorIndex(dim=64)
    # Embed brief description
    index.upsert("c_0001", client.embed([c1.what]))
    index.upsert("c_0002", client.embed([c2.what]))

    merge_cfg = MergeSettings(
        threshold=0.8,
        top_k=5,
        overlap_always_judge=True,
        touch_gap_lines=0,
    )
    merger = Merger(cards, retired, index, client, prompts, db, merge_cfg)

    stats = merger.run(new_ids=["c_0001", "c_0002"], touched_sources={"s_paper"})

    assert stats.cards_merged == 1
    assert "c_0002" not in cards
    assert "c_0001" in cards

    # Joined range from union_refs (100–130 + 125–160 -> 100–160)
    merged_card = cards["c_0001"]
    assert len(merged_card.refs) == 1
    assert merged_card.refs[0].start == 100
    assert merged_card.refs[0].end == 160
    assert merged_card.rev == 2

    # Retired list
    assert len(retired) == 1
    assert retired[0].id == "c_0002"
    assert retired[0].into == ["c_0001"]

    # Members linked in DB
    members = db.get_card_members("c_0001")
    assert sorted(members) == ["raw_1", "raw_2"]


def test_merger_rule_a_different_titles_kept_apart(mock_server: str, tmp_path: Path):
    """A Rule-A pair with different titles -> kept apart and listed in kept_apart_overlap."""
    db = WorkDB(tmp_path / "work.db")
    db.save_raw_card("raw_1", "s_paper", 100, 130, {}, 0)
    db.save_raw_card("raw_2", "s_paper", 125, 160, {}, 1)
    db.link_card_members("c_0001", ["raw_1"])
    db.link_card_members("c_0002", ["raw_2"])

    c1 = _make_card(
        "c_0001", "Self-Attention", "Brief description of self-attention.", "s_paper", 100, 130
    )
    c2 = _make_card(
        "c_0002",
        "Positional Encoding",
        "Brief description of positional encoding.",
        "s_paper",
        125,
        160,
    )
    cards = {"c_0001": c1, "c_0002": c2}
    retired = []

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_seconds=5.0,
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    client = LLMClient(llm_cfg, emb_cfg)
    prompts = Prompts.load(Path(__file__).parents[2] / "prompts")
    index = VectorIndex(dim=64)

    merge_cfg = MergeSettings(
        threshold=0.8,
        top_k=5,
        overlap_always_judge=True,
        touch_gap_lines=0,
    )
    merger = Merger(cards, retired, index, client, prompts, db, merge_cfg)

    stats = merger.run(new_ids=["c_0001", "c_0002"], touched_sources={"s_paper"})

    assert stats.cards_merged == 0
    assert "c_0001" in cards
    assert "c_0002" in cards
    assert len(retired) == 0
    assert ("c_0001", "c_0002") in stats.kept_apart_overlap


def test_merger_no_chains(mock_server: str, tmp_path: Path):
    """No chains: A≈B merged, then B≈C -> judged as (A, C) with the merged A."""
    db = WorkDB(tmp_path / "work.db")
    db.save_raw_card("raw_a", "s_paper", 10, 20, {}, 0)
    db.save_raw_card("raw_b", "s_paper", 15, 25, {}, 0)
    db.save_raw_card("raw_c", "s_paper", 22, 35, {}, 0)
    db.link_card_members("c_0001", ["raw_a"])
    db.link_card_members("c_0002", ["raw_b"])
    db.link_card_members("c_0003", ["raw_c"])

    # All three cards describe the same concept "Transformer Layer"
    c1 = _make_card("c_0001", "Transformer Layer", "Brief desc.", "s_paper", 10, 20)
    c2 = _make_card("c_0002", "Transformer Layer", "Brief desc.", "s_paper", 15, 25)
    c3 = _make_card("c_0003", "Transformer Layer", "Brief desc.", "s_paper", 22, 35)
    cards = {"c_0001": c1, "c_0002": c2, "c_0003": c3}
    retired = []

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_seconds=5.0,
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    client = LLMClient(llm_cfg, emb_cfg)
    prompts = Prompts.load(Path(__file__).parents[2] / "prompts")
    index = VectorIndex(dim=64)

    merge_cfg = MergeSettings(
        threshold=0.8,
        top_k=5,
        overlap_always_judge=True,
        touch_gap_lines=0,
    )
    merger = Merger(cards, retired, index, client, prompts, db, merge_cfg)

    stats = merger.run(new_ids=["c_0001", "c_0002", "c_0003"], touched_sources={"s_paper"})

    assert stats.cards_merged == 2
    assert "c_0001" in cards
    assert "c_0002" not in cards
    assert "c_0003" not in cards

    # All 3 raw cards merged into c_0001
    members = db.get_card_members("c_0001")
    assert sorted(members) == ["raw_a", "raw_b", "raw_c"]

    # Both c_0002 and c_0003 retired into c_0001
    ret_map = {r.id: r.into for r in retired}
    assert ret_map["c_0002"] == ["c_0001"]
    assert ret_map["c_0003"] == ["c_0001"]


def test_merger_never_merge(mock_server: str, tmp_path: Path):
    """Never-merge pair in work.db is skipped even if similar/overlapping."""
    db = WorkDB(tmp_path / "work.db")
    db.save_raw_card("raw_1", "s_paper", 100, 130, {}, 0)
    db.save_raw_card("raw_2", "s_paper", 125, 160, {}, 1)
    db.link_card_members("c_0001", ["raw_1"])
    db.link_card_members("c_0002", ["raw_2"])

    # Mark never merge
    db.mark_never_merge("raw_1", "raw_2")

    c1 = _make_card("c_0001", "Self-Attention", "Brief description.", "s_paper", 100, 130)
    c2 = _make_card("c_0002", "Self-Attention", "Brief description.", "s_paper", 125, 160)
    cards = {"c_0001": c1, "c_0002": c2}
    retired = []

    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="gpt-4o-mini",
        timeout_seconds=5.0,
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1",
        api_key=SecretStr("mock"),
        model="text-embedding-3-small",
        dim=64,
    )
    client = LLMClient(llm_cfg, emb_cfg)
    prompts = Prompts.load(Path(__file__).parents[2] / "prompts")
    index = VectorIndex(dim=64)

    merge_cfg = MergeSettings(
        threshold=0.8,
        top_k=5,
        overlap_always_judge=True,
        touch_gap_lines=0,
    )
    merger = Merger(cards, retired, index, client, prompts, db, merge_cfg)

    pairs = merger.candidates(["c_0001", "c_0002"], {"s_paper"})
    assert len(pairs) == 0  # Filtered out by never_merge
