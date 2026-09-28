// Turns a source's content.md blocks (core toBlocks) into HTML chunks for the W2 book pane.
// One chunk = ~40 blocks. prepareBook() does one cheap pass (no Markdown) to find chunk line ranges,
// height estimates, card-start markers and gaps; html(i) builds one chunk's HTML on demand, so a
// 15,000-line book opens without parsing all of it. Chunks use `content-visibility: auto`.
import { formatTime, timeOf, toBlocks, type Block, type SourceMeta } from "@rh/core";
import { chunkBlocks, type Span } from "./scroll-sync.ts";
import { escapeHtml, finish, rawMarkdown, renderMath } from "./md.ts";

export interface BookChunk { index: number; first: number; last: number; est: number }
export interface Book { chunks: BookChunk[]; html: (i: number) => string }
export interface BookInput {
  sourceId: string;
  lines: string[];
  meta: SourceMeta;
  spans: (Span & { title: string })[];
  gaps: [number, number][];
  gapLimit: number | null;
  url: (libPath: string) => string;
  videoUrlAt: (seconds: number) => string | null;
}

const attr = escapeHtml;
const endOf = (b: Block) => ("endLine" in b ? b.endLine : b.line);

function estimate(b: Block): number {
  switch (b.type) {
    case "heading": return 44;
    case "image": return 300;
    case "cue": return 26;
    case "math": return 60;
    case "code": return 24 + 18 * b.text.split("\n").length;
    default: return 12 + 26 * Math.ceil(b.text.length / 85);
  }
}

interface Plan { items: Block[]; marks: { span: Span & { title: string }; before: number }[]; gaps: { g: [number, number]; before: number }[] }

export function prepareBook(input: BookInput, chunkSize = 40): Book {
  const { sourceId, lines, meta, spans, gaps, gapLimit } = input;
  const raw = chunkBlocks(toBlocks(sourceId, lines), chunkSize);
  const plans: Plan[] = [];
  const chunks: BookChunk[] = [];
  let p = 0;
  let g = 0;
  for (const ch of raw) {
    const plan: Plan = { items: ch.items, marks: [], gaps: [] };
    let est = 0;
    ch.items.forEach((b, k) => {
      const end = endOf(b);
      while (g < gaps.length && gaps[g][0] <= end) { plan.gaps.push({ g: gaps[g++], before: k }); est += 24; }
      while (p < spans.length && spans[p].start <= end) { plan.marks.push({ span: spans[p++], before: k }); est += 22; }
      est += estimate(b);
    });
    plans.push(plan);
    chunks.push({ index: ch.index, first: ch.first, last: ch.last, est });
  }
  const cache = new Map<number, string>();

  function html(i: number): string {
    const hit = cache.get(i);
    if (hit !== undefined) return hit;
    const plan = plans[i];
    if (!plan) return "";
    const parts: string[] = [];
    const math: string[] = [];
    let dirty = false;
    const inline = (text: string): string => {
      const r = rawMarkdown(text, true);
      if (r.dirty) dirty = true;
      if (!r.math.length) return r.html;
      return r.html.replace(/qqmath(\d+)qq/g, (_m, n: string) => `qqmath${math.push(r.math[Number(n)]) - 1}qq`);
    };
    let mi = 0;
    let gi = 0;
    plan.items.forEach((b, k) => {
      for (; gi < plan.gaps.length && plan.gaps[gi].before === k; gi++) {
        const [a, z] = plan.gaps[gi].g;
        const n = z - a + 1;
        const long = gapLimit !== null && n > gapLimit;
        parts.push(`<div class="gapmk${long ? " long" : ""}" data-gap="${a}">Lines ${a}–${z}: no card (${n} line${n === 1 ? "" : "s"})</div>`);
      }
      for (; mi < plan.marks.length && plan.marks[mi].before === k; mi++) {
        const s = plan.marks[mi].span;
        parts.push(`<button type="button" class="mk" data-go="${attr(s.id)}">▸ ${attr(s.title)}</button>`);
      }
      const l = b.line;
      switch (b.type) {
        case "heading": {
          const lv = Math.min(b.level, 4);
          parts.push(`<div class="rh lv${lv}" role="heading" aria-level="${lv + 1}" data-l="${l}">${inline(b.text)}</div>`);
          break;
        }
        case "para":
          parts.push(`<div class="rp" data-l="${l}" data-e="${b.endLine}">${inline(b.text)}</div>`);
          break;
        case "math":
          parts.push(`<div class="rmath" data-l="${l}" data-e="${b.endLine}">qqmath${math.push(renderMath(b.tex, true)) - 1}qq</div>`);
          break;
        case "code":
          parts.push(`<pre class="rcode" data-l="${l}" data-e="${b.endLine}"><code>${escapeHtml(b.text)}</code></pre>`);
          break;
        case "image":
          parts.push(`<figure class="rfig" data-l="${l}"><img loading="lazy" decoding="async" src="${attr(input.url(b.path))}" alt="${attr(b.alt)}"><figcaption>${escapeHtml(b.alt)}</figcaption></figure>`);
          break;
        case "cue": {
          const t = timeOf(meta, l);
          const href = t !== null ? input.videoUrlAt(t) : null;
          const ts = t !== null ? formatTime(t) : b.time;
          const stamp = href
            ? `<a class="ts" href="${attr(href)}" target="_blank" rel="noopener noreferrer" title="Open the video at ${ts}">${ts}</a>`
            : `<span class="ts">${ts}</span>`;
          parts.push(`<div class="cue" data-l="${l}">${stamp}<span>${inline(b.text)}</span></div>`);
          break;
        }
      }
    });
    const joined = parts.join("");
    const out = dirty ? finish(joined, math) : joined.replace(/qqmath(\d+)qq/g, (_m, n: string) => math[Number(n)] ?? "");
    cache.set(i, out);
    return out;
  }
  return { chunks, html };
}
