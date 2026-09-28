// The /library/* routes. Used by the Vite dev server (plugin) and by the production server.
// A browser cannot read a folder, so this is the only way the app touches LIBRARY_DIR.
//
//   GET  /library/<path>            a file (ETag / If-None-Match -> 304)
//   GET  /library/<dir>/?list       JSON array of file names in that folder
//   PUT  /library/state/<device>.json   this device's state file (atomic)
//   PUT  /library/notes/<card>.md       a note (atomic)
//   POST /library/inbox/            multipart upload -> inbox/<file>
//   POST /library/inbox/links       text body, URLs appended to inbox/links.txt
// Everything else that writes is refused. Paths with ".." or outside the folder are refused.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".html": "text/plain; charset=utf-8", // originals are shown as text, never run
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

/**
 * Turn the part of a URL after /library/ into an absolute path inside root.
 * Returns null for anything unsafe: "..", backslashes, NUL, absolute paths, or a result outside root.
 */
/** "bytes=3252-6656" → {start: 3252, end: 6657} (end exclusive). null = no/invalid range → send whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;       // "bytes=-" or multi-range "a-b,c-d" → ignore, send 200
  let start: number, last: number;
  if (m[1] === "") { const n = Number(m[2]); start = Math.max(0, size - n); last = size - 1; }   // "bytes=-500" = last 500
  else { start = Number(m[1]); last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > last) return "unsatisfiable";
  return { start, end: last + 1 };
}

export function safeLibraryPath(root: string, rel: string): string | null {
  let p: string;
  try { p = decodeURIComponent(rel); } catch { return null; }
  if (p.includes("\0") || p.includes("\\")) return null;
  if (p.startsWith("/")) return null;
  const parts = p.split("/");
  if (parts.some((x) => x === ".." || x === ".")) return null;
  const base = resolve(root);
  const full = resolve(base, p);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export type WriteKind = "state" | "note" | null;

/** Which library-relative paths a PUT may write. Everything else is refused. */
export function writeKind(rel: string): WriteKind {
  if (/^state\/[a-z0-9-]+\.json$/.test(rel)) return "state";
  if (/^notes\/c_[A-Za-z0-9_]+\.md$/.test(rel)) return "note";
  return null;
}

/** A file name that is safe to create in inbox/ (no folders, no hidden files, no odd characters). */
export function safeUploadName(name: string): string | null {
  const b = basename(name.replace(/\\/g, "/")).normalize("NFC");
  const clean = b.replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/^[.\s]+/, "").trim().slice(0, 180);
  if (!clean || clean === "links.txt" || clean.endsWith(".tmp")) return null;
  return clean;
}

/** Keep only http(s) URLs, one per line. */
export function parseLinks(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\/\S+$/i.test(l));
}

async function atomicWrite(full: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = full + ".tmp";
  await writeFile(tmp, data);
  await rename(tmp, full);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > limit) { fail(new HttpError(413, "Too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

/** Minimal multipart/form-data parser: returns file parts (name + bytes). */
export function parseMultipart(body: Buffer, contentType: string): { filename: string; data: Buffer }[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new HttpError(400, "No multipart boundary");
  const boundary = Buffer.from("--" + (m[1] ?? m[2]).trim());
  const out: { filename: string; data: Buffer }[] = [];
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    const headEnd = body.indexOf("\r\n\r\n", start);
    if (headEnd === -1) break;
    const head = body.slice(start, headEnd).toString("utf8");
    const next = body.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    const data = body.slice(headEnd + 4, next - 2); // strip CRLF before boundary
    const fn = /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i.exec(head);
    if (fn) out.push({ filename: decodeURIComponent(fn[1]), data });
    pos = next;
  }
  return out;
}

async function uniqueName(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const cand = i === 0 ? name : `${stem}-${i}${ext}`;
    try { await stat(join(dir, cand)); } catch { return cand; }
  }
  throw new HttpError(409, "Too many files with this name");
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

/**
 * Returns a function that handles a request if its URL starts with /library/ and returns true;
 * returns false for every other URL (so the caller can serve the app).
 */
export function createLibraryHandler(root: string): (req: IncomingMessage, res: ServerResponse) => boolean {
  const base = resolve(root);
  return (req, res) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/library/")) return false;
    const q = url.indexOf("?");
    const rel = (q === -1 ? url : url.slice(0, q)).slice("/library/".length);
    const query = q === -1 ? "" : url.slice(q + 1);
    handle(base, req, res, rel, query).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!res.headersSent) send(res, status, e instanceof Error ? e.message : "Error");
      else res.end();
    });
    return true;
  };
}

