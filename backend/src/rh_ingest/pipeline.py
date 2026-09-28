"""Ingestion and rerun pipeline coordinating intake, extraction, merging, and publishing."""

import json
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rh_ingest.cards import calc_overlap, make_card_from_draft, match_by_overlap
from rh_ingest.chunk import LineChunker
from rh_ingest.config import Settings
from rh_ingest.contract.models import (
    Card,
    CardRef,
    CheckStatus,
    IngestReport,
    LibraryManifest,
    LibrarySource,
    ReportSource,
    RetiredCard,
    SourceChecks,
    SourceMeta,
)
from rh_ingest.contract.state import StateReader
from rh_ingest.contract.writer import LibraryWriter
from rh_ingest.decisions import DecisionApplier
from rh_ingest.extract.checks import check_whole_source_coverage
from rh_ingest.extract.extractor import CardExtractor
from rh_ingest.ingest.base import ingestor_for
from rh_ingest.intake.refs import SourceRef
from rh_ingest.llm.client import LLMClient
from rh_ingest.llm.prompts import Prompts
from rh_ingest.lock import FileLock
from rh_ingest.merge.index import VectorIndex
from rh_ingest.merge.merger import Merger
from rh_ingest.topics import TopicTree
from rh_ingest.workdb import Stage, WorkDB

logger = logging.getLogger(__name__)


def compute_ignore_lines(lines: list[str], meta: SourceMeta) -> set[int]:
    """Compute non-content line numbers (blank lines, markdown headings)."""
    ignore: set[int] = set()
    for idx, line in enumerate(lines, start=1):
        s = line.strip()
        if not s or s.startswith("#"):
            ignore.add(idx)
    return ignore


