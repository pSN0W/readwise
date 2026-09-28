// Rules of the dev file adapter. Same rules as the library contract:
// the UI may write only its own files (state/, notes/, inbox/). Everything else is read-only.
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const WRITABLE_DIRS = ["state/", "notes/", "inbox/"];

/** Library-relative path with forward slashes, or null if it is not safe (.., absolute, empty parts, NUL, backslash). */
export function cleanPath(p: string): string | null {
  if (typeof p !== "string" || !p || p.includes("\0") || p.includes("\\")) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((x) => x === "" || x === "." || x === "..")) return null;
  return parts.join("/");
}

/** True if the UI may write this path. */
export function canWrite(p: string): boolean {
  const c = cleanPath(p);
  if (!c) return false;
  return WRITABLE_DIRS.some((d) => c.startsWith(d) && c.length > d.length);
}

/** Names that readers must ignore: temp files of atomic writes and Syncthing temp files. */
export function isHidden(name: string): boolean {
  return name.endsWith(".tmp") || name.startsWith(".syncthing.") || name.startsWith("~syncthing~");
}

/** Absolute path inside root, or null if the path escapes root. */
export function inside(root: string, p: string): string | null {
  const c = cleanPath(p);
  if (!c) return null;
  const abs = resolve(root, c);
  const r = resolve(root);
  return abs.startsWith(r + sep) ? abs : null;
}

export async function readLibFile(root: string, p: string): Promise<Buffer | null> {
  const abs = inside(root, p);
  if (!abs) return null;
  try { return await readFile(abs); } catch { return null; }
}

export async function listLibDir(root: string, dir: string): Promise<string[]> {
  const abs = dir === "" ? resolve(root) : inside(root, dir);
  if (!abs) return [];
  try {
    const ents = await readdir(abs, { withFileTypes: true });
    return ents.filter((e) => !isHidden(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}

export class WriteDenied extends Error {}

/** Atomic write: name.tmp, then rename. Throws WriteDenied outside state/, notes/, inbox/. */
export async function writeLibFile(root: string, p: string, text: string): Promise<void> {
  if (!canWrite(p)) throw new WriteDenied(`Read-only path: ${p}`);
  const abs = inside(root, p);
  if (!abs) throw new WriteDenied(`Bad path: ${p}`);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = abs + ".tmp";
  await writeFile(tmp, text, "utf8");
  await rename(tmp, abs);
}

