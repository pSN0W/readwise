"""Topic tree management, decisions, and tag suggestions."""

import difflib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from rh_ingest.contract.models import Card, LibraryTopic, TagSuggestion, TopicDecision
from rh_ingest.workdb import WorkDB


def clean_path(raw_path: str) -> str | None:
    """Clean and truncate a topic path to at most 3 levels."""
    if not raw_path:
        return None
    parts = [p.strip() for p in raw_path.strip().strip("/").split("/") if p.strip()]
    if not parts:
        return None
    return "/".join(parts[:3])


def flatten_yaml_topics(data: Any, prefix: str = "") -> list[str]:
    """Flatten nested YAML dictionary into slash-separated topic paths."""
    paths: list[str] = []
    if isinstance(data, dict):
        for k, v in data.items():
            curr = f"{prefix}/{k}" if prefix else str(k)
            if isinstance(v, dict) and v or isinstance(v, list) and v:
                paths.extend(flatten_yaml_topics(v, curr))
            else:
                cleaned = clean_path(curr)
                if cleaned:
                    paths.append(cleaned)
    elif isinstance(data, list):
        for item in data:
            curr = f"{prefix}/{item}" if prefix else str(item)
            cleaned = clean_path(curr)
            if cleaned:
                paths.append(cleaned)
    return paths


class TopicTree:
    """Topic hierarchy built from topics.yaml and library.json topics."""

    def __init__(self, library_dir: Path):
        self.library_dir = Path(library_dir)
        self.paths: set[str] = set()
        self.rejected_paths: set[str] = set()
        self._load()

    def _load(self) -> None:
        # 1. Read topics.yaml (read-only baseline)
        yaml_path = self.library_dir / "topics.yaml"
        if yaml_path.exists():
            try:
                content = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
                for p in flatten_yaml_topics(content):
                    self.paths.add(p)
            except Exception:
                pass

        # 2. Read library.json topics
        lib_json_path = self.library_dir / "library.json"
        if lib_json_path.exists():
            try:
                import json

                data = json.loads(lib_json_path.read_text(encoding="utf-8"))
                for t in data.get("topics", []):
                    cleaned = clean_path(t.get("path", ""))
                    if cleaned:
                        self.paths.add(cleaned)
            except Exception:
                pass

    def apply_decisions(
        self,
        decisions: dict[str, TopicDecision],
        cards_map: dict[str, Card],
        db: WorkDB,
    ) -> None:
        """Apply user topic decisions (accept, rename, combine, reject)."""
        # Load known suggestions from DB
        db_suggs = {s["id"]: s for s in db.list_suggestions(status=None)}

        for sug_id, dec in decisions.items():
            sug_info = db_suggs.get(sug_id)
            default_path = sug_info["path"] if sug_info else None
            target_path = clean_path(dec.path or default_path or "")
            linked_cards = sug_info["card_ids"] if sug_info else []

            if dec.action == "reject":
                if default_path:
                    self.rejected_paths.add(default_path)
                db.update_suggestion_status(sug_id, "rejected")
            elif dec.action in ("accept", "rename", "combine"):
                if target_path:
                    self.paths.add(target_path)
                    # Add path to linked cards
                    for cid in linked_cards:
                        if cid in cards_map:
                            if target_path not in cards_map[cid].topics:
                                cards_map[cid].topics.append(target_path)
                                cards_map[cid].topics.sort()
                    db.update_suggestion_status(sug_id, dec.action)

    def collect_suggestions(
        self,
        cards: list[Card],
        suggested_by_card: dict[str, list[str]],
        db: WorkDB,
        max_suggestions_per_run: int = 10,
    ) -> list[TagSuggestion]:
        """Group suggested topics, filter existing/rejected, find similar, and create TagSuggestions."""
        # Map: cleaned_path -> set of card_ids
        grouped: dict[str, set[str]] = {}
        for card in cards:
            raw_list = suggested_by_card.get(card.id, [])
            for raw in raw_list:
                cleaned = clean_path(raw)
                if not cleaned:
                    continue
                # Skip if already in tree or rejected
                if cleaned in self.paths or cleaned in self.rejected_paths:
                    continue
                if cleaned not in grouped:
                    grouped[cleaned] = set()
                grouped[cleaned].add(card.id)

        # Existing open suggestions in DB
        existing_suggs = {s["path"]: s for s in db.list_suggestions(status="open")}

        new_suggestions: list[TagSuggestion] = []
        all_tree_paths = sorted(list(self.paths))

        for path, card_set in grouped.items():
            if len(new_suggestions) >= max_suggestions_per_run:
                break

            if path in existing_suggs:
                # Update existing suggestion card_ids
                sug = existing_suggs[path]
                merged_cards = sorted(list(set(sug["card_ids"] + list(card_set))))
                db.save_suggestion(
                    sug_id=sug["id"],
                    path=path,
                    card_ids=merged_cards,
                    reason=sug["reason"],
                    similar_existing=sug["similar_existing"],
                    status="open",
                )
                continue

            # Find similar existing path in tree (cutoff 0.6)
            similar = difflib.get_close_matches(path, all_tree_paths, n=1, cutoff=0.6)
            similar_path = similar[0] if similar else None

            sug_id = db.next_suggestion_id()
            now = datetime.now(UTC)
            suggestion = TagSuggestion(
                id=sug_id,
                path=path,
                card_ids=sorted(list(card_set)),
                reason=f"Suggested for {len(card_set)} card(s)",
                similar_existing=similar_path,
                created_at=now,
            )
            db.save_suggestion(
                sug_id=sug_id,
                path=path,
                card_ids=sorted(list(card_set)),
                reason=suggestion.reason,
                similar_existing=similar_path,
                status="open",
            )
            new_suggestions.append(suggestion)

        # Combine open suggestions from DB to publish
        open_db_suggs = db.list_suggestions(status="open")
        result: list[TagSuggestion] = []
        for s in open_db_suggs:
            result.append(
                TagSuggestion(
                    id=s["id"],
                    path=s["path"],
                    card_ids=s["card_ids"],
                    reason=s.get("reason"),
                    similar_existing=s.get("similar_existing"),
                    created_at=datetime.fromisoformat(s["created_at"])
                    if s.get("created_at")
                    else datetime.now(UTC),
                )
            )
        return result

    def to_library_topics(self) -> list[LibraryTopic]:
        """Convert tree paths to sorted list of LibraryTopic objects."""
        return [LibraryTopic(path=p) for p in sorted(self.paths)]
