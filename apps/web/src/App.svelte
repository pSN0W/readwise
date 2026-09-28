<script lang="ts">
  import { onMount } from "svelte";
  import { searchSources } from "@rh/core";
  import { app } from "./lib/app.svelte.ts";
  import { router } from "./lib/router.svelte.ts";
  import { prefs } from "./lib/prefs.ts";
  import Reader from "./views/Reader.svelte";
  import Search from "./views/Search.svelte";
  import Coverage from "./views/Coverage.svelte";
  import Video from "./views/Video.svelte";
  import Focus from "./views/Focus.svelte";
  import Board from "./views/Board.svelte";
  import Inbox from "./views/Inbox.svelte";
  import Report from "./views/Report.svelte";
  import Settings from "./views/Settings.svelte";
  import Palette from "./components/Palette.svelte";

  const r = $derived(router.route);
  let searchSel = $state(0);
  let searchBox: HTMLInputElement | undefined = $state();

  onMount(() => { void app.open(); });

  const tabs: [string, string][] = [
    ["focus", "Focus"], ["read", "Reader"], ["search", "Search"], ["coverage", "Coverage"], ["video", "Video"],
    ["board", "Tag board"], ["inbox", "Tag inbox"], ["report", "Ingest report"], ["settings", "Settings"],
  ];

  const readerSource = $derived.by(() => {
    const lib = app.lib;
    if (!lib) return "";
    if (r.id && lib.source(r.id)) return r.id;
    const last = prefs.lastSource();
    return last && lib.source(last) ? last : lib.sourceList()[0]?.id ?? "";
  });

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); app.paletteOpen = !app.paletteOpen; }
  }
  function onSearchInput() {
    if (r.view !== "search") router.go("search");
  }
  function onSearchKey(e: KeyboardEvent) {
    if (!app.lib) return;
    const hits = searchSources(app.lib, app.searchQuery, 200);
    if (e.key === "ArrowDown") { searchSel = Math.min(hits.length - 1, searchSel + 1); e.preventDefault(); if (r.view !== "search") router.go("search"); }
    else if (e.key === "ArrowUp") { searchSel = Math.max(0, searchSel - 1); e.preventDefault(); }
    else if (e.key === "Enter") {
      const h = hits[r.view === "search" ? searchSel : 0];
      if (h) { router.go("read/" + encodeURIComponent(h.source.id)); searchBox?.blur(); }
      e.preventDefault();
    } else if (e.key === "Escape") { searchBox?.blur(); }
  }
  $effect(() => { if (r.view === "search") searchBox?.focus(); });
</script>

<svelte:window onkeydown={onKey} />

<header class="top">
  <a class="brand" href="#/focus">Reading helper</a>
  <nav class="tabs" aria-label="Views">
    {#each tabs as [v, label] (v)}
      <a href="#/{v}" class:on={r.view === v} aria-current={r.view === v ? "page" : undefined}>{label}{#if v === "inbox" && app.openSuggestionCount()}<span class="badge">{app.openSuggestionCount()}</span>{/if}</a>
    {/each}
  </nav>
  <input class="search" type="search" placeholder="Search sources…" aria-label="Search sources" bind:this={searchBox}
    bind:value={app.searchQuery} oninput={onSearchInput} onkeydown={onSearchKey} onfocus={onSearchInput} />
  <button type="button" class="btn palbtn" onclick={() => (app.paletteOpen = true)} title="Command palette"><kbd>Ctrl</kbd>+<kbd>K</kbd></button>
</header>

{#if app.updateReady}
  <div class="banner" role="status">New cards arrived · <button type="button" class="btn primary" onclick={() => app.reload()}>Reload</button></div>
{/if}

<main class="main">
  {#if app.error && !app.lib}
    <div class="empty"><p><b>Cannot open the library.</b></p><p>{app.error}</p></div>
  {:else if !app.lib}
    <p class="empty">Loading library…</p>
  {:else if r.view === "read"}
    {#if readerSource}
      <Reader sourceId={readerSource} line={Number(r.params.get("line") ?? 0)} cardParam={r.params.get("card") ?? ""} />
    {:else}
      <p class="empty">The library has no sources yet. Add one from Search.</p>
    {/if}
  {:else if r.view === "search"}
    <Search bind:sel={searchSel} />
  {:else if r.view === "coverage"}
    <Coverage />
  {:else if r.view === "video"}
    <Video sourceId={r.id} cardId={r.params.get("card") ?? ""} />
  {:else if r.view === "focus"}
    <Focus
      scope={r.params.get("scope") ?? "all"}
      cardId={r.params.get("card") ?? ""}
      q={r.params.get("q") ?? ""}
      status={r.params.get("status") ?? "all"}
      tag={r.params.get("tag") ?? "all"}
      notes={r.params.get("notes") ?? "all"}
    />
  {:else if r.view === "board"}
    <Board focusTag={r.params.get("tag") ?? ""} />
  {:else if r.view === "inbox"}
    <Inbox />
  {:else if r.view === "report"}
    <Report />
  {:else if r.view === "settings"}
    <Settings />
  {:else}
    <p class="empty">Unknown page. <a href="#/focus">Open focus mode</a>.</p>
  {/if}
</main>

{#if app.paletteOpen && app.lib}<Palette />{/if}

{#if app.manualCopy}
  <div class="scrim">
    <div class="dialog" role="dialog" aria-label="Copy by hand">
      <b>The browser blocked the clipboard.</b>
      <p class="small">Select the text below and copy it (Ctrl+C). Then press Done.</p>
      <textarea class="inp" rows="14" readonly value={app.manualCopy.text} onfocus={(e) => (e.target as HTMLTextAreaElement).select()}></textarea>
      <div><button type="button" class="btn primary" onclick={() => app.confirmManualCopy()}>Done, I copied it</button>
        <button type="button" class="btn" onclick={() => (app.manualCopy = null)}>Cancel</button></div>
    </div>
  </div>
{/if}

{#if app.toastMsg}<div class="toast" role="status">{app.toastMsg}</div>{/if}

<style>
  .top{display:flex;align-items:center;gap:14px;padding:8px 16px;background:var(--paper);border-bottom:1px solid var(--line);flex:none}
  .brand{font-family:var(--serif);font-weight:600;font-size:1.1rem;color:var(--ink);text-decoration:none;white-space:nowrap}
  .tabs{display:flex;gap:4px;flex-wrap:wrap}
  .tabs a{font-size:.8rem;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:99px;padding:3px 11px;text-decoration:none;white-space:nowrap}
  .tabs a.on{background:var(--ink);color:var(--ground);border-color:var(--ink)}
  .badge{font-family:var(--mono);font-size:.62rem;background:var(--rule-red);color:#fff;border-radius:99px;padding:0 5px;margin-left:5px}
  .search{margin-left:auto;font:inherit;font-size:.85rem;border:1px solid var(--line);border-radius:6px;padding:5px 10px;background:var(--ground);color:var(--ink);width:260px}
  .palbtn{white-space:nowrap}
  .banner{background:var(--accent-soft);color:var(--ink);padding:6px 16px;display:flex;gap:10px;align-items:center;font-size:.86rem;border-bottom:1px solid var(--line)}
  .main{flex:1;min-height:0;display:flex;flex-direction:column}
</style>
