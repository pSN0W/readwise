"""DecisionApplier applying user card splits and topic decisions."""

import json
from datetime import UTC, datetime

from rh_ingest.contract.models import Card, CardRef
from rh_ingest.contract.state import MergedState
from rh_ingest.llm.client import LLMClient
from rh_ingest.merge.index import VectorIndex
from rh_ingest.topics import TopicTree
from rh_ingest.workdb import WorkDB


class DecisionApplier:
    """Applies card splits and topic decisions from user state files."""

    def __init__(self, db: WorkDB, client: LLMClient, index: VectorIndex, topic_tree: TopicTree):
        self.db = db
        self.client = client
        self.index = index
        self.topic_tree = topic_tree

    def apply(
        self,
        merged_state: MergedState,
        cards_map: dict[str, Card],
    ) -> tuple[int, list[str]]:
        """Apply pending splits and topic decisions.

        Returns (splits_applied_count, new_card_ids_created).
        """
        # 1. Apply topic decisions
        self.topic_tree.apply_decisions(merged_state.topic_decisions, cards_map, self.db)

        # 2. Apply splits
        splits_applied = 0
        new_card_ids: list[str] = []

        for cid, split_entry in merged_state.splits.items():
            if not split_entry.v:
                continue

            last_applied = self.db.get_applied_split_ts(cid)
            if last_applied is not None and split_entry.ts <= last_applied:
                continue

            if cid not in cards_map:
                continue

            members = self.db.get_card_members(cid)
            if len(members) < 2:
                # Cannot split a single-member card
                self.db.record_applied_split(cid, split_entry.ts)
                continue

            # Sort members by raw_id
            sorted_members = sorted(members)

            # Member 0 stays on cid
            raw0 = self.db.get_raw_card(sorted_members[0])
            if raw0:
                fields0 = (
                    json.loads(raw0["fields_json"])
                    if isinstance(raw0["fields_json"], str)
                    else raw0["fields_json"]
                )
                c0 = cards_map[cid]
                c0.title = fields0.get("title", c0.title)
                c0.what = fields0.get("what")
                c0.why = fields0.get("why")
                c0.how = fields0.get("how")
                c0.when = fields0.get("when")
                c0.extra = fields0.get("extra")
                c0.refs = [CardRef(source=raw0["sid"], start=raw0["start"], end=raw0["end"])]
                c0.rev += 1
                c0.updated_at = datetime.now(UTC)
                self.db.set_card_members(cid, [sorted_members[0]])

                # Re-embed c0 (embeds brief description {what})
                vec0 = self.client.embed([c0.what or c0.title])
                self.index.upsert(cid, vec0)

            # Other members become new cards
            now = datetime.now(UTC)
            for raw_m_id in sorted_members[1:]:
                raw_m = self.db.get_raw_card(raw_m_id)
                if not raw_m:
                    continue
                fields_m = (
                    json.loads(raw_m["fields_json"])
                    if isinstance(raw_m["fields_json"], str)
                    else raw_m["fields_json"]
                )
                new_id = self.db.next_card_id()
                self.db.link_card_members(new_id, [raw_m_id])

                new_card = Card(
                    id=new_id,
                    rev=1,
                    title=fields_m.get("title", "Untitled"),
                    what=fields_m.get("what"),
                    why=fields_m.get("why"),
                    how=fields_m.get("how"),
                    when=fields_m.get("when"),
                    extra=fields_m.get("extra"),
                    topics=fields_m.get("topics", []),
                    refs=[CardRef(source=raw_m["sid"], start=raw_m["start"], end=raw_m["end"])],
                    images=[],
                    created_at=now,
                    updated_at=now,
                )
                cards_map[new_id] = new_card
                new_card_ids.append(new_id)

                # Embed new card (embeds brief description {what})
                vec_m = self.client.embed([new_card.what or new_card.title])
                self.index.upsert(new_id, vec_m)

            # Mark all member pairs as never_merge
            for i in range(len(sorted_members)):
                for j in range(i + 1, len(sorted_members)):
                    self.db.mark_never_merge(sorted_members[i], sorted_members[j])

            self.db.record_applied_split(cid, split_entry.ts)
            splits_applied += 1

        return splits_applied, new_card_ids
