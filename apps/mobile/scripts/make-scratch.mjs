// Copy fixtures/library (read-only) to a scratch folder inside apps/mobile.
//   node scripts/make-scratch.mjs <dest> [--keep]
// --keep: do nothing if <dest>/library.json already exists (keeps your dev edits).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const fixture = resolve(app, "../../fixtures/library");
const dest = resolve(app, process.argv[2] ?? ".scratch/library");
if (!dest.startsWith(resolve(app, ".scratch") + "/")) throw new Error("scratch folder must be inside apps/mobile/.scratch/");
if (process.argv.includes("--keep") && existsSync(resolve(dest, "library.json"))) process.exit(0);
rmSync(dest, { recursive: true, force: true });
cpSync(fixture, dest, { recursive: true });
console.log(`[scratch] copied fixture -> ${dest}`);
