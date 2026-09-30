import { readJSON, type LibraryFS } from "./fs.ts";
import type { Card, CardStateEntry, CardView, DeviceState, Stamped, TopicAction, TopicDecision } from "./types.ts";

export const DEFAULT_COPY_PROMPT =
  "You are my tutor. I know the card below at a basic level. Go deeper using the source text. " +
  "Use simple words. End with one question to check I understood.";
export const DEFAULT_MY_TAGS = ["revisit", "important", "confusing", "read later"];
/** A card counts as Viewed after this long on screen (the UI runs the timer). */
export const VIEWED_AFTER_MS = 2000;

function later<T extends { ts: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.ts > a.ts ? b : a;
}

function mergeEntry(a: CardStateEntry | undefined, b: CardStateEntry): CardStateEntry {
  if (!a) return { ...b };
  const out: CardStateEntry = {};
  // viewed: highest rev wins, tie -> latest ts
  if (a.viewed || b.viewed) {
    if (!a.viewed) out.viewed = b.viewed;
    else if (!b.viewed) out.viewed = a.viewed;
    else out.viewed = b.viewed.rev > a.viewed.rev || (b.viewed.rev === a.viewed.rev && b.viewed.ts > a.viewed.ts) ? b.viewed : a.viewed;
  }
  // explored: earliest wins (a fact, not a toggle)
  if (a.explored || b.explored) {
    out.explored = !a.explored ? b.explored : !b.explored ? a.explored : (b.explored.ts < a.explored.ts ? b.explored : a.explored);
  }
  const k = later(a.known, b.known); if (k) out.known = k;
  const t = later(a.tags, b.tags); if (t) out.tags = t;
  const s = later(a.split, b.split); if (s) out.split = s;
  return out;
}

/** Merge many device files into one view, using the contract's rules. Pure function. */
export function mergeStates(files: DeviceState[]): Omit<DeviceState, "device_id" | "updated_at"> {
  const cards: Record<string, CardStateEntry> = {};
  const myTags: Record<string, { ts: number; deleted?: boolean }> = {};
  const decisions: Record<string, TopicDecision> = {};
  let prompt: Stamped<string> | undefined;
  for (const f of files) {
    for (const [id, e] of Object.entries(f.cards ?? {})) cards[id] = mergeEntry(cards[id], e);
    for (const [tag, v] of Object.entries(f.my_tags ?? {})) myTags[tag] = later(myTags[tag], v) as { ts: number };
    for (const [id, d] of Object.entries(f.topic_decisions ?? {})) decisions[id] = later(decisions[id], d) as TopicDecision;
    prompt = later(prompt, f.copy_prompt);
  }
  return { schema_version: 1, cards, my_tags: myTags, topic_decisions: decisions, copy_prompt: prompt };
}

/** Pure: what to show for a card given merged state. */
export function viewOf(card: Card, e: CardStateEntry | undefined): CardView {
  const status = e?.explored ? "explored" : e?.viewed ? "viewed" : "new";
  return {
    status,
    known: !!e?.known?.v,
    updated: !!e?.viewed && e.viewed.rev < card.rev,
    tags: e?.tags?.v ?? [],
    split: !!e?.split?.v,
  };
}

export interface StateStoreOptions {
  /** Called after any change (merged view changed). */
  onChange?: () => void;
  /** Delay before writing this device's file. Default 1000 ms. */
  debounceMs?: number;
  /** Clock, for tests. */
  now?: () => number;
  /** Maps retired card ids to current ones (Library.resolveId). */
  resolveId?: (id: string) => string[];
}

/**
 * Reads every state/*.json, merges them, and writes ONLY state/<deviceId>.json.
 * All mutations go to this device's file; reads use the merged view.
 */
export class StateStore {
  fs: LibraryFS;
  deviceId: string;
  own: DeviceState;
  others: DeviceState[];
  merged: Omit<DeviceState, "device_id" | "updated_at">;
  private opts: StateStoreOptions;
  private timer: ReturnType<typeof setTimeout> | null;
  private writing: Promise<void>;

  private constructor(fs: LibraryFS, deviceId: string, own: DeviceState, others: DeviceState[], opts: StateStoreOptions) {
    this.fs = fs;
    this.deviceId = deviceId;
    this.own = own;
    this.others = others;
    this.opts = opts;
    this.timer = null;
    this.writing = Promise.resolve();
    this.merged = mergeStates([...others, own]);
  }

  static async open(fs: LibraryFS, deviceId: string, opts: StateStoreOptions = {}): Promise<StateStore> {
    if (!/^[a-z0-9-]+$/.test(deviceId)) throw new Error("deviceId must be lowercase letters, digits and dashes");
    const names = (await fs.list("state")).filter((n) => n.endsWith(".json") && !n.endsWith(".tmp"));
    const files: DeviceState[] = [];
    let own: DeviceState | null = null;
    for (const n of names) {
      const f = await readJSON<DeviceState>(fs, `state/${n}`).catch(() => null);
      if (!f) continue;
      if (n === `${deviceId}.json`) own = f;
      else files.push(f); // other devices, and Syncthing conflict copies of any file
    }
    own ??= { schema_version: 1, device_id: deviceId, updated_at: 0, cards: {} };
    const store = new StateStore(fs, deviceId, own, files, opts);
    store.migrateRetired();
    return store;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Re-read other devices' files (call when the folder changed). Keeps local edits. */
  async reloadOthers(): Promise<void> {
    const names = (await this.fs.list("state")).filter((n) => n.endsWith(".json") && n !== `${this.deviceId}.json`);
    const files: DeviceState[] = [];
    for (const n of names) {
      const f = await readJSON<DeviceState>(this.fs, `state/${n}`).catch(() => null);
      if (f) files.push(f);
    }
    this.others = files;
    this.remerge();
  }

  /** Move entries of retired card ids to their new ids (in this device's file only). */
  private migrateRetired(): void {
    const resolve = this.opts.resolveId;
    if (!resolve) return;
    let changed = false;
    for (const id of Object.keys(this.own.cards)) {
      const into = resolve(id);
      if (into.length === 1 && into[0] === id) continue;
      if (into.length === 0) continue; // unknown id: keep, maybe the library is behind
      const e = this.own.cards[id];
      delete this.own.cards[id];
      for (const n of into) this.own.cards[n] = mergeEntry(this.own.cards[n], e);
      changed = true;
    }
    if (changed) this.touch();
    else this.remerge();
  }

  private remerge(): void {
    this.merged = mergeStates([...this.others, this.own]);
  }

  private touch(): void {
    this.own.updated_at = this.now();
    this.remerge();
    this.opts.onChange?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.debounceMs ?? 1000);
  }

