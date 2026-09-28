// DevFS: LibraryFS over the dev server's /__lib/ endpoints (see server/devfs-plugin.ts).
import type { LibraryFS } from "@rh/core";

function enc(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export class DevFS implements LibraryFS {
  base: string;
  private fetchFn: typeof fetch;
  constructor(base = "/__lib", fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = base.replace(/\/$/, "");
    this.fetchFn = fetchFn;
  }
  async readText(path: string): Promise<string | null> {
    const r = await this.fetchFn(`${this.base}/f/${enc(path)}`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`read ${path}: HTTP ${r.status}`);
    return r.text();
  }
  async writeText(path: string, text: string): Promise<void> {
    const r = await this.fetchFn(`${this.base}/f/${enc(path)}`, {
      method: "PUT", body: text, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    if (!r.ok) throw new Error(`write ${path}: HTTP ${r.status} ${await r.text()}`);
  }
  async list(dir: string): Promise<string[]> {
    const r = await this.fetchFn(`${this.base}/ls/${enc(dir.replace(/\/$/, ""))}`, { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()) as string[];
  }
  url(path: string): string {
    return `${this.base}/f/${enc(path)}`;
  }
  async readRange(path: string, start: number, end: number): Promise<string | null> {
    if (end <= start) return "";
    const r = await this.fetchFn(`${this.base}/f/${enc(path)}`, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: "no-store" });
    if (r.status === 404) return null;
    if (r.status === 206) return new TextDecoder().decode(await r.arrayBuffer());
    if (r.status === 200) return new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()).subarray(start, end));
    throw new Error(`range ${path}: HTTP ${r.status}`);
  }
}
