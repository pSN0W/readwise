<script lang="ts">
  // One Markdown note per card. Click to edit; Ctrl+Enter or leaving the box saves.
  // Also shows read-only notes from retired (merged) cards via readNotes().
  import { readNotes, type Card } from "@rh/core";
  import { app, fs } from "../lib/app.svelte.ts";
  import { md } from "../lib/md.ts";

  let { card, editing = $bindable(false) }: { card: Card; editing?: boolean } = $props();
  let draft = $state("");
  let box: HTMLTextAreaElement | undefined = $state();
  const text = $derived(app.note(card.id));
  const conflicts = $derived(app.conflicts[card.id] ?? []);
  let conflictText = $state<Record<string, string>>({});
  let mergedNotes = $state<{ id: string; text: string }[]>([]);

  $effect(() => {
    if (editing) { draft = text; queueMicrotask(() => box?.focus()); }
  });
  $effect(() => {
    for (const p of conflicts) if (!(p in conflictText)) app.readConflict(p).then((t) => { conflictText = { ...conflictText, [p]: t }; });
  });
  $effect(() => {
    const lib = app.lib;
    if (lib) {
      readNotes(lib, fs, card.id).then((notes) => {
        mergedNotes = notes.filter((n) => !n.own && n.text.trim());
      });
    }
  });

  async function save() {
    if (!editing) return;
    editing = false;
    try { await app.saveNote(card.id, draft); } catch (e) { app.toast("Note not saved: " + (e as Error).message); }
  }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
    if (e.key === "Escape") { editing = false; }
  }
</script>

{#if editing}
  <textarea class="inp note-edit" bind:this={box} bind:value={draft} onblur={save} onkeydown={key}
    aria-label="Note" placeholder="Write a note (Markdown). Ctrl+Enter saves."></textarea>
{:else}
  <button type="button" class="notebtn" class:has={!!text} onclick={() => (editing = true)} aria-label={text ? "Edit note" : "Add a note"}>
    {#if text}<span class="md">{@html md(text)}</span>{:else}✎ Add a note{/if}
  </button>
{/if}
{#each mergedNotes as mn (mn.id)}
  <div class="merged-note"><b>From merged card {mn.id}</b>
    <div class="md">{@html md(mn.text)}</div>
  </div>
{/each}
{#each conflicts as p (p)}
  <div class="conflict"><b>Sync conflict copy</b> <span class="mono small">{p}</span>
    {#if conflictText[p]}<div class="md">{@html md(conflictText[p])}</div>{/if}
  </div>
{/each}

<style>
  .notebtn{font:inherit;text-align:left;font-size:.8rem;background:color-mix(in srgb,var(--warn) 7%,transparent);border:0;border-left:3px solid var(--warn);color:var(--muted);padding:5px 8px;cursor:text;border-radius:0 4px 4px 0;width:100%}
  .notebtn.has{color:var(--ink)}
  .note-edit{min-height:80px;font-size:.85rem}
  .merged-note{font-size:.78rem;border-left:3px solid var(--muted);padding:4px 8px;background:color-mix(in srgb,var(--muted) 7%,transparent);margin-top:4px}
  .conflict{font-size:.78rem;border-left:3px solid var(--rule-red);padding:4px 8px;background:color-mix(in srgb,var(--rule-red) 7%,transparent)}
</style>
