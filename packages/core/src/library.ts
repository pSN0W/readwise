import { readJSON, type LibraryFS } from "./fs.ts";
import type {
  Card, CardsFile, IngestReport, LibraryManifest, SourceMeta, SourceSummary, TagSuggestionsFile, TopicSuggestion,
} from "./types.ts";

export const SUPPORTED_SCHEMA = 1;

export class LibraryError extends Error {}

interface LoadedText { lines: string[]; meta: SourceMeta }

/**
 * Read side of the library. Holds library.json + cards.json in memory.
 * Source text (content.md) is loaded lazily per source and kept in a small LRU.
 */
export class Library {
  fs: LibraryFS;
  manifest: LibraryManifest;
  cardsFile: CardsFile;
  suggestions: TopicSuggestion[];
  report: IngestReport | null;
  /** Active cards by id. */
  cards: Map<string, Card>;
  /** Old card id -> new card ids (from cards.json "retired"). */
  retired: Map<string, string[]>;
  sources: Map<string, SourceSummary>;
  private textCache: Map<string, Promise<LoadedText>>;
  private metaCache: Map<string, Promise<SourceMeta>>;
  private blockCache: Map<string, Promise<string[]>>;
  private cacheSize: number;

  private constructor(fs: LibraryFS, manifest: LibraryManifest, cardsFile: CardsFile,
                      suggestions: TopicSuggestion[], report: IngestReport | null, cacheSize: number) {
    this.fs = fs;
    this.manifest = manifest;
    this.cardsFile = cardsFile;
    this.suggestions = suggestions;
    this.report = report;
    this.cards = new Map(cardsFile.cards.map((c) => [c.id, c]));
    this.retired = new Map(cardsFile.retired.map((r) => [r.id, r.into]));
    this.sources = new Map(manifest.sources.map((s) => [s.id, s]));
    this.textCache = new Map();
    this.metaCache = new Map();
    this.blockCache = new Map();
    this.cacheSize = cacheSize;
  }

  /**
   * Open a library. Throws LibraryError if library.json is missing, has a newer schema,
   * or cards.json is behind library.json (sync still running; retry later).
   */
  static async open(fs: LibraryFS, opts: { cacheSize?: number } = {}): Promise<Library> {
    const manifest = await readJSON<LibraryManifest>(fs, "library.json");
    if (!manifest) throw new LibraryError("library.json not found. Is this the library folder?");
    if (manifest.schema_version > SUPPORTED_SCHEMA) {
      throw new LibraryError(`library.json uses schema ${manifest.schema_version}; this app supports ${SUPPORTED_SCHEMA}. Update the app.`);
    }
    const cardsFile = await readJSON<CardsFile>(fs, "cards.json");
    if (!cardsFile) throw new LibraryError("cards.json not found.");
    if (cardsFile.generation < manifest.generation) {
      throw new LibraryError("cards.json is older than library.json. Sync is still running; try again in a moment.");
    }
    const sug = await readJSON<TagSuggestionsFile>(fs, "tag_suggestions.json");
    const report = await readJSON<IngestReport>(fs, "reports/latest.json");
    return new Library(fs, manifest, cardsFile, sug?.suggestions ?? [], report, opts.cacheSize ?? 4);
  }

  get generation(): number {
    return this.manifest.generation;
  }

  /** True if the backend wrote a newer generation since this Library was opened. */
  async hasUpdate(): Promise<boolean> {
    const m = await readJSON<LibraryManifest>(this.fs, "library.json");
    return !!m && m.generation > this.manifest.generation;
  }

  sourceList(): SourceSummary[] {
    return this.manifest.sources;
  }

  source(id: string): SourceSummary | undefined {
    return this.sources.get(id);
  }

  /** Resolve an old (retired) card id to the current card ids. */
  resolveId(id: string): string[] {
    if (this.cards.has(id)) return [id];
    const seen = new Set<string>();
    const out: string[] = [];
    const walk = (x: string) => {
      if (seen.has(x)) return;
      seen.add(x);
      if (this.cards.has(x)) out.push(x);
      else for (const y of this.retired.get(x) ?? []) walk(y);
    };
    walk(id);
    return out;
  }

