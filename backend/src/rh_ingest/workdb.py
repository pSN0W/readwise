"""SQLite persistence (WorkDB) for Reading Helper backend ingest pipeline."""

import functools
import json
import sqlite3
import threading
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any


class Stage(StrEnum):
    QUEUED = "queued"
    INGESTED = "ingested"
    EXTRACTED = "extracted"
    EMBEDDED = "embedded"
    MERGED = "merged"
    PUBLISHED = "published"
    FAILED = "failed"


SCHEMA_VERSION = 1

INIT_SQL = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS jobs (
    sid TEXT PRIMARY KEY,
    kind TEXT,
    path TEXT,
    url TEXT,
    stage TEXT,
    attempts INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
    sid TEXT,
    idx INTEGER,
    start INTEGER,
    end INTEGER,
    own_end INTEGER,
    input_hash TEXT,
    ok INTEGER,
    tries INTEGER,
    result_json TEXT,
    gaps_json TEXT,
    problems_json TEXT,
    PRIMARY KEY (sid, idx, input_hash)
);

CREATE TABLE IF NOT EXISTS raw_cards (
    raw_id TEXT PRIMARY KEY,
    sid TEXT,
    start INTEGER,
    end INTEGER,
    fields_json TEXT,
    chunk_idx INTEGER,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS card_members (
    card_id TEXT,
    raw_id TEXT,
    pos INTEGER,
    PRIMARY KEY (card_id, raw_id)
);

CREATE TABLE IF NOT EXISTS vectors (
    card_id TEXT PRIMARY KEY,
    faiss_id INTEGER,
    model TEXT,
    dim INTEGER,
    text_hash TEXT
);

CREATE TABLE IF NOT EXISTS merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    a TEXT,
    b TEXT,
    sim REAL,
    why TEXT,
    decision TEXT,
    reason TEXT,
    prompt_version TEXT,
    model TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS never_merge (
    raw_a TEXT,
    raw_b TEXT,
    PRIMARY KEY (raw_a, raw_b)
);

CREATE TABLE IF NOT EXISTS applied_splits (
    card_id TEXT PRIMARY KEY,
    mark_ts INTEGER
);

CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    path TEXT,
    card_ids_json TEXT,
    reason TEXT,
    similar_existing TEXT,
    status TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _sync(func):
    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return func(self, *args, **kwargs)

    return wrapper


class WorkDB:
    """Private working database for the GPU machine."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        with self.conn:
            self.conn.executescript(INIT_SQL)
            self.conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION};")
            # Default counters if not present
            self.conn.execute("INSERT OR IGNORE INTO kv (key, value) VALUES ('next_card', '1')")
            self.conn.execute(
                "INSERT OR IGNORE INTO kv (key, value) VALUES ('next_suggestion', '1')"
            )

    @_sync
    def close(self) -> None:
        self.conn.close()

    # -------------------------------------------------------------------------
    # KV and counters
    # -------------------------------------------------------------------------

    @_sync
    def get_kv(self, key: str, default: str | None = None) -> str | None:
        cur = self.conn.execute("SELECT value FROM kv WHERE key = ?", (key,))
        row = cur.fetchone()
        return row["value"] if row else default

    @_sync
    def set_kv(self, key: str, value: str) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    @_sync
    def next_card_id(self) -> str:
        with self.conn:
            cur = self.conn.execute("SELECT value FROM kv WHERE key = 'next_card'")
            row = cur.fetchone()
            val = int(row["value"]) if row else 1
            self.conn.execute("UPDATE kv SET value = ? WHERE key = 'next_card'", (str(val + 1),))
            return f"c_{val:04d}"

    @_sync
    def next_suggestion_id(self) -> str:
        with self.conn:
            cur = self.conn.execute("SELECT value FROM kv WHERE key = 'next_suggestion'")
            row = cur.fetchone()
            val = int(row["value"]) if row else 1
            self.conn.execute(
                "UPDATE kv SET value = ? WHERE key = 'next_suggestion'", (str(val + 1),)
            )
            return f"t_{val:04d}"

    # -------------------------------------------------------------------------
    # Jobs
    # -------------------------------------------------------------------------

    @_sync
    def add_job(
        self,
        sid: str,
        kind: str,
        path: str | None = None,
        url: str | None = None,
        stage: Stage = Stage.QUEUED,
    ) -> None:
        now = _utc_now_iso()
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO jobs (sid, kind, path, url, stage, attempts, error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET
                    kind = excluded.kind,
                    path = excluded.path,
                    url = excluded.url,
                    updated_at = excluded.updated_at
                """,
                (sid, kind, path, url, str(stage), now, now),
            )

    @_sync
    def update_job(
        self,
        sid: str,
        stage: Stage | str | None = None,
        error: str | None = None,
        attempts: int | None = None,
    ) -> None:
        now = _utc_now_iso()
        updates: list[str] = ["updated_at = ?"]
        params: list[Any] = [now]

        if stage is not None:
            updates.append("stage = ?")
            params.append(str(stage))
        if error is not None:
            updates.append("error = ?")
            params.append(error)
        if attempts is not None:
            updates.append("attempts = ?")
            params.append(attempts)

        params.append(sid)
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE sid = ?"
        with self.conn:
            self.conn.execute(query, params)

    @_sync
    def get_job(self, sid: str) -> dict[str, Any] | None:
        cur = self.conn.execute("SELECT * FROM jobs WHERE sid = ?", (sid,))
        row = cur.fetchone()
        return dict(row) if row else None

    @_sync
    def list_jobs(self, stage: Stage | str | None = None) -> list[dict[str, Any]]:
        if stage is not None:
            cur = self.conn.execute(
                "SELECT * FROM jobs WHERE stage = ? ORDER BY created_at ASC", (str(stage),)
            )
        else:
            cur = self.conn.execute("SELECT * FROM jobs ORDER BY created_at ASC")
        return [dict(r) for r in cur.fetchall()]

    # -------------------------------------------------------------------------
    # Chunks
    # -------------------------------------------------------------------------

    @_sync
    def save_chunk(
        self,
        sid: str,
        idx: int,
        start: int,
        end: int,
        own_end: int,
        input_hash: str,
        ok: bool,
        tries: int,
        result: Any,
        gaps: list[list[int]] | None = None,
        problems: list[str] | None = None,
    ) -> None:
        res_json = json.dumps(
            result
            if isinstance(result, (dict, list))
            else result.model_dump()
            if hasattr(result, "model_dump")
            else result
        )
        gaps_json = json.dumps(gaps or [])
        probs_json = json.dumps(problems or [])
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO chunks (sid, idx, start, end, own_end, input_hash, ok, tries, result_json, gaps_json, problems_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sid, idx, input_hash) DO UPDATE SET
                    ok = excluded.ok,
                    tries = excluded.tries,
                    result_json = excluded.result_json,
                    gaps_json = excluded.gaps_json,
                    problems_json = excluded.problems_json
                """,
                (
                    sid,
                    idx,
                    start,
                    end,
                    own_end,
                    input_hash,
                    1 if ok else 0,
                    tries,
                    res_json,
                    gaps_json,
                    probs_json,
                ),
            )

    @_sync
    def chunk_result(self, sid: str, idx: int, input_hash: str) -> dict[str, Any] | None:
        cur = self.conn.execute(
            "SELECT * FROM chunks WHERE sid = ? AND idx = ? AND input_hash = ?",
            (sid, idx, input_hash),
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["ok"] = bool(d["ok"])
        d["result"] = json.loads(d["result_json"])
        d["gaps"] = json.loads(d["gaps_json"])
        d["problems"] = json.loads(d["problems_json"])
        return d

    # -------------------------------------------------------------------------
    # Raw cards & card members
    # -------------------------------------------------------------------------

    @_sync
    def save_raw_card(
        self,
        raw_id: str,
        sid: str,
        start: int,
        end: int,
        fields: dict[str, Any],
        chunk_idx: int,
    ) -> None:
        now = _utc_now_iso()
        fields_json = json.dumps(fields)
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO raw_cards (raw_id, sid, start, end, fields_json, chunk_idx, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(raw_id) DO UPDATE SET
                    fields_json = excluded.fields_json
                """,
                (raw_id, sid, start, end, fields_json, chunk_idx, now),
            )

    @_sync
    def get_raw_card(self, raw_id: str) -> dict[str, Any] | None:
        cur = self.conn.execute("SELECT * FROM raw_cards WHERE raw_id = ?", (raw_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["fields"] = json.loads(d["fields_json"])
        return d

    @_sync
    def link_card_members(self, card_id: str, raw_ids: list[str]) -> None:
        with self.conn:
            for pos, raw_id in enumerate(raw_ids):
                self.conn.execute(
                    """
                    INSERT INTO card_members (card_id, raw_id, pos)
                    VALUES (?, ?, ?)
                    ON CONFLICT(card_id, raw_id) DO UPDATE SET pos = excluded.pos
                    """,
                    (card_id, raw_id, pos),
                )

    @_sync
    def delete_card_members(self, card_id: str) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM card_members WHERE card_id = ?", (card_id,))

    @_sync
    def set_card_members(self, card_id: str, raw_ids: list[str]) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM card_members WHERE card_id = ?", (card_id,))
            for pos, raw_id in enumerate(raw_ids):
                self.conn.execute(
                    """
                    INSERT INTO card_members (card_id, raw_id, pos)
                    VALUES (?, ?, ?)
                    ON CONFLICT(card_id, raw_id) DO UPDATE SET pos = excluded.pos
                    """,
                    (card_id, raw_id, pos),
                )

    @_sync
    def get_card_members(self, card_id: str) -> list[str]:
        cur = self.conn.execute(
            "SELECT raw_id FROM card_members WHERE card_id = ? ORDER BY pos ASC",
            (card_id,),
        )
        return [r["raw_id"] for r in cur.fetchall()]

    # -------------------------------------------------------------------------
    # Vectors
    # -------------------------------------------------------------------------

    @_sync
    def save_vector_meta(
        self,
        card_id: str,
        faiss_id: int,
        model: str,
        dim: int,
        text_hash: str,
    ) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO vectors (card_id, faiss_id, model, dim, text_hash)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(card_id) DO UPDATE SET
                    faiss_id = excluded.faiss_id,
                    model = excluded.model,
                    dim = excluded.dim,
                    text_hash = excluded.text_hash
                """,
                (card_id, faiss_id, model, dim, text_hash),
            )

    @_sync
    def get_vector_meta(self, card_id: str) -> dict[str, Any] | None:
        cur = self.conn.execute("SELECT * FROM vectors WHERE card_id = ?", (card_id,))
        row = cur.fetchone()
        return dict(row) if row else None

    @_sync
    def all_vector_metas(self) -> list[dict[str, Any]]:
        cur = self.conn.execute("SELECT * FROM vectors ORDER BY faiss_id ASC")
        return [dict(r) for r in cur.fetchall()]

    @_sync
    def delete_vector_meta(self, card_id: str) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM vectors WHERE card_id = ?", (card_id,))

    # -------------------------------------------------------------------------
    # Merges & Never Merge
    # -------------------------------------------------------------------------

    @_sync
    def log_merge(
        self,
        a: str,
        b: str,
        sim: float,
        why: str,
        decision: str,
        reason: str,
        prompt_version: str,
        model: str,
    ) -> None:
        now = _utc_now_iso()
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO merges (a, b, sim, why, decision, reason, prompt_version, model, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (a, b, sim, why, decision, reason, prompt_version, model, now),
            )

    @_sync
    def cached_verdict(
        self,
        a: str,
        b: str,
        prompt_version: str,
        model: str,
    ) -> dict[str, Any] | None:
        cur = self.conn.execute(
            """
            SELECT * FROM merges
            WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?))
              AND prompt_version = ?
              AND model = ?
            ORDER BY id DESC LIMIT 1
            """,
            (a, b, b, a, prompt_version, model),
        )
        row = cur.fetchone()
        return dict(row) if row else None

    @_sync
    def mark_never_merge(self, raw_a: str, raw_b: str) -> None:
        pair = sorted([raw_a, raw_b])
        with self.conn:
            self.conn.execute(
                "INSERT OR IGNORE INTO never_merge (raw_a, raw_b) VALUES (?, ?)",
                (pair[0], pair[1]),
            )

    @_sync
    def is_never_merge(self, a_members: list[str], b_members: list[str]) -> bool:
        """Check if any member of card a and card b are in never_merge."""
        if not a_members or not b_members:
            return False
        for raw_a in a_members:
            for raw_b in b_members:
                pair = sorted([raw_a, raw_b])
                cur = self.conn.execute(
                    "SELECT 1 FROM never_merge WHERE raw_a = ? AND raw_b = ?",
                    (pair[0], pair[1]),
                )
                if cur.fetchone():
                    return True
        return False

    # -------------------------------------------------------------------------
    # Applied splits
    # -------------------------------------------------------------------------

    @_sync
    def record_applied_split(self, card_id: str, mark_ts: int) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO applied_splits (card_id, mark_ts)
                VALUES (?, ?)
                ON CONFLICT(card_id) DO UPDATE SET mark_ts = excluded.mark_ts
                """,
                (card_id, mark_ts),
            )

    @_sync
    def get_applied_split_ts(self, card_id: str) -> int | None:
        cur = self.conn.execute("SELECT mark_ts FROM applied_splits WHERE card_id = ?", (card_id,))
        row = cur.fetchone()
        return row["mark_ts"] if row else None

    # -------------------------------------------------------------------------
    # Suggestions
    # -------------------------------------------------------------------------

    @_sync
    def save_suggestion(
        self,
        sug_id: str,
        path: str,
        card_ids: list[str],
        reason: str | None = None,
        similar_existing: str | None = None,
        status: str = "open",
    ) -> None:
        now = _utc_now_iso()
        cards_json = json.dumps(card_ids)
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO suggestions (id, path, card_ids_json, reason, similar_existing, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    path = excluded.path,
                    card_ids_json = excluded.card_ids_json,
                    reason = excluded.reason,
                    similar_existing = excluded.similar_existing,
                    status = excluded.status
                """,
                (sug_id, path, cards_json, reason, similar_existing, status, now),
            )

    @_sync
    def list_suggestions(self, status: str | None = "open") -> list[dict[str, Any]]:
        if status:
            cur = self.conn.execute(
                "SELECT * FROM suggestions WHERE status = ? ORDER BY id ASC", (status,)
            )
        else:
            cur = self.conn.execute("SELECT * FROM suggestions ORDER BY id ASC")
        res = []
        for r in cur.fetchall():
            d = dict(r)
            d["card_ids"] = json.loads(d["card_ids_json"])
            res.append(d)
        return res

    @_sync
    def update_suggestion_status(self, sug_id: str, status: str) -> None:
        with self.conn:
            self.conn.execute("UPDATE suggestions SET status = ? WHERE id = ?", (status, sug_id))
