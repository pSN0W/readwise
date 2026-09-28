"""Card creation from drafts and membership tracking."""

import hashlib
from datetime import UTC, datetime

from rh_ingest.contract.models import Card, CardRef, MetaAsset
from rh_ingest.extract.extractor import CardDraft
from rh_ingest.workdb import WorkDB


def make_card_from_draft(
    draft: CardDraft,
    sid: str,
    chunk_idx: int,
    assets: list[MetaAsset],
    db: WorkDB,
    existing_topics: set[str],
) -> tuple[Card, str, list[str]]:
    """Creates a new Card, saves raw_card in DB, and returns (Card, raw_id, suggested_topics)."""
    # 1. Generate unique raw_id
    raw_hash = hashlib.sha256(
        f"{sid}:{chunk_idx}:{draft.start_line}:{draft.end_line}:{draft.title}".encode()
    ).hexdigest()[:10]
    raw_id = f"raw_{raw_hash}"

    # 2. Save raw_card
    db.save_raw_card(
        raw_id=raw_id,
        sid=sid,
        start=draft.start_line,
        end=draft.end_line,
        fields=draft.model_dump(),
        chunk_idx=chunk_idx,
    )

    # 3. Allocate card_id
    card_id = db.next_card_id()

    # 4. Link card members
    db.link_card_members(card_id, [raw_id])

    # 5. Filter topics and collect suggested
    assigned_topics: list[str] = []
    suggested: list[str] = list(draft.suggested_topics)
    for tp in draft.topics:
        if tp in existing_topics:
            assigned_topics.append(tp)
        else:
            suggested.append(tp)

    # 6. Attach assets whose line is inside [start_line, end_line]
    images: list[str] = []
    for asset in assets:
        if draft.start_line <= asset.line <= draft.end_line:
            images.append(f"sources/{sid}/{asset.path}")

    now = datetime.now(UTC)
    card = Card(
        id=card_id,
        rev=1,
        title=draft.title.strip(),
        what=draft.what.strip() if draft.what else None,
        why=draft.why.strip() if draft.why else None,
        how=draft.how.strip() if draft.how else None,
        when=draft.when.strip() if draft.when else None,
        extra=draft.extra.strip() if draft.extra else None,
        topics=assigned_topics,
        refs=[CardRef(source=sid, start=draft.start_line, end=draft.end_line)],
        images=images,
        created_at=now,
        updated_at=now,
    )

    return card, raw_id, suggested


def calc_overlap(start1: int, end1: int, start2: int, end2: int) -> int:
    """Calculate line overlap between two inclusive ranges."""
    return max(0, min(end1, end2) - max(start1, start2) + 1)


def match_by_overlap(
    draft: CardDraft,
    old_cards: list[Card],
    sid: str,
) -> tuple[Card | None, int]:
    """Find the old card whose ref to sid overlaps draft most, if overlap >= 50% of smaller range."""
    best_card: Card | None = None
    best_overlap = 0

    draft_len = draft.end_line - draft.start_line + 1

    for c in old_cards:
        ref = next((r for r in c.refs if r.source == sid), None)
        if not ref:
            continue
        ref_len = ref.end - ref.start + 1
        overlap = calc_overlap(draft.start_line, draft.end_line, ref.start, ref.end)
        min_len = min(draft_len, ref_len)
        if overlap >= 0.5 * min_len and overlap > best_overlap:
            best_overlap = overlap
            best_card = c

    return best_card, best_overlap
