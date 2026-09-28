<script lang="ts">
  // Everything on one card, top to bottom. Nothing is hidden behind "Read more".
  import { cardFields, readNotes, type Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { renderMd } from "../lib/md.ts";
  import Chips from "./Chips.svelte";
  import TagDropdown from "./TagDropdown.svelte";
  import SourceLines from "./SourceLines.svelte";

  let { card }: { card: Card } = $props();

  const view = $derived.by(() => { app.v; return app.view(card); });
  const fields = $derived(cardFields(card).filter((f) => f.key !== "what"));
  const topic = $derived((app.topicsOf(card)[0] ?? "").split("/").join(" › "));
  const hasConflict = $derived((app.noteConflicts[card.id] ?? []).length > 0);
  let note = $state("");
  let mergedNotes = $state<{ id: string; text: string }[]>([]);

  $effect(() => {
    const id = card.id;
    app.v;
    if (app.lib && app.fs) {
      void readNotes(app.lib, app.fs, id).then((notes) => {
        if (id !== card.id) return;
        const own = notes.find((n) => n.own);
        note = (own?.text ?? "").trim();
        mergedNotes = notes.filter((n) => !n.own && n.text.trim());
      });
    } else {
      note = "";
      mergedNotes = [];
    }
  });

  function toggleSplit() {
    app.st?.setSplit(card.id, !view.split);
    app.toast(view.split ? "Mark removed" : "Marked. The next ingest run splits this card.");
  }
</script>

<div class="card-front" data-testid="card-front">
  <div class="fc-top">
    <span class="path">{topic}</span>
    <Chips {view} />
  </div>
  <TagDropdown {card} />
  <div class="hero-body">
    <h3 data-testid="card-title">{card.title}</h3>
    {#if card.what}<div class="boldline md">{@html renderMd(card.what, true)}</div>{/if}
  </div>

  {#if fields.length > 0 || card.refs.length > 0 || card.images.length > 0}
    <div class="scroll-invite" aria-hidden="true">
      <span class="scroll-msg">Scroll down for details & sources</span>
      <span class="scroll-arr">↓</span>
    </div>
  {/if}
</div>

{#if fields.length > 0 || card.refs.length > 0 || card.images.length > 0 || note || mergedNotes.length > 0}
  <div class="card-details" data-testid="card-details">
    <div class="details-divider"><span>Details & Context</span></div>
    {#each fields as f (f.key)}
      <div class="sec"><span class="k">{f.label}</span><div class="md">{@html renderMd(f.text)}</div></div>
    {/each}
    {#each card.images as p (p)}
      <figure class="fig"><img src={app.lib?.url(p)} alt="Figure from the source" loading="lazy" /></figure>
    {/each}
    <div class="notebox" class:has={!!note || mergedNotes.length > 0} data-testid="note-preview">
      {#if note}<div class="md">✎ {@html renderMd(note, true)}</div>{:else if mergedNotes.length === 0}✎ Tap the card to add a note{/if}
      {#each mergedNotes as m (m.id)}
        <div class="merged-preview" data-testid="merged-note-preview">
          <span class="small">From merged card {m.id}:</span>
          <div class="md">{@html renderMd(m.text, true)}</div>
        </div>
      {/each}
      {#if hasConflict}<span class="flag">Note has a sync conflict copy. Tap to see it.</span>{/if}
    </div>
    <div class="sec"><span class="k">Sources</span></div>
    <SourceLines {card} />
    {#if card.refs.length >= 2}
      <button type="button" class="flagbtn" class:on={view.split} onclick={toggleSplit} data-testid="split-btn">
        {view.split ? "⚑ Marked · split on next ingest" : "⚑ Mark: these are different ideas"}
      </button>
    {/if}
  </div>
{/if}
<div class="gesturehint">drag → next · drag ← copy · tap = note</div>

<style>
  .card-front { min-height: calc(100% - 20px); display: flex; flex-direction: column; gap: 10px; flex: none; }
  .fc-top { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
  .hero-body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 14px; padding: 8px 0; }
  .hero-body h3 { font-size: 1.55rem; line-height: 1.25; }
  .hero-body .boldline { font-weight: 600; font-size: 1.1rem; line-height: 1.5; color: var(--ink); }
  .scroll-invite { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: auto; padding: 8px 0 4px; color: var(--muted); font-family: var(--mono); font-size: .72rem; letter-spacing: .02em; user-select: none; }
  .scroll-arr { font-size: .95rem; animation: bounce 1.8s infinite ease-in-out; }
  @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }
  .card-details { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
  .details-divider { display: flex; align-items: center; text-align: center; color: var(--muted); font-family: var(--mono); font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; margin: 4px 0 8px; }
  .details-divider::before, .details-divider::after { content: ""; flex: 1; border-bottom: 1px dashed var(--line); }
  .details-divider span { padding: 0 10px; }
  .sec { display: flex; flex-direction: column; gap: 2px; font-size: .95rem; line-height: 1.5; }
  .sec .k { font-family: var(--mono); font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; color: var(--rule-red); }
  .fig { margin: 0; background: var(--ground); border: 1px solid var(--line); border-radius: 6px; padding: 6px; display: grid; place-items: center; }
  .fig img { max-height: 240px; object-fit: contain; }
  .notebox { font-size: .88rem; background: color-mix(in srgb, var(--warn) 7%, transparent); border-left: 3px solid var(--warn); color: var(--muted); padding: 6px 10px; border-radius: 0 6px 6px 0; }
  .notebox.has { color: var(--ink); }
  .flag { display: block; font-size: .78rem; color: var(--rule-red); }
  .gesturehint { font-family: var(--mono); font-size: .66rem; color: var(--muted); text-align: center; margin-top: auto; padding-top: 8px; }
  .flagbtn { font-size: .8rem; background: none; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); padding: 6px 10px; align-self: flex-start; }
  .flagbtn.on { border-color: var(--rule-red); color: var(--rule-red); }
  .merged-preview { margin-top: 4px; font-size: .82rem; }
  .merged-preview .small { font-weight: 600; color: var(--muted); }
</style>
