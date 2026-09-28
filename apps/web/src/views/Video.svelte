<script lang="ts">
  // W7 Video timeline: slide images on a time axis, cards as spans, transcript below.
  // Click a span -> its transcript lines light up and the card shows on the right.
  import { tick } from "svelte";
  import { formatTime, timeOf, toBlocks, type Card, type SourceMeta } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import CardView from "../components/Card.svelte";
  import FilterSelect, { type FilterItem } from "../components/FilterSelect.svelte";

  let { sourceId = "", cardId = "" }: { sourceId?: string; cardId?: string } = $props();
  const lib = $derived(app.lib!);
  const videos = $derived(lib.sourceList().filter((s) => s.kind === "video"));
  const sid = $derived(sourceId || videos[0]?.id || "");
  const videoOptions = $derived.by((): FilterItem[] => videos.map((v) => ({ value: v.id, label: v.title })));
  let meta = $state.raw<SourceMeta | null>(null);
  let cues = $state.raw<{ line: number; t: number; text: string }[]>([]);
  let trEl: HTMLElement | undefined = $state();

  $effect(() => {
    const id = sid;
    if (!id) return;
    let alive = true;
    lib.text(id).then(({ lines, meta: m }) => {
      if (!alive) return;
      meta = m;
      cues = toBlocks(id, lines).flatMap((b) => b.type === "cue" ? [{ line: b.line, t: timeOf(m, b.line) ?? 0, text: b.text }] : []);
    });
    return () => { alive = false; };
  });

  const src = $derived(lib.source(sid));
  const dur = $derived(src?.duration_s ?? (cues.length ? cues[cues.length - 1].t + 10 : 1));
  const cards = $derived(app.cardsInSource(sid));
  const spans = $derived.by(() => {
    if (!meta) return [];
    const lanes: number[] = [];
    return cards.map((c) => {
      const r = c.refs.find((x) => x.source === sid)!;
      const a = timeOf(meta!, r.start) ?? 0;
      const b = Math.max(a + 5, timeOf(meta!, r.end) ?? a);
      let lane = lanes.findIndex((end) => end <= a);
      if (lane === -1) { lane = lanes.length; lanes.push(b); } else lanes[lane] = b;
      return { card: c, a, b, lane, start: r.start, end: r.end };
    });
  });
  const laneCount = $derived(Math.max(1, ...spans.map((s) => s.lane + 1)));
  const slides = $derived(meta ? meta.assets.filter((a) => a.kind === "slide").map((a) => ({ ...a, t: a.time_s ?? timeOf(meta!, a.line) ?? 0 })) : []);
  const picked = $derived(spans.find((s) => s.card.id === cardId) ?? spans[0]);
  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => formatTime(f * dur)));

  async function pick(c: Card) {
    router.go(`video/${encodeURIComponent(sid)}?card=${c.id}`);
  }
  $effect(() => {
    const p = picked;
    if (!p || !trEl) return;
    void tick().then(() => {
      const el = trEl?.querySelector<HTMLElement>(`[data-l="${p.start}"]`) ?? trEl?.querySelector<HTMLElement>(".tr.hl");
      if (el && trEl) trEl.scrollTop = el.offsetTop - 40;
    });
  });
</script>

<div class="view" data-testid="video-view">
  <div class="toolbar">
    <label class="small" for="w7src">Video</label>
    <FilterSelect
      id="w7src"
      ariaLabel="Video"
      value={sid}
      items={videoOptions}
      onchange={(val) => router.go("video/" + encodeURIComponent(val))}
    />
    {#if src}<span class="small">{formatTime(dur)} · {slides.length} slide images · {cards.length} cards</span>{/if}
  </div>
  {#if !videos.length}
    <p class="empty">No video sources in the library.</p>
  {:else}
    <div class="axisbox">
      <h5>Slides</h5>
      <div class="thumbs">
        {#each slides as s (s.path)}
          <a class="thumb" style="left:{(100 * s.t) / dur}%" href={app.videoUrlAt(sid, s.t)} target="_blank" rel="noopener noreferrer" title="{s.caption ?? 'Slide'} · {formatTime(s.t)}">
            <img src={lib.url(`sources/${sid}/${s.path}`)} alt={s.caption ?? "Slide"} loading="lazy" />
          </a>
        {/each}
      </div>
      <h5>Cards</h5>
      <div class="tl" style="height:{laneCount * 28 + 8}px">
        {#each spans as s (s.card.id)}
          <button type="button" class="span" class:hl={picked?.card.id === s.card.id} data-id={s.card.id}
            style="left:{(100 * s.a) / dur}%;width:{Math.max(0.8, (100 * (s.b - s.a)) / dur)}%;top:{4 + s.lane * 28}px"
            title="{s.card.title} · {formatTime(s.a)}–{formatTime(s.b)}" onclick={() => pick(s.card)}>{s.card.title}</button>
        {/each}
      </div>
      <div class="axis">{#each ticks as t, i (i)}<span>{t}</span>{/each}</div>
    </div>
    <div class="cols" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="col" bind:this={trEl} data-keep-scroll="transcript">
        <h5>Transcript</h5>
        {#each cues as c (c.line)}
          <div class="tr" class:hl={!!picked && c.line >= picked.start && c.line <= picked.end} data-l={c.line}>
            <a class="ts" href={app.videoUrlAt(sid, c.t)} target="_blank" rel="noopener noreferrer">{formatTime(c.t)}</a><span>{c.text}</span>
          </div>
        {/each}
      </div>
      <div class="col ground" data-testid="video-detail">
        {#if picked}<CardView card={picked.card} mode="detail" />{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .axisbox{padding:12px 20px 6px;background:var(--paper);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
  .thumbs{position:relative;height:58px;margin:0 30px}
  .thumb{position:absolute;width:72px;height:48px;transform:translateX(-50%);border:1px solid var(--line);border-radius:3px;overflow:hidden;background:var(--ground)}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .tl{position:relative;border-bottom:1px solid var(--line);margin:0 30px}
  .span{position:absolute;height:22px;border-radius:4px;background:color-mix(in srgb,var(--accent) 30%,var(--paper));border:1px solid var(--accent);font:inherit;font-size:.68rem;padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:var(--ink);text-align:left}
  .span.hl{background:var(--accent);color:var(--paper)}
  .axis{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.62rem;color:var(--muted);margin:0 30px}
  .tr{font-size:.86rem;display:grid;grid-template-columns:56px 1fr;gap:8px;padding:3px 6px;border-radius:4px}
  .tr .ts{font-family:var(--mono);font-size:.72rem;color:var(--accent)}
  .tr.hl{background:color-mix(in srgb,var(--accent) 12%,transparent)}
</style>
