"""Card merging and candidate detection for Reading Helper."""

from dataclasses import dataclass, field
from datetime import UTC, datetime

from rh_ingest.config import MergeSettings
from rh_ingest.contract.models import Card, CardRef, RetiredCard
from rh_ingest.llm.client import LLMClient
from rh_ingest.llm.prompts import Prompts
from rh_ingest.llm.schemas import MergeVerdict
from rh_ingest.merge.index import VectorIndex
from rh_ingest.workdb import WorkDB


@dataclass(frozen=True)
class Pair:
    a: str
    b: str
    sim: float
    why: str  # "overlap" | "similar"


@dataclass
class MergeStats:
    cards_merged: int = 0
    kept_apart_overlap: list[tuple[str, str]] = field(default_factory=list)


def union_refs(refs: list[CardRef]) -> list[CardRef]:
    """Join overlapping or touching refs for each source preserving source order of first appearance."""
    if not refs:
        return []

    # Track order of first appearance of each source
    source_order: list[str] = []
    by_source: dict[str, list[tuple[int, int]]] = {}
    for r in refs:
        if r.source not in source_order:
            source_order.append(r.source)
            by_source[r.source] = []
        by_source[r.source].append((r.start, r.end))

    result: list[CardRef] = []
    for src in source_order:
        ranges = sorted(by_source[src], key=lambda x: (x[0], x[1]))
        merged_ranges: list[tuple[int, int]] = []
        for start, end in ranges:
            if not merged_ranges:
                merged_ranges.append((start, end))
            else:
                prev_start, prev_end = merged_ranges[-1]
                if start <= prev_end + 1:
                    merged_ranges[-1] = (prev_start, max(prev_end, end))
                else:
                    merged_ranges.append((start, end))

        for m_start, m_end in merged_ranges:
            result.append(CardRef(source=src, start=m_start, end=m_end))

    return result


def format_card_fields(c: Card) -> str:
    """Format all non-null card fields for the LLM judge."""
    lines: list[str] = [f"title: {c.title}"]
    if c.what:
        lines.append(f"what: {c.what}")
    if c.why:
        lines.append(f"why: {c.why}")
    if c.how:
        lines.append(f"how: {c.how}")
    if c.when:
        lines.append(f"when: {c.when}")
    if c.extra:
        lines.append(f"extra: {c.extra}")
    return "\n".join(lines)


