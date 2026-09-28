"""InboxWatcher monitoring library/inbox/ for files and links."""

import logging
import shutil
import time
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from rh_ingest.intake.refs import SourceRef
from rh_ingest.workdb import Stage, WorkDB

logger = logging.getLogger(__name__)


def guess_kind_from_path(p: Path) -> str:
    suf = p.suffix.lower()
    if suf == ".pdf":
        return "pdf"
    if suf in (".md", ".markdown", ".txt"):
        return "markdown"
    if suf in (".html", ".htm"):
        return "blog"
    return "unknown"


class InboxWatcher:
    """Monitors library/inbox/ and inbox/links.txt for new sources."""

    def __init__(self, library_dir: Path, work_dir: Path, db: WorkDB, settle_s: float = 5.0):
        self.library_dir = Path(library_dir)
        self.work_dir = Path(work_dir)
        self.db = db
        self.settle_s = settle_s

        self.inbox_dir = self.library_dir / "inbox"
        self.incoming_dir = self.work_dir / "incoming"
        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.incoming_dir.mkdir(parents=True, exist_ok=True)

        # Track file sizes and last modified times: path -> (size, check_timestamp)
        self._file_snapshots: dict[Path, tuple[int, float]] = {}

    def scan_once(self) -> list[SourceRef]:
        """Scans inbox/ once for settled files and links in links.txt, enqueuing them."""
        enqueued: list[SourceRef] = []
        now = time.time()

        # 1. Check individual files in inbox/
        if self.inbox_dir.exists():
            for item in self.inbox_dir.iterdir():
                if item.is_dir() or item.name == "links.txt":
                    continue
                if item.name.endswith(".tmp") or ".tmp." in item.name or item.name.startswith("."):
                    continue

                try:
                    stat = item.stat()
                    size = stat.st_size
                except OSError:
                    continue

                prev_size, first_seen = self._file_snapshots.get(item, (None, now))

                if prev_size == size and (now - first_seen >= self.settle_s):
                    # File is settled! Move it to incoming
                    dest = self.incoming_dir / item.name
                    if dest.exists():
                        dest.unlink()
                    shutil.move(str(item), str(dest))
                    self._file_snapshots.pop(item, None)

                    kind = guess_kind_from_path(dest)
                    ref = SourceRef.from_path(dest, kind_hint=kind)
                    self.db.add_job(
                        sid=ref.sid,
                        kind=kind,
                        path=str(dest),
                        url=None,
                        stage=Stage.QUEUED,
                    )
                    enqueued.append(ref)
                    logger.info("Enqueued file from inbox: %s (%s)", dest.name, ref.sid)
                else:
                    if prev_size != size:
                        # Size changed, reset timer
                        self._file_snapshots[item] = (size, now)
                    else:
                        # Size same, keep initial first_seen
                        self._file_snapshots[item] = (size, first_seen)

        # 2. Check links.txt
        links_file = self.inbox_dir / "links.txt"
        if links_file.exists():
            try:
                curr_size = links_file.stat().st_size
                offset_str = self.db.get_kv("links_offset", "0")
                offset = int(offset_str) if offset_str else 0

                if curr_size < offset:
                    # User truncated or cleared links.txt
                    offset = 0

                if curr_size > offset:
                    with open(links_file, "r", encoding="utf-8", errors="replace") as f:
                        f.seek(offset)
                        new_content = f.read()

                    for line in new_content.splitlines():
                        url_str = line.strip()
                        if url_str.startswith("http://") or url_str.startswith("https://"):
                            lower = url_str.lower()
                            kind = (
                                "video"
                                if ("youtube.com" in lower or "youtu.be" in lower)
                                else "blog"
                            )
                            ref = SourceRef.from_url(url_str, kind_hint=kind)
                            self.db.add_job(
                                sid=ref.sid,
                                kind=kind,
                                path=None,
                                url=ref.url,
                                stage=Stage.QUEUED,
                            )
                            enqueued.append(ref)
                            logger.info("Enqueued URL from links.txt: %s (%s)", url_str, ref.sid)

                    self.db.set_kv("links_offset", str(curr_size))
            except Exception as e:
                logger.error("Error reading links.txt: %s", e)

        return enqueued

    def watch(self, pipeline: Any, rescan_s: float = 60.0) -> None:
        """Runs the inbox loop watching for file events and polling rescan_s."""
        handler = _InboxEventHandler(self)
        observer = Observer()
        observer.schedule(handler, str(self.inbox_dir), recursive=False)
        observer.start()

        logger.info(
            "Watching %s (settle_s=%s, rescan_s=%s)...", self.inbox_dir, self.settle_s, rescan_s
        )
        try:
            while True:
                time.sleep(min(self.settle_s, rescan_s))
                new_refs = self.scan_once()
                if new_refs:
                    pipeline.run_queue()
        except KeyboardInterrupt:
            logger.info("Watch stopped cleanly by user.")
        finally:
            observer.stop()
            observer.join()


class _InboxEventHandler(FileSystemEventHandler):
    def __init__(self, watcher: InboxWatcher):
        self.watcher = watcher

    def on_created(self, event):
        if not event.is_directory:
            self.watcher.scan_once()

    def on_modified(self, event):
        if not event.is_directory:
            self.watcher.scan_once()
