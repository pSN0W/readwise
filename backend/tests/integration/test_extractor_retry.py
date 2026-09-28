from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from rh_ingest.chunk import Chunk
from rh_ingest.config import CheckSettings, EmbedSettings, LLMSettings, Settings
from rh_ingest.extract.extractor import CardExtractor
from rh_ingest.llm.client import LLMClient
from rh_ingest.llm.prompts import Prompts
from rh_ingest.workdb import WorkDB


@pytest.fixture
def extractor_setup(tmp_path: Path, mock_server: str):
    prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
    prompts = Prompts(
        cards_path=prompts_dir / "cards.md",
        retry_path=prompts_dir / "cards_retry.md",
        merge_path=prompts_dir / "merge.md",
    )
    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-cards"
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-embed"
    )
    client = LLMClient(llm_cfg, emb_cfg)
    cfg = Settings(
        llm=llm_cfg,
        embeddings=emb_cfg,
        checks=CheckSettings(max_gap_lines=20, max_description_words=50, max_retries=3),
    )
    extractor = CardExtractor(client, prompts, cfg)
    db = WorkDB(tmp_path / "work.db")
    return extractor, db, mock_server


def test_extractor_gap_retry_success(extractor_setup):
    extractor, db, mock_server = extractor_setup
    httpx.post(f"{mock_server}/_mock/reset")
    # 1 gap fault: drops middle card on 1st attempt -> gap > 20 lines -> retries -> ok on attempt 2
    httpx.post(f"{mock_server}/_mock/faults", json={"gap": 1})

    lines = [
        f"Line {i} content text discussing neural network activations and features."
        for i in range(1, 101)
    ]
    chunk = Chunk(idx=0, start=1, end=100, own_end=100)

    res = extractor.extract(
        sid="s_test_gap",
        title="Test Document",
        lines=lines,
        chunk=chunk,
        topics=["ML/Features"],
        db=db,
        ignore=set(),
    )
    assert res.ok is True
    assert res.tries == 2
    assert len(res.drafts) > 0


def test_extractor_long_description_retry_success(extractor_setup):
    extractor, db, mock_server = extractor_setup
    httpx.post(f"{mock_server}/_mock/reset")
    # 1 long_description fault: produces description > 50 words on 1st attempt -> retries -> ok on attempt 2
    httpx.post(f"{mock_server}/_mock/faults", json={"long_description": 1})

    lines = [f"Line {i} content text." for i in range(1, 40)]
    chunk = Chunk(idx=0, start=1, end=40, own_end=40)

    res = extractor.extract(
        sid="s_test_long_desc",
        title="Test Document",
        lines=lines,
        chunk=chunk,
        topics=["ML/Features"],
        db=db,
        ignore=set(),
    )
    assert res.ok is True
    assert res.tries == 2


def test_extractor_small_slip_repaired_no_retry(extractor_setup):
    extractor, db, mock_server = extractor_setup
    httpx.post(f"{mock_server}/_mock/reset")
    # small_slip: slips end by 2 lines -> clamp repairs in code -> no retry!
    httpx.post(f"{mock_server}/_mock/faults", json={"small_slip": 1})

    lines = [f"Line {i} content text." for i in range(1, 40)]
    chunk = Chunk(idx=0, start=1, end=40, own_end=40)

    res = extractor.extract(
        sid="s_test_slip",
        title="Test Document",
        lines=lines,
        chunk=chunk,
        topics=["ML/Features"],
        db=db,
        ignore=set(),
    )
    assert res.ok is True
    assert res.tries == 1


def test_extractor_bad_json_partial_accept(extractor_setup):
    extractor, db, mock_server = extractor_setup
    httpx.post(f"{mock_server}/_mock/reset")
    # 3 bad_json faults -> fails all 3 attempts -> partial accept (tries=3, ok=False)
    httpx.post(f"{mock_server}/_mock/faults", json={"bad_json": 3})

    lines = [f"Line {i} content text." for i in range(1, 40)]
    chunk = Chunk(idx=0, start=1, end=40, own_end=40)

    res = extractor.extract(
        sid="s_test_bad_json",
        title="Test Document",
        lines=lines,
        chunk=chunk,
        topics=["ML/Features"],
        db=db,
        ignore=set(),
    )
    assert res.ok is False
    assert res.tries == 3
