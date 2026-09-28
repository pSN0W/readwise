"""Pure checks and repairs for extracted card drafts."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from rh_ingest.chunk import Chunk
from rh_ingest.config import CheckSettings
from rh_ingest.llm.schemas import CardDraft

if TYPE_CHECKING:
    from rh_ingest.contract.models import CardRef, CoverageCheckStatus


@dataclass
class CheckResult:
    ok: bool
    drafts: list[CardDraft]
    gaps: list[list[int]]
    feedback_lines: list[str]
    max_gap_lines: int


def repair(
    drafts: list[CardDraft],
    chunk: Chunk,
    cfg: CheckSettings,
) -> list[CardDraft]:
    """In-code repairs: clamp small range slips, trim small overlaps, drop empty cards."""
    # 1. Drop empty
    valid: list[CardDraft] = []
    for d in drafts:
        if d.title and d.title.strip() and d.what and d.what.strip():
            valid.append(d)

    # 2. Clamp ranges off by <= clamp_lines
    repaired: list[CardDraft] = []
    for d in valid:
        start = d.start_line
        end = d.end_line

        # Clamp start
        if chunk.start - cfg.clamp_lines <= start < chunk.start:
            start = chunk.start
        # Clamp end
        if chunk.end < end <= chunk.end + cfg.clamp_lines:
            end = chunk.end

        if start <= end:
            d.start_line = start
            d.end_line = end
            repaired.append(d)

    # 3. Sort by start_line
    repaired.sort(key=lambda d: (d.start_line, d.end_line))

    # 4. Trim small overlaps
    for i in range(len(repaired) - 1):
        cur = repaired[i]
        nxt = repaired[i + 1]
        if cur.end_line >= nxt.start_line:
            overlap = cur.end_line - nxt.start_line + 1
            if overlap <= cfg.trim_overlap_lines:
                nxt.start_line = cur.end_line + 1
                nxt.end_line = max(nxt.end_line, nxt.start_line)

    return repaired


def check(
    drafts: list[CardDraft],
    chunk: Chunk,
    ignore: set[int],
    cfg: CheckSettings,
) -> CheckResult:
    """Validate drafts against ranges, overlaps, description length, and coverage."""
    feedback_lines: list[str] = []
    is_ok = True

    # 1. Ranges
    for d in drafts:
        if d.start_line < chunk.start or d.end_line > chunk.end:
            is_ok = False
            feedback_lines.append(
                f'Card "{d.title}" uses lines {d.start_line}–{d.end_line}, but this part is {chunk.start}–{chunk.end}.'
            )

    # 2. Overlaps
    for i in range(len(drafts) - 1):
        for j in range(i + 1, len(drafts)):
            d1 = drafts[i]
            d2 = drafts[j]
            if not (d1.end_line < d2.start_line or d2.end_line < d1.start_line):
                is_ok = False
                o_start = max(d1.start_line, d2.start_line)
                o_end = min(d1.end_line, d2.end_line)
                feedback_lines.append(
                    f'Cards "{d1.title}" and "{d2.title}" share lines {o_start}–{o_end}.'
                )

    # 3. Description presence (mandatory required field) and length (< 50 words)
    for d in drafts:
        if not d.what or not d.what.strip():
            is_ok = False
            feedback_lines.append(
                f'Card "{d.title}" is missing the mandatory required field "what". The "what" field is required and must always be provided with a brief description (< {cfg.max_description_words} words).'
            )
            continue
        word_count = len(d.what.split())
        if word_count > cfg.max_description_words:
            is_ok = False
            feedback_lines.append(
                f"Card \"{d.title}\" description ('what') has {word_count} words (limit {cfg.max_description_words}). Make it concise (less than {cfg.max_description_words} words)."
            )

    # 4. Coverage in chunk.start .. chunk.own_end
    covered_lines: set[int] = set()
    for d in drafts:
        covered_lines.update(range(d.start_line, d.end_line + 1))

    gaps: list[list[int]] = []
    curr_gap_start: int | None = None

    for line in range(chunk.start, chunk.own_end + 1):
        is_content = line not in ignore
        if is_content and line not in covered_lines:
            if curr_gap_start is None:
                curr_gap_start = line
        else:
            if curr_gap_start is not None:
                gaps.append([curr_gap_start, line - 1])
                curr_gap_start = None

    if curr_gap_start is not None:
        gaps.append([curr_gap_start, chunk.own_end])

    max_gap = max([end - start + 1 for start, end in gaps], default=0)
    if max_gap > cfg.max_gap_lines:
        is_ok = False
        for start, end in gaps:
            if end - start + 1 > cfg.max_gap_lines:
                feedback_lines.append(f"Lines {start}–{end} have no card. Add cards for them.")

    return CheckResult(
        ok=is_ok,
        drafts=drafts,
        gaps=gaps,
        feedback_lines=feedback_lines,
        max_gap_lines=max_gap,
    )


def check_whole_source_coverage(
    refs: list["CardRef"],
    total_lines: int,
    ignore: set[int],
    max_gap_limit: int,
) -> "CoverageCheckStatus":
    from rh_ingest.contract.models import CoverageCheckStatus

    covered_lines: set[int] = set()
    for r in refs:
        covered_lines.update(range(r.start, r.end + 1))

    content_lines_count = 0
    covered_content_count = 0
    gaps: list[list[int]] = []
    curr_gap_start: int | None = None

    for line in range(1, total_lines + 1):
        if line in ignore:
            if curr_gap_start is not None:
                gaps.append([curr_gap_start, line - 1])
                curr_gap_start = None
            continue

        content_lines_count += 1
        if line in covered_lines:
            covered_content_count += 1
            if curr_gap_start is not None:
                gaps.append([curr_gap_start, line - 1])
                curr_gap_start = None
        else:
            if curr_gap_start is None:
                curr_gap_start = line

    if curr_gap_start is not None:
        gaps.append([curr_gap_start, total_lines])

    pct = (
        round((covered_content_count / content_lines_count * 100.0), 2)
        if content_lines_count > 0
        else 100.0
    )
    max_gap = max([end - start + 1 for start, end in gaps], default=0)
    ok = max_gap <= max_gap_limit

    detail = None if ok else f"Largest uncovered gap is {max_gap} lines (limit {max_gap_limit})."
    return CoverageCheckStatus(
        ok=ok,
        covered_pct=pct,
        limit=max_gap_limit,
        gaps=gaps,
        detail=detail,
    )
