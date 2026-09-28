<script lang="ts">
  // P8 Book outline: the source's table of contents, each concept as one line under its heading,
  // and the gaps with no card ("what is in this book?" in 10 seconds).
  import { coverage, type Card, type SourceMeta } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { sourceCards } from "../lib/stats.ts";
  import Chips from "../components/Chips.svelte";
  import SearchButton from "../components/SearchButton.svelte";
  import FilterableSelect from "../components/FilterableSelect.svelte";

  const DEFAULT_GAP_LIMIT = 20;

  const sid = $derived(router.route.parts[0] ?? app.lib?.sourceList()[0]?.id ?? "");
  let meta = $state.raw<SourceMeta | null>(null);
  let failed = $state(false);
  $effect(() => {
    const id = sid;
    meta = null;
    failed = false;
    if (id && app.lib) void app.lib.meta(id).then((m) => { if (id === sid) meta = m; }).catch(() => { failed = true; });
  });

  type Item =
    | { kind: "h"; line: number; level: number; title: string }
    | { kind: "c"; line: number; card: Card }
    | { kind: "g"; line: number; a: number; b: number };

  const limit = $derived(app.lib?.report?.sources.find((s) => s.source === sid)?.checks.coverage.limit ?? DEFAULT_GAP_LIMIT);

  const items = $derived.by((): Item[] => {
    const lib = app.lib;
    if (!lib || !sid) return [];
    const out: Item[] = [];
    const order = { h: 0, g: 1, c: 2 } as const;
    for (const t of meta?.toc ?? []) out.push({ kind: "h", line: t.line, level: t.level, title: t.title });
    for (const c of sourceCards(lib, sid)) {
      const r = c.refs.find((x) => x.source === sid);
      if (r) out.push({ kind: "c", line: r.start, card: c });
    }
    for (const [a, b] of coverage(lib, sid).gaps) out.push({ kind: "g", line: a, a, b });
    return out.sort((x, y) => x.line - y.line || order[x.kind] - order[y.kind]);
  });
  const nCards = $derived(items.filter((i) => i.kind === "c").length);
  const minLevel = $derived(meta?.toc.length ? Math.min(...meta.toc.map((t) => t.level)) : 1);
</script>

<div class="screen" data-testid="outline">
  <div class="topbar">
    <FilterableSelect
      ariaLabel="Source"
      testId="outline-src"
      value={sid}
      options={(app.lib?.sourceList() ?? []).map((s) => ({ value: s.id, label: s.title }))}
      placeholder="Filter source…"
      onchange={(val) => router.go("outline", [val], {}, true)}
    />
    <span class="small">{nCards} concepts</span>
    <SearchButton />
  </div>
  <div class="plist outline" data-testid="outline-list">
    {#if failed}<p class="small">The text of this source is not synced yet. Showing cards only.</p>{/if}
    {#each items as it, i (i)}
      {#if it.kind === "h"}
        <div class="oh" style="--d:{it.level - minLevel}">{it.title}</div>
      {:else if it.kind === "g"}
        {@const n = it.b - it.a + 1}
        <div class="gap" class:bad={n > limit} data-testid="gap">{n > limit ? "⚠ " : ""}{n} line{n === 1 ? "" : "s"} with no card (L{it.a}–{it.b})</div>
      {:else}
        {@const v = app.view(it.card)}
        <button type="button" class="row-i line" data-open={it.card.id} onclick={() => router.go("feed", [], { scope: `src:${sid}`, card: it.card.id })}>
          <span>{it.card.title}</span><Chips view={v} />
        </button>
      {/if}
    {:else}
      <p class="empty">No cards from this source yet.</p>
    {/each}
  </div>
</div>

<style>
  .outline { gap: 4px; }
  .oh { font-family: var(--serif); font-weight: 600; font-size: 1.02rem; margin-top: 10px; padding-left: calc(var(--d, 0) * 12px); }
  .gap { font-size: .78rem; color: var(--muted); padding: 0 4px; }
  .gap.bad { color: var(--rule-red); font-weight: 700; }
</style>
