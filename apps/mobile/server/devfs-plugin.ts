// Vite plugin: a tiny HTTP file adapter over a scratch library folder (dev and preview only).
//   GET  /__lib/f/<path>   file bytes (404 if missing)
//   GET  /__lib/ls/<dir>   JSON list of names in a folder ([] if missing)
//   PUT  /__lib/f/<path>   write text (only state/, notes/, inbox/; else 403)
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { listLibDir, readLibFile, writeLibFile, WriteDenied, cleanPath } from "./devfs-rules.ts";

const TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  yaml: "text/yaml; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", vtt: "text/vtt; charset=utf-8", html: "text/plain; charset=utf-8", pdf: "application/pdf",
};

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { fail(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

// exported for unit tests
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number, last: number;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); last = size - 1; }
  else { start = Number(m[1]); last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > last) return "unsatisfiable";
  return { start, end: last + 1 };
}

/** Connect-style handler. Exported for unit tests. */
export function devfsHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url ?? "";
    if (!url.startsWith("/__lib/")) return next();
    const raw = url.split("?")[0];
    let rest: string;
    try { rest = decodeURIComponent(raw.slice("/__lib/".length)); } catch { res.statusCode = 400; res.end("bad path"); return; }
    const send = (code: number, body: string | Buffer, type = "text/plain; charset=utf-8") => {
      res.statusCode = code;
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
    };
    try {
      if (rest.startsWith("ls/") || rest === "ls") {
        const dir = rest === "ls" ? "" : rest.slice(3).replace(/\/$/, "");
        if (dir !== "" && !cleanPath(dir)) return send(400, "bad path");
        return send(200, JSON.stringify(await listLibDir(root, dir)), TYPES.json);
      }
      if (!rest.startsWith("f/")) return send(404, "unknown");
      const p = rest.slice(2);
      if (!cleanPath(p)) return send(400, "bad path");
      if (req.method === "GET" || req.method === "HEAD") {
        const buf = await readLibFile(root, p);
        if (!buf) return send(404, "not found");
        const ext = (p.split(".").pop() ?? "").toLowerCase();
        res.setHeader("Accept-Ranges", "bytes");
        const range = parseRange(req.headers.range as string | undefined, buf.length);
        if (range === "unsatisfiable") {
          res.setHeader("Content-Range", `bytes */${buf.length}`);
          return send(416, "");
        }
        if (range) {
          res.setHeader("Content-Range", `bytes ${range.start}-${range.end - 1}/${buf.length}`);
          return send(206, buf.subarray(range.start, range.end), TYPES[ext] ?? "application/octet-stream");
        }
        return send(200, buf, TYPES[ext] ?? "application/octet-stream");
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        await writeLibFile(root, p, body);
        return send(204, "");
      }
      return send(405, "method not allowed");
    } catch (e) {
      if (e instanceof WriteDenied) return send(403, e.message);
      return send(500, String((e as Error).message ?? e));
    }
  };
}

export function devfsPlugin(root: string): Plugin {
  return {
    name: "rh-devfs",
    configureServer(server) {
      server.config.logger.info(`[devfs] library folder: ${root}`);
      server.middlewares.use(devfsHandler(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(devfsHandler(root));
    },
  };
}
