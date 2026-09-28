// Feed scopes and order. Data, state, topics come from @rh/core; this only decides the order.
import { topicTree, type Card, type CardView, type Library, type TopicNode } from "@rh/core";

/** "all" | "src:<source id>" | "topic:<topic path>" */
export type ScopeKey = string;

export type Scope = { kind: "all" } | { kind: "source"; id: string } | { kind: "topic"; path: string };

export function parseScope(key: ScopeKey): Scope {
  if (key.startsWith("src:")) return { kind: "source", id: key.slice(4) };
  if (key.startsWith("topic:")) return { kind: "topic", path: key.slice(6) };
  return { kind: "all" };
}

/** 0 = New, 1 = Viewed / Explored, 2 = Known. */
export function rank(v: CardView): number {
  if (v.known) return 2;
  return v.status === "new" ? 0 : 1;
}

export type FeedFilter = "all" | "unread" | "viewed";

/**
 * Card ids of a scope, in feed order. Call once per scope and keep the list while reading,
 * so cards do not jump when their state changes.
 * - Everything / topic: New first, then Viewed / Explored, Known last; inside a group, source order.
 * - One source: the source's order (where each card starts in it).
 * - filter: "all" (default), "unread" (only status === "new" and !known), or "viewed" (already read/known).
 */
export function feedOrder(
  lib: Library,
  scope: ScopeKey,
  view: (c: Card) => CardView,
  topicsOf?: (c: Card) => string[],
  filter: FeedFilter = "all",
): string[] {
  const s = parseScope(scope);
  let cards = s.kind === "source"
    ? lib.cardsInSource(s.id)
    : s.kind === "topic"
      ? lib.cardsInTopic(s.path, topicsOf ? (c) => topicsOf(c).filter((t) => !c.topics.includes(t)) : undefined)
      : [...lib.cards.values()];

  if (filter === "unread") {
    cards = cards.filter((c) => {
      const v = view(c);
      return v.status === "new" && !v.known;
    });
  } else if (filter === "viewed") {
    cards = cards.filter((c) => {
      const v = view(c);
      return v.status !== "new" || v.known;
    });
  }

  if (s.kind === "source") return cards.map((c) => c.id);
  const srcIndex = new Map(lib.sourceList().map((x, i) => [x.id, i]));
  const keyed = cards.map((c) => {
    const r = c.refs[0];
    return { c, rank: rank(view(c)), si: srcIndex.get(r?.source ?? "") ?? 1e9, start: r?.start ?? 0 };
  });
  keyed.sort((a, b) => a.rank - b.rank || a.si - b.si || a.start - b.start || a.c.id.localeCompare(b.c.id));
  return keyed.map((k) => k.c.id);
}

/** Options for the scope select: Everything, each source, each topic at every level. */
export function scopeOptions(lib: Library, tree: TopicNode): { key: ScopeKey; label: string }[] {
  const out: { key: ScopeKey; label: string }[] = [{ key: "all", label: "Everything" }];
  for (const s of lib.sourceList()) out.push({ key: `src:${s.id}`, label: s.title });
  const walk = (n: TopicNode, depth: number) => {
    for (const c of n.children) {
      out.push({ key: `topic:${c.path}`, label: `${"· ".repeat(depth)}${c.name}` });
      walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

/** Share of cards that are not New, 0–100. */
export function readShare(cards: Iterable<Card>, view: (c: Card) => CardView): number {
  let n = 0, r = 0;
  for (const c of cards) { n++; if (view(c).status !== "new") r++; }
  return n ? Math.round((100 * r) / n) : 0;
}

export function scopeLabel(lib: Library, key: ScopeKey): string {
  const s = parseScope(key);
  if (s.kind === "source") return lib.source(s.id)?.title ?? s.id;
  if (s.kind === "topic") return s.path.split("/").join(" › ");
  return "Everything";
}

export { topicTree };
