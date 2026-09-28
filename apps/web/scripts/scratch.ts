// Copy fixtures/library to a git-ignored scratch folder (apps/web/.scratch/<name>) so the app
// never writes into the fixture. Usage: node scripts/scratch.ts [name] [--fresh]
import { cp, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
export const FIXTURE = resolve(here, "../../../fixtures/library");

export async function scratchCopy(name = "library", fresh = false): Promise<string> {
  const dest = resolve(here, "../.scratch", name);
  const exists = await stat(dest).then(() => true, () => false);
  if (exists && !fresh) return dest;
  await rm(dest, { recursive: true, force: true });
  await cp(FIXTURE, dest, { recursive: true });
  return dest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--")) ?? "library";
  const dest = await scratchCopy(name, args.includes("--fresh"));
  console.log(`scratch library: ${dest}`);
}