  /** Cards that have a ref in this source, ordered by where they start in it. */
  cardsInSource(sourceId: string): Card[] {
    const withStart: [number, Card][] = [];
    for (const c of this.cards.values()) {
      const r = c.refs.find((x) => x.source === sourceId);
      if (r) withStart.push([r.start, c]);
    }
    withStart.sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id));
    return withStart.map((x) => x[1]);
  }

  /** Cards whose topics include this path or anything under it ("ML" matches "ML/Interpretability/Features"). */
  cardsInTopic(prefix: string, extraTopics?: (c: Card) => string[]): Card[] {
    const p = prefix.replace(/\/$/, "");
    return [...this.cards.values()].filter((c) => {
      const topics = extraTopics ? [...c.topics, ...extraTopics(c)] : c.topics;
      return topics.some((t) => t === p || t.startsWith(p + "/"));
    });
  }

  /** meta.json only (small). Cached; content.md is NOT loaded. */
  meta(sourceId: string): Promise<SourceMeta> {
    const hit = this.metaCache.get(sourceId);
    if (hit) return hit;
    const p = readJSON<SourceMeta>(this.fs, `sources/${sourceId}/meta.json`).then((m) => {
      if (!m) throw new LibraryError(`Source ${sourceId} is missing meta.json.`);
      return m;
    });
    this.metaCache.set(sourceId, p);
    p.catch(() => this.metaCache.delete(sourceId));
    lru(this.metaCache, 256);
    return p;
  }

  /** meta.json and the whole content.md as a line array (for the book view). Cached (small LRU). */
  async text(sourceId: string): Promise<LoadedText> {
    const hit = this.textCache.get(sourceId);
    if (hit) {
      this.textCache.delete(sourceId);
      this.textCache.set(sourceId, hit); // most recent at the end
      return hit;
    }
    const p = (async () => {
      const [content, meta] = await Promise.all([this.fs.readText(`sources/${sourceId}/content.md`), this.meta(sourceId)]);
      if (content === null) throw new LibraryError(`Source ${sourceId} is missing content.md.`);
      return { lines: splitLines(content), meta };
    })();
    this.textCache.set(sourceId, p);
    p.catch(() => this.textCache.delete(sourceId));
    lru(this.textCache, this.cacheSize);
    return p;
  }

  /**
   * Lines start..end (1-based, inclusive). Out-of-range parts are dropped.
   * If the whole file is already loaded, slices it. Otherwise, if the platform can read byte ranges,
   * reads only the bytes between the anchors around the range (a few KB). Else loads the whole file.
   */
  async lines(sourceId: string, start: number, end: number): Promise<string[]> {
    if (end < start) return [];
    const full = this.textCache.get(sourceId);
    if (full || !this.fs.readRange) return (await this.text(sourceId)).lines.slice(Math.max(0, start - 1), Math.max(0, end));
    const meta = await this.meta(sourceId);
    const anchors = meta.anchors;
    if (!anchors?.length) return (await this.text(sourceId)).lines.slice(Math.max(0, start - 1), Math.max(0, end));
    const a = lastAtOrBefore(anchors, Math.max(1, start));
    const nextIdx = anchors.findIndex((x) => x[0] > end);
    const bLine = nextIdx === -1 ? meta.n_lines + 1 : anchors[nextIdx][0];
    const bByte = nextIdx === -1 ? meta.content_bytes : anchors[nextIdx][1];
    const key = `${sourceId}:${a[0]}:${bLine}`;
    let block = this.blockCache.get(key);
    if (!block) {
      block = this.fs.readRange(`sources/${sourceId}/content.md`, a[1], bByte).then((t) => {
        if (t === null) throw new LibraryError(`Source ${sourceId} is missing content.md.`);
        return splitLines(t);
      });
      this.blockCache.set(key, block);
      block.catch(() => this.blockCache.delete(key));
      lru(this.blockCache, 64);
    }
    const lines = await block;
    return lines.slice(Math.max(0, start - a[0]), Math.max(0, end - a[0] + 1));
  }

  /** Every line of a source, for the book / transcript view. */
  async allLines(sourceId: string): Promise<string[]> {
    return (await this.text(sourceId)).lines;
  }

  /** URL for an image. `path` is library-relative (as in card.images). */
  url(path: string): string {
    return this.fs.url(path);
  }
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // trailing newline
  return lines;
}

function lastAtOrBefore(runs: [number, number][], line: number): [number, number] {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid][0] <= line) lo = mid;
    else hi = mid - 1;
  }
  return runs[lo];
}

function lru<K, V>(m: Map<K, V>, max: number): void {
  while (m.size > max) m.delete(m.keys().next().value as K);
}
