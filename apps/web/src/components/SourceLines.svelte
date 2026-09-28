<script lang="ts">
  // The source lines of one card ref, loaded from content.md (never copied into cards).
  import type { CardRef } from "@rh/core";
  import { timeOf, formatTime } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { readHref } from "../lib/router.svelte.ts";

  let { r, cardId, max = 30 }: { r: CardRef; cardId: string; max?: number } = $props();
  let lines = $state<string[] | null>(null);
  let video = $state(false);
  let times = $state<(number | null)[]>([]);

  $effect(() => {
    const lib = app.lib;
    if (!lib) return;
    let alive = true;
    Promise.all([lib.lines(r.source, r.start, r.end), lib.meta(r.source)]).then(([ls, meta]) => {
      if (!alive) return;
      lines = ls;
      video = meta.kind === "video";
      times = video ? ls.slice(0, max).map((_, i) => timeOf(meta, r.start + i)) : [];
    }).catch(() => { lines = []; });
    return () => { alive = false; };
  });
</script>

<div class="snip">
  <a class="snip-h" href={readHref(r.source, r.start, cardId)}>{app.sourceTitle(r.source)} · {app.refLabel(r)}</a>
  {#if lines === null}
    <div class="small">Loading…</div>
  {:else}
    {#each lines.slice(0, max) as l, i}
      <div class="ln-row"><span class="ln">{video && times[i] !== null ? formatTime(times[i] as number) : r.start + i}</span>{l}</div>
    {/each}
    {#if lines.length > max}<div class="small">… {lines.length - max} more lines. <a href={readHref(r.source, r.start, cardId)}>Open in reader</a></div>{/if}
  {/if}
</div>

<style>
  .snip{font-family:var(--mono);font-size:.68rem;line-height:1.6;background:var(--ground);border:1px solid var(--line);border-radius:4px;padding:6px 8px;max-height:320px;overflow:auto}
  .snip-h{font-family:var(--sans);font-size:.76rem;font-weight:700;display:block;margin-bottom:3px;color:var(--ink);text-decoration:none}
  .snip-h:hover{color:var(--accent)}
  .ln-row{white-space:pre-wrap;word-break:break-word}
  .ln{color:var(--muted);margin-right:8px;display:inline-block;min-width:34px}
</style>
