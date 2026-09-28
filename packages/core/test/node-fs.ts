// LibraryFS over a real folder, for tests (Node only; not exported by the package).
import { mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LibraryFS } from "../src/fs.ts";

export class NodeFS implements LibraryFS {
  root: string;
  constructor(root: string) { this.root = root; }
  async readText(p: string): Promise<string | null> {
    try { return await readFile(join(this.root, p), "utf8"); } catch { return null; }
  }
  async writeText(p: string, text: string): Promise<void> {
    const full = join(this.root, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full + ".tmp", text);
    await rename(full + ".tmp", full);
  }
  async list(dir: string): Promise<string[]> {
    try { return (await readdir(join(this.root, dir))).sort(); } catch { return []; }
  }
  url(p: string): string { return "file://" + join(this.root, p); }
  rangeBytes = 0;
  async readRange(p: string, start: number, end: number): Promise<string | null> {
    let fh;
    try { fh = await open(join(this.root, p), "r"); } catch { return null; }
    try {
      const buf = Buffer.alloc(Math.max(0, end - start));
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      this.rangeBytes += bytesRead;
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally { await fh.close(); }
  }
}