class Merger:
    """Deduplicates and merges cards using VectorIndex and LLM judgment."""

    def __init__(
        self,
        cards: dict[str, Card],
        retired: list[RetiredCard],
        index: VectorIndex,
        client: LLMClient,
        prompts: Prompts,
        db: WorkDB,
        cfg: MergeSettings,
    ):
        self.cards = cards
        self.retired = retired
        self.index = index
        self.client = client
        self.prompts = prompts
        self.db = db
        self.cfg = cfg

    def candidates(self, new_ids: list[str], touched_sources: set[str]) -> list[Pair]:
        pairs_dict: dict[tuple[str, str], Pair] = {}

        # 1. Similarity search via VectorIndex (embeds brief description {what})
        for nid in new_ids:
            if nid not in self.cards:
                continue
            card = self.cards[nid]
            vec = self.client.embed([card.what or card.title])
            neighbors = self.index.search(vec, top_k=self.cfg.top_k + 1)
            for other_id, sim in neighbors:
                if other_id == nid or other_id not in self.cards:
                    continue
                if sim >= self.cfg.threshold:
                    a, b = sorted([nid, other_id])
                    pairs_dict[(a, b)] = Pair(a=a, b=b, sim=sim, why="similar")

        # 2. Rule A: Overlap or touch in the same source
        if self.cfg.overlap_always_judge:
            all_card_ids = list(self.cards.keys())
            for i in range(len(all_card_ids)):
                for j in range(i + 1, len(all_card_ids)):
                    cid_a = all_card_ids[i]
                    cid_b = all_card_ids[j]
                    if cid_a not in new_ids and cid_b not in new_ids:
                        continue
                    ca = self.cards[cid_a]
                    cb = self.cards[cid_b]

                    # Check if they share any touched source and lines overlap or touch
                    for ra in ca.refs:
                        if ra.source not in touched_sources:
                            continue
                        for rb in cb.refs:
                            if ra.source == rb.source:
                                # Overlap or touch: b.start <= a.end + touch_gap_lines
                                if not (
                                    ra.end + self.cfg.touch_gap_lines < rb.start
                                    or rb.end + self.cfg.touch_gap_lines < ra.start
                                ):
                                    a, b = sorted([cid_a, cid_b])
                                    pairs_dict[(a, b)] = Pair(a=a, b=b, sim=1.0, why="overlap")

        # 3. Filter never_merge and order
        filtered: list[Pair] = []
        for (a, b), pair in pairs_dict.items():
            a_members = self.db.get_card_members(a)
            b_members = self.db.get_card_members(b)
            if not self.db.is_never_merge(a_members, b_members):
                filtered.append(pair)

        # 4. Sort: overlap pairs first, then by similarity descending
        filtered.sort(key=lambda p: (0 if p.why == "overlap" else 1, -p.sim))
        return filtered

    def judge(self, pair: Pair) -> MergeVerdict:
        ca = self.cards[pair.a]
        cb = self.cards[pair.b]

        a_src = ca.refs[0].source if ca.refs else "source"
        b_src = cb.refs[0].source if cb.refs else "source"

        a_fields = format_card_fields(ca)
        b_fields = format_card_fields(cb)

        overlap_note = ""
        if pair.why == "overlap":
            ra = ca.refs[0] if ca.refs else None
            rb = cb.refs[0] if cb.refs else None
            if ra and rb and ra.source == rb.source:
                overlap_note = (
                    f"These two cards come from the same document and their lines overlap "
                    f"(A: {ra.start}–{ra.end}, B: {rb.start}–{rb.end}). "
                    f"This often means one idea was cut in two by a chunk edge."
                )

        system, user = self.prompts.merge(
            a_source=a_src,
            a_fields=a_fields,
            b_source=b_src,
            b_fields=b_fields,
            overlap_note=overlap_note,
        )
        return self.client.chat_json(MergeVerdict, [system, user])

    def apply_merge(self, a_id: str, b_id: str, verdict: MergeVerdict) -> None:
        ca = self.cards[a_id]
        cb = self.cards[b_id]

        # Update a fields
        ca.title = verdict.title if verdict.title else ca.title
        ca.what = verdict.what if verdict.what else ca.what
        ca.why = verdict.why if verdict.why is not None else (ca.why or cb.why)
        ca.how = verdict.how if verdict.how is not None else (ca.how or cb.how)
        ca.when = verdict.when if verdict.when is not None else (ca.when or cb.when)
        ca.extra = verdict.extra if verdict.extra is not None else (ca.extra or cb.extra)

        # Rule B: Union refs
        ca.refs = union_refs(ca.refs + cb.refs)

        # Merge images and topics
        ca.images = sorted(list(set(ca.images + cb.images)))
        ca.topics = sorted(list(set(ca.topics + cb.topics)))

        ca.rev += 1
        ca.updated_at = datetime.now(UTC)

        # Link card members
        members_a = self.db.get_card_members(a_id)
        members_b = self.db.get_card_members(b_id)
        self.db.link_card_members(a_id, members_a + members_b)

        # Retire b into a
        self.retired.append(RetiredCard(id=b_id, into=[a_id]))

        # Remove b from cards and index
        del self.cards[b_id]
        self.index.delete(b_id)

        # Re-embed updated a (embeds brief description {what})
        vec_a = self.client.embed([ca.what or ca.title])
        self.index.upsert(a_id, vec_a)

    def run(self, new_ids: list[str], touched_sources: set[str]) -> MergeStats:
        stats = MergeStats()
        pairs = self.candidates(new_ids, touched_sources)

        # Redirection tracking for chained merges
        redirect: dict[str, str] = {}

        def resolve(cid: str) -> str:
            while cid in redirect:
                cid = redirect[cid]
            return cid

        for pair in pairs:
            a = resolve(pair.a)
            b = resolve(pair.b)
            if a == b:
                continue

            a_members = self.db.get_card_members(a)
            b_members = self.db.get_card_members(b)
            if self.db.is_never_merge(a_members, b_members):
                continue

            cached = self.db.cached_verdict(a, b, self.prompts.version, self.client.cfg.model)
            if cached is not None:
                decision = cached["decision"]
                reason = cached["reason"]
                verdict = MergeVerdict(decision=decision, reason=reason)
            else:
                verdict = self.judge(Pair(a=a, b=b, sim=pair.sim, why=pair.why))
                self.db.log_merge(
                    a=a,
                    b=b,
                    sim=pair.sim,
                    why=pair.why,
                    decision=verdict.decision,
                    reason=verdict.reason,
                    prompt_version=self.prompts.version,
                    model=self.client.cfg.model,
                )

            if verdict.decision == "merge":
                self.apply_merge(a, b, verdict)
                redirect[b] = a
                stats.cards_merged += 1
            elif pair.why == "overlap":
                stats.kept_apart_overlap.append((a, b))

        return stats
