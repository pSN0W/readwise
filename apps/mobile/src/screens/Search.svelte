<script lang="ts">
  // Search: results as you type. Resources (name, author, URL, file name, keywords) → P8 outline.
  // Cards → P1 at that card.
  import { searchAll, searchSources, type Card, type SourceSummary } from "@rh/core";
  import { onMount, tick } from "svelte";
  import { app } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { sourceStats } from "../lib/stats.ts";

  let q = $state("");
  let input: HTMLInputElement | undefined = $state();
  let sources = $state.raw<SourceSummary[]>([]);
  let cards = $state.raw<Card[]>([]);
  /** Time of the last keystroke (keydown / beforeinput fire before bind:value updates `q`),
   *  to measure keystroke → results on screen. */
  let inputAt = 0;

  function run(query: string) {
    const lib = app.lib;
    if (!lib) return;
    const t0 = inputAt || performance.now();
    inputAt = 0;
    const c0 = performance.now();
    sources = searchSources(lib, query).map((h) => h.source);
    cards = query.trim()
      ? searchAll(lib, query, 80).flatMap((h) => (h.kind === "card" ? [h.card] : [])).slice(0, 20)
      : [];
    const t1 = performance.now();
    void tick().then(() => {
      const t2 = performance.now();
      requestAnimationFrame(() => {
        const w = window as unknown as { __rhPerf?: Record<string, number[]> };
        w.__rhPerf ??= {};
        (w.__rhPerf["search-compute"] ??= []).push(t1 - c0);
        (w.__rhPerf["search-dom"] ??= []).push(t2 - t0);
        (w.__rhPerf["search"] ??= []).push(performance.now() - t0);
      });
    });
  }

  $effect(() => { app.lib; run(q); });
  onMount(() => { input?.focus(); });

  const kindLabel = { pdf: "book", blog: "blog", video: "video", markdown: "notes" } as const;
  function back() {
    if (history.length > 1) history.back(); else router.go("feed");
  }
</script>

<div class="screen" data-testid="search">
  <div class="topbar">
    <button type="button" class="navbtn" aria-label="Close search" onclick={back}>‹</button>
    <input class="inp q" type="search" placeholder="Book, author, link, file name…" aria-label="Search" bind:this={input} bind:value={q} onkeydown={() => (inputAt = performance.now())}
      onbeforeinput={() => { if (!inputAt) inputAt = performance.now(); }}
      autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" data-testid="search-input" />
  </div>
  <div class="plist" data-testid="search-results">
    <div class="section-h">Sources · {sources.length}</div>
    {#each sources as s (s.id)}
      {@const st = sourceStats(app.lib!, s.id, (c) => app.view(c))}
      <button type="button" class="row-i" data-result-source={s.id} onclick={() => router.go("outline", [s.id])}>
        <b>{s.title}</b>
        <span class="m">{kindLabel[s.kind]}{s.authors?.length ? ` · ${s.authors.join(", ")}` : ""} · {st.total} cards · {st.pct}% read</span>
        {#if s.origin.url || s.origin.filename}<span class="m src">{s.origin.url ?? s.origin.filename}</span>{/if}
      </button>
    {:else}
      <p class="small">No source matches.</p>
    {/each}
    {#if cards.length}
      <div class="section-h">Cards · {cards.length}</div>
      {#each cards as c (c.id)}
        <button type="button" class="row-i" data-result-card={c.id} onclick={() => router.go("feed", [], { scope: "all", card: c.id })}>
          <b>{c.title}</b>{#if c.what}<span class="m">{c.what}</span>{/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .q { flex: 1; font-size: 1rem; background: var(--paper); }
  .src { font-family: var(--mono); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
