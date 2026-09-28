<script lang="ts">
  // My tags dropdown: checkbox list + "create tag". Personal only; saved in this device's state file.
  import type { Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";

  let { card, open = $bindable(false) }: { card: Card; open?: boolean } = $props();
  let tagFilter = $state("");
  let fresh = $state("");
  let el: HTMLDetailsElement | undefined = $state();
  const v = $derived(app.view(card));
  const visibleTags = $derived.by(() => {
    const q = tagFilter.trim().toLowerCase();
    const all = app.myTags();
    if (!q) return all;
    return all.filter((t) => t.toLowerCase().includes(q));
  });

  function add(e?: Event) {
    e?.preventDefault();
    const t = app.createTag(fresh);
    if (!t) return;
    if (!v.tags.includes(t)) app.toggleTag(card, t);
    fresh = "";
  }
  function outside(e: MouseEvent) {
    if (open && el && !el.contains(e.target as Node)) open = false;
  }
  $effect(() => {
    if (open) {
      const first = el?.querySelector<HTMLInputElement>("input");
      first?.focus();
    } else {
      tagFilter = "";
    }
  });
</script>

<svelte:document onclick={outside} />

<div class="tagrow">
  {#each v.tags as t (t)}<span class="ptag">#{t}</span>{/each}
  <details class="tagdd" bind:this={el} bind:open>
    <summary aria-label="My tags">＋ tag ▾</summary>
    {#if open}
      <div class="ddpanel" role="group" aria-label="My tags">
        {#if app.myTags().length > 3}
          <input
            class="inp tag-filter"
            type="text"
            placeholder="Filter tags…"
            aria-label="Filter tags"
            bind:value={tagFilter}
            onkeydown={(e) => { if (e.key === "Escape") open = false; e.stopPropagation(); }}
          />
        {/if}
        {#each visibleTags as t (t)}
          <label><input type="checkbox" checked={v.tags.includes(t)} onchange={() => app.toggleTag(card, t)} /> #{t}</label>
        {:else}
          <span class="small" style="color:var(--muted)">No tags match "{tagFilter}"</span>
        {/each}
        <form class="row" onsubmit={add}>
          <input class="inp" type="text" placeholder="new tag" aria-label="New tag" bind:value={fresh}
            onkeydown={(e) => { if (e.key === "Escape") open = false; e.stopPropagation(); }} />
          <button type="submit" class="btn">Add</button>
        </form>
        <span class="small">Stays on your devices. Never sent to a model.</span>
      </div>
    {/if}
  </details>
</div>

<style>
  .tagrow{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
  details.tagdd{position:relative}
  summary{list-style:none;cursor:pointer;font-family:var(--mono);font-size:.66rem;border:1px dashed var(--warn);color:var(--warn);border-radius:99px;padding:1px 9px;display:inline-block}
  summary::-webkit-details-marker{display:none}
  .ddpanel{position:absolute;z-index:20;top:calc(100% + 4px);left:0;width:220px;background:var(--paper);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px;display:flex;flex-direction:column;gap:4px}
  label{display:flex;gap:6px;align-items:center;font-size:.8rem;cursor:pointer}
  .row{display:flex;gap:4px}
  .ddpanel .small{font-size:.64rem}
</style>
