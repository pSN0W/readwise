// Synthetic library for performance tests (follows docs/contract):
//   50 sources · one "big" PDF with 15,000 lines and 400 images · 5,000 cards in total.
//   node scripts/gen-synthetic.mjs <dest under .scratch/> [--keep]
// Deterministic (seeded), so numbers are comparable between runs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const WORDS = "model layer feature neuron attention circuit probe vector space signal memory habit focus routine cue reward sparse dense weight bias gradient loss token head residual stream direction basis sample batch learning training data input output value key query network idea concept method result test cause effect".split(" ");
const sentence = (n = int(8, 16)) => { const w = Array.from({ length: n }, () => pick(WORDS)); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(" ") + "."; };
const title = () => { const w = [pick(WORDS), pick(WORDS)]; return w.map((x) => x[0].toUpperCase() + x.slice(1)).join(" "); };

const NOW = "2026-09-27T03:10:00Z";

// Topic tree: 4 × 4 × 4 = 64 leaves
const ROOTS = ["ML", "Mind", "Math", "Systems"];
const MID = ["Basics", "Methods", "Theory", "Practice"];
const LEAF = ["Core", "Tools", "Cases", "Limits"];
const topics = [];
for (const r of ROOTS) for (const m of MID) for (const l of LEAF) topics.push(`${r}/${m}/${l}`);

function svg(label, hue) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${hue},40%,85%)"/><path d="M20 160 L160 30 L300 160" stroke="hsl(${hue},50%,35%)" stroke-width="6" fill="none"/><text x="160" y="110" font-size="22" text-anchor="middle" fill="#223">${label}</text></svg>\n`;
}

/** content.md + meta for one source. */
export function makeSource(dest, id, kind, nLines, nImages) {
  const write = (p, text) => { const f = resolve(dest, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  const lines = [];
  const toc = [];
  const assets = [];
  const imgEvery = nImages ? Math.floor(nLines / (nImages + 1)) : 0;
  let img = 0, ch = 0, sec = 0;
  const push = (t) => lines.push(t);
  push(`# ${id} ${kind === "video" ? "talk" : "book"}`);
  toc.push({ title: `${id} ${kind === "video" ? "talk" : "book"}`, level: 1, line: 1 });
  push("");
  let t = 0;
  while (lines.length < nLines) {
    const ln = lines.length + 1;
    if (imgEvery && img < nImages && ln >= (img + 1) * imgEvery) {
      img++;
      const p = `assets/${kind === "video" ? "slide" : "fig"}-${String(img).padStart(3, "0")}.svg`;
      push(`![Figure ${img}: ${title()}](${p})`);
      assets.push({ path: p, line: ln, caption: `Figure ${img}`, kind: kind === "video" ? "slide" : "figure", ...(kind === "video" ? { time_s: t } : {}) });
      write(`sources/${id}/${p}`, svg(`Figure ${img}`, (img * 37) % 360));
      continue;
    }
    if (ln % 300 === 3) { ch++; sec = 0; push(`## Chapter ${ch} · ${title()}`); toc.push({ title: `Chapter ${ch} · ${lines[ln - 1].split(" · ")[1]}`, level: 2, line: ln }); continue; }
    if (ln % 60 === 33 && kind !== "video") { sec++; push(`### ${ch}.${sec} ${title()}`); toc.push({ title: `${ch}.${sec} ${lines[ln - 1].split(" ").slice(1).join(" ")}`, level: 3, line: ln }); continue; }
    if (kind === "video") {
      const m = Math.floor(t / 60), s = t % 60;
      const stamp = m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
      push(`[${stamp}] ${sentence()}`);
      t += 10;
      continue;
    }
    if (ln % 97 === 0) { push("$$"); push("\\sum_{i=1}^{n} w_i x_i + b = y"); push("$$"); continue; }
    if (ln % 6 === 0) { push(""); continue; }
    push(ln % 23 === 0 ? `${sentence()} The size is $d = ${int(2, 512)}$ here.` : sentence());
  }
  lines.length = nLines;

  const ANCHOR_STEP = 100, enc = new TextEncoder();
  let byte = 0; const anchors = [];
  lines.forEach((line, i) => {
    if (i % ANCHOR_STEP === 0) anchors.push([i + 1, byte]);
    byte += enc.encode(line).length + 1;
  });
  const content = lines.join("\n") + "\n";
  write(`sources/${id}/content.md`, content);

  const pages = kind === "pdf" ? Array.from({ length: Math.ceil(nLines / 40) }, (_, i) => [i * 40 + 1, i + 1]) : null;
  let tt = 0;
  const times = kind === "video" ? lines.map((l, i) => { const m = /^\[(\d+):(\d{2})(?::(\d{2}))?\]/.exec(l); if (m) tt = m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]); return [i + 1, tt]; }) : null;
  const meta = {
    schema_version: 1, id, kind, title: "", original: kind === "pdf" ? "original.pdf" : kind === "video" ? "original.info.json" : "original.html",
    content_sha256: createHash("sha256").update(content).digest("hex"), n_lines: nLines,
    content_bytes: enc.encode(content).length,
    anchor_step: ANCHOR_STEP,
    anchors,
    toc, pages, times, assets,
  };
  return { meta, toc, assets, t };
}

