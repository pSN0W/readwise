<script lang="ts">
  // Note editor: one Markdown note per card (notes/<card_id>.md). Shows Syncthing conflict copies.
  import { readNotes } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { renderMd } from "../lib/md.ts";

  let { cardId }: { cardId: string } = $props();
  let text = $state("");
  let mergedNotes = $state<{ id: string; text: string }[]>([]);
  let ready = $state(false);
  let conflicts = $state<{ path: string; text: string }[]>([]);
  let area: HTMLTextAreaElement | undefined = $state();
  const card = $derived(app.lib?.cards.get(cardId));

  $effect(() => {
    const id = cardId;
    ready = false;
    if (app.lib && app.fs) {
      void readNotes(app.lib, app.fs, id).then((notes) => {
        if (id !== cardId) return;
        const own = notes.find((n) => n.own);
        text = (own?.text ?? "").replace(/\n$/, "");
        mergedNotes = notes.filter((n) => !n.own && n.text.trim());
        ready = true;
        setTimeout(() => area?.focus(), 30);
      });
    } else {
      ready = true;
    }
    const paths = app.noteConflicts[id] ?? [];
    void Promise.all(paths.map(async (p) => ({ path: p, text: (await app.fs?.readText(p)) ?? "" }))).then((c) => (conflicts = c));
  });

  async function save() {
    await app.saveNote(cardId, text);
    app.noteFor = null;
    app.toast("Note saved");
  }
  function close() {
    app.noteFor = null;
  }
</script>

<div class="scrim" role="presentation" onclick={close}></div>
<div class="sheet" role="dialog" aria-label="Note" data-testid="note-sheet">
  <h4>Note · {card?.title ?? cardId}</h4>
  <textarea class="inp" aria-label="Note text" bind:this={area} bind:value={text} disabled={!ready} placeholder="Write in Markdown…" data-testid="note-text"
    onkeydown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save(); }}></textarea>
  <span class="small">Saved to <code>notes/{cardId}.md</code></span>
  {#each mergedNotes as m (m.id)}
    <div class="merged-note" data-testid="merged-note">
      <span class="small">From merged card {m.id}</span>
      <div class="md">{@html renderMd(m.text, true)}</div>
    </div>
  {/each}
  {#each conflicts as c (c.path)}
    <div class="conflict"><b>Sync conflict copy</b> <span class="small">{c.path}</span><br />{c.text}</div>
  {/each}
  <div class="row">
    <button type="button" class="btn primary" onclick={save} disabled={!ready} data-testid="note-save">Save</button>
    <button type="button" class="btn" onclick={close}>Cancel</button>
  </div>
</div>

<style>
  .merged-note { margin-top: 8px; padding: 6px 8px; background: var(--ground); border-left: 2px solid var(--muted); border-radius: 0 4px 4px 0; font-size: .85rem; }
  .merged-note .small { color: var(--muted); font-size: .75rem; font-weight: 600; display: block; margin-bottom: 2px; }
</style>
