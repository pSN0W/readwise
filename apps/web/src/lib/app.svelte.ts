// App-wide state. Core objects (Library, StateStore) are not reactive, so every change bumps
// `tick`, and anything that reads state reads `app.tick` first (the helpers below do that).
import {
  Library, LibraryError, StateStore, buildDeepDivePrompt, listNotes, openSuggestions, rangeLabel,
  readNote, retiredInto, topicsWithDecisions, writeNote,
  type Card, type CardRef, type CardView, type SourceMeta,
} from "@rh/core";
import { HttpFS } from "./http-fs.ts";
import { prefs } from "./prefs.ts";
import { initViewed } from "./viewed.ts";

export const fs = new HttpFS("/library/");

class App {
  lib = $state.raw<Library | null>(null);
  st = $state.raw<StateStore | null>(null);
  /** Bumped on every state change (read state, tags, notes, decisions). */
  tick = $state(0);
  /** Bumped when a meta.json arrives (source labels). */
  metaTick = $state(0);
  error = $state<string | null>(null);
  updateReady = $state(false);
  toastMsg = $state<string | null>(null);
  /** Text shown for manual copy when the clipboard is refused. */
  manualCopy = $state.raw<{ text: string; card: Card } | null>(null);
  paletteOpen = $state(false);
  searchQuery = $state("");
  deviceId = $state(prefs.deviceId());
  noteIds = $state.raw<Set<string>>(new Set());
  conflicts = $state.raw<Record<string, string[]>>({});

  private notes = new Map<string, string>();
  private noteLoading = new Set<string>();
  private metas = new Map<string, SourceMeta>();
  private metaLoading = new Set<string>();
  private cardsBySourceCache: { gen: Library | null; map: Map<string, Card[]> } = { gen: null, map: new Map() };
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  /** Open library + state. Retries while sync is still running. */
  async open(): Promise<void> {
    try {
      const lib = await Library.open(fs, { cacheSize: 6 });
      const st = await StateStore.open(fs, this.deviceId, {
        resolveId: (id) => lib.resolveId(id),
        onChange: () => { this.tick++; },
      });
      const notes = await listNotes(fs);
      this.notes.clear();
      this.metas.clear();
      this.lib = lib;
      this.st = st;
      this.noteIds = new Set(notes.ids);
      this.conflicts = notes.conflicts;
      this.error = null;
      this.updateReady = false;
      initViewed((id) => { const c = this.lib?.cards.get(id); if (c) this.st?.markViewed(c); });
      this.tick++;
      this.startPolling();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      if (e instanceof LibraryError && /Sync is still running/.test(this.error)) setTimeout(() => void this.open(), 3000);
    }
  }

