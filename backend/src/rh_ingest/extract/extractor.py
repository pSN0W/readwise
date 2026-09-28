"""CardExtractor implementing the LLM chunk extraction retry loop."""

import hashlib
import json
from dataclasses import dataclass

from langchain_core.messages import AIMessage, BaseMessage

from rh_ingest.chunk import Chunk
from rh_ingest.config import Settings
from rh_ingest.extract.checks import CheckResult, check, repair
from rh_ingest.llm.client import LLMClient, LLMFormatError
from rh_ingest.llm.prompts import Prompts
from rh_ingest.llm.schemas import CardDraft, ChunkCards
from rh_ingest.workdb import WorkDB


@dataclass
class ChunkResult:
    drafts: list[CardDraft]
    tries: int
    ok: bool
    gaps: list[list[int]]
    problems: list[str]


def better(a: CheckResult | None, b: CheckResult) -> CheckResult:
    if a is None:
        return b
    if b.ok and not a.ok:
        return b
    if a.ok and not b.ok:
        return a
    if b.max_gap_lines < a.max_gap_lines:
        return b
    return a


class CardExtractor:
    """Extracts card drafts from document chunks with validation and retries."""

    def __init__(self, client: LLMClient, prompts: Prompts, cfg: Settings):
        self.client = client
        self.prompts = prompts
        self.cfg = cfg

    def extract(
        self,
        sid: str,
        title: str,
        lines: list[str],
        chunk: Chunk,
        topics: list[str],
        db: WorkDB,
        ignore: set[int],
    ) -> ChunkResult:
        chunk_text = "\n".join(lines[chunk.start - 1 : chunk.end])
        key = hashlib.sha256(
            (chunk_text + self.prompts.version + self.cfg.llm.model + "1").encode("utf-8")
        ).hexdigest()

        cached = db.chunk_result(sid, chunk.idx, key)
        if cached is not None:
            cards_list = (
                cached["result"].get("cards", []) if isinstance(cached["result"], dict) else []
            )
            drafts = [CardDraft.model_validate(d) for d in cards_list]
            return ChunkResult(
                drafts=drafts,
                tries=cached["tries"],
                ok=cached["ok"],
                gaps=cached["gaps"],
                problems=cached["problems"],
            )

        system, user = self.prompts.cards(
            title,
            lines,
            chunk,
            topics,
            max_desc_words=self.cfg.checks.max_description_words,
        )
        messages: list[BaseMessage] = [system, user]
        best: CheckResult | None = None
        attempt = 0

        for attempt in range(1, self.cfg.checks.max_retries + 1):
            try:
                cards_res = self.client.chat_json(ChunkCards, messages)
                drafts = cards_res.cards
            except LLMFormatError as e:
                messages.extend(
                    [
                        AIMessage(e.raw),
                        self.prompts.retry([f"The answer was not valid JSON: {e.error}"]),
                    ]
                )
                continue

            drafts = repair(drafts, chunk, self.cfg.checks)
            res = check(drafts, chunk, ignore, self.cfg.checks)
            best = better(best, res)
            if res.ok:
                break

            drafts_json = json.dumps([d.model_dump() for d in drafts])
            messages.extend(
                [
                    AIMessage(drafts_json),
                    self.prompts.retry(res.feedback_lines),
                ]
            )

        result = ChunkResult(
            drafts=best.drafts if best else [],
            tries=attempt,
            ok=bool(best and best.ok),
            gaps=best.gaps if best else [],
            problems=best.feedback_lines if best else [],
        )

        db.save_chunk(
            sid=sid,
            idx=chunk.idx,
            start=chunk.start,
            end=chunk.end,
            own_end=chunk.own_end,
            input_hash=key,
            ok=result.ok,
            tries=result.tries,
            result={"cards": [d.model_dump() for d in result.drafts]},
            gaps=result.gaps,
            problems=result.problems,
        )
        return result
