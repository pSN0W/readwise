<script lang="ts">
  // W6 Coverage: each source as a strip of its lines (video: its time). Blocks = cards, coloured
  // by read state; hatched = lines with no card (core coverage()); red = longer than the report's limit.
  import { coverage, timeOf, formatTime, type Card, type SourceMeta } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { readHref } from "../lib/router.svelte.ts";
  import CardView from "../components/Card.svelte";

  const lib = $derived(app.lib!);
  let picked = $state<Card | null>(null);
  let metas = $state.raw<Record<string, SourceMeta>>({});

  // Video strips need line -> time; load meta for video sources only.
  $effect(() => {
    for (const s of lib.sourceList()) {
      if (s.kind === "video" && !metas[s.id]) lib.meta(s.id).then((m) => { metas = { ...metas, [s.id]: m }; }).catch(() => {});
    }
  });

  interface Strip { id: string; title: string; kind: string; total: number; pos: (l: number) => number; fmt: (l: number) => string;
    segs: { card: Card; a: number; b: number; cls: string }[]; gaps: { a: number; b: number; long: boolean }[]; n: number; read: number; covered: number; limit: number | null }

  const strips = $derived.by((): Strip[] => {
    void app.tick;
    return lib.sourceList().map((s) => {
      const cov = coverage(lib, s.id);
      const limit = lib.report?.sources.find((r) => r.source === s.id)?.checks.coverage.limit ?? null;
      const m = metas[s.id];
      const video = s.kind === "video" && m?.times;
      const n = Math.max(1, s.n_lines);
      const dur = video ? (s.duration_s ?? timeOf(m, n) ?? 1) : n;
      const pos = video ? (l: number) => (timeOf(m, l) ?? 0) / dur : (l: number) => (l - 1) / n;
      const fmt = video ? (l: number) => formatTime(timeOf(m, l) ?? 0) : (l: number) => "L" + l;
      const segs = app.cardsInSource(s.id).map((c) => {
        const r = c.refs.find((x) => x.source === s.id)!;
        const v = app.view(c);
        return { card: c, a: r.start, b: r.end, cls: v.known ? "known" : v.status };
      });
      return {
        id: s.id, title: s.title, kind: s.kind, total: n, pos, fmt, segs, n: segs.length, read: app.readPct(s.id),
        covered: cov.covered_pct, limit,
        gaps: cov.gaps.map(([a, b]) => ({ a, b, long: limit !== null && b - a + 1 > limit })),
      };
    });
  });
  function left(st: Strip, a: number) { return (100 * st.pos(a)).toFixed(3); }
  function width(st: Strip, a: number, b: number) {
    const end = b >= st.total ? 1 : st.pos(b + 1);
    return Math.max(0.25, 100 * (end - st.pos(a))).toFixed(3);
  }
</script>

<div class="view" data-testid="coverage-view">
  <div class="toolbar">
    <div class="key-row">
      <span><i class="seg2 new"></i>new</span><span><i class="seg2 viewed"></i>viewed</span><span><i class="seg2 explored"></i>explored</span>
      <span><i class="seg2 known"></i>known</span><span><i class="gap2"></i>no card</span><span><i class="gap2 long"></i>gap above your limit</span>
    </div>
  </div>
  <div class="cols" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
    <div class="col strips" data-keep-scroll="coverage">
      {#each strips as st (st.id)}
        <div class="strip" data-sid={st.id}>
          <div class="head"><a href={readHref(st.id)}><b>{st.title}</b></a><span class="small">{st.n} cards · {st.read}% read · {st.covered}% of lines covered</span></div>
          <div class="bar2">
            {#each st.segs as z (z.card.id)}
              <button type="button" class="seg2 {z.cls}" class:sel={picked?.id === z.card.id} data-id={z.card.id}
                title="{z.card.title} · {st.fmt(z.a)}–{st.fmt(z.b)}" aria-label={z.card.title}
                style="left:{left(st, z.a)}%;width:{width(st, z.a, z.b)}%" onclick={() => (picked = z.card)}></button>
            {/each}
            {#each st.gaps as g (g.a)}
              <a class="gap2" class:long={g.long} href={readHref(st.id, g.a)} title="Lines {g.a}–{g.b}: no card ({g.b - g.a + 1} lines)"
                style="left:{left(st, g.a)}%;width:{width(st, g.a, g.b)}%" aria-label="Gap at lines {g.a} to {g.b}"></a>
            {/each}
          </div>
          <div class="axis"><span>{st.fmt(1)}</span><span>{st.fmt(Math.round(st.total / 2))}</span><span>{st.fmt(st.total)}</span></div>
        </div>
      {/each}
    </div>
    <div class="col" data-testid="coverage-detail">
      {#if picked}
        <CardView card={picked} mode="detail" />
      {:else}
        <p class="small">Click a block to open its card. Click a hatched gap to read those lines.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .strips{gap:20px;padding:20px}
  .strip{display:flex;flex-direction:column;gap:5px}
  .head{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .head a{color:inherit;text-decoration:none}
  .bar2{position:relative;height:34px;background:var(--ground);border:1px solid var(--line);border-radius:4px;overflow:hidden}
  .seg2{position:absolute;top:0;bottom:0;border:0;border-right:1px solid var(--paper);cursor:pointer;padding:0}
  .seg2:hover,.seg2.sel{filter:brightness(1.08);outline:2px solid var(--ink);z-index:1}
  .seg2.new{background:color-mix(in srgb,var(--c-new) 22%,var(--paper))}
  .seg2.viewed{background:color-mix(in srgb,var(--c-viewed) 55%,var(--paper))}
  .seg2.explored{background:color-mix(in srgb,var(--c-explored) 60%,var(--paper))}
  .seg2.known{background:color-mix(in srgb,var(--muted) 30%,var(--paper))}
  .gap2{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--muted) 55%,transparent) 0 2px,transparent 2px 6px);z-index:2}
  .gap2.long{background:repeating-linear-gradient(45deg,var(--rule-red) 0 2px,transparent 2px 6px);box-shadow:inset 0 0 0 1px var(--rule-red)}
  .axis{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.62rem;color:var(--muted)}
  .key-row{display:flex;gap:14px;flex-wrap:wrap;font-size:.74rem;color:var(--muted);align-items:center}
  .key-row i{display:inline-block;position:static;width:14px;height:10px;border-radius:2px;vertical-align:middle;margin-right:4px}
</style>
