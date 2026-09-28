<script lang="ts">
  // Every source of a card with its lines from content.md (loaded only when this is shown).
  import { rangeLabel, type Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";

  let { card }: { card: Card } = $props();

  // content.md is loaded only when this section comes near the screen (not at app start).
  let near = $state(false);
  let sentinel: HTMLDivElement | undefined = $state();
  $effect(() => {
    const el = sentinel;
    if (!el || near) return;
    let root: HTMLElement | null = el.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near = true; io.disconnect(); } }, { root, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });

  interface Loaded { title: string; label: string; start: number; lines: string[] }

  const loaded = $derived.by(() => {
    const lib = app.lib;
    if (!lib || !near) return new Promise<Loaded[]>(() => {});
    return Promise.all(card.refs.map(async (r): Promise<Loaded> => {
      const src = lib.source(r.source);
      try {
        const meta = await lib.meta(r.source);
        const lines = await lib.lines(r.source, r.start, r.end);
        return { title: src?.title ?? r.source, label: rangeLabel(meta, r.start, r.end), start: r.start, lines };
      } catch {
        return { title: src?.title ?? r.source, label: `lines ${r.start}–${r.end}`, start: r.start, lines: ["(text not synced yet)"] };
      }
    }));
  });
</script>

<div bind:this={sentinel} aria-hidden="true"></div>
{#await loaded}
  <p class="small">Loading source lines…</p>
{:then refs}
  {#each refs as r, i (i)}
    <div class="snip" data-testid="snip">
      <b>{r.title} · {r.label}</b>
      {#each r.lines as l, j (j)}<div><span>{r.start + j}</span>{l}</div>{/each}
    </div>
  {/each}
{/await}

<style>
  .snip { font-family: var(--mono); font-size: .72rem; line-height: 1.6; background: var(--ground); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; overflow-wrap: anywhere; }
  .snip b { font-family: var(--sans); font-size: .8rem; display: block; margin-bottom: 2px; }
  .snip span { color: var(--muted); margin-right: 8px; display: inline-block; min-width: 3ch; text-align: right; user-select: none; }
</style>