async function handle(base: string, req: IncomingMessage, res: ServerResponse, rel: string, query: string): Promise<void> {
  const method = req.method ?? "GET";
  const full = safeLibraryPath(base, rel);
  if (!full) throw new HttpError(403, "Path not allowed");
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { throw new HttpError(400, "Bad path"); }

  if (method === "GET" || method === "HEAD") {
    if (query === "list" || query.startsWith("list&")) {
      const names = await readdir(full, { withFileTypes: true }).catch(() => []);
      const files = names.filter((d) => d.isFile() && !d.name.endsWith(".tmp") && !d.name.startsWith(".syncthing."))
        .map((d) => d.name).sort();
      send(res, 200, JSON.stringify(files), "application/json; charset=utf-8");
      return;
    }
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) throw new HttpError(404, "Not found");
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers: Record<string, string> = {
      "Content-Type": TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return; }
    headers["Accept-Ranges"] = "bytes";
    const range = parseRange(req.headers.range, st.size);
    if (range === "unsatisfiable") {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${st.size}` }); res.end(); return;
    }
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end - 1}/${st.size}`;
      headers["Content-Length"] = String(range.end - range.start);
      res.writeHead(206, headers);
      if (method === "HEAD") { res.end(); return; }
      // createReadStream's `end` is INCLUSIVE
      await new Promise<void>((ok, fail) =>
        createReadStream(full, { start: range.start, end: range.end - 1 }).on("error", fail).on("end", ok).pipe(res));
      return;
    }
    headers["Content-Length"] = String(st.size);
    res.writeHead(200, headers);
    if (method === "HEAD") { res.end(); return; }
    await new Promise<void>((ok, fail) => {
      createReadStream(full).on("error", fail).on("end", ok).pipe(res);
    });
    return;
  }

  if (method === "PUT") {
    const kind = writeKind(decoded);
    if (!kind) throw new HttpError(403, "Writing this file is not allowed");
    const body = await readBody(req, MAX_TEXT_BYTES);
    if (kind === "state") {
      let parsed: { device_id?: unknown };
      try { parsed = JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "State file is not valid JSON"); }
      if (parsed.device_id !== basename(decoded, ".json")) throw new HttpError(400, "device_id does not match the file name");
    }
    await atomicWrite(full, body);
    send(res, 204, "");
    return;
  }

  if (method === "POST" && decoded === "inbox/links") {
    const body = await readBody(req, MAX_TEXT_BYTES);
    const links = parseLinks(body.toString("utf8"));
    if (!links.length) throw new HttpError(400, "No http(s) links found");
    const file = join(base, "inbox", "links.txt");
    await mkdir(dirname(file), { recursive: true });
    const prev = await readFile(file, "utf8").catch(() => "");
    const lead = prev && !prev.endsWith("\n") ? "\n" : "";
    await appendFile(file, lead + links.join("\n") + "\n");
    send(res, 200, JSON.stringify({ added: links.length }), "application/json; charset=utf-8");
    return;
  }

  if (method === "POST" && (decoded === "inbox/" || decoded === "inbox")) {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.startsWith("multipart/form-data")) throw new HttpError(415, "Send multipart/form-data");
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const parts = parseMultipart(body, ct);
    if (!parts.length) throw new HttpError(400, "No file in the upload");
    const dir = join(base, "inbox");
    await mkdir(dir, { recursive: true });
    const saved: string[] = [];
    for (const p of parts) {
      const name = safeUploadName(p.filename);
      if (!name) throw new HttpError(400, `File name not allowed: ${p.filename}`);
      const final = await uniqueName(dir, name);
      await atomicWrite(join(dir, final), p.data);
      saved.push(final);
    }
    send(res, 200, JSON.stringify({ saved }), "application/json; charset=utf-8");
    return;
  }

  throw new HttpError(405, "Not allowed");
}
