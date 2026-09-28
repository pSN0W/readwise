// LibraryFS over the local server's /library routes (see server/handler.ts).
import type { LibraryFS } from "@rh/core";

function enc(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class HttpFS implements LibraryFS {
  base: string;
  private f: typeof fetch;
  constructor(base = "/library/", fetchFn?: typeof fetch) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.f = fetchFn ?? ((...a) => fetch(...a));
  }
  /** File text or null (404). "no-cache" revalidates with the ETag, so polling library.json costs a 304. */
  async readText(path: string): Promise<string | null> {
    const r = await this.f(this.base + enc(path), { cache: "no-cache" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Read failed (${r.status}): ${path}`);
    return r.text();
  }
  async writeText(path: string, text: string): Promise<void> {
    const r = await this.f(this.base + enc(path), {
      method: "PUT", body: text, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    if (!r.ok) throw new Error(`Write failed (${r.status}): ${path}`);
  }
  async list(dir: string): Promise<string[]> {
    const d = dir.replace(/\/+$/, "");
    const r = await this.f(this.base + enc(d) + "/?list", { cache: "no-store" });
    if (!r.ok) return [];
    const names = (await r.json()) as unknown;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
  }
  url(path: string): string {
    return this.base + enc(path);
  }
  /** Upload files into inbox/. */
  async upload(files: File[]): Promise<string[]> {
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name);
    const r = await this.f(this.base + "inbox/", { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    return ((await r.json()) as { saved: string[] }).saved;
  }
  /** Append URLs to inbox/links.txt. */
  async addLinks(text: string): Promise<number> {
    const r = await this.f(this.base + "inbox/links", { method: "POST", body: text });
    if (!r.ok) throw new Error(await r.text());
    return ((await r.json()) as { added: number }).added;
  }
  /** Bytes [start, end) of a file as UTF-8 text, via an HTTP Range request. null if the file is missing. */
  async readRange(path: string, start: number, end: number): Promise<string | null> {
    if (end <= start) return "";
    const r = await this.f(this.base + enc(path), {
      headers: { Range: `bytes=${start}-${end - 1}` },
      cache: "no-store",                     // never mix a cached 200 body with a range
    });
    if (r.status === 404) return null;
    if (r.status === 206) return new TextDecoder().decode(await r.arrayBuffer());
    if (r.status === 200) {                  // server ignored the range: cut it ourselves
      const all = new Uint8Array(await r.arrayBuffer());
      return new TextDecoder().decode(all.subarray(start, end));
    }
    throw new Error(`Range read failed (${r.status}): ${path}`);
  }
}
