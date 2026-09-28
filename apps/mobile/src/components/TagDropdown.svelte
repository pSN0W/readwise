<script lang="ts">
  // My tags on a card: checkbox list + create. Personal, stored in this device's state file only.
  import type { Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";

  let { card }: { card: Card } = $props();
  let open = $state(false);
  let draft = $state("");
  let filterText = $state("");
  let root: HTMLDivElement | undefined = $state();

  const tags = $derived.by(() => { app.v; return app.st ? app.view(card).tags : []; });
  const all = $derived.by(() => { app.v; return app.st ? app.st.myTags() : []; });
  const filteredTags = $derived(
    all.filter((t) => t.toLowerCase().includes(filterText.trim().toLowerCase()))
  );

  function toggle(t: string) {
    app.st?.toggleTag(card.id, t);
  }
  function add() {
    const st = app.st;
    const t = draft.trim();
    if (!st || !t) return;
    const name = st.createTag(t);
    if (!app.view(card).tags.includes(name)) st.toggleTag(card.id, name);
    draft = "";
    app.toast(`Created #${name}`);
  }
  function onDoc(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) {
      open = false;
      filterText = "";
    }
  }
</script>

<svelte:document onpointerdown={onDoc} />

<div class="tagrow" bind:this={root} data-testid="tagrow">
  {#each tags as t (t)}<span class="ptag">#{t}</span>{/each}
  <button type="button" class="tagbtn" aria-expanded={open} data-testid="tag-dd" onclick={() => { open = !open; if (!open) filterText = ""; }}>＋ tag ▾</button>
  {#if open}
    <div class="ddpanel" role="group" aria-label="My tags" data-testid="tag-panel">
      {#if all.length > 0}
        <input
          class="inp filter-inp"
          type="search"
          placeholder="Filter tags…"
          bind:value={filterText}
          aria-label="Filter tags"
          data-testid="tag-filter-input"
        />
      {/if}
      <div class="tag-list">
        {#each filteredTags as t (t)}
          <label><input type="checkbox" checked={tags.includes(t)} onchange={() => toggle(t)} data-tag={t} /> #{t}</label>
        {:else}
          {#if filterText}
            <span class="small no-match">No tags match "{filterText}"</span>
          {/if}
        {/each}
      </div>
      <form class="row" onsubmit={(e) => { e.preventDefault(); add(); }}>
        <input class="inp" type="text" placeholder="new tag" aria-label="New tag" bind:value={draft} />
        <button type="submit" class="btn">Add</button>
      </form>
      <span class="small">Stays on this device. Never sent to a model.</span>
    </div>
  {/if}
</div>

<style>
  .tagrow { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; position: relative; }
  .tagbtn { font-family: var(--mono); font-size: .72rem; border: 1px dashed var(--warn); color: var(--warn); border-radius: 99px; padding: 2px 10px; background: none; min-height: 28px; }
  .ddpanel { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; width: min(260px, 80vw); background: var(--paper); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, .18); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .filter-inp { font-size: 0.8rem; padding: 4px 8px; border-radius: 6px; }
  .tag-list { max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .no-match { color: var(--muted); padding: 4px 0; }
  label { display: flex; gap: 8px; align-items: center; font-size: .9rem; min-height: 32px; }
  input[type="checkbox"] { width: 18px; height: 18px; }
  .row { display: flex; gap: 6px; }
</style>
