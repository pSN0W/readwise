<script lang="ts">
  // One concept card, with every behaviour from the ticket (state chip, known, updated, tags,
  // note, copy for deep dive, split mark). Used by every view.
  //   mode "reader": cards pane of W2 · "detail": side panels · "big": W9 focus.
  import type { Card } from "@rh/core";
  import { cardFields } from "@rh/core";
  import { app, topicLabel } from "../lib/app.svelte.ts";
  import { md } from "../lib/md.ts";
  import { readHref } from "../lib/router.svelte.ts";
  import { trackViewed } from "../lib/viewed.ts";
  import TagDropdown from "./TagDropdown.svelte";
  import Note from "./Note.svelte";
  import SourceLines from "./SourceLines.svelte";

  let {
    card, mode = "detail", current = false, sourceId = "", track = true,
    tagsOpen = $bindable(false), noteEditing = $bindable(false),
    scrollReveal = false, revealed = $bindable(false),
  }: {
    card: Card; mode?: "reader" | "detail" | "big"; current?: boolean; sourceId?: string; track?: boolean;
    tagsOpen?: boolean; noteEditing?: boolean;
    scrollReveal?: boolean; revealed?: boolean;
  } = $props();

  const v = $derived(app.view(card));
  const fields = $derived(cardFields(card).filter((f) => f.key !== "what"));
  const topics = $derived(app.topicsOf(card));
  const label = { new: "New", viewed: "Viewed", explored: "Explored" } as const;
  const otherRefs = $derived(sourceId ? card.refs.filter((r) => r.source !== sourceId) : card.refs);
  let copying = $state(false);

  async function copy() {
    copying = true;
    try { await app.copyCard(card); } finally { copying = false; }
  }
</script>

<article
  class="rcard {mode}"
  class:cur={current}
  class:known={v.known}
  class:unrevealed={scrollReveal && !revealed && !v.known}
  data-id={card.id}
  use:trackViewed={track ? card.id : null}
  onwheel={(e) => { if (scrollReveal && !revealed && e.deltaY > 0) revealed = true; }}
