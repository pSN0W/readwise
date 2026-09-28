from datetime import UTC, datetime
from pathlib import Path

from pydantic import SecretStr

from rh_ingest.config import EmbedSettings, LLMSettings
from rh_ingest.contract.models import Card, CardRef, StateSplit, TopicDecision
from rh_ingest.contract.state import MergedState, StateReader
from rh_ingest.decisions import DecisionApplier
from rh_ingest.llm.client import LLMClient
from rh_ingest.merge.index import VectorIndex
from rh_ingest.topics import TopicTree, clean_path, flatten_yaml_topics
from rh_ingest.workdb import WorkDB


def test_clean_path():
    assert clean_path("ML/Interpretability/Probing") == "ML/Interpretability/Probing"
    assert clean_path("/ML/Interpretability/Probing/ExtraLevel/") == "ML/Interpretability/Probing"
    assert clean_path("Single") == "Single"
    assert clean_path("") is None


def test_flatten_yaml_topics():
    yaml_obj = {
        "ML": {
            "Interpretability": {
                "Probing": {},
                "Features": {},
            }
        },
        "Focus": ["Deep work"],
    }
    paths = flatten_yaml_topics(yaml_obj)
    assert "ML/Interpretability/Probing" in paths
    assert "ML/Interpretability/Features" in paths
    assert "Focus/Deep work" in paths


def test_state_reader_loads_fixtures():
    fixtures_dir = Path(__file__).resolve().parents[3] / "fixtures" / "library"
    reader = StateReader(fixtures_dir)
    merged = reader.load()
    assert isinstance(merged, MergedState)
    # Check that topic_decisions from laptop-web.json are read
    assert "t_0004" in merged.topic_decisions
    assert merged.topic_decisions["t_0004"].action == "reject"


def test_topic_tree_and_decisions(tmp_path: Path):
    db = WorkDB(tmp_path / "work.db")
    db.save_suggestion("t_0001", "ML/Probing", ["c_0001"], reason="Suggested", status="open")
    db.save_suggestion("t_0002", "Mind/Focus", ["c_0002"], reason="Suggested", status="open")

    now = datetime.now(UTC)
    cards_map = {
        "c_0001": Card(
            id="c_0001",
            rev=1,
            title="Probing Card",
            what="What",
            refs=[CardRef(source="s_01", start=1, end=10)],
            topics=[],
            images=[],
            created_at=now,
            updated_at=now,
        ),
        "c_0002": Card(
            id="c_0002",
            rev=1,
            title="Focus Card",
            what="What",
            refs=[CardRef(source="s_01", start=11, end=20)],
            topics=[],
            images=[],
            created_at=now,
            updated_at=now,
        ),
    }

    tree = TopicTree(tmp_path)
    tree.paths.add("Baseline/Topic")

    # Apply decisions: accept t_0001, reject t_0002
    decisions = {
        "t_0001": TopicDecision(action="accept", path="ML/Probing", ts=1000),
        "t_0002": TopicDecision(action="reject", path=None, ts=1000),
    }
    tree.apply_decisions(decisions, cards_map, db)

    assert "ML/Probing" in tree.paths
    assert "ML/Probing" in cards_map["c_0001"].topics
    assert "Mind/Focus" in tree.rejected_paths

    suggs = {s["id"]: s for s in db.list_suggestions(status=None)}
    assert suggs["t_0001"]["status"] == "accept"
    assert suggs["t_0002"]["status"] == "rejected"


def test_decision_applier_split(mock_server: str, tmp_path: Path):
    db = WorkDB(tmp_path / "work.db")
    # Save 2 raw cards that were previously merged into c_0001
    db.save_raw_card(
        "raw_0001",
        "s_01",
        1,
        20,
        {"title": "Idea One", "what": "Desc 1", "why": "Why 1"},
        0,
    )
    db.save_raw_card(
        "raw_0002",
        "s_01",
        21,
        40,
        {"title": "Idea Two", "what": "Desc 2", "why": "Why 2"},
        0,
    )
    cid = db.next_card_id()
    db.link_card_members(cid, ["raw_0001", "raw_0002"])

    now = datetime.now(UTC)
    card_01 = Card(
        id=cid,
        rev=2,
        title="Merged Ideas",
        what="Combined desc",
        refs=[CardRef(source="s_01", start=1, end=40)],
        topics=[],
        images=[],
        created_at=now,
        updated_at=now,
    )
    cards_map = {cid: card_01}

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
    index = VectorIndex(dim=64)
    tree = TopicTree(tmp_path)

    applier = DecisionApplier(db, client, index, tree)

    merged_state = MergedState(
        splits={"c_0001": StateSplit(v=True, ts=2000)},
    )
    splits_applied, new_cards = applier.apply(merged_state, cards_map)

    assert splits_applied == 1
    assert len(new_cards) == 1
    new_cid = new_cards[0]

    # c_0001 retains raw_0001 with rev bumped
    assert cards_map["c_0001"].title == "Idea One"
    assert cards_map["c_0001"].rev == 3
    assert cards_map["c_0001"].refs[0].start == 1
    assert cards_map["c_0001"].refs[0].end == 20
    assert db.get_card_members("c_0001") == ["raw_0001"]

    # new card gets raw_0002
    assert cards_map[new_cid].title == "Idea Two"
    assert cards_map[new_cid].refs[0].start == 21
    assert cards_map[new_cid].refs[0].end == 40
    assert db.get_card_members(new_cid) == ["raw_0002"]

    # never_merge recorded
    assert db.is_never_merge(["raw_0001"], ["raw_0002"])
    # applied_split recorded
    assert db.get_applied_split_ts("c_0001") == 2000
