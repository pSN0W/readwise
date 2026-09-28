import type { Run, SourceMeta, TocEntry } from "./types.ts";

/** Value of the last run whose start line is <= line (binary search). null if none. */
export function runValue(runs: Run[] | null, line: number): number | null {
  if (!runs || runs.length === 0 || line < runs[0][0]) return null;
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid][0] <= line) lo = mid;
    else hi = mid - 1;
  }
  return runs[lo][1];
}

export function pageOf(meta: SourceMeta, line: number): number | null {
  return runValue(meta.pages, line);
}

export function timeOf(meta: SourceMeta, line: number): number | null {
  return runValue(meta.times, line);
}

/** First line whose time is >= t seconds (for "open the transcript at 12:30"). */
export function lineAtTime(meta: SourceMeta, t: number): number | null {
  const runs = meta.times;
  if (!runs || runs.length === 0) return null;
  for (const [line, s] of runs) if (s >= t) return line;
  return runs[runs.length - 1][0];
}

/** The TOC entry a line belongs to (last heading at or before the line). */
export function sectionOf(meta: SourceMeta, line: number, maxLevel = 6): TocEntry | null {
  let best: TocEntry | null = null;
  for (const t of meta.toc) {
    if (t.level > maxLevel) continue;
    if (t.line <= line) best = t;
    else break;
  }
  return best;
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(r).padStart(2, "0")}`;
}

/** Human label for a line range: "lines 12–40, p. 3–4" or "12:30–15:10". */
export function rangeLabel(meta: SourceMeta, start: number, end: number): string {
  if (meta.kind === "video" && meta.times) {
    const a = timeOf(meta, start);
    const b = timeOf(meta, end);
    if (a !== null && b !== null) return `${formatTime(a)}–${formatTime(b)}`;
  }
  let label = `lines ${start}–${end}`;
  if (meta.pages) {
    const a = pageOf(meta, start);
    const b = pageOf(meta, end);
    if (a !== null && b !== null) label += a === b ? `, p. ${a}` : `, p. ${a}–${b}`;
  }
  return label;
}