>
  <div class="fc-top">
    <span class="path" title={topics.join(", ")}>{topics.map((t) => topicLabel(t, 1)).join(" · ")}</span>
    <span class="chips">
      {#if v.updated}<span class="st updated">Updated</span>{/if}
      <span class="st {v.status}" data-state={v.status}>{label[v.status]}</span>
      {#if v.known}<span class="st known">Known</span>{/if}
    </span>
  </div>
  {#if !v.known}<TagDropdown {card} bind:open={tagsOpen} />{/if}
  {#if mode === "big"}<h2 class="t">{card.title}</h2>{:else}<h3 class="t">{card.title}</h3>{/if}
  {#if card.what}<div class="bl md what">{@html md(card.what)}</div>{/if}

  {#if scrollReveal && !revealed && !v.known}
    <!-- Progressive reveal cue: shown initially until the user scrolls -->
    <div
      class="reveal-cue"
      role="button"
      tabindex="0"
      aria-label="Reveal additional details"
      onclick={() => (revealed = true)}
      onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); revealed = true; } }}
    >
      <div class="reveal-inner">
        <span class="reveal-arrow" aria-hidden="true">↓</span>
        <span class="reveal-label">Scroll to reveal why, how, when & sources</span>
        <span class="reveal-arrow" aria-hidden="true">↓</span>
      </div>
    </div>
  {/if}

  {#if !v.known && (!scrollReveal || revealed)}
    <div class="card-details">
      {#each fields as f (f.key)}
        <div class="sec"><span class="k">{f.label}</span><div class="md">{@html md(f.text)}</div></div>
      {/each}
      {#each card.images as im (im)}
        <img class="cimg" src={app.lib?.url(im)} alt="" loading="lazy" />
      {/each}
      {#if mode === "big"}
        <div class="sec"><span class="k">Sources</span></div>
        {#each card.refs as r (r.source + r.start)}<SourceLines {r} cardId={card.id} />{/each}
      {:else if mode === "reader"}
        {#if otherRefs.length}
          <div class="small">Also in: {#each otherRefs as r, i (r.source + r.start)}{i ? ", " : ""}<a href={readHref(r.source, r.start, card.id)}>{app.sourceTitle(r.source)} · {app.refLabel(r)}</a>{/each}</div>
        {/if}
      {:else}
        <div class="srcs">
          {#each card.refs as r (r.source + r.start)}
            <a class="src" href={readHref(r.source, r.start, card.id)}>{app.sourceTitle(r.source)} · {app.refLabel(r)}</a>
          {/each}
        </div>
      {/if}
      <Note {card} bind:editing={noteEditing} />
    </div>
  {/if}

  {#if !scrollReveal || revealed || v.known}
    <div class="acts">
      {#if !v.known}
        <button type="button" class="btn" onclick={copy} disabled={copying} data-act="copy">Copy for deep dive</button>
      {/if}
      <button type="button" class="btn" onclick={() => app.setKnown(card, !v.known)} data-act="known" aria-pressed={v.known}>{v.known ? "Unmark Known" : "I know this"}</button>
      {#if mode !== "reader"}
        <a class="btn" href={readHref(card.refs[0].source, card.refs[0].start, card.id)}>Open in reader</a>
      {/if}
      {#if mode !== "big"}
        <a class="btn" href="#/focus?card={card.id}">Focus</a>
      {/if}
    </div>
    {#if card.refs.length >= 2 && !v.known}
      <button type="button" class="flagbtn" class:on={v.split} onclick={() => app.setSplit(card, !v.split)} data-act="split" aria-pressed={v.split}>
        {v.split ? "⚑ Marked · split on next ingest" : "⚑ Mark: these are different ideas"}
      </button>
    {/if}
  {/if}
</article>

<style>
  .rcard{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:.86rem;min-width:0}
  .rcard.reader{flex:none;content-visibility:auto;contain-intrinsic-size:auto 240px}
  .rcard.cur{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .rcard.known{opacity:.7}
  .t{font-family:var(--serif);font-size:1.05rem}
  .big .t{font-size:1.9rem}
  .bl{font-weight:700;line-height:1.4}
  .big .bl{font-size:1.12rem}
  .sec{display:flex;flex-direction:column;gap:2px;line-height:1.45}
  .big .sec{font-size:1rem;line-height:1.55}
  .k{font-family:var(--mono);font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--rule-red)}
  .acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .acts .btn{font-size:.72rem;padding:2px 8px;text-decoration:none}
  .cimg{max-height:220px;object-fit:contain;border:1px solid var(--line);border-radius:4px;background:var(--paper);align-self:flex-start}
  .flagbtn{font:inherit;font-size:.7rem;background:none;border:1px dashed var(--line);border-radius:6px;color:var(--muted);padding:3px 8px;cursor:pointer;align-self:flex-start}
  .flagbtn.on{border-color:var(--rule-red);color:var(--rule-red)}
  .big{max-width:680px;width:100%;margin:0 auto;padding:28px 32px;border-radius:10px;gap:12px}
  .card-details{display:flex;flex-direction:column;gap:12px;animation:fadeIn .25s ease-out}
  .reveal-cue{margin-top:10px;padding:14px;border:1px dashed var(--line);border-radius:8px;background:color-mix(in srgb,var(--paper) 70%,var(--ground));text-align:center;cursor:pointer;transition:border-color .15s, background .15s}
  .reveal-cue:hover{border-color:var(--accent);background:var(--accent-soft)}
  .reveal-inner{display:flex;align-items:center;justify-content:center;gap:8px;font-size:.84rem;font-weight:500;color:var(--muted)}
  .reveal-cue:hover .reveal-inner{color:var(--accent)}
  .reveal-arrow{font-size:1.1rem;animation:bounce 1.5s infinite}
  @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
</style>
