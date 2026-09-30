// CapacitorFS: LibraryFS over an absolute folder on the phone (the Syncthing library folder).
// Android needs "All files access" (MANAGE_EXTERNAL_STORAGE) to read /storage/emulated/0/...
// iOS reads the folder picked in the Files app (FolderPicker keeps access to it).
import { Capacitor } from "@capacitor/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import type { LibraryFS } from "@rh/core";
import { RangeFile } from "./rangefile.ts";

/** Android only. iOS has no fixed shared path: the user always picks the folder. */
export const DEFAULT_LIBRARY_PATH = "/storage/emulated/0/Syncthing/library";

function hidden(name: string): boolean {
  return name.endsWith(".tmp") || name.startsWith(".syncthing.") || name.startsWith("~syncthing~");
}

export class CapacitorFS implements LibraryFS {
  root: string;
  constructor(root: string) {
    this.root = root.replace(/\/+$/, "");
  }
  private abs(p: string): string {
    return `${this.root}/${p}`;
  }
  async readText(path: string): Promise<string | null> {
    try {
      const r = await Filesystem.readFile({ path: this.abs(path), encoding: Encoding.UTF8 });
      return typeof r.data === "string" ? r.data : await (r.data as Blob).text();
    } catch {
      return null;
    }
  }
  /** Atomic where Android allows: write name.tmp, then rename over the old file. */
  async writeText(path: string, text: string): Promise<void> {
    const target = this.abs(path);
    const tmp = target + ".tmp";
    await Filesystem.writeFile({ path: tmp, data: text, encoding: Encoding.UTF8, recursive: true });
    try {
      await Filesystem.rename({ from: tmp, to: target });
    } catch {
      // Some Android versions refuse to rename over an existing file: delete it, then rename.
      await Filesystem.deleteFile({ path: target }).catch(() => {});
      await Filesystem.rename({ from: tmp, to: target });
    }
  }
  async list(dir: string): Promise<string[]> {
    try {
      const r = await Filesystem.readdir({ path: this.abs(dir.replace(/\/$/, "")) });
      return r.files.map((f) => (typeof f === "string" ? f : f.name)).filter((n) => !hidden(n)).sort();
    } catch {
      return [];
    }
  }
  url(path: string): string {
    return Capacitor.convertFileSrc(`file://${this.abs(path)}`);
  }
  async readRange(path: string, start: number, end: number): Promise<string | null> {
    if (end <= start) return "";
    try {
      return (await RangeFile.read({ path: this.abs(path), start, end })).data;
    } catch (e) {
      if ((e as { code?: string }).code === "NOT_FOUND") return null;
      // Plugin missing (old APK) or other error: fall back to the whole file, cut by bytes.
      const all = await this.readText(path);
      if (all === null) return null;
      return new TextDecoder().decode(new TextEncoder().encode(all).subarray(start, end));
    }
  }
}
