<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/app.svelte.ts";
  import { router } from "./lib/router.svelte.ts";
  import Feed from "./screens/Feed.svelte";
  import Books from "./screens/Books.svelte";
  import Tree from "./screens/Tree.svelte";
  import Shelf from "./screens/Shelf.svelte";
  import Outline from "./screens/Outline.svelte";
  import Search from "./screens/Search.svelte";
  import Setup from "./screens/Setup.svelte";
  import NoteSheet from "./components/NoteSheet.svelte";

  onMount(() => { void app.boot(); });

  const name = $derived(router.route.name === "tree" ? "topics" : router.route.name);
  const tab = $derived(name === "outline" ? "books" : name);
  const tabs = [
    { id: "feed", label: "Feed" },
    { id: "books", label: "Books" },
    { id: "topics", label: "Topics" },
    { id: "shelf", label: "Shelf" },
  ] as const;

  let manualArea: HTMLTextAreaElement | undefined = $state();
</script>

<div class="shell">
  {#if app.needsSetup}
    <Setup />
  {:else if !app.lib}
    <div class="empty">
      {#if app.error}
        <p>{app.error}</p>
        <button type="button" class="btn" onclick={() => app.open()}>Try again</button>
      {:else}
        <p>Opening the library…</p>
      {/if}
    </div>
  {:else}
    {#if app.updateReady}
      <div class="banner" role="status" data-testid="reload-banner"><span>New cards</span><button type="button" onclick={() => app.reload()}>Reload</button></div>
    {/if}
    {#if name === "books"}<Books />
    {:else if name === "topics" || name === "tree"}<Tree />
    {:else if name === "shelf"}<Shelf />
    {:else if name === "outline"}<Outline />
    {:else if name === "search"}<Search />
    {:else}<Feed />{/if}
    {#if name !== "search"}
      <nav class="tabs" aria-label="Main">
        {#each tabs as t (t.id)}
          <a href="#/{t.id}" class:on={tab === t.id || (t.id === "feed" && !["books", "topics", "shelf", "outline"].includes(tab))} aria-current={tab === t.id ? "page" : undefined} data-tab={t.id}>
            {#if t.id === "feed"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M7 3h10a2 2 0 0 1 2 2v13" />
                <rect x="5" y="6" width="14" height="15" rx="2" />
                <line x1="8.5" y1="11" x2="15.5" y2="11" />
                <line x1="8.5" y1="14.5" x2="15.5" y2="14.5" />
              </svg>
            {:else if t.id === "books"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
                <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0v13a9 9 0 0 0-9 0a9 9 0 0 0-9 0Z" />
                <line x1="12" y1="6" x2="12" y2="19" />
              </svg>
            {:else if t.id === "topics"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="5" r="2.5" />
                <circle cx="6" cy="18" r="2.5" />
                <circle cx="18" cy="18" r="2.5" />
                <path d="M12 7.5v3.5" />
                <path d="M6 15.5v-1a3.5 3.5 0 0 1 3.5-3.5h5a3.5 3.5 0 0 1 3.5 3.5v1" />
              </svg>
            {:else if t.id === "shelf"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 20h18" />
                <path d="M5 20V7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v13" />
                <path d="M9 20V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v13" />
                <path d="M15 6.5l3.2 13.5" />
              </svg>
            {/if}
            <span>{t.label}</span>
          </a>
        {/each}
      </nav>
    {/if}
    {#if app.noteFor}<NoteSheet cardId={app.noteFor} />{/if}
    {#if app.manualCopy !== null}
      <div class="scrim" role="presentation" onclick={() => (app.manualCopy = null)}></div>
      <div class="sheet" role="dialog" aria-label="Copy by hand">
        <h4>Copy this text</h4>
        <p class="small">The clipboard is blocked here. Select all and copy by hand.</p>
        <textarea class="inp" readonly bind:this={manualArea} value={app.manualCopy} onfocus={() => manualArea?.select()}></textarea>
        <div class="row"><button type="button" class="btn primary" onclick={() => (app.manualCopy = null)}>Done</button></div>
      </div>
    {/if}
  {/if}
  {#if app.toastMsg}<div class="toast" role="status" data-testid="toast">{app.toastMsg}</div>{/if}
</div>
