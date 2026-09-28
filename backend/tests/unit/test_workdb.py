from pathlib import Path

from rh_ingest.workdb import Stage, WorkDB


def test_workdb_init_and_reopen(tmp_path: Path):
    db_file = tmp_path / "work.db"
    db1 = WorkDB(db_file)

    # Check journal mode is WAL
    cur = db1.conn.execute("PRAGMA journal_mode")
    row = cur.fetchone()
    assert row[0].lower() == "wal"

    # Test counters
    c1 = db1.next_card_id()
    c2 = db1.next_card_id()
    assert c1 == "c_0001"
    assert c2 == "c_0002"

    t1 = db1.next_suggestion_id()
    assert t1 == "t_0001"

    # Test jobs
    db1.add_job("s_test", "markdown", path="/tmp/test.md")
    job = db1.get_job("s_test")
    assert job is not None
    assert job["stage"] == Stage.QUEUED
    assert job["attempts"] == 0

    db1.update_job("s_test", stage=Stage.EXTRACTED, attempts=1)
    job_updated = db1.get_job("s_test")
    assert job_updated["stage"] == Stage.EXTRACTED
    assert job_updated["attempts"] == 1

    # Test chunks
    db1.save_chunk("s_test", 0, 1, 100, 80, "hash123", ok=True, tries=1, result={"cards": []})
    chunk = db1.chunk_result("s_test", 0, "hash123")
    assert chunk is not None
    assert chunk["ok"] is True
    assert chunk["result"] == {"cards": []}

    # Test raw_cards and members
    db1.save_raw_card("raw_001", "s_test", 1, 20, {"title": "Title 1"}, 0)
    db1.save_raw_card("raw_002", "s_test", 21, 40, {"title": "Title 2"}, 0)
    db1.link_card_members("c_0001", ["raw_001", "raw_002"])
    members = db1.get_card_members("c_0001")
    assert members == ["raw_001", "raw_002"]

    # Test never_merge
    assert not db1.is_never_merge(["raw_001"], ["raw_002"])
    db1.mark_never_merge("raw_001", "raw_002")
    assert db1.is_never_merge(["raw_001"], ["raw_002"])
    # symmetrical check
    assert db1.is_never_merge(["raw_002"], ["raw_001"])

    # Test merges cache
    db1.log_merge("c_0001", "c_0002", 0.88, "similar", "merge", "same idea", "v1", "modelA")
    verdict = db1.cached_verdict("c_0001", "c_0002", "v1", "modelA")
    assert verdict is not None
    assert verdict["decision"] == "merge"
    # reversed query should also hit cache
    verdict_rev = db1.cached_verdict("c_0002", "c_0001", "v1", "modelA")
    assert verdict_rev is not None

    # Test applied splits
    db1.record_applied_split("c_0001", 1700000000)
    assert db1.get_applied_split_ts("c_0001") == 1700000000

    # Close and reopen
    db1.close()

    db2 = WorkDB(db_file)
    c3 = db2.next_card_id()
    assert c3 == "c_0003"
    assert db2.get_job("s_test")["stage"] == Stage.EXTRACTED
    assert db2.get_card_members("c_0001") == ["raw_001", "raw_002"]
    assert db2.is_never_merge(["raw_001"], ["raw_002"])
    db2.close()