  /** Re-open after "New cards arrived". Keeps the scroll position of every pane. */
  async reload(): Promise<void> {
    const panes = [...document.querySelectorAll<HTMLElement>("[data-keep-scroll]")].map((el) => [el.dataset.keepScroll, el.scrollTop] as const);
    await this.st?.flush();
    await this.open();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [k, top] of panes) {
        const el = document.querySelector<HTMLElement>(`[data-keep-scroll="${k}"]`);
        if (el) el.scrollTop = top;
      }
    }));
  }

  startPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      const lib = this.lib;
      if (!lib) return;
      try {
        if (await lib.hasUpdate()) this.updateReady = true;
        await this.st?.reloadOthers();
        this.tick++;
      } catch { /* server gone for a moment */ }
    }, prefs.pollMs());
  }

  async setDeviceId(id: string): Promise<void> {
    await this.st?.flush();
    prefs.setDeviceId(id);
    this.deviceId = id;
    await this.open();
  }

  /* ------------------------------------------------------------ reads */

  view(card: Card): CardView {
    void this.tick;
    return this.st ? this.st.view(card) : { status: "new", known: false, updated: false, tags: [], split: false };
  }

  topicsOf(card: Card): string[] {
    void this.tick;
    if (!this.lib || !this.st) return card.topics;
    return topicsWithDecisions(card, this.lib.suggestions, this.st.topicDecisions());
  }

  myTags(): string[] {
    void this.tick;
    return this.st?.myTags() ?? [];
  }

  openSuggestionCount(): number {
    void this.tick;
    return this.lib && this.st ? openSuggestions(this.lib.suggestions, this.st.topicDecisions()).length : 0;
  }

  /** core lib.cardsInSource(), cached per Library (it scans every card). */
  cardsInSource(sourceId: string): Card[] {
    const lib = this.lib;
    if (!lib) return [];
    if (this.cardsBySourceCache.gen !== lib) this.cardsBySourceCache = { gen: lib, map: new Map() };
    const map = this.cardsBySourceCache.map;
    let hit = map.get(sourceId);
    if (!hit) { hit = lib.cardsInSource(sourceId); map.set(sourceId, hit); }
    return hit;
  }

  /** Share of a source's cards that are not New (0-100). */
  readPct(sourceId: string): number {
    void this.tick;
    const cs = this.cardsInSource(sourceId);
    if (!cs.length || !this.st) return 0;
    let n = 0;
    for (const c of cs) if (this.st.view(c).status !== "new") n++;
    return Math.round((100 * n) / cs.length);
  }

  /**
   * meta.json via core's lib.meta() (only loads meta.json, not content.md). Core caches up to 256.
   * Returns null until loaded; bumps metaTick for reactive updates.
   */
  metaOf(sourceId: string): SourceMeta | null {
    void this.metaTick;
    const m = this.metas.get(sourceId);
    if (m) return m;
    const lib = this.lib;
    if (lib && !this.metaLoading.has(sourceId)) {
      this.metaLoading.add(sourceId);
      lib.meta(sourceId)
        .then((meta) => { this.metas.set(sourceId, meta); this.metaTick++; })
        .catch(() => {})                                // missing meta → label stays "lines a–b"
        .finally(() => this.metaLoading.delete(sourceId));
    }
    return null;
  }

  refLabel(r: CardRef): string {
    const meta = this.metaOf(r.source);
    return meta ? rangeLabel(meta, r.start, r.end) : `lines ${r.start}–${r.end}`;
  }

  sourceTitle(id: string): string {
    return this.lib?.source(id)?.title ?? id;
  }

  /** YouTube (or other video) URL at a second. */
  videoUrlAt(sourceId: string, seconds: number): string | null {
    const url = this.lib?.source(sourceId)?.origin.url;
    if (!url) return null;
    return url + (url.includes("?") ? "&" : "?") + `t=${Math.floor(seconds)}s`;
  }

  /* ------------------------------------------------------------ notes */

  note(id: string): string {
    void this.tick;
    const hit = this.notes.get(id);
    if (hit !== undefined) return hit;
    if (this.noteIds.has(id) && !this.noteLoading.has(id)) {
      this.noteLoading.add(id);
      readNote(fs, id).then((t) => { this.notes.set(id, t); this.noteLoading.delete(id); this.tick++; });
    }
    return "";
  }

  async saveNote(id: string, text: string): Promise<void> {
    const clean = text.replace(/\s+$/, "");
    if ((this.notes.get(id) ?? "") === clean) return;
    await writeNote(fs, id, clean);
    this.notes.set(id, clean);
    const ids = new Set(this.noteIds);
    if (clean) ids.add(id); else ids.delete(id);
    this.noteIds = ids;
    this.tick++;
  }

  async readConflict(path: string): Promise<string> {
    return (await fs.readText(path)) ?? "";
  }

  hasNote(id: string): boolean {
    void this.tick;
    if (this.noteIds.has(id)) return true;
    if ((this.notes.get(id) ?? "").trim().length > 0) return true;
    if (!this.lib) return false;
    return retiredInto(this.lib, id).some((old) => this.noteIds.has(old) || !!(this.notes.get(old) ?? "").trim());
  }

  /* ------------------------------------------------------------ actions */

  toast(msg: string): void {
    this.toastMsg = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastMsg = null; }, 2600);
  }

  /** Copy for deep dive: prompt + card + every source's lines -> clipboard -> Explored. */
  async copyCard(card: Card): Promise<void> {
    const lib = this.lib;
    const st = this.st;
    if (!lib || !st) return;
    const text = await buildDeepDivePrompt(lib, card, st.copyPrompt());
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      this.manualCopy = { text, card };
      return;
    }
    st.markExplored(card);
    const n = card.refs.length;
    this.toast(`Copied: prompt + card + ${n} source${n === 1 ? "" : "s"}`);
  }

  confirmManualCopy(): void {
    const m = this.manualCopy;
    if (m) this.st?.markExplored(m.card);
    this.manualCopy = null;
  }

  setKnown(card: Card, v: boolean): void { this.st?.setKnown(card.id, v); }
  toggleTag(card: Card, tag: string): void { this.st?.toggleTag(card.id, tag); }
  setSplit(card: Card, v: boolean): void {
    this.st?.setSplit(card.id, v);
    this.toast(v ? "Marked · split on next ingest" : "Mark removed");
  }
  createTag(tag: string): string { return this.st?.createTag(tag) ?? ""; }
}

export const app = new App();

export function kindIcon(kind: string): string {
  return ({ pdf: "PDF", blog: "WEB", video: "VIDEO", markdown: "MD" } as Record<string, string>)[kind] ?? kind.toUpperCase();
}

/** "ML/Interpretability/Features" -> "Interpretability › Features" (drop the first level if asked). */
export function topicLabel(path: string, from = 0): string {
  return path.split("/").slice(from).join(" › ");
}

/** Normalise a topic typed by the user ("ML › Interp › X" or "ML/Interp/X"). null if not valid. */
export function cleanTopicPath(input: string): string | null {
  const parts = input.split(/\s*(?:›|\/|>)\s*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  return parts.join("/");
}
