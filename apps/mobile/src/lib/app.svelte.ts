// The one app store: the open library, the state store, feed position, toasts, reload banner.
import {
  buildDeepDivePrompt, Library, LibraryError, listNotes, readNote, StateStore, topicsWithDecisions, topicTree, writeNote,
  type Card, type CardView, type LibraryFS, type TopicNode,
} from "@rh/core";
import { feedOrder, parseScope, type FeedFilter, type ScopeKey } from "./feed.ts";
import { DevFS } from "./fs/devfs.ts";
import { CapacitorFS, DEFAULT_LIBRARY_PATH } from "./fs/capfs.ts";
import { copyText, isNative, onResume, store, storeSet } from "./platform.ts";

export const DEFAULT_DEVICE_ID = "android-phone";
const POLL_MS = 30_000;

export function mark(name: string): void {
  try { performance.mark(name); } catch { /* ignore */ }
}

class AppStore {
  lib = $state.raw<Library | null>(null);
  st = $state.raw<StateStore | null>(null);
  fs = $state.raw<LibraryFS | null>(null);
  /** Bumped on every state change, so views that read it re-render. */
  v = $state(0);
  error = $state<string | null>(null);
  needsSetup = $state(false);
  loading = $state(true);
  updateReady = $state(false);
  toastMsg = $state<string | null>(null);
  manualCopy = $state<string | null>(null);
  /** Card id whose note sheet is open. */
  noteFor = $state<string | null>(null);
  noteIds = $state.raw<Set<string>>(new Set());
  noteConflicts = $state.raw<Record<string, string[]>>({});
  /** Tree screen: kind and the path of names the user opened. */
  treeKind = $state<"topics" | "books">("topics");
  treePath = $state<string[]>([]);
  /** Feed: scope, filter (all/unread/viewed), frozen order, position. */
  scope = $state<ScopeKey>("all");
  feedFilter = $state<FeedFilter>("all");
  feed = $state.raw<string[]>([]);
  index = $state(0);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private derivedCache: { key: unknown; tree: TopicNode } | null = null;

  deviceId = $state(store("rh.deviceId") ?? DEFAULT_DEVICE_ID);
  libraryPath = $state(store("rh.libraryPath") ?? DEFAULT_LIBRARY_PATH);

  get native(): boolean {
    return isNative();
  }

  makeFS(path = this.libraryPath): LibraryFS {
    return isNative() ? new CapacitorFS(path) : new DevFS();
  }

  /** Open library + state. On the phone without a saved folder, show the setup screen first. */
  async boot(): Promise<void> {
    mark("rh-boot");
    if (isNative() && !store("rh.libraryPath")) { this.needsSetup = true; this.loading = false; return; }
    await this.open();
    const pollMs = Number(store("rh.pollMs")) || POLL_MS;
    this.pollTimer = setInterval(() => void this.checkUpdate(), pollMs);
    onResume(() => void this.checkUpdate(), () => void this.st?.flush());
    addEventListener("pagehide", () => void this.st?.flush());
  }

