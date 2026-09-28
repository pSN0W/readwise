<script lang="ts">
  // The whole content.md of a source as one long scroll (toBlocks from @rh/core).
  // Fast for big books: blocks are grouped in chunks; a chunk's HTML is built only when it comes near
  // the screen, and `content-visibility: auto` skips layout and paint of chunks off screen.
  import { toBlocks, type Block, type Card } from "@rh/core";
  import { onDestroy } from "svelte";
  import { app, mark } from "../lib/app.svelte.ts";
  import { escapeHtml, renderMd, tex } from "../lib/md.ts";

  let { sourceId, onMarker }: { sourceId: string; onMarker: (cardId: string) => void } = $props();

  const CHUNK = 40;
  interface Chunk { blocks: Block[]; est: number; markers: Map<number, Card[]>; covered: Set<number> }

  let chunks = $state.raw<Chunk[]>([]);
  /** Built HTML per chunk; null = not built yet (a placeholder of the estimated height). */
  let htmls = $state<(string | null)[]>([]);
  let error = $state<string | null>(null);
  let box: HTMLDivElement | undefined = $state();
  let io: IntersectionObserver | null = null;

  function estimate(b: Block): number {
    switch (b.type) {
      case "heading": return 44;
      case "image": return 230;
      case "math": return 60;
      case "code": return 22 * (b.text.split("\n").length + 1);
      case "cue": return 24 * Math.max(1, Math.ceil(b.text.length / 48));
      default: return 12 + 25 * Math.max(1, Math.ceil(b.text.length / 45));
    }
  }

  function blockHtml(b: Block, covered: boolean): string {
    const cov = covered ? " cov" : "";
    switch (b.type) {
      case "heading": {
        const lv = Math.min(4, Math.max(2, b.level));
        return `<h${lv} class="bh${cov}" data-line="${b.line}">${renderMd(b.text, true)}</h${lv}>`;
      }
      case "image":
        return `<figure class="bf${cov}" data-line="${b.line}"><img loading="lazy" decoding="async" src="${escapeHtml(app.lib?.url(b.path) ?? "")}" alt="${escapeHtml(b.alt)}"><figcaption>${escapeHtml(b.alt)}</figcaption></figure>`;
      case "cue":
        return `<p class="bc${cov}" data-line="${b.line}"><span class="ts">${escapeHtml(b.time)}</span>${renderMd(b.text, true)}</p>`;
      case "math":
        return `<div class="bm${cov}" data-line="${b.line}">${tex(b.tex, true)}</div>`;
      case "code":
        return `<pre class="bpre${cov}" data-line="${b.line}"><code>${escapeHtml(b.text)}</code></pre>`;
      default:
        return `<p class="bp${cov}" data-line="${b.line}">${renderMd(b.text, true)}</p>`;
    }
  }

  function buildChunk(c: Chunk): string {
    let out = "";
    c.blocks.forEach((b, i) => {
      out += blockHtml(b, c.covered.has(i));
      const ms = c.markers.get(i);
      if (ms) for (const card of ms) out += `<button type="button" class="mk" data-mk="${card.id}">● ${escapeHtml(card.title)}</button>`;
    });
    return out;
  }

  function render(i: number) {
    const c = chunks[i];
    if (!c || htmls[i] !== null) return;
    htmls[i] = buildChunk(c);
  }

  async function load(id: string) {
    const lib = app.lib;
    if (!lib) return;
    error = null;
    try {
      const lines = await lib.allLines(id);
      const blocks = toBlocks(id, lines);
      // Card starts → the block that holds that line. Card ranges → blocks covered by some card.
      const starts = blocks.map((b) => b.line);
      const blockAt = (line: number) => {
        let lo = 0, hi = starts.length - 1, ans = 0;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= line) { ans = m; lo = m + 1; } else hi = m - 1; }
        return ans;
      };
      const markerAt = new Map<number, Card[]>();
      const cov = new Uint8Array(blocks.length);
      for (const card of lib.cardsInSource(id)) {
        const r = card.refs.find((x) => x.source === id);
        if (!r) continue;
        const a = blockAt(r.start);
        (markerAt.get(a) ?? markerAt.set(a, []).get(a) as Card[]).push(card);
        const bEnd = blockAt(r.end);
        for (let k = a; k <= bEnd; k++) cov[k] = 1;
      }
      const out: Chunk[] = [];
      for (let i = 0; i < blocks.length; i += CHUNK) {
        const bs = blocks.slice(i, i + CHUNK);
        const markers = new Map<number, Card[]>();
        const covered = new Set<number>();
        bs.forEach((_, j) => { const m = markerAt.get(i + j); if (m) markers.set(j, m); if (cov[i + j]) covered.add(j); });
        out.push({ blocks: bs, est: bs.reduce((s, b) => s + estimate(b), 0), markers, covered });
      }
      htmls = out.map(() => null);
      chunks = out;
      render(0);
      render(1);
      requestAnimationFrame(() => mark("rh-book-ready"));
    } catch (e) {
      error = `Cannot read this source: ${(e as Error).message}`;
    }
  }

  $effect(() => { void load(sourceId); });

  // Render chunks when they come within ~2 screens.
  $effect(() => {
    const n = chunks.length;
    if (!box || !n) return;
    const root = box;
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        render(Number((en.target as HTMLElement).dataset.chunk));
        obs.unobserve(en.target);
      }
    }, { root, rootMargin: "2000px 0px" });
    io = obs;
    queueMicrotask(() => root.querySelectorAll<HTMLElement>("[data-chunk]").forEach((el) => obs.observe(el)));
    return () => obs.disconnect();
  });
  onDestroy(() => io?.disconnect());

  function onClick(e: MouseEvent) {
    const b = (e.target as Element).closest<HTMLElement>("[data-mk]");
    if (b?.dataset.mk) onMarker(b.dataset.mk);
  }
