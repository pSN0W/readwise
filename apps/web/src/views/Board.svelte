<script lang="ts">
  // W10 Tag board: columns = my tags (+ "No tag"). Drag a card to change its FIRST tag.
  import type { Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";

  let { focusTag = "" }: { focusTag?: string } = $props();
  const lib = $derived(app.lib!);
  const NONE = "";
  const MAX = 150;
  let fresh = $state("");
  let over = $state<string | null>(null);

  const columns = $derived.by(() => {
    const tags = app.myTags();
    const cols = new Map<string, Card[]>([[NONE, []], ...tags.map((t) => [t, []] as [string, Card[]])]);
    for (const c of lib.cards.values()) {
      const first = app.view(c).tags[0] ?? NONE;
      (cols.get(first) ?? cols.get(NONE)!).push(c);
    }
    return [...cols.entries()];
  });

  function drop(e: DragEvent, tag: string) {
    e.preventDefault();
    over = null;
    const id = e.dataTransfer?.getData("text/plain");
    const c = id ? lib.cards.get(id) : undefined;
    if (!c || !app.st) return;
    const rest = app.view(c).tags.slice(1).filter((t) => t !== tag);
    app.st.setTags(c.id, tag ? [tag, ...rest] : rest);
  }
  function create(e: Event) {
    e.preventDefault();
    const t = app.createTag(fresh);
    if (t) app.toast(`Created #${t}`);
    fresh = "";
  }
</script>

<div class="view">
  <div class="toolbar">
    <span class="small">Drag a card to another column. A card can have several tags; the board shows its first one.</span>
    <form class="new" onsubmit={create}>
      <input class="inp" placeholder="new tag" aria-label="New tag" bind:value={fresh} />
      <button class="btn" type="submit" disabled={!fresh.trim()}>Create tag</button>
    </form>
  </div>
  <div class="kan" data-keep-scroll="board">
    {#each columns as [tag, cs] (tag)}
      <section class="kcol" class:over={over === tag} class:focus={!!focusTag && focusTag === tag} data-col={tag || "none"} aria-label={tag ? "#" + tag : "No tag"}
        ondragover={(e) => { e.preventDefault(); over = tag; }} ondragleave={() => { if (over === tag) over = null; }} ondrop={(e) => drop(e, tag)}>
        <h5><span>{tag ? "#" + tag : "No tag"}</span><span>{cs.length}</span></h5>
        {#each cs.slice(0, MAX) as c (c.id)}
          {@const v = app.view(c)}
          <div class="kcard" draggable="true" data-id={c.id} role="listitem"
            ondragstart={(e) => e.dataTransfer?.setData("text/plain", c.id)}>
            <b>{c.title}</b>
            {#if c.what}<span class="m">{c.what}</span>{/if}
            <span class="small">{v.tags.map((t) => "#" + t).join(" ")}</span>
          </div>
        {/each}
        {#if cs.length > MAX}<p class="small">… and {cs.length - MAX} more</p>{/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .new{display:flex;gap:6px;margin-left:auto}
  .new .inp{width:180px}
  .kan{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:12px;padding:14px;flex:1;min-height:0;overflow-x:auto}
  .kcol{background:var(--chip);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;border:2px dashed transparent;min-height:0}
  .kcol.over{border-color:var(--accent)}
  .kcol.focus{border-color:var(--warn)}
  h5{display:flex;justify-content:space-between;color:var(--warn)}
  .kcard{flex:none;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;cursor:grab;content-visibility:auto;contain-intrinsic-size:auto 90px}
  .kcard b{font-family:var(--serif);font-size:.92rem}
  .m{font-size:.76rem;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style>
