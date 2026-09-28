import { cp, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLibraryHandler } from "../server/handler.ts";

export const FIXTURE = resolve(import.meta.dirname, "../../../fixtures/library");

/** A fresh copy of the fixture in the OS temp folder (never the fixture itself). */
export async function tempLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rh-web-"));
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

/** The /library handler on a random local port. */
export async function startServer(root: string): Promise<{ url: string; server: Server }> {
  const handle = createLibraryHandler(root);
  const server = createServer((req, res) => { if (!handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, server };
}