</script>

{#if error}
  <p class="empty">{error}</p>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="book" bind:this={box} onclick={onClick} data-testid="book">
    {#if !chunks.length}<p class="small">Loading the text…</p>{/if}
    {#each chunks as c, i (i)}
      <div class="chunk" data-chunk={i} style={htmls[i] === null ? `height: ${c.est}px` : `contain-intrinsic-size: auto ${c.est}px`}>
        {#if htmls[i] !== null}{@html htmls[i]}{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .book { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 24px; overscroll-behavior: contain; }
  .chunk { content-visibility: auto; }
  .book :global(.bh) { font-family: var(--serif); font-weight: 600; margin: 16px 0 6px; font-size: 1.15rem; }
  .book :global(h2.bh) { font-size: 1.3rem; }
  .book :global(.bp), .book :global(.bc) { font-family: var(--serif); font-size: 1.02rem; line-height: 1.6; margin: 0 0 10px; padding-left: 8px; border-left: 3px solid transparent; }
  .book :global(.cov) { border-left-color: color-mix(in srgb, var(--accent) 25%, transparent); }
  .book :global(.bc) { margin-bottom: 4px; }
  .book :global(.ts) { font-family: var(--mono); font-size: .72rem; color: var(--accent); margin-right: 6px; }
  .book :global(.bf) { margin: 8px 0 12px; display: flex; flex-direction: column; gap: 4px; }
  .book :global(.bf img) { border: 1px solid var(--line); border-radius: 6px; background: var(--paper); max-height: 260px; object-fit: contain; min-height: 120px; }
  .book :global(.bf figcaption) { font-size: .78rem; color: var(--muted); }
  .book :global(.bm) { margin: 6px 0 10px; }
  .book :global(.bpre) { background: var(--chip); border-radius: 6px; padding: 8px; overflow-x: auto; font-size: .8rem; }
  .book :global(.mk) { font-family: var(--mono); font-size: .72rem; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 99px; padding: 2px 10px; margin: -4px 0 10px 8px; min-height: 26px; display: inline-block; }
</style>
