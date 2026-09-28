// Search, deep-dive prompt, coverage, topic tree with decisions, notes, and content blocks.
import { sourcePath, type LibraryFS } from "./fs.ts";
import type { Library } from "./library.ts";
import { rangeLabel } from "./locate.ts";
import { CARD_FIELDS, CARD_FIELD_LABELS, type Card, type SourceSummary, type TopicDecision, type TopicSuggestion } from "./types.ts";

/* ------------------------------------------------------------------ search */

export interface SourceHit { kind: "source"; source: SourceSummary; score: number }
export interface CardHit { kind: "card"; card: Card; score: number }
export interface TopicHit { kind: "topic"; path: string; score: number }
export type SearchHit = SourceHit | CardHit | TopicHit;

function words(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

/** Score of one field against all query words; 0 if some word is missing from every field. */
function scoreFields(qw: string[], title: string, others: string[]): number {
  const t = title.toLowerCase();
  const rest = others.join(" \u0000 ").toLowerCase();
  let score = 0;
  for (const w of qw) {
    if (t.startsWith(w)) score += 30;
    else if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}`, "u").test(t)) score += 20;
    else if (t.includes(w)) score += 12;
    else if (rest.includes(w)) score += 5;
    else return 0;
  }
  return score;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search resources by title, authors, URL, file name, kind, keywords, id. Empty query returns all, newest first. */
export function searchSources(lib: Library, query: string, limit = 50): SourceHit[] {
  const qw = words(query);
  const all = lib.sourceList();
  if (!qw.length) {
    return [...all].sort((a, b) => b.added_at.localeCompare(a.added_at)).slice(0, limit).map((s) => ({ kind: "source", source: s, score: 0 }));
  }
  const hits: SourceHit[] = [];
  for (const s of all) {
    const score = scoreFields(qw, s.title, [
      ...(s.authors ?? []), s.origin.url ?? "", s.origin.filename ?? "", s.kind, s.id, ...(s.keywords ?? []),
    ]);
    if (score > 0) hits.push({ kind: "source", source: s, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.source.title.localeCompare(b.source.title)).slice(0, limit);
}

/** Sources, cards (title / what) and topics, best first. For the command palette. */
export function searchAll(lib: Library, query: string, limit = 30): SearchHit[] {
  const qw = words(query);
  if (!qw.length) return searchSources(lib, "", limit);
  const hits: SearchHit[] = [...searchSources(lib, query, limit)];
  for (const c of lib.cards.values()) {
    const score = scoreFields(qw, c.title, [c.what ?? "", ...c.topics]);
    if (score > 0) hits.push({ kind: "card", card: c, score: score - 1 });
  }
  const topics = new Set(lib.manifest.topics.map((t) => t.path));
  for (const p of topics) {
    const leaf = p.split("/").pop() as string;
    const score = scoreFields(qw, leaf, [p]);
    if (score > 0) hits.push({ kind: "topic", path: p, score: score - 2 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ------------------------------------------------------------ deep dive copy */

/** Card fields that have text, in display order: What, Why, How, When, Additional info. */
export function cardFields(card: Card): { key: (typeof CARD_FIELDS)[number]; label: string; text: string }[] {
  return CARD_FIELDS.filter((k) => card[k]).map((k) => ({ key: k, label: CARD_FIELD_LABELS[k], text: card[k] as string }));
}

/** Prompt + card + every source's lines. Reads text from content.md; nothing is stored twice. */
export async function buildDeepDivePrompt(lib: Library, card: Card, prompt: string): Promise<string> {
  const out: string[] = [prompt.trim(), "", `## Card: ${card.title}`];
  for (const f of cardFields(card)) out.push(`${f.label}: ${f.text}`);
  if (card.topics.length) out.push(`Topics: ${card.topics.join(", ")}`);
  out.push("", "## Sources");
  for (const r of card.refs) {
    const src = lib.source(r.source);
    const meta = await lib.meta(r.source);
    const lines = await lib.lines(r.source, r.start, r.end);
    const where = src?.origin.url ?? src?.origin.filename ?? "";
    out.push("", `### ${src?.title ?? r.source} — ${rangeLabel(meta, r.start, r.end)}${where ? ` (${where})` : ""}`, "", ...lines);
  }
  return out.join("\n") + "\n";
}

/* ---------------------------------------------------------------- coverage */

export interface Coverage { n_lines: number; covered: number; covered_pct: number; gaps: [number, number][] }

/** Lines of a source not inside any card's range. Computed from cards; no extra data needed. */
export function coverage(lib: Library, sourceId: string): Coverage {
  const n = lib.source(sourceId)?.n_lines ?? 0;
  const ranges: [number, number][] = [];
  for (const c of lib.cards.values()) for (const r of c.refs) if (r.source === sourceId) ranges.push([r.start, Math.min(r.end, n)]);
  ranges.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let next = 1;
  let covered = 0;
  for (const [a, b] of ranges) {
    if (a > next) gaps.push([next, a - 1]);
    if (b >= next) { covered += b - Math.max(a, next) + 1; next = b + 1; }
  }
  if (next <= n) gaps.push([next, n]);
  return { n_lines: n, covered, covered_pct: n ? Math.round((1000 * covered) / n) / 10 : 0, gaps };
}

/* ------------------------------------------------------------ topic tree */

export interface TopicNode { name: string; path: string; children: TopicNode[]; cardIds: string[] }

/**
 * Topic paths a card has, including model suggestions the user already accepted/renamed/combined
 * (shown at once, before the backend makes them permanent).
 */
export function topicsWithDecisions(card: Card, suggestions: TopicSuggestion[], decisions: Record<string, TopicDecision>): string[] {
  const out = [...card.topics];
  for (const s of suggestions) {
    const d = decisions[s.id];
    if (!d || d.action === "reject" || !s.card_ids.includes(card.id)) continue;
    const p = d.action === "accept" ? s.path : d.path;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Suggestions the user has not decided yet. */
export function openSuggestions(suggestions: TopicSuggestion[], decisions: Record<string, TopicDecision>): TopicSuggestion[] {
  return suggestions.filter((s) => !decisions[s.id]);
}

/** Build a tree (up to 3 levels) from cards' topic paths. A card is listed at its deepest node(s). */
export function topicTree(cards: Iterable<Card>, topicsOf: (c: Card) => string[] = (c) => c.topics): TopicNode {
  const root: TopicNode = { name: "", path: "", children: [], cardIds: [] };
  for (const c of cards) {
    for (const p of topicsOf(c)) {
      let node = root;
      const parts = p.split("/");
      parts.forEach((name, i) => {
        const path = parts.slice(0, i + 1).join("/");
        let child = node.children.find((x) => x.name === name);
        if (!child) { child = { name, path, children: [], cardIds: [] }; node.children.push(child); }
        node = child;
      });
      if (!node.cardIds.includes(c.id)) node.cardIds.push(c.id);
    }
  }
  const sort = (n: TopicNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root;
}

/** All card ids at or under a node. */
export function cardIdsUnder(node: TopicNode): string[] {
  const out = new Set<string>(node.cardIds);
  for (const c of node.children) for (const id of cardIdsUnder(c)) out.add(id);
  return [...out];
}

/* ------------------------------------------------------------------- notes */

export async function readNote(fs: LibraryFS, cardId: string): Promise<string> {
  return (await fs.readText(`notes/${cardId}.md`)) ?? "";
}

export async function writeNote(fs: LibraryFS, cardId: string, text: string): Promise<void> {
  await fs.writeText(`notes/${cardId}.md`, text.endsWith("\n") || !text ? text : text + "\n");
}

/** Old (retired) ids that now resolve to this card: cards merged into it, or the card it was split from. */
export function retiredInto(lib: Library, cardId: string): string[] {
  const out: string[] = [];
  for (const old of lib.retired.keys()) if (lib.resolveId(old).includes(cardId)) out.push(old);
  return out.sort();
}

/**
 * The card's own note first, then notes still stored under retired ids that point to this card.
 * The backend never moves notes (contract: one writer per file), so after a merge the other card's
 * note stays in notes/<old id>.md. Show those read-only under the card's own note.
 */
export async function readNotes(lib: Library, fs: LibraryFS, cardId: string): Promise<{ id: string; text: string; own: boolean }[]> {
  const out = [{ id: cardId, text: await readNote(fs, cardId), own: true }];
  for (const old of retiredInto(lib, cardId)) {
    const text = await readNote(fs, old);
    if (text.trim()) out.push({ id: old, text, own: false });
  }
  return out;
}

/** Card ids that have a non-empty note, and Syncthing conflict copies per card id. */
export async function listNotes(fs: LibraryFS): Promise<{ ids: string[]; conflicts: Record<string, string[]> }> {
  const names = await fs.list("notes");
  const ids: string[] = [];
  const conflicts: Record<string, string[]> = {};
  for (const n of names) {
    const m = /^(c_[A-Za-z0-9_]+)\.sync-conflict-.*\.md$/.exec(n);
    if (m) (conflicts[m[1]] ??= []).push(`notes/${n}`);
    else if (/^c_[A-Za-z0-9_]+\.md$/.test(n)) ids.push(n.slice(0, -3));
  }
  return { ids, conflicts };
}

/* ------------------------------------------------------- content.md blocks */

export type Block =
  | { type: "heading"; line: number; level: number; text: string }
  | { type: "image"; line: number; alt: string; path: string }
  | { type: "cue"; line: number; time: string; text: string }
  | { type: "math"; line: number; endLine: number; tex: string }
  | { type: "code"; line: number; endLine: number; lang: string; text: string }
  | { type: "para"; line: number; endLine: number; text: string };

/**
 * Split content.md lines into blocks for the book / transcript view. Every block keeps its line numbers,
 * so the UI can match blocks to card ranges. Image paths are returned library-relative.
 */
export function toBlocks(sourceId: string, lines: string[], from = 1, to = lines.length): Block[] {
  const out: Block[] = [];
  let i = from - 1;
  const end = Math.min(to, lines.length);
  while (i < end) {
    const text = lines[i];
    const ln = i + 1;
    let m: RegExpExecArray | null;
    if (!text.trim()) { i++; continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(text))) { out.push({ type: "heading", line: ln, level: m[1].length, text: m[2] }); i++; continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(text))) {
      const p = /^[a-z]+:\/\//i.test(m[2]) ? m[2] : sourcePath(sourceId, m[2]);
      out.push({ type: "image", line: ln, alt: m[1], path: p }); i++; continue;
    }
    if ((m = /^\[(\d+:\d{2}(?::\d{2})?)\]\s?(.*)$/.exec(text))) { out.push({ type: "cue", line: ln, time: m[1], text: m[2] }); i++; continue; }
    if (text.trim().startsWith("```")) {
      const lang = text.trim().slice(3).trim();
      let j = i + 1;
      while (j < end && !lines[j].trim().startsWith("```")) j++;
      out.push({ type: "code", line: ln, endLine: Math.min(j + 1, end), lang, text: lines.slice(i + 1, j).join("\n") });
      i = j + 1; continue;
    }
    if (text.trim().startsWith("$$")) {
      let j = i;
      if (!(text.trim().length > 2 && text.trim().endsWith("$$"))) { j = i + 1; while (j < end && !lines[j].includes("$$")) j++; }
      out.push({ type: "math", line: ln, endLine: j + 1, tex: lines.slice(i, j + 1).join("\n").replace(/\$\$/g, "").trim() });
      i = j + 1; continue;
    }
    let j = i;
    while (j + 1 < end && lines[j + 1].trim() && !/^(#{1,6}\s|!\[|\[\d+:\d{2}|```|\$\$)/.test(lines[j + 1])) j++;
    out.push({ type: "para", line: ln, endLine: j + 1, text: lines.slice(i, j + 1).join(" ") });
    i = j + 1;
  }
  return out;
}
