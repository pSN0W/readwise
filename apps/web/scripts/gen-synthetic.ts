// Synthetic library for performance checks (ticket 01): 50 sources, one of them 15,000 lines with
// 400 images, 5,000 cards. Follows the contract (docs/contract). Deterministic (seeded).
//   node scripts/gen-synthetic.ts [outDir]      default: .scratch/synth
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(here, "../.scratch/synth"));

const N_SOURCES = parseInt(process.env.SYNTH_N_SOURCES || "50", 10);
const N_CARDS = parseInt(process.env.SYNTH_N_CARDS || "5000", 10);
const BIG_LINES = parseInt(process.env.SYNTH_BIG_LINES || "15000", 10);
const BIG_IMAGES = parseInt(process.env.SYNTH_BIG_IMAGES || "400", 10);
const BIG_CARDS = parseInt(process.env.SYNTH_BIG_CARDS || "520", 10);

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const WORDS = ("model layer feature neuron attention probe circuit vector sparse dense weight signal token context memory habit focus " +
  "sleep routine energy method result claim test data loss gradient update step simple clear small large fast slow idea concept " +
  "example reason because when then after before inside outside across between direction space basis value key query head").split(" ");
const sentence = () => {
  const n = int(8, 20);
  const w = Array.from({ length: n }, () => pick(WORDS));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  if (rnd() < 0.08) w.splice(int(1, n - 1), 0, `$x_{${int(1, 9)}} = ${int(2, 9)}k$`);
  if (rnd() < 0.05) w.splice(int(1, n - 1), 0, "**" + pick(WORDS) + "**");
  return w.join(" ") + ".";
};
const TOPICS = [
  "ML/Interpretability/Features", "ML/Interpretability/Circuits", "ML/Interpretability/Probing", "ML/Transformers/Attention",
  "ML/Transformers/Training", "ML/Optimisation/Adam", "ML/Optimisation/Schedules", "Mind/Focus/Deep work", "Mind/Habits/Routines",
  "Mind/Sleep", "Maths/Linear algebra/Bases", "Maths/Probability", "Code/Rust/Ownership", "Code/Python/Typing",
];
const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e2ecf6"/>` +
  `<text x="160" y="96" font-size="20" text-anchor="middle" fill="#2b5c8a">${label}</text></svg>`;

