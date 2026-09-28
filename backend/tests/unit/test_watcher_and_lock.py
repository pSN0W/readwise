import time
from pathlib import Path

import pytest

from rh_ingest.intake.watcher import InboxWatcher, guess_kind_from_path
from rh_ingest.lock import FileLock, LockError
from rh_ingest.workdb import Stage, WorkDB


def test_file_lock_mutual_exclusion(tmp_path: Path):
    lock_file = tmp_path / "test.lock"

    lock1 = FileLock(lock_file)
    lock2 = FileLock(lock_file)

    with lock1:
        assert lock_file.exists()
        # lock2 cannot acquire while lock1 is held
        with pytest.raises(LockError):
            lock2.acquire()

    # After lock1 releases, lock2 can acquire successfully
    with lock2:
        assert lock2.fd is not None


def test_guess_kind_from_path():
    assert guess_kind_from_path(Path("doc.pdf")) == "pdf"
    assert guess_kind_from_path(Path("article.md")) == "markdown"
    assert guess_kind_from_path(Path("article.txt")) == "markdown"
    assert guess_kind_from_path(Path("page.html")) == "blog"
    assert guess_kind_from_path(Path("data.csv")) == "unknown"


def test_inbox_watcher_file_settling(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    db = WorkDB(work_dir / "work.db")

    watcher = InboxWatcher(lib_dir, work_dir, db, settle_s=0.1)

    inbox_dir = lib_dir / "inbox"
    incoming_dir = work_dir / "incoming"

    # Place a file in inbox
    sample_file = inbox_dir / "test_doc.md"
    sample_file.write_text("# Hello world\nContent here", encoding="utf-8")

    # First scan: records size, not yet settled
    refs1 = watcher.scan_once()
    assert refs1 == []
    assert sample_file.exists()
    assert not (incoming_dir / "test_doc.md").exists()

    # Wait for settle_s
    time.sleep(0.15)

    # Second scan: file settled, moved to incoming
    refs2 = watcher.scan_once()
    assert len(refs2) == 1
    ref = refs2[0]
    assert ref.kind_hint == "markdown"
    assert not sample_file.exists()
    assert (incoming_dir / "test_doc.md").exists()

    # Check job added to WorkDB
    job = db.get_job(ref.sid)
    assert job is not None
    assert job["stage"] == Stage.QUEUED
    assert job["kind"] == "markdown"
    assert job["path"] == str(incoming_dir / "test_doc.md")


def test_inbox_watcher_links_txt(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    db = WorkDB(work_dir / "work.db")

    watcher = InboxWatcher(lib_dir, work_dir, db, settle_s=0.1)
    inbox_dir = lib_dir / "inbox"
    links_file = inbox_dir / "links.txt"

    # Append first link
    links_file.write_text("https://example.com/blog/post1\n", encoding="utf-8")

    refs1 = watcher.scan_once()
    assert len(refs1) == 1
    assert refs1[0].url == "https://example.com/blog/post1"
    assert refs1[0].kind_hint == "blog"

    job1 = db.get_job(refs1[0].sid)
    assert job1 is not None
    assert job1["stage"] == Stage.QUEUED

    # Scan again without changes: nothing new
    refs_dup = watcher.scan_once()
    assert refs_dup == []

    # Append second link (YouTube)
    with open(links_file, "a", encoding="utf-8") as f:
        f.write("https://www.youtube.com/watch?v=dQw4w9WgXcQ\n")

    refs2 = watcher.scan_once()
    assert len(refs2) == 1
    assert "youtube" in refs2[0].url
    assert refs2[0].kind_hint == "video"

    job2 = db.get_job(refs2[0].sid)
    assert job2 is not None
    assert job2["stage"] == Stage.QUEUED
