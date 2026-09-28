// Production server: the built app (dist/) + the /library routes. No framework.
//   LIBRARY_DIR=/path/to/library npm start      (default port 8787, host 127.0.0.1)
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLibraryHandler } from "./handler.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(here, "../dist");
const libraryDir = resolve(process.env.LIBRARY_DIR ?? resolve(here, "../.scratch/library"));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
};

const library = createLibraryHandler(libraryDir);

const server = createServer(async (req, res) => {
  if (library(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = resolve(dist, "." + path);
  if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
  let st = await stat(file).catch(() => null);
  if (!st || st.isDirectory()) { file = join(dist, "index.html"); st = await stat(file).catch(() => null); }
  if (!st) { res.writeHead(500); res.end("Build missing. Run: npm run build"); return; }
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": String(st.size),
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Reading helper on http://${host}:${port}  ·  library: ${libraryDir}`);
});
