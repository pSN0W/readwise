// Test helpers. The fixture is read only; tests work on in-memory or scratch copies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFS } from "@rh/core";

export const APP = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const FIXTURE = resolve(APP, "../../fixtures/library");

/** All text files of the fixture in a MemoryFS (never touches the fixture on disk again). */
export function fixtureMemoryFS(): MemoryFS {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(json|md|yaml|txt|svg|vtt)$/.test(n)) files[relative(FIXTURE, p).split("\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(FIXTURE);
  return new MemoryFS(files);
}
