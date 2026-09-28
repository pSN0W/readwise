// Pure helpers for the W2 reader: which card belongs to a line, which item is at the top
// of a scrolled pane, and how to split blocks into render chunks. No DOM here (unit-tested).

export interface Span { id: string; start: number; end: number }

/** Index of the last item with key(item) <= x in an array sorted by key, or -1. */
export function lastLE<T>(arr: readonly T[], x: number, key: (t: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * The card to show for a line. Spans are sorted by start.
 * 1. the card with the latest start whose range holds the line;
 * 2. else the nearest card that started before the line (the reader is in a gap after it);
 * 3. else the first card (the line is before every card).
 */
export function cardAtLine(spans: readonly Span[], line: number): string | null {
  if (!spans.length) return null;
  const i = lastLE(spans, line, (s) => s.start);
  if (i < 0) return spans[0].id;
  for (let j = i; j >= 0 && j > i - 64; j--) if (spans[j].end >= line) return spans[j].id;
  return spans[i].id;
}

/** Start line of a card in this source (null if the card is not in it). */
export function lineOfCard(spans: readonly Span[], id: string): number | null {
  const s = spans.find((x) => x.id === id);
  return s ? s.start : null;
}

/**
 * First item whose bottom edge is below y (the "top visible" item).
 * tops/heights are in pane coordinates, sorted by top. Returns -1 for an empty list.
 */
export function topVisible(tops: readonly number[], heights: readonly number[], y: number): number {
  if (!tops.length) return -1;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] + heights[mid] > y) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export interface Chunk<T> { index: number; first: number; last: number; items: T[] }

/** Split blocks (each with line / optional endLine) into chunks of about `size` blocks. */
export function chunkBlocks<T extends { line: number; endLine?: number }>(blocks: readonly T[], size = 40): Chunk<T>[] {
  const out: Chunk<T>[] = [];
  for (let i = 0; i < blocks.length; i += size) {
    const items = blocks.slice(i, i + size);
    const lastB = items[items.length - 1];
    out.push({ index: out.length, first: items[0].line, last: lastB.endLine ?? lastB.line, items });
  }
  return out;
}

/** Anything with a line range (a Chunk, or a rendered book chunk). */
export interface LineRange { first: number; last: number }

/** Index of the chunk that holds a line (last chunk starting at or before it; 0 if before all). */
export function chunkOfLine(chunks: readonly LineRange[], line: number): number {
  return Math.max(0, lastLE(chunks, line, (c) => c.first));
}

/** Chunks whose line range meets [a, b]. */
export function chunksInRange(chunks: readonly LineRange[], a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = chunkOfLine(chunks, a); i < chunks.length && chunks[i].first <= b; i++) {
    if (chunks[i].last >= a) out.push(i);
  }
  return out;
}