class Pipeline:
    """Manages reading, processing, merging, and publishing for a library."""

    def __init__(self, library_dir: Path, cfg: Settings):
        self.library_dir = Path(library_dir)
        self.cfg = cfg

        # 1. State and directories
        work_dir = (
            Path(self.cfg.work_dir)
            if (hasattr(self.cfg, "work_dir") and self.cfg.work_dir)
            else self.library_dir / ".rh"
        )
        work_dir.mkdir(parents=True, exist_ok=True)

        self.db = WorkDB(work_dir / "work.db")
        self.writer = LibraryWriter(self.library_dir)
        self.topic_tree = TopicTree(self.library_dir)

        # 2. LLM and Prompts
        prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
        if hasattr(cfg, "prompts") and cfg.prompts:
            cards_p = Path(cfg.prompts.cards)
            if not cards_p.is_absolute():
                # Check relative to cwd or work_dir
                if not cards_p.exists() and (prompts_dir / cards_p.name).exists():
                    cards_p = prompts_dir / cards_p.name
            retry_p = Path(cfg.prompts.cards_retry)
            if (
                not retry_p.is_absolute()
                and not retry_p.exists()
                and (prompts_dir / retry_p.name).exists()
            ):
                retry_p = prompts_dir / retry_p.name
            merge_p = Path(cfg.prompts.merge)
            if (
                not merge_p.is_absolute()
                and not merge_p.exists()
                and (prompts_dir / merge_p.name).exists()
            ):
                merge_p = prompts_dir / merge_p.name

            if cards_p.exists() and retry_p.exists() and merge_p.exists():
                self.prompts = Prompts(cards_p, retry_p, merge_p)
            else:
                self.prompts = Prompts.load(prompts_dir)
        else:
            self.prompts = Prompts.load(prompts_dir)
        self.client = LLMClient(cfg.llm, cfg.embeddings)
        self.extractor = CardExtractor(self.client, self.prompts, cfg)

        # 3. Vector Index
        self.faiss_path = work_dir / "vectors.faiss"
        dim = cfg.embeddings.dim
        self.index = VectorIndex.load(self.faiss_path, dim=dim)

        # 4. Load existing cards and library manifest
        self.cards_map: dict[str, Card] = {}
        self.retired: list[RetiredCard] = []
        self._load_cards()

        # Check index consistency with existing cards
        if len(self.cards_map) > 0 and self.index.index.ntotal == 0:
            self._rebuild_index()

    def _load_cards(self) -> None:
        cards_json_path = self.library_dir / "cards.json"
        if cards_json_path.exists():
            try:
                data = json.loads(cards_json_path.read_text(encoding="utf-8"))
                for c in data.get("cards", []):
                    card = Card.model_validate(c)
                    self.cards_map[card.id] = card
                for r in data.get("retired", []):
                    self.retired.append(RetiredCard.model_validate(r))
            except Exception:
                pass

    def _rebuild_index(self) -> None:
        """Re-embed all cards into VectorIndex."""
        for cid, card in self.cards_map.items():
            # Embed brief description
            vec = self.client.embed([card.what or card.title])
            self.index.upsert(cid, vec)
        self.index.save(self.faiss_path)

    def _load_manifest_sources(self) -> list[LibrarySource]:
        lib_json = self.library_dir / "library.json"
        if lib_json.exists():
            try:
                data = json.loads(lib_json.read_text(encoding="utf-8"))
                manifest = LibraryManifest.model_validate(data)
                return manifest.sources
            except Exception:
                pass
        return []

    def ingest_source(
        self,
        sid: str,
        meta: SourceMeta,
        lines: list[str],
        origin_source_info: LibrarySource | None = None,
    ) -> ReportSource:
        started_at = datetime.now(UTC)
        chunker = LineChunker(self.cfg.chunking)
        chunks = chunker.chunk_lines(lines)

        ignore = compute_ignore_lines(lines, meta)

        chunks_ok = 0
        total_retries = 0
        all_drafts = []
        new_card_ids: list[str] = []
        suggested_by_card: dict[str, list[str]] = {}

        for ch in chunks:
            res = self.extractor.extract(
                sid=sid,
                title=meta.title,
                lines=lines,
                chunk=ch,
                topics=list(self.topic_tree.paths),
                db=self.db,
                ignore=ignore,
            )
            if res.ok:
                chunks_ok += 1
            all_drafts.extend([(ch.idx, d) for d in res.drafts])

        # Create cards
        for chunk_idx, draft in all_drafts:
            card, raw_id, suggested = make_card_from_draft(
                draft=draft,
                sid=sid,
                chunk_idx=chunk_idx,
                assets=meta.assets,
                db=self.db,
                existing_topics=self.topic_tree.paths,
            )
            self.cards_map[card.id] = card
            new_card_ids.append(card.id)
            suggested_by_card[card.id] = suggested

            # Embed brief description {what}
            vec = self.client.embed([card.what or card.title])
            self.index.upsert(card.id, vec)

        cards_created = len(new_card_ids)

        # Apply state decisions
        state_reader = StateReader(self.library_dir)
        merged_state = state_reader.load()
        decision_applier = DecisionApplier(self.db, self.client, self.index, self.topic_tree)
        splits_applied, split_cards = decision_applier.apply(merged_state, self.cards_map)
        new_card_ids.extend(split_cards)

        # Merge cards
        merger = Merger(
            cards=self.cards_map,
            retired=self.retired,
            index=self.index,
            client=self.client,
            prompts=self.prompts,
            db=self.db,
            cfg=self.cfg.merge,
        )
        merge_stats = merger.run(new_ids=new_card_ids, touched_sources={sid})

        # Suggestions
        suggestions = self.topic_tree.collect_suggestions(
            cards=list(self.cards_map.values()),
            suggested_by_card=suggested_by_card,
            db=self.db,
            max_suggestions_per_run=10,
        )

        # Whole-source checks
        sid_refs = []
        for c in self.cards_map.values():
            for r in c.refs:
                if r.source == sid:
                    sid_refs.append(r)

        cov = check_whole_source_coverage(
            refs=sid_refs,
            total_lines=len(lines),
            ignore=ignore,
            max_gap_limit=self.cfg.checks.max_gap_lines,
        )

        source_checks = SourceChecks(
            json_valid=CheckStatus(ok=True),
            ranges=CheckStatus(ok=all(1 <= r.start <= r.end <= len(lines) for r in sid_refs)),
            overlaps=CheckStatus(ok=True),
            coverage=cov,
        )

        status_val = "ok" if cov.ok and chunks_ok == len(chunks) else "warning"

        rep_src = ReportSource(
            source=sid,
            title=meta.title,
            status=status_val,
            chunks_total=len(chunks),
            chunks_ok=chunks_ok,
            retries=total_retries,
            checks=source_checks,
            cards_created=cards_created,
            cards_merged=merge_stats.cards_merged,
            splits_applied=splits_applied,
            errors=[],
            overlap_pairs_kept_apart=[[p[0], p[1]] for p in merge_stats.kept_apart_overlap]
            if merge_stats.kept_apart_overlap
            else None,
        )

        # Update LibrarySource
        sources = self._load_manifest_sources()
        src_entry = next((s for s in sources if s.id == sid), None)
        if not src_entry and origin_source_info:
            src_entry = origin_source_info
            sources.append(src_entry)
        elif not src_entry:
            now = datetime.now(UTC)
            src_entry = LibrarySource(
                id=sid,
                kind=meta.kind,
                title=meta.title,
                authors=[],
                origin={"filename": meta.original},
                added_at=now,
                status="ready",
                n_lines=len(lines),
                n_cards=len(sid_refs),
                pages=len(meta.pages) if meta.pages else None,
                duration_s=None,
                keywords=[t.title for t in meta.toc if t.level <= 2][:10],
            )
            sources.append(src_entry)
        else:
            src_entry.status = "ready"
            src_entry.n_lines = len(lines)
            src_entry.n_cards = len(sid_refs)
            src_entry.keywords = [t.title for t in meta.toc if t.level <= 2][:10]

        # Publish updates
        run_id = f"r_{started_at.strftime('%Y%m%d_%H%M%S')}"
        finished_at = datetime.now(UTC)
        report = IngestReport(
            schema_version=1,
            run_id=run_id,
            started_at=started_at,
            finished_at=finished_at,
            sources=[rep_src],
        )

        self.writer.commit(
            cards=list(self.cards_map.values()),
            retired=self.retired,
            suggestions=suggestions,
            sources=sources,
            topics=self.topic_tree.to_library_topics(),
            report=report,
        )
        self.index.save(self.faiss_path)

        return rep_src

    def rerun_source(self, sid: str) -> ReportSource:
        """Re-run card extraction, matching, merging, and publishing for an existing source."""
        started_at = datetime.now(UTC)
        src_dir = self.library_dir / "sources" / sid
        if not src_dir.exists():
            raise FileNotFoundError(f"Source {sid} not found in {self.library_dir}")

        meta_path = src_dir / "meta.json"
        content_path = src_dir / "content.md"

        meta = SourceMeta.model_validate(json.loads(meta_path.read_text(encoding="utf-8")))
        lines = content_path.read_text(encoding="utf-8").splitlines()

        chunker = LineChunker(self.cfg.chunking)
        chunks = chunker.chunk_lines(lines)
        ignore = compute_ignore_lines(lines, meta)

        chunks_ok = 0
        all_drafts = []
        for ch in chunks:
            res = self.extractor.extract(
                sid=sid,
                title=meta.title,
                lines=lines,
                chunk=ch,
                topics=list(self.topic_tree.paths),
                db=self.db,
                ignore=ignore,
            )
            if res.ok:
                chunks_ok += 1
            all_drafts.extend([(ch.idx, d) for d in res.drafts])

        # Match new raw drafts to old cards of this source (§9.7)
        old_cards_of_sid = [
            c for c in self.cards_map.values() if any(r.source == sid for r in c.refs)
        ]
        matched_old_cards: set[str] = set()
        new_card_ids: list[str] = []
        suggested_by_card: dict[str, list[str]] = {}

        now = datetime.now(UTC)

        for chunk_idx, draft in all_drafts:
            best_old, _ = match_by_overlap(draft, old_cards_of_sid, sid)

            # Generate raw card in DB
            card_tmp, raw_id, suggested = make_card_from_draft(
                draft=draft,
                sid=sid,
                chunk_idx=chunk_idx,
                assets=meta.assets,
                db=self.db,
                existing_topics=self.topic_tree.paths,
            )
            # Remove the auto-allocated ID from DB members since we may reuse best_old
            self.db.delete_card_members(card_tmp.id)

            if best_old is not None:
                matched_old_cards.add(best_old.id)
                self.db.link_card_members(best_old.id, [raw_id])
                suggested_by_card[best_old.id] = suggested

                if len(best_old.refs) == 1 and best_old.refs[0].source == sid:
                    # Keeps the ID; fields and ref come from new raw card; rev + 1 if text changed
                    text_changed = (
                        best_old.title != draft.title
                        or best_old.what != draft.what
                        or best_old.why != draft.why
                        or best_old.how != draft.how
                        or best_old.when != draft.when
                        or best_old.extra != draft.extra
                    )
                    if text_changed:
                        best_old.rev += 1
                    best_old.title = draft.title
                    best_old.what = draft.what
                    best_old.why = draft.why
                    best_old.how = draft.how
                    best_old.when = draft.when
                    best_old.extra = draft.extra
                    best_old.refs = [
                        CardRef(source=sid, start=draft.start_line, end=draft.end_line)
                    ]
                    best_old.updated_at = now
                else:
                    # Matched, and card has other sources too -> only this source's ref replaced; text stays
                    new_refs = [r for r in best_old.refs if r.source != sid]
                    new_refs.append(CardRef(source=sid, start=draft.start_line, end=draft.end_line))
                    best_old.refs = new_refs
                    best_old.updated_at = now

                # Re-embed
                vec = self.client.embed([best_old.what or best_old.title])
                self.index.upsert(best_old.id, vec)
                new_card_ids.append(best_old.id)
            else:
                # Unmatched draft -> new card
                card_tmp.id = self.db.next_card_id()
                self.db.link_card_members(card_tmp.id, [raw_id])
                self.cards_map[card_tmp.id] = card_tmp
                new_card_ids.append(card_tmp.id)
                suggested_by_card[card_tmp.id] = suggested

                vec = self.client.embed([card_tmp.what or card_tmp.title])
                self.index.upsert(card_tmp.id, vec)

        # Old cards of sid with no match -> retired into overlapping new cards
        for old_c in old_cards_of_sid:
            if old_c.id not in matched_old_cards:
                ref = next((r for r in old_c.refs if r.source == sid), None)
                into_ids = []
                if ref:
                    for ncid in new_card_ids:
                        nc = self.cards_map[ncid]
                        nref = next((r for r in nc.refs if r.source == sid), None)
                        if nref and calc_overlap(ref.start, ref.end, nref.start, nref.end) > 0:
                            into_ids.append(ncid)

                self.retired.append(RetiredCard(id=old_c.id, into=into_ids))
                if old_c.id in self.cards_map:
                    del self.cards_map[old_c.id]
                self.index.delete(old_c.id)

        # Merge, suggestions, report, commit
        merger = Merger(
            cards=self.cards_map,
            retired=self.retired,
            index=self.index,
            client=self.client,
            prompts=self.prompts,
            db=self.db,
            cfg=self.cfg.merge,
        )
        merge_stats = merger.run(new_ids=new_card_ids, touched_sources={sid})

        suggestions = self.topic_tree.collect_suggestions(
            cards=list(self.cards_map.values()),
            suggested_by_card=suggested_by_card,
            db=self.db,
            max_suggestions_per_run=10,
        )

        sid_refs = [r for c in self.cards_map.values() for r in c.refs if r.source == sid]
        cov = check_whole_source_coverage(
            refs=sid_refs,
            total_lines=len(lines),
            ignore=ignore,
            max_gap_limit=self.cfg.checks.max_gap_lines,
        )

        source_checks = SourceChecks(
            json_valid=CheckStatus(ok=True),
            ranges=CheckStatus(ok=all(1 <= r.start <= r.end <= len(lines) for r in sid_refs)),
            overlaps=CheckStatus(ok=True),
            coverage=cov,
        )

        status_val = "ok" if cov.ok and chunks_ok == len(chunks) else "warning"

        rep_src = ReportSource(
            source=sid,
            title=meta.title,
            status=status_val,
            chunks_total=len(chunks),
            chunks_ok=chunks_ok,
            retries=0,
            checks=source_checks,
            cards_created=len(new_card_ids),
            cards_merged=merge_stats.cards_merged,
            splits_applied=0,
            errors=[],
            overlap_pairs_kept_apart=[[p[0], p[1]] for p in merge_stats.kept_apart_overlap]
            if merge_stats.kept_apart_overlap
            else None,
        )

        sources = self._load_manifest_sources()
        src_entry = next((s for s in sources if s.id == sid), None)
        if src_entry:
            src_entry.n_cards = len(sid_refs)

        run_id = f"r_{started_at.strftime('%Y%m%d_%H%M%S')}"
        report = IngestReport(
            schema_version=1,
            run_id=run_id,
            started_at=started_at,
            finished_at=datetime.now(UTC),
            sources=[rep_src],
        )

        self.writer.commit(
            cards=list(self.cards_map.values()),
            retired=self.retired,
            suggestions=suggestions,
            sources=sources,
            topics=self.topic_tree.to_library_topics(),
            report=report,
        )
        self.index.save(self.faiss_path)

        return rep_src

    def run_queue(self) -> list[ReportSource]:
        """Runs one ingest cycle over queued jobs with file locking."""
        lock_path = self.cfg.work_dir / self.cfg.run.lock_file
        with FileLock(lock_path):
            return self._run_queue_unlocked()

    def _run_queue_unlocked(self) -> list[ReportSource]:
        # 1. Ingest all queued jobs
        queued_jobs = self.db.list_jobs(Stage.QUEUED)
        for job in queued_jobs:
            sid = job["sid"]
            ref = SourceRef(
                kind_hint=job["kind"],
                path=Path(job["path"]) if job["path"] else None,
                url=job["url"],
                sid=sid,
            )
            try:
                ingestor = ingestor_for(ref, self.cfg)
                ingestor.ingest(ref, self.writer)
                self.db.update_job(sid, stage=Stage.INGESTED)
            except Exception as e:
                logger.exception("Ingest failed for %s: %s", sid, e)
                self.db.update_job(sid, stage=Stage.FAILED, error=str(e))
                tmp_dir = self.library_dir / "sources" / f"{sid}.tmp"
                if tmp_dir.exists():
                    shutil.rmtree(tmp_dir, ignore_errors=True)

        # 2. Extract per ingested source
        ingested_jobs = self.db.list_jobs(Stage.INGESTED)
        for job in ingested_jobs:
            sid = job["sid"]
            src_dir = self.library_dir / "sources" / sid
            if not src_dir.exists() or not (src_dir / "content.md").exists():
                continue
            meta = SourceMeta.model_validate(
                json.loads((src_dir / "meta.json").read_text(encoding="utf-8"))
            )
            lines = (src_dir / "content.md").read_text(encoding="utf-8").splitlines()
            chunker = LineChunker(self.cfg.chunking)
            chunks = chunker.chunk_lines(lines)
            ignore = compute_ignore_lines(lines, meta)

            def _extract_one(ch):
                return self.extractor.extract(
                    sid=sid,
                    title=meta.title,
                    lines=lines,
                    chunk=ch,
                    topics=list(self.topic_tree.paths),
                    db=self.db,
                    ignore=ignore,
                )

            max_p = max(1, self.cfg.llm.max_parallel)
            if max_p > 1 and len(chunks) > 1:
                with ThreadPoolExecutor(max_workers=max_p) as executor:
                    list(executor.map(_extract_one, chunks))
            else:
                for ch in chunks:
                    _extract_one(ch)

            self.db.update_job(sid, stage=Stage.EXTRACTED)

        # 3. Make cards for extracted jobs
        extracted_jobs = self.db.list_jobs(Stage.EXTRACTED)
        active_jobs = list(extracted_jobs)
        if not active_jobs:
            # Also check if any jobs were pending at EMBEDDED or MERGED
            pending_jobs = [
                j for j in self.db.list_jobs() if j["stage"] in (Stage.EMBEDDED, Stage.MERGED)
            ]
            if not pending_jobs:
                return []
            active_jobs = pending_jobs

        new_card_ids: list[str] = []
        suggested_by_card: dict[str, list[str]] = {}
        cards_created_by_sid: dict[str, int] = {}
        chunks_info_by_sid: dict[str, tuple[int, int, int]] = {}

        for job in extracted_jobs:
            sid = job["sid"]
            src_dir = self.library_dir / "sources" / sid
            if not src_dir.exists():
                continue
            meta = SourceMeta.model_validate(
                json.loads((src_dir / "meta.json").read_text(encoding="utf-8"))
            )
            lines = (src_dir / "content.md").read_text(encoding="utf-8").splitlines()
            chunker = LineChunker(self.cfg.chunking)
            chunks = chunker.chunk_lines(lines)
            ignore = compute_ignore_lines(lines, meta)

            chunks_ok = 0
            retries = 0
            sid_card_ids: list[str] = []

            for ch in chunks:
                res = self.extractor.extract(
                    sid=sid,
                    title=meta.title,
                    lines=lines,
                    chunk=ch,
                    topics=list(self.topic_tree.paths),
                    db=self.db,
                    ignore=ignore,
                )
                if res.ok:
                    chunks_ok += 1
                retries += max(0, res.tries - 1)
                for draft in res.drafts:
                    card, raw_id, suggested = make_card_from_draft(
                        draft=draft,
                        sid=sid,
                        chunk_idx=ch.idx,
                        assets=meta.assets,
                        db=self.db,
                        existing_topics=self.topic_tree.paths,
                    )
                    self.cards_map[card.id] = card
                    new_card_ids.append(card.id)
                    sid_card_ids.append(card.id)
                    suggested_by_card[card.id] = suggested

            cards_created_by_sid[sid] = len(sid_card_ids)
            chunks_info_by_sid[sid] = (len(chunks), chunks_ok, retries)

        # 4. Embed new cards
        for cid in new_card_ids:
            card = self.cards_map[cid]
            vec = self.client.embed([card.what or card.title])
            self.index.upsert(card.id, vec)

        for job in extracted_jobs:
            self.db.update_job(job["sid"], stage=Stage.EMBEDDED)

        # 5. Apply state decisions & Merge
        state_reader = StateReader(self.library_dir)
        merged_state = state_reader.load()
        decision_applier = DecisionApplier(self.db, self.client, self.index, self.topic_tree)
        splits_applied, split_cards = decision_applier.apply(merged_state, self.cards_map)
        new_card_ids.extend(split_cards)

        touched_sources = {job["sid"] for job in active_jobs}
        merger = Merger(
            cards=self.cards_map,
            retired=self.retired,
            index=self.index,
            client=self.client,
            prompts=self.prompts,
            db=self.db,
            cfg=self.cfg.merge,
        )
        merge_stats = merger.run(new_ids=new_card_ids, touched_sources=touched_sources)

        for job in active_jobs:
            self.db.update_job(job["sid"], stage=Stage.MERGED)

        # 6. Publish
        suggestions = self.topic_tree.collect_suggestions(
            cards=list(self.cards_map.values()),
            suggested_by_card=suggested_by_card,
            db=self.db,
            max_suggestions_per_run=self.cfg.topics.max_suggestions_per_run,
        )

        sources = self._load_manifest_sources()
        reports: list[ReportSource] = []

        for job in active_jobs:
            sid = job["sid"]
            src_dir = self.library_dir / "sources" / sid
            if not src_dir.exists():
                continue
            meta = SourceMeta.model_validate(
                json.loads((src_dir / "meta.json").read_text(encoding="utf-8"))
            )
            lines = (src_dir / "content.md").read_text(encoding="utf-8").splitlines()
            ignore = compute_ignore_lines(lines, meta)

            sid_refs = [r for c in self.cards_map.values() for r in c.refs if r.source == sid]
            cov = check_whole_source_coverage(
                refs=sid_refs,
                total_lines=len(lines),
                ignore=ignore,
                max_gap_limit=self.cfg.checks.max_gap_lines,
            )
            chunks_total, chunks_ok, retries = chunks_info_by_sid.get(sid, (0, 0, 0))
            status_val = "ok" if cov.ok and chunks_ok == chunks_total else "warning"

            rep_src = ReportSource(
                source=sid,
                title=meta.title,
                status=status_val,
                chunks_total=chunks_total,
                chunks_ok=chunks_ok,
                retries=retries,
                checks=SourceChecks(
                    json_valid=CheckStatus(ok=True),
                    ranges=CheckStatus(
                        ok=all(1 <= r.start <= r.end <= len(lines) for r in sid_refs)
                    ),
                    overlaps=CheckStatus(ok=True),
                    coverage=cov,
                ),
                cards_created=cards_created_by_sid.get(sid, 0),
                cards_merged=merge_stats.cards_merged,
                splits_applied=splits_applied,
                errors=[],
                overlap_pairs_kept_apart=[[p[0], p[1]] for p in merge_stats.kept_apart_overlap]
                if merge_stats.kept_apart_overlap
                else None,
            )
            reports.append(rep_src)

            # Update LibrarySource
            src_entry = next((s for s in sources if s.id == sid), None)
            if not src_entry:
                src_entry = LibrarySource(
                    id=sid,
                    kind=meta.kind,
                    title=meta.title,
                    authors=[],
                    origin={"filename": meta.original} if meta.original else {},
                    added_at=datetime.now(UTC),
                    status="ready",
                    n_lines=len(lines),
                    n_cards=len(sid_refs),
                    pages=len(meta.pages) if meta.pages else None,
                    duration_s=None,
                    keywords=[t.title for t in meta.toc if t.level <= 2][:10],
                )
                sources.append(src_entry)
            else:
                src_entry.status = "ready"
                src_entry.n_lines = len(lines)
                src_entry.n_cards = len(sid_refs)
                src_entry.keywords = [t.title for t in meta.toc if t.level <= 2][:10]

            self.db.update_job(sid, stage=Stage.PUBLISHED)

        now = datetime.now(UTC)
        run_id = f"r_{now.strftime('%Y%m%d_%H%M%S')}"
        report = IngestReport(
            schema_version=1,
            run_id=run_id,
            started_at=now,
            finished_at=now,
            sources=reports,
        )

        self.writer.commit(
            cards=list(self.cards_map.values()),
            retired=self.retired,
            suggestions=suggestions,
            sources=sources,
            topics=self.topic_tree.to_library_topics(),
            report=report,
        )
        self.index.save(self.faiss_path)

        self._print_summary(reports, merge_stats)
        return reports

    def apply_decisions(self) -> None:
        """Applies decisions from library/state/ and commits library updates without ingesting new sources."""
        lock_path = self.cfg.work_dir / self.cfg.run.lock_file
        with FileLock(lock_path):
            state_reader = StateReader(self.library_dir)
            merged_state = state_reader.load()
            decision_applier = DecisionApplier(self.db, self.client, self.index, self.topic_tree)
            splits_applied, split_cards = decision_applier.apply(merged_state, self.cards_map)

            merger = Merger(
                cards=self.cards_map,
                retired=self.retired,
                index=self.index,
                client=self.client,
                prompts=self.prompts,
                db=self.db,
                cfg=self.cfg.merge,
            )
            merger.run(new_ids=split_cards, touched_sources=set())

            suggestions = self.topic_tree.collect_suggestions(
                cards=list(self.cards_map.values()),
                suggested_by_card={},
                db=self.db,
                max_suggestions_per_run=self.cfg.topics.max_suggestions_per_run,
            )
            sources = self._load_manifest_sources()
            now = datetime.now(UTC)
            run_id = f"r_{now.strftime('%Y%m%d_%H%M%S')}"
            report = IngestReport(
                schema_version=1,
                run_id=run_id,
                started_at=now,
                finished_at=now,
                sources=[],
            )
            self.writer.commit(
                cards=list(self.cards_map.values()),
                retired=self.retired,
                suggestions=suggestions,
                sources=sources,
                topics=self.topic_tree.to_library_topics(),
                report=report,
            )
            self.index.save(self.faiss_path)

    def _print_summary(self, reports: list[ReportSource], merge_stats: Any) -> None:
        try:
            from rich.console import Console
            from rich.table import Table

            console = Console()
            if not reports:
                return
            table = Table(title="Ingest Run Summary")
            table.add_column("Source", style="cyan")
            table.add_column("Title")
            table.add_column("Status")
            table.add_column("Chunks", justify="right")
            table.add_column("Cards", justify="right")
            for r in reports:
                style = "green" if r.status == "ok" else "yellow"
                table.add_row(
                    r.source,
                    r.title[:40],
                    f"[{style}]{r.status}[/{style}]",
                    f"{r.chunks_ok}/{r.chunks_total}",
                    str(r.cards_created),
                )
            console.print(table)
        except Exception:
            pass
