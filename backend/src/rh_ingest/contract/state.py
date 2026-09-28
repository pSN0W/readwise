"""StateReader loading and merging device states from library/state/*.json."""

import json
from pathlib import Path

from pydantic import BaseModel, Field

from rh_ingest.contract.models import DeviceState, StateSplit, TopicDecision


class MergedState(BaseModel):
    splits: dict[str, StateSplit] = Field(default_factory=dict)
    topic_decisions: dict[str, TopicDecision] = Field(default_factory=dict)


class StateReader:
    """Reads all state/*.json files in a library and merges split & topic_decisions."""

    def __init__(self, library_dir: Path):
        self.state_dir = Path(library_dir) / "state"

    def load(self) -> MergedState:
        merged = MergedState()
        if not self.state_dir.exists():
            return merged

        for p in sorted(self.state_dir.glob("*.json")):
            # Skip tmp files
            if p.name.endswith(".tmp") or ".tmp." in p.name:
                continue

            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                state = DeviceState.model_validate(data)
            except Exception:
                continue

            # Merge card splits: highest ts wins
            for cid, card_state in state.cards.items():
                if card_state.split is not None:
                    existing_split = merged.splits.get(cid)
                    if existing_split is None or card_state.split.ts > existing_split.ts:
                        merged.splits[cid] = card_state.split

            # Merge topic decisions: highest ts wins
            for sug_id, dec in state.topic_decisions.items():
                existing_dec = merged.topic_decisions.get(sug_id)
                if existing_dec is None or dec.ts > existing_dec.ts:
                    merged.topic_decisions[sug_id] = dec

        return merged
