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

export interface SourceStats { total: number; read: number; pct: number; viewed: number; explored: number }

export function sourceStats(lib: Library, sourceId: string, view: (c: Card) => CardView): SourceStats {
  const cs = sourceCards(lib, sourceId);
  let viewed = 0, explored = 0;
  for (const c of cs) {
    const s = view(c).status;
    if (s === "explored") explored++;
    else if (s === "viewed") viewed++;
  }
  const read = viewed + explored;
  return { total: cs.length, read, pct: cs.length ? Math.round((100 * read) / cs.length) : 0, viewed, explored };
}

/** Width (%) of each meter segment. */
export function meterParts(s: SourceStats): { ex: number; vw: number } {
  return s.total ? { ex: (100 * s.explored) / s.total, vw: (100 * s.viewed) / s.total } : { ex: 0, vw: 0 };
}
