<script lang="ts">
  // P2 Books: all sources; open one → Book (whole text) / Cards (its cards in source order).
  import { rangeLabel, type SourceMeta } from "@rh/core";
  import { tick } from "svelte";
  import { app, mark } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { sourceCards, sourceStats } from "../lib/stats.ts";
  import BookText from "../components/BookText.svelte";
  import SearchButton from "../components/SearchButton.svelte";

  const sid = $derived(router.route.parts[0] ?? null);
  const mode = $derived(router.route.query.mode === "cards" ? "cards" : "book");
  const hl = $derived(router.route.query.card ?? null);
  const src = $derived(sid ? app.lib?.source(sid) : undefined);

  const rows = $derived.by(() => {
    app.v;
    const lib = app.lib;
    if (!lib) return [];
    return lib.sourceList().map((s) => ({ s, ...sourceStats(lib, s.id, (c) => app.view(c)) }));
  });

  let bookFilter = $state("");
  const filteredRows = $derived.by(() => {
    const q = bookFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.s.title.toLowerCase().includes(q) ||
        r.s.authors?.some((a) => a.toLowerCase().includes(q)) ||
        r.s.kind.toLowerCase().includes(q)
    );
  });

  const cards = $derived.by(() => (sid && app.lib ? sourceCards(app.lib, sid) : []));
  let meta = $state.raw<SourceMeta | null>(null);
  $effect(() => {
    const id = sid;
    meta = null;
    if (id && mode === "cards" && app.lib) void app.lib.meta(id).then((m) => { if (id === sid) meta = m; }).catch(() => {});
  });

  function openSource(id: string) {
    mark("rh-book-open");
    router.go("books", [id], { mode: "book" });
  }
  async function toCard(cardId: string) {
    router.go("books", [sid as string], { mode: "cards", card: cardId });
    await tick();
    await tick();
    document.querySelector(`[data-open="${cardId}"]`)?.scrollIntoView({ block: "center" });
  }
  $effect(() => {
    if (mode === "cards" && hl && cards.length) {
      void tick().then(() => document.querySelector(`[data-open="${hl}"]`)?.scrollIntoView({ block: "center" }));
    }
  });
  function label(id: string, start: number, end: number): string {
    return meta ? rangeLabel(meta, start, end) : `lines ${start}–${end}`;
  }
  const kindLabel = { pdf: "book", blog: "blog", video: "video", markdown: "notes" } as const;
</script>

<div class="screen" data-testid="books">
  {#if !sid}
    <div class="topbar"><span class="title">Books</span><span class="small">{filteredRows.length} of {rows.length} sources</span><SearchButton /></div>
    <div class="filter-wrap">
      <input
        type="search"
        class="inp filter-input"
        placeholder="Type to filter books…"
        bind:value={bookFilter}
        aria-label="Filter books"
        data-testid="books-filter-input"
      />
    </div>
    <div class="plist">
      {#each filteredRows as r (r.s.id)}
        <button type="button" class="row-i" data-source={r.s.id} onclick={() => openSource(r.s.id)}>
          <b>{r.s.title}</b>
          <span class="m">{kindLabel[r.s.kind]}{r.s.authors?.length ? ` · ${r.s.authors.join(", ")}` : ""}</span>
          <span class="m">{r.total} cards · {r.pct}% read{r.s.status !== "ready" ? ` · ${r.s.status}` : ""}</span>
          <div class="meter"><i style="width:{r.pct}%"></i></div>
        </button>
      {:else}
        {#if bookFilter}
          <p class="small">No sources match "{bookFilter}".</p>
        {/if}
      {/each}
      <span class="small">New sources appear here after the GPU machine ingests them.</span>
    </div>
  {:else}
    <div class="topbar">
      <button type="button" class="navbtn" onclick={() => router.go("books")} data-testid="books-back">‹ Books</button>
      <span class="title">{src?.title ?? sid}</span>
      <div class="seg" role="group" aria-label="Book or cards">
        <button type="button" aria-pressed={mode === "book"} data-testid="mode-book" onclick={() => router.go("books", [sid], { mode: "book" }, true)}>Book</button>
        <button type="button" aria-pressed={mode === "cards"} data-testid="mode-cards" onclick={() => router.go("books", [sid], { mode: "cards" }, true)}>Cards</button>
      </div>
    </div>
    {#if mode === "book"}
      <BookText sourceId={sid} onMarker={toCard} />
    {:else}
      <div class="plist" data-testid="source-cards">
        {#each cards as c (c.id)}
          {@const v = app.view(c)}
          {@const r = c.refs.find((x) => x.source === sid)}
          <button type="button" class="row-i cv" class:hl={hl === c.id} data-open={c.id} onclick={() => router.go("feed", [], { scope: `src:${sid}`, card: c.id })}>
            <b>{c.title}</b>
            {#if c.what}<span>{c.what}</span>{/if}
            <span class="m">{r ? label(sid, r.start, r.end) : ""}{#if c.refs.length > 1} · also in {c.refs.filter((x) => x.source !== sid).map((x) => app.lib?.source(x.source)?.title ?? x.source).join(", ")}{/if}</span>
            {#if v.status !== "new"}<span class="m">{v.status === "explored" ? "Deeply explored" : "Read before"}{v.updated ? " · Updated" : ""}</span>{/if}
          </button>
        {:else}
          <p class="empty">No cards from this source yet.</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .cv { content-visibility: auto; contain-intrinsic-size: auto 90px; }
  .topbar .title { font-size: 1rem; }
  .filter-wrap { padding: 4px 12px 8px; background: var(--ground); }
  .filter-input { width: 100%; font-size: .85rem; padding: 6px 10px; border-radius: 8px; }
</style>
