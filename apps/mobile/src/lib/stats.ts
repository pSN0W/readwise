// Read counts per source, cached per Library (cardsInSource is computed once per source).
import type { Card, CardView, Library } from "@rh/core";

const bySource = new WeakMap<Library, Map<string, Card[]>>();

export function sourceCards(lib: Library, sourceId: string): Card[] {
  let m = bySource.get(lib);
  if (!m) { m = new Map(); bySource.set(lib, m); }
  let cs = m.get(sourceId);
  if (!cs) { cs = lib.cardsInSource(sourceId); m.set(sourceId, cs); }
  return cs;
}

export function sourceStats(lib: Library, sourceId: string, view: (c: Card) => CardView): { total: number; read: number; pct: number } {
  const cs = sourceCards(lib, sourceId);
  let read = 0;
  for (const c of cs) if (view(c).status !== "new") read++;
  return { total: cs.length, read, pct: cs.length ? Math.round((100 * read) / cs.length) : 0 };
}