  async open(keepCard?: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const fs = this.makeFS();
      const lib = await Library.open(fs);
      const st = await StateStore.open(fs, this.deviceId, { resolveId: (id) => lib.resolveId(id), onChange: () => { this.v++; } });
      this.fs = fs;
      this.lib = lib;
      this.st = st;
      this.derivedCache = null;
      this.updateReady = false;
      this.needsSetup = false;
      const cur = keepCard ?? this.feed[this.index];
      this.setScope(this.scope, cur ? lib.resolveId(cur)[0] : undefined);
      this.v++;
      void this.refreshNotes();
    } catch (e) {
      this.error = e instanceof LibraryError ? e.message : `Cannot open the library: ${(e as Error).message ?? e}`;
      if (isNative()) this.needsSetup = true;
    } finally {
      this.loading = false;
    }
  }

  async checkUpdate(): Promise<void> {
    if (!this.lib || this.updateReady) return;
    try { if (await this.lib.hasUpdate()) this.updateReady = true; } catch { /* folder busy; try later */ }
    void this.st?.reloadOthers().then(() => { this.v++; }).catch(() => {});
  }

  async reload(): Promise<void> {
    await this.st?.flush();
    await this.open();
    this.toast("Library reloaded");
  }

  async refreshNotes(): Promise<void> {
    if (!this.fs) return;
    const { ids, conflicts } = await listNotes(this.fs);
    this.noteIds = new Set(ids);
    this.noteConflicts = conflicts;
  }

  /** Display state of a card. Reads `v`, so templates that call it re-render on state changes. */
  view(c: Card): CardView {
    void this.v;
    return (this.st as StateStore).view(c);
  }

  topicsOf = (c: Card): string[] => {
    const lib = this.lib as Library;
    return topicsWithDecisions(c, lib.suggestions, (this.st as StateStore).topicDecisions());
  };

  /** Topic tree with the user's topic decisions shown. Cached per library + decisions. */
  tree(): TopicNode {
    void this.v;
    const lib = this.lib as Library;
    const key = [lib, JSON.stringify((this.st as StateStore).topicDecisions())];
    const c = this.derivedCache;
    if (c && c.key instanceof Array && c.key[0] === key[0] && c.key[1] === key[1]) return c.tree;
    const tree = topicTree(lib.cards.values(), this.topicsOf);
    this.derivedCache = { key, tree };
    return tree;
  }

  scopeCards = $derived.by((): Card[] => {
    const lib = this.lib;
    if (!lib) return [];
    const s = parseScope(this.scope);
    return s.kind === "source"
      ? lib.cardsInSource(s.id)
      : s.kind === "topic"
        ? lib.cardsInTopic(s.path, this.topicsOf ? (c) => this.topicsOf(c).filter((t) => !c.topics.includes(t)) : undefined)
        : [...lib.cards.values()];
  });

  countAll = $derived(this.scopeCards.length);
  countUnread = $derived.by(() => {
    this.v;
    return this.scopeCards.filter((c) => {
      const v = this.view(c);
      return v.status === "new" && !v.known;
    }).length;
  });
  countViewed = $derived.by(() => {
    this.v;
    return this.scopeCards.filter((c) => {
      const v = this.view(c);
      return v.status !== "new" || v.known;
    }).length;
  });

  /** Change the feed scope. The order is computed once here and then kept while reading. */
  setScope(scope: ScopeKey, cardId?: string): void {
    const lib = this.lib;
    if (!lib || !this.st) return;
    this.scope = scope;
    this.feed = feedOrder(lib, scope, (c) => this.view(c), this.topicsOf, this.feedFilter);
    const i = cardId ? this.feed.indexOf(cardId) : 0;
    this.index = Math.max(0, i);
  }

  setFeedFilter(f: FeedFilter): void {
    this.feedFilter = f;
    const cur = this.current();
    if (this.lib && this.st) {
      this.feed = feedOrder(this.lib, this.scope, (c) => this.view(c), this.topicsOf, f);
      const i = cur ? this.feed.indexOf(cur.id) : 0;
      this.index = Math.max(0, i);
    }
  }

  current(): Card | null {
    const id = this.feed[this.index];
    return id ? (this.lib?.cards.get(id) ?? null) : null;
  }

  next(): void {
    if (this.feed.length) this.index = (this.index + 1) % this.feed.length;
  }

  prev(): void {
    if (this.feed.length) this.index = (this.index - 1 + this.feed.length) % this.feed.length;
  }

  /** Copy for deep dive: prompt + card + all source lines → clipboard → Explored. */
  async copyCard(card: Card): Promise<void> {
    const lib = this.lib as Library, st = this.st as StateStore;
    const text = await buildDeepDivePrompt(lib, card, st.copyPrompt());
    const ok = await copyText(text);
    if (ok) {
      st.markExplored(card);
      this.toast(`Copied: prompt + card + ${card.refs.length} source${card.refs.length === 1 ? "" : "s"}`);
    } else {
      this.manualCopy = text;
      st.markExplored(card);
    }
  }

  async readNote(id: string): Promise<string> {
    return this.fs ? readNote(this.fs, id) : "";
  }

  async saveNote(id: string, text: string): Promise<void> {
    if (!this.fs) return;
    await writeNote(this.fs, id, text.trim());
    const ids = new Set(this.noteIds);
    if (text.trim()) ids.add(id); else ids.delete(id);
    this.noteIds = ids;
    this.v++;
  }

  setDeviceId(id: string): void {
    this.deviceId = id;
    storeSet("rh.deviceId", id);
  }

  setLibraryPath(p: string): void {
    this.libraryPath = p;
    storeSet("rh.libraryPath", p);
  }

  toast(msg: string): void {
    this.toastMsg = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastMsg = null; }, 2400);
  }
}

export const app = new AppStore();