async function put(path: string, text: string) {
  const full = join(OUT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
}

interface Built { id: string; kind: "pdf" | "blog" | "video"; title: string; lines: string[]; toc: { title: string; level: number; line: number }[];
  assets: { path: string; line: number; caption: string; kind: "figure" | "slide"; time_s?: number }[]; times: [number, number][] | null; duration: number | null }

function buildText(id: string, kind: Built["kind"], title: string, nLines: number, nImages: number): Built {
  const lines: string[] = [`# ${title}`, ""];
  const toc: Built["toc"] = [];
  const assets: Built["assets"] = [];
  const times: [number, number][] = [];
  const imgEvery = nImages ? Math.max(8, Math.floor(nLines / nImages)) : Infinity;
  let chapter = 0;
  let t = 0;
  let img = 0;
  while (lines.length < nLines) {
    const ln = lines.length + 1;
    if (ln % 300 === 3 || lines.length === 2) {
      chapter++;
      const h = `${chapter} · ${pick(WORDS)} and ${pick(WORDS)}`;
      lines.push(`## ${h}`); toc.push({ title: h, level: 2, line: ln }); lines.push("");
      continue;
    }
    if (kind !== "video" && ln % 60 === 0) {
      const h = `${chapter}.${Math.floor((ln % 300) / 60)} ${pick(WORDS)}`;
      lines.push(`### ${h}`); toc.push({ title: h, level: 3, line: ln });
      continue;
    }
    if (img < nImages && ln >= 5 + img * imgEvery) {
      img++;
      const name = kind === "video" ? `assets/slide-${String(t).padStart(6, "0")}.svg` : `assets/fig-${String(img).padStart(3, "0")}.svg`;
      const cap = kind === "video" ? `Slide at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : `Figure ${img}`;
      lines.push(`![${cap}](${name})`);
      assets.push({ path: name, line: ln, caption: cap, kind: kind === "video" ? "slide" : "figure", ...(kind === "video" ? { time_s: t } : {}) });
      if (kind === "video") times.push([ln, t]);
      continue;
    }
    if (kind === "video") {
      lines.push(`[${Math.floor(t / 3600) ? Math.floor(t / 3600) + ":" : ""}${Math.floor((t % 3600) / 60)}:${String(t % 60).padStart(2, "0")}] ${sentence()}`);
      times.push([ln, t]);
      t += int(4, 12);
      continue;
    }
    const r = rnd();
    if (r < 0.01) { lines.push("$$", `\\sum_{i=1}^{${int(2, 9)}} w_i x_i = y`, "$$"); continue; }
    if (r < 0.02) { lines.push("```python", `def f(x):`, `    return x * ${int(2, 9)}`, "```"); continue; }
    if (r < 0.2) { lines.push(""); continue; }
    lines.push(sentence() + " " + sentence());
  }
  lines.length = nLines;
  return { id, kind, title, lines, toc: toc.filter((x) => x.line <= nLines), assets: assets.filter((a) => a.line <= nLines), times: kind === "video" ? times.filter((x) => x[0] <= nLines) : null, duration: kind === "video" ? t : null };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  const now = "2026-09-27T03:10:00Z";
  const built: Built[] = [];
  built.push(buildText("s_big", "pdf", "The Very Long Book of Models", BIG_LINES, BIG_IMAGES));
  for (let i = 1; i < N_SOURCES; i++) {
    const kind = i % 7 === 0 ? "video" : i % 4 === 0 ? "blog" : "pdf";
    const n = kind === "pdf" ? int(900, 3200) : kind === "blog" ? int(120, 500) : int(300, 900);
    built.push(buildText(`s_src${String(i).padStart(2, "0")}`, kind, `${pick(["Notes on", "A guide to", "Talk:", "Essays on", "Field notes:"])} ${pick(WORDS)} ${pick(WORDS)} ${i}`, n, kind === "video" ? int(4, 10) : int(0, 6)));
  }

  // Cards: BIG_CARDS in the big book, the rest spread by size over the others.
  const cards: object[] = [];
  let cid = 1;
  const others = built.slice(1);
  const otherLines = others.reduce((a, b) => a + b.lines.length, 0);
  const quota = new Map<string, number>([["s_big", BIG_CARDS]]);
  let left = N_CARDS - BIG_CARDS;
  others.forEach((b, i) => {
    const q = i === others.length - 1 ? left : Math.round(((N_CARDS - BIG_CARDS) * b.lines.length) / otherLines);
    quota.set(b.id, q); left -= q;
  });
  const cardsBySource = new Map<string, { id: string; start: number; end: number }[]>();
  for (const b of built) {
    const q = quota.get(b.id)!;
    const n = b.lines.length;
    const step = n / q;
    const list: { id: string; start: number; end: number }[] = [];
    for (let k = 0; k < q; k++) {
      const start = Math.max(3, Math.floor(k * step) + 1);
      const end = Math.min(n, Math.floor((k + 1) * step) - (rnd() < 0.15 ? int(1, Math.max(1, Math.floor(step / 3))) : 0));
      const id = `c_${String(cid++).padStart(5, "0")}`;
      list.push({ id, start, end: Math.max(start, end) });
      const images = b.assets.filter((a) => a.line >= start && a.line <= end).map((a) => `sources/${b.id}/${a.path}`);
      const title = `${pick(WORDS)[0].toUpperCase()}${pick(WORDS).slice(1)} ${pick(WORDS)} ${cid}`;
      const card: Record<string, unknown> = {
        id, rev: rnd() < 0.05 ? 2 : 1, title, what: sentence(),
        topics: [pick(TOPICS)], refs: [{ source: b.id, start, end: Math.max(start, end) }], images, created_at: now, updated_at: now,
      };
      if (rnd() < 0.8) card.why = sentence();
      if (rnd() < 0.7) card.how = sentence() + " " + sentence();
      if (rnd() < 0.5) card.when = sentence();
      if (rnd() < 0.4) card.extra = sentence();
      cards.push(card);
    }
    cardsBySource.set(b.id, list);
  }
  // ~8 % merged cards: a second ref into another source
  for (const c of cards as { refs: { source: string; start: number; end: number }[] }[]) {
    if (rnd() < 0.08) {
      const other = pick(others);
      const s = int(3, Math.max(3, other.lines.length - 20));
      c.refs.push({ source: other.id, start: s, end: Math.min(other.lines.length, s + int(5, 30)) });
    }
  }

  const ANCHOR_STEP = 100;
  const enc = new TextEncoder();
  for (const b of built) {
    let byte = 0; const anchors: [number, number][] = [];
    b.lines.forEach((line, i) => {
      const lineNo = i + 1;
      if ((lineNo - 1) % ANCHOR_STEP === 0) anchors.push([lineNo, byte]);
      byte += enc.encode(line).length + 1;
    });
    const content = b.lines.join("\n") + "\n";
    const content_bytes = enc.encode(content).length;
    await put(`sources/${b.id}/content.md`, content);
    for (const a of b.assets) await put(`sources/${b.id}/${a.path}`, svg(a.caption));
    await put(`sources/${b.id}/meta.json`, JSON.stringify({
      schema_version: 1, id: b.id, kind: b.kind, title: b.title,
      original: b.kind === "pdf" ? "original.pdf" : b.kind === "blog" ? "original.html" : "original.info.json",
      content_sha256: createHash("sha256").update(content).digest("hex"), n_lines: b.lines.length,
      content_bytes, anchor_step: ANCHOR_STEP, anchors,
      toc: b.toc,
      pages: b.kind === "pdf" ? Array.from({ length: Math.ceil(b.lines.length / 40) }, (_, i) => [i * 40 + 1, i + 1]) : null,
      times: b.times, assets: b.assets,
    }));
  }
  const gen = 1;
  await put("cards.json", JSON.stringify({ schema_version: 1, generation: gen, cards, retired: [] }));
  await put("library.json", JSON.stringify({
    schema_version: 1, generation: gen, updated_at: now,
    sources: built.map((b, i) => ({
      id: b.id, kind: b.kind, title: b.title, authors: [`Author ${i}`],
      origin: b.kind === "pdf" ? { filename: `${b.id}.pdf` } : b.kind === "video" ? { url: `https://www.youtube.com/watch?v=SYNTH${i}` } : { url: `https://example.com/${b.id}` },
      added_at: new Date(Date.parse(now) - i * 3600_000).toISOString(), status: "ready", n_lines: b.lines.length,
      n_cards: cardsBySource.get(b.id)!.length, pages: b.kind === "pdf" ? Math.ceil(b.lines.length / 40) : null,
      duration_s: b.duration, keywords: b.toc.filter((t) => t.level === 2).slice(0, 5).map((t) => t.title),
    })),
    topics: TOPICS.map((path) => ({ path })),
  }));
  await put("tag_suggestions.json", JSON.stringify({ schema_version: 1, generation: gen, suggestions: Array.from({ length: 20 }, (_, i) => ({
    id: `t_${String(i + 1).padStart(4, "0")}`, path: `ML/Interpretability/${pick(WORDS)} ${i}`, card_ids: [`c_${String(int(1, N_CARDS)).padStart(5, "0")}`],
    reason: sentence(), created_at: now,
  })) }));
  await put("reports/latest.json", JSON.stringify({ schema_version: 1, run_id: "run_synth", started_at: now, finished_at: now, sources: built.map((b) => ({
    source: b.id, title: b.title, status: "ok", chunks_total: Math.ceil(b.lines.length / 400), chunks_ok: Math.ceil(b.lines.length / 400), retries: 0,
    checks: { json_valid: { ok: true }, ranges: { ok: true }, overlaps: { ok: true }, coverage: { ok: true, covered_pct: 95, limit: 20, gaps: [] } },
    cards_created: cardsBySource.get(b.id)!.length, cards_merged: 0, splits_applied: 0, errors: [],
  })) }));
  // Another device's state: ~1,000 viewed, some tags.
  const phone: Record<string, unknown> = {};
  for (let i = 0; i < 1000; i++) phone[`c_${String(int(1, N_CARDS)).padStart(5, "0")}`] = { viewed: { rev: 1, ts: 1759000000000 + i }, ...(rnd() < 0.2 ? { tags: { v: [pick(["revisit", "important"])], ts: 1759000000000 } } : {}) };
  await put("state/pixel-8.json", JSON.stringify({ schema_version: 1, device_id: "pixel-8", updated_at: 1759000000000, cards: phone }));
  for (let i = 0; i < 50; i++) await put(`notes/c_${String(int(1, N_CARDS)).padStart(5, "0")}.md`, sentence() + "\n");
  await put("inbox/links.txt", "# one URL per line\n");
  await put("topics.yaml", "ML: {}\n");

  const big = built[0];
  console.log(`synthetic library: ${OUT}`);
  console.log(`  sources ${built.length} · cards ${cards.length} · big source ${big.lines.length} lines, ${big.assets.length} images, ${quota.get("s_big")} cards`);
}

await main();
