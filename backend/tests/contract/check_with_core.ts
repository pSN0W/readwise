import { resolve } from "node:path";
import { open, readFile, readdir, mkdir, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Library, buildDeepDivePrompt, coverage, type LibraryFS } from "../../../packages/core/src/index.ts";

class NodeFS implements LibraryFS {
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

async function main() {
  const libPath = process.argv[2];
  if (!libPath) {
    console.error("Usage: node check_with_core.ts <library_path>");
    process.exit(1);
  }

  const absPath = resolve(libPath);
  const lib = await Library.open(new NodeFS(absPath));

  // 1. Verify every card and ref lines
  for (const card of lib.cards.values()) {
    for (const ref of card.refs) {
      const lines = await lib.lines(ref.source, ref.start, ref.end);
      if (lines.length !== ref.end - ref.start + 1) {
        throw new Error(`Lines length mismatch for card ${card.id} ref ${ref.source}:${ref.start}-${ref.end}`);
      }
    }
    const prompt = await buildDeepDivePrompt(lib, card, "Explain this to me");
    if (!prompt.includes(card.title)) {
      throw new Error(`Deep dive prompt missing card title for ${card.id}`);
    }
  }

  // 2. Verify coverage for every source
  for (const src of lib.sourceList()) {
    const cov = coverage(lib, src.id);
    if (cov.n_lines !== src.n_lines) {
      throw new Error(`Coverage n_lines mismatch for source ${src.id}: expected ${src.n_lines}, got ${cov.n_lines}`);
    }
  }

  console.log(`OK: verified library at ${absPath} with @rh/core`);
}

main().catch((err) => {
  console.error("check_with_core failed:", err);
  process.exit(1);
});