  /** Write this device's file now (also called by the debounce). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const text = JSON.stringify(this.own, null, 1) + "\n";
    this.writing = this.writing.then(() => this.fs.writeText(`state/${this.deviceId}.json`, text));
    return this.writing;
  }

  private entry(cardId: string): CardStateEntry {
    return (this.own.cards[cardId] ??= {});
  }

  view(card: Card): CardView {
    return viewOf(card, this.merged.cards[card.id]);
  }

  /** Call when the card has been on screen for VIEWED_AFTER_MS. No-op if already viewed at this rev. */
  markViewed(card: Card): void {
    const cur = this.merged.cards[card.id]?.viewed;
    if (cur && cur.rev >= card.rev) return;
    this.entry(card.id).viewed = { rev: card.rev, ts: this.now() };
    this.touch();
  }

  /** Call after "copy for deep dive" succeeded. Also marks viewed. */
  markExplored(card: Card): void {
    const e = this.entry(card.id);
    if (!this.merged.cards[card.id]?.explored) e.explored = { ts: this.now() };
    e.viewed = { rev: card.rev, ts: this.now() };
    this.touch();
  }

  setKnown(cardId: string, known: boolean): void {
    this.entry(cardId).known = { v: known, ts: this.now() };
    this.touch();
  }

  setTags(cardId: string, tags: string[]): void {
    const clean = [...new Set(tags.map(normalizeTag).filter(Boolean))];
    this.entry(cardId).tags = { v: clean, ts: this.now() };
    for (const t of clean) if (!this.myTags().includes(t)) this.createTag(t, false);
    this.touch();
  }

  toggleTag(cardId: string, tag: string): void {
    const cur = this.merged.cards[cardId]?.tags?.v ?? [];
    const t = normalizeTag(tag);
    this.setTags(cardId, cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }

  /** "Mark: these are different ideas". The backend splits the card on its next run. */
  setSplit(cardId: string, split: boolean): void {
    this.entry(cardId).split = { v: split, ts: this.now() };
    this.touch();
  }

  /** The user's own tags (defaults + created, minus deleted), sorted by first use. */
  myTags(): string[] {
    const tags = this.merged.my_tags ?? {};
    const out = DEFAULT_MY_TAGS.filter((t) => !tags[t]?.deleted);
    const extra = Object.entries(tags).filter(([t, v]) => !v.deleted && !out.includes(t)).sort((a, b) => a[1].ts - b[1].ts);
    return [...out, ...extra.map(([t]) => t)];
  }

  createTag(tag: string, notify = true): string {
    const t = normalizeTag(tag);
    if (!t) return t;
    (this.own.my_tags ??= {})[t] = { ts: this.now() };
    if (notify) this.touch();
    return t;
  }

  deleteTag(tag: string): void {
    (this.own.my_tags ??= {})[normalizeTag(tag)] = { ts: this.now(), deleted: true };
    this.touch();
  }

  /** Card ids that carry a personal tag. */
  cardsWithTag(tag: string): string[] {
    return Object.entries(this.merged.cards).filter(([, e]) => e.tags?.v.includes(tag)).map(([id]) => id);
  }

  copyPrompt(): string {
    return this.merged.copy_prompt?.v ?? DEFAULT_COPY_PROMPT;
  }

  setCopyPrompt(text: string): void {
    this.own.copy_prompt = { v: text, ts: this.now() };
    this.touch();
  }

  topicDecisions(): Record<string, TopicDecision> {
    return this.merged.topic_decisions ?? {};
  }

  /** Decide on a model-suggested topic. `path` is needed for rename and combine. */
  decideTopic(suggestionId: string, action: TopicAction, path?: string): void {
    if ((action === "rename" || action === "combine") && !path) throw new Error(`${action} needs a path`);
    (this.own.topic_decisions ??= {})[suggestionId] = path ? { action, path, ts: this.now() } : { action, ts: this.now() };
    this.touch();
  }
}

/** Personal tags: lowercase, no leading '#', single spaces. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase();
}

// Tag colors: the default tags have fixed colors, custom tags hash into a small pool.
// The CSS variables (--t-*) are defined in each app's app.css.
const TAG_FIXED: Record<string, string> = {
  revisit: "var(--t-revisit)",
  important: "var(--t-important)",
  confusing: "var(--t-confusing)",
  "read later": "var(--t-later)",
};
const TAG_POOL = ["var(--t-5)", "var(--t-6)", "var(--t-7)", "var(--t-8)", "var(--t-revisit)", "var(--t-important)", "var(--t-confusing)", "var(--t-later)"];

/** CSS color for a tag, stable across sessions and devices. Use as `style="--tc: {tagColor(t)}"`. */
export function tagColor(tag: string): string {
  const fixed = TAG_FIXED[tag];
  if (fixed) return fixed;
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_POOL[h % TAG_POOL.length];
}
