// The only thing a UI must implement: file access to the library folder.
// Paths are always library-relative with forward slashes, e.g. "sources/s_booka/content.md".

export interface LibraryFS {
  /** File text, or null if the file does not exist. */
  readText(path: string): Promise<string | null>;
  /** Write a whole file (atomically if the platform allows). Creates parent folders. */
  writeText(path: string, text: string): Promise<void>;
  /** File names (not paths) directly inside a folder. Empty list if the folder is missing. */
  list(dir: string): Promise<string[]>;
  /** A URL the UI can put in <img src> for a library file (e.g. an asset). */
  url(path: string): string;
  /**
   * Optional: bytes [start, end) of a file decoded as UTF-8, or null if the file does not exist.
   * Used with meta.json "anchors" to read a few lines without loading the whole content.md.
   * Web: HTTP Range request. Android: the RangeFile native plugin. If missing, core reads whole files.
   */
  readRange?(path: string, start: number, end: number): Promise<string | null>;
}

/** In-memory LibraryFS for tests and demos. */
export class MemoryFS implements LibraryFS {
  files: Map<string, string>;
  constructor(files: Record<string, string> = {}) {
    this.files = new Map(Object.entries(files));
  }
  async readText(path: string): Promise<string | null> {
    return this.files.has(path) ? (this.files.get(path) as string) : null;
  }
  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }
  async list(dir: string): Promise<string[]> {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const out = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (!rest.includes("/")) out.add(rest);
      }
    }
    return [...out].sort();
  }
  url(path: string): string {
    return "memory:/" + path;
  }
  /** Counts bytes served by readRange, for tests. */
  rangeBytes = 0;
  async readRange(path: string, start: number, end: number): Promise<string | null> {
    const t = this.files.get(path);
    if (t === undefined) return null;
    const bytes = new TextEncoder().encode(t).subarray(start, end);
    this.rangeBytes += bytes.length;
    return new TextDecoder().decode(bytes);
  }
}

export async function readJSON<T>(fs: LibraryFS, path: string): Promise<T | null> {
  const text = await fs.readText(path);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

/** Join a source-folder-relative path from content.md (e.g. "assets/fig-003.png") to a library path. */
export function sourcePath(sourceId: string, rel: string): string {
  return `sources/${sourceId}/${rel.replace(/^\.\//, "")}`;
}