export function generateSynthetic(dest, keep = false) {
  if (!dest.startsWith(resolve(app, ".scratch") + "/")) throw new Error("destination must be inside apps/mobile/.scratch/");
  if (keep && existsSync(resolve(dest, "library.json"))) { console.log(`[synth] keeping ${dest}`); return; }
  rmSync(dest, { recursive: true, force: true });

  const write = (p, text) => { const f = resolve(dest, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };

  const KINDS = ["pdf", "blog", "video", "markdown"];
  const sources = [];
  const metas = new Map();
  // big source first
  const plan = [{ id: "s_big", kind: "pdf", lines: 15000, images: 400, cards: 1000 }];
  for (let i = 1; i < 50; i++) {
    const kind = KINDS[i % 4];
    plan.push({ id: `s_src${String(i).padStart(2, "0")}`, kind, lines: kind === "pdf" ? 2400 : kind === "video" ? 900 : 350, images: kind === "video" ? 6 : kind === "pdf" ? 8 : 1, cards: 0 });
  }
  // share the other 4,000 cards by length
  const rest = plan.slice(1);
  const totalLines = rest.reduce((s, p) => s + p.lines, 0);
  let left = 4000;
  rest.forEach((p, i) => { p.cards = i === rest.length - 1 ? left : Math.max(5, Math.round((4000 * p.lines) / totalLines)); left -= p.cards; });

  for (const p of plan) {
    const { meta, toc } = makeSource(dest, p.id, p.kind, p.lines, p.images);
    const t = `${p.id === "s_big" ? "The Big Book of" : title() + " and"} ${title()}`;
    meta.title = t;
    write(`sources/${p.id}/meta.json`, JSON.stringify(meta, null, 1) + "\n");
    metas.set(p.id, meta);
    sources.push({
      id: p.id, kind: p.kind, title: t, authors: [`${pick(["A.", "B.", "C.", "D."])} ${title().split(" ")[0]}`],
      origin: p.kind === "blog" || p.kind === "video" ? { url: `https://example.com/${p.kind}/${p.id}` } : { filename: `${p.id}.${p.kind === "pdf" ? "pdf" : "md"}` },
      added_at: `2026-09-${String(1 + (sources.length % 27)).padStart(2, "0")}T03:10:00Z`, status: "ready", n_lines: p.lines, n_cards: p.cards,
      pages: p.kind === "pdf" ? Math.ceil(p.lines / 40) : null, duration_s: p.kind === "video" ? p.lines * 10 : null,
      keywords: toc.filter((x) => x.level === 2).slice(0, 5).map((x) => x.title),
    });
  }

  // cards: consecutive ranges with small gaps; 10 % get a second ref (merged)
  const cards = [];
  let n = 0;
  for (const p of plan) {
    const meta = metas.get(p.id);
    const span = Math.floor((p.lines - 4) / p.cards);
    for (let i = 0; i < p.cards; i++) {
      n++;
      const start = 3 + i * span + (i % 7 === 0 ? 2 : 0);
      const end = Math.min(p.lines, start + span - 1 - (i % 9 === 0 ? 3 : 0));
      const refs = [{ source: p.id, start, end: Math.max(start, end) }];
      if (n % 10 === 0) {
        const o = plan[(plan.indexOf(p) + 1 + (n % 7)) % plan.length];
        const s = int(3, o.lines - 30);
        refs.push({ source: o.id, start: s, end: s + int(5, 25) });
      }
      const images = meta.assets.filter((a) => a.line >= refs[0].start && a.line <= refs[0].end).map((a) => `sources/${p.id}/${a.path}`);
      const c = { id: `c_${String(n).padStart(5, "0")}`, rev: n % 13 === 0 ? 2 : 1, title: `${title()} ${n}`, what: sentence(14) };
      if (n % 3) c.why = sentence(12);
      if (n % 4) c.how = sentence(16);
      if (n % 5) c.when = sentence(8);
      if (n % 6 === 0) c.extra = `${sentence(10)} Like $k > d$ directions.`;
      Object.assign(c, { topics: [topics[n % topics.length], ...(n % 17 === 0 ? [topics[(n * 7) % topics.length]] : [])], refs, images, created_at: NOW, updated_at: NOW });
      cards.push(c);
    }
  }

  write("library.json", JSON.stringify({ schema_version: 1, generation: 1, updated_at: NOW, sources, topics: topics.map((path) => ({ path })) }, null, 1) + "\n");
  write("cards.json", JSON.stringify({ schema_version: 1, generation: 1, cards, retired: [{ id: "c_old01", into: ["c_00005"] }] }) + "\n");
  write("tag_suggestions.json", JSON.stringify({ schema_version: 1, generation: 1, suggestions: [
    { id: "t_0001", path: "ML/Methods/Dictionary", card_ids: ["c_00010", "c_00020"], reason: "Similar cards.", created_at: NOW },
  ] }, null, 1) + "\n");
  const check = { ok: true };
  write("reports/latest.json", JSON.stringify({ schema_version: 1, run_id: "r_synth", started_at: NOW, finished_at: NOW, sources: sources.map((s) => ({
    source: s.id, title: s.title, status: "ok", chunks_total: 10, chunks_ok: 10, retries: 0,
    checks: { json_valid: check, ranges: check, overlaps: check, coverage: { ok: true, covered_pct: 95, limit: 20, gaps: [] } },
    cards_created: s.n_cards, cards_merged: 0, splits_applied: 0, errors: [],
  })) }, null, 1) + "\n");
  // another device has read 1,500 cards; some known, some tagged
  const other = { schema_version: 1, device_id: "laptop-web", updated_at: 1, my_tags: { important: { ts: 1 } }, cards: {} };
  for (let i = 1; i <= 1500; i++) {
    const e = { viewed: { rev: 1, ts: 1000 + i } };
    if (i % 10 === 0) e.known = { v: true, ts: 2000 + i };
    if (i % 25 === 0) e.tags = { v: ["important"], ts: 3000 + i };
    other.cards[`c_${String(i * 3).padStart(5, "0")}`] = e;
  }
  write("state/laptop-web.json", JSON.stringify(other) + "\n");
  for (let i = 1; i <= 30; i++) write(`notes/c_${String(i * 11).padStart(5, "0")}.md`, `Note ${i}: ${sentence()}\n`);
  write("topics.yaml", ROOTS.map((r) => `${r}:\n` + MID.map((m) => `  ${m}:\n` + LEAF.map((l) => `    ${l}: {}`).join("\n")).join("\n")).join("\n") + "\n");
  write("inbox/links.txt", "");
  console.log(`[synth] ${sources.length} sources, ${cards.length} cards, big source 15000 lines / 400 images -> ${dest}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dest = resolve(app, process.argv[2] ?? ".scratch/synth");
  generateSynthetic(dest, process.argv.includes("--keep"));
}
