<script lang="ts">
  // W2 Reader: Contents | Book | Cards. The three panes scroll together:
  // top visible block -> its line -> card (cardAtLine) -> other panes scroll to that card.
  import { tick } from "svelte";
  import { coverage, sectionOf, type SourceMeta } from "@rh/core";
  import { app, kindIcon } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { prefs, type Panes } from "../lib/prefs.ts";
  import { prepareBook, type Book, type BookChunk } from "../lib/book.ts";
  import { cardAtLine, chunkOfLine, chunksInRange, topVisible, type Span } from "../lib/scroll-sync.ts";
  import LazyCard from "../components/LazyCard.svelte";
  import FilterSelect, { type FilterItem } from "../components/FilterSelect.svelte";

  let { sourceId, line = 0, cardParam = "" }: { sourceId: string; line?: number; cardParam?: string } = $props();

  const lib = $derived(app.lib!);
  const src = $derived(lib.source(sourceId));
  const cards = $derived(app.cardsInSource(sourceId));
  const spans = $derived<(Span & { title: string })[]>(cards.map((c) => {
    const r = c.refs.find((x) => x.source === sourceId)!;
    return { id: c.id, start: r.start, end: r.end, title: c.title };
  }));
  const spanById = $derived(new Map(spans.map((s) => [s.id, s])));

  let meta = $state.raw<SourceMeta | null>(null);
  let chunks = $state.raw<BookChunk[]>([]);
  let book: Book | null = null;
  /** Chunks whose HTML is in the DOM. The rest are empty boxes with an estimated height. */
  let rendered: boolean[] = [];
  let idleHandle = 0;
  let loadedId = $state("");
  let loadError = $state<string | null>(null);
  let cur = $state<string | null>(null);
  let curLine = $state(0);
  let panes = $state<Panes>({ toc: true, book: true, cards: true });

  let bookEl: HTMLElement | undefined = $state();
  let cardsEl: HTMLElement | undefined = $state();
  let tocEl: HTMLElement | undefined = $state();
  /** Where the app itself last scrolled each pane. A scroll event that lands there is ours, not the user's. */
  const own: Record<"book" | "cards" | "toc", number | null> = { book: null, cards: null, toc: null };

  const video = $derived(src?.kind === "video");

  // Contents: meta.toc headings, each with the card titles that start under it.
  const toc = $derived.by(() => {
    if (!meta) return [];
    const groups: { title: string; level: number; line: number; cards: { id: string; title: string }[] }[] = [];
    const byLine = new Map<number, (typeof groups)[number]>();
    const start = { title: "Start", level: 1, line: 1, cards: [] as { id: string; title: string }[] };
    for (const t of meta.toc) { const g = { title: t.title, level: t.level, line: t.line, cards: [] }; groups.push(g); byLine.set(t.line, g); }
    for (const s of spans) {
      const sec = sectionOf(meta, s.start);
      (sec ? byLine.get(sec.line) ?? start : start).cards.push({ id: s.id, title: s.title });
    }
    return start.cards.length ? [start, ...groups] : groups;
  });
  const curSection = $derived(meta && curLine ? sectionOf(meta, curLine)?.line ?? 0 : 0);

  // Load the source text when the source changes.
  $effect(() => {
    const id = sourceId;
    const l = lib;
    if (!l || !src) return;
    panes = prefs.panes(src.kind);
    prefs.setLastSource(id);
    let alive = true;
    const t0 = performance.now();
    l.text(id).then(async ({ lines, meta: m }) => {
      if (!alive) return;
      const tText = performance.now();
      const cov = coverage(l, id);
      const limit = l.report?.sources.find((s) => s.source === id)?.checks.coverage.limit ?? null;
      meta = m;
      book = prepareBook({
        sourceId: id, lines, meta: m, spans, gaps: cov.gaps, gapLimit: limit,
        url: (p) => l.url(p), videoUrlAt: (s) => app.videoUrlAt(id, s),
      });
      rendered = new Array(book.chunks.length).fill(false);
      chunks = book.chunks;
      const tBuild = performance.now();
      loadedId = id;
      loadError = null;
      await tick();
      // first screen now; small sources at once; everything else when idle
      if (chunks.length <= 16) ensureChunk(0, chunks.length);
      else ensureChunk(chunkOfLine(chunks, line || 1), 2);
      const tDom = performance.now();
      position();
      startIdleFill();
      requestAnimationFrame(() => {
        const ms = performance.now() - t0;
        const w = window as unknown as { __rhPerf: Record<string, number> };
        w.__rhPerf ??= {};
        Object.assign(w.__rhPerf, { readerOpen: ms, readerText: tText - t0, readerBuild: tBuild - tText, readerDom: tDom - tBuild });
        document.documentElement.dataset.readerReady = id;
      });
    }).catch((e: Error) => { if (alive) loadError = e.message; });
    return () => { alive = false; stopIdleFill(); delete document.documentElement.dataset.readerReady; };
  });

  // Deep link (?line= / &card=) inside the same source.
  let lastPositioned = "";
  $effect(() => {
    const key = `${line}:${cardParam}`;
    if (key === lastPositioned) return;
    if (line > 0 && line === curLine && (!cardParam || cardParam === cur)) {
      lastPositioned = key;
      return;
    }
    lastPositioned = key;
    if (loadedId === sourceId) void tick().then(position);
  });

  function position() {
    if (cardParam && spanById.has(cardParam)) { goTo(cardParam, null); return; }
    if (line > 0) {
      scrollBookToLine(line);
      const id = cardAtLine(spans, line);
      if (id) goTo(id, "book");
      curLine = line;
      return;
    }
    if (spans.length) mark(spans[0].id);
  }

  /* ---------------------------------------------------------------- DOM helpers */

  function chunkEls(): HTMLElement[] {
    return bookEl ? [...bookEl.querySelectorAll<HTMLElement>(":scope > .chunk")] : [];
  }

  /** Put chunk i's HTML into the DOM (and its neighbours with `around`). */
  function ensureChunk(i: number, around = 0, els = chunkEls()) {
    if (!book) return;
    for (let k = Math.max(0, i - around); k <= Math.min(chunks.length - 1, i + around); k++) {
      if (rendered[k] || !els[k]) continue;
      els[k].innerHTML = book.html(k);
      rendered[k] = true;
      if (cur) { const s = spanById.get(cur); if (s && chunks[k].first <= s.end && chunks[k].last >= s.start) highlight(s, [k], els); }
    }
  }

  /** Fill the other chunks when the browser is idle, nearest to the reading position first. */
  function startIdleFill() {
    stopIdleFill();
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 30));
    const step = (d: IdleDeadline) => {
      const els = chunkEls();
      const center = chunkOfLine(chunks, curLine || 1);
      let done = true;
      for (let r = 0; r < chunks.length; r++) {
        for (const k of [center + r, center - r]) {
          if (k < 0 || k >= chunks.length || rendered[k]) continue;
          if (d.timeRemaining() < 3) { done = false; break; }
          ensureChunk(k, 0, els);
        }
        if (!done) break;
      }
      if (rendered.includes(false)) idleHandle = ric(step) as unknown as number;
    };
    idleHandle = ric(step) as unknown as number;
  }
  function stopIdleFill() {
    if (idleHandle) (window.cancelIdleCallback ?? clearTimeout)(idleHandle);
    idleHandle = 0;
  }

  /** Top of `el` inside `pane` (scroll coordinates). Chunks use containment, so they are the
   *  offsetParent of their blocks; sum offsetTop up the chain instead of trusting one level. */
  function topIn(pane: HTMLElement, el: HTMLElement): number {
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== pane) { y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    return y;
  }

  function set(el: HTMLElement | undefined, key: keyof typeof own, top: number) {
    if (!el) return;
    const before = el.scrollTop;
    el.scrollTop = Math.max(0, top);
    own[key] = Math.abs(el.scrollTop - before) >= 1 ? el.scrollTop : null;
  }

  /** Line of the block at the top of the book pane. */
  function bookTopLine(): number {
    if (!bookEl) return 0;
    const els = chunkEls();
    const y = bookEl.scrollTop + 20;
    const i = topVisible(els.map((e) => e.offsetTop), els.map((e) => e.offsetHeight), y);
    if (i < 0) return 0;
    ensureChunk(i, 1, els);
    const base = els[i].offsetTop;
    const blocks = els[i].querySelectorAll<HTMLElement>("[data-l]");
    for (const b of blocks) if (base + b.offsetTop + b.offsetHeight > y) return Number(b.dataset.l);
    return chunks[i]?.last ?? 0;
  }

  /** Element of the block holding a line. */
  function blockEl(l: number): HTMLElement | null {
    const els = chunkEls();
    const ci = chunkOfLine(chunks, l);
    ensureChunk(ci, 1, els);
    const chunk = els[ci];
    if (!chunk) return null;
    let best: HTMLElement | null = null;
    for (const b of chunk.querySelectorAll<HTMLElement>("[data-l]")) {
      if (Number(b.dataset.l) <= l) best = b; else break;
    }
    return best ?? chunk;
  }

  function scrollBookToLine(l: number) {
    const el = blockEl(l);
    if (el && bookEl) set(bookEl, "book", topIn(bookEl, el) - 8);
  }

  function markerEl(id: string): HTMLElement | null {
    const s = spanById.get(id);
    if (s) ensureChunk(chunkOfLine(chunks, s.start), 1);
    return bookEl?.querySelector<HTMLElement>(`.mk[data-go="${CSS.escape(id)}"]`) ?? null;
  }

  let hl: HTMLElement[] = [];
  function mark(id: string) {
    cur = id;
    for (const e of hl) e.classList.remove("inr");
    hl = [];
    const s = spanById.get(id);
    if (!s || !bookEl) return;
    highlight(s, chunksInRange(chunks, s.start, s.end), chunkEls());
  }
  /** Light up the blocks of a card's range inside the given (rendered) chunks. */
  function highlight(s: Span, which: number[], els: HTMLElement[]) {
    for (const ci of which) {
      if (!rendered[ci]) continue;
      for (const b of els[ci]?.querySelectorAll<HTMLElement>("[data-l]") ?? []) {
        const a = Number(b.dataset.l);
        const z = Number(b.dataset.e ?? a);
        if (a <= s.end && z >= s.start) { b.classList.add("inr"); hl.push(b); }
      }
    }
  }

  /** Make `id` the current card and scroll every pane except `from` to it. */
  function goTo(id: string, from: "book" | "cards" | "toc" | null) {
    const s = spanById.get(id);
    if (!s) return;
    mark(id);
    if (from !== "book") {
      const b = blockEl(s.start);
      const m = markerEl(id);
      if (b && bookEl) set(bookEl, "book", topIn(bookEl, b) - 8);
      else if (m && bookEl) set(bookEl, "book", topIn(bookEl, m) - 8);
      else scrollBookToLine(s.start);
      curLine = s.start;
    }
    if (from !== "cards" && cardsEl) {
      const c = cardsEl.querySelector<HTMLElement>(`.rcard[data-id="${CSS.escape(id)}"]`);
      if (c) set(cardsEl, "cards", topIn(cardsEl, c) - 36);
    }
    if (from !== "toc" && tocEl) {
      const t = tocEl.querySelector<HTMLElement>(`[data-tocid="${CSS.escape(id)}"]`);
      const ty = t ? topIn(tocEl, t) : 0;
      if (t && (ty < tocEl.scrollTop + 30 || ty > tocEl.scrollTop + tocEl.clientHeight - 40)) {
        set(tocEl, "toc", ty - tocEl.clientHeight / 3);
      }
    }
  }

  let raf = 0;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  function onScroll(which: "book" | "cards") {
    const el = which === "book" ? bookEl : cardsEl;
    if (el && own[which] !== null && Math.abs(el.scrollTop - (own[which] as number)) < 2) { own[which] = null; return; }
    own[which] = null;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (which === "book") {
        const l = bookTopLine();
        curLine = l;
        const id = cardAtLine(spans, l);
        if (id && id !== cur) goTo(id, "book");
        clearTimeout(urlTimer);
        urlTimer = setTimeout(() => router.replace(`read/${encodeURIComponent(sourceId)}?line=${l}`), 300);
      } else if (cardsEl) {
        const els = [...cardsEl.querySelectorAll<HTMLElement>(".rcard")];
        const i = topVisible(els.map((e) => e.offsetTop), els.map((e) => e.offsetHeight), cardsEl.scrollTop + 40);
        const id = els[i]?.dataset.id;
        if (id && id !== cur) goTo(id, "cards");
      }
    });
  }

  function onBookClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("a")) return; // video time links open the video
    const mk = t.closest<HTMLElement>(".mk");
    if (mk?.dataset.go) { goTo(mk.dataset.go, null); return; }
    const b = t.closest<HTMLElement>("[data-l]");
    if (!b) return;
    const l = Number(b.dataset.l);
    const id = cardAtLine(spans, l);
    curLine = l;
    if (id) goTo(id, "book");
  }

  function jumpToHeading(l: number) {
    scrollBookToLine(l);
    curLine = l;
    const id = cardAtLine(spans, l);
    if (id) goTo(id, "book");
  }

  async function togglePane(k: keyof Panes, on: boolean) {
    panes = { ...panes, [k]: on };
    if (src) prefs.setPanes(src.kind, panes);
    await tick();
    if (cur) goTo(cur, null);
  }

  function onKey(e: KeyboardEvent) {
    if (app.paletteOpen || (e.target as HTMLElement).closest("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f" || k === "r") {
      e.preventDefault();
      const id = cur || cards[0]?.id || "";
      router.go(`focus${id ? "?card=" + encodeURIComponent(id) : ""}`);
    }
  }

  const sourceOptions = $derived.by((): FilterItem[] => {
    return lib.sourceList().map((s) => ({
      value: s.id,
      label: `${kindIcon(s.kind)} · ${s.title}`,
      sub: s.kind,
    }));
  });

  const cols = $derived([panes.toc && "minmax(180px,250px)", panes.book && "minmax(0,1.45fr)", panes.cards && "minmax(0,1fr)"].filter(Boolean).join(" ") || "1fr");
</script>

<svelte:window onkeydown={onKey} />

<div class="view reader">
  <div class="toolbar">
    <label class="small" for="w2src">Source</label>
    <FilterSelect
      id="w2src"
      ariaLabel="Source"
      value={sourceId}
      items={sourceOptions}
      onchange={(val) => router.go("read/" + encodeURIComponent(val))}
    />
    {#if src}<span class="small">{src.n_lines.toLocaleString()} lines · {cards.length} cards · {app.readPct(sourceId)}% read</span>{/if}
    <span class="toggles" role="group" aria-label="Panes">
      <label><input type="checkbox" checked={panes.toc} onchange={(e) => togglePane("toc", (e.target as HTMLInputElement).checked)} data-pane="toc" /> Contents</label>
      <label><input type="checkbox" checked={panes.book} onchange={(e) => togglePane("book", (e.target as HTMLInputElement).checked)} data-pane="book" /> {video ? "Transcript" : "Book"}</label>
      <label><input type="checkbox" checked={panes.cards} onchange={(e) => togglePane("cards", (e.target as HTMLInputElement).checked)} data-pane="cards" /> Cards</label>
    </span>
    <span class="sync">⇅ panes sync</span>
    <a class="btn small mode-btn" href="#/focus{cur ? '?card=' + encodeURIComponent(cur) : ''}" title="Switch to Focus mode on current card (shortcut: F)"><kbd>F</kbd> Focus</a>
  </div>

  {#if !src}
    <p class="empty">This source is not in the library.</p>
  {:else if loadError}
    <p class="empty">Could not load this source: {loadError}</p>
  {:else}
    <div class="cols" style="grid-template-columns:{cols}">
      {#if panes.toc}
        <nav class="col toc" bind:this={tocEl} data-pane-el="toc" data-keep-scroll="toc" aria-label="Contents">
          <h5>Contents · {src.title}</h5>
          {#each toc as g (g.line + g.title)}
            <button type="button" class="toc-h lv{g.level}" class:cur={curSection === g.line} onclick={() => jumpToHeading(g.line)}>{g.title}</button>
            {#each g.cards as c (c.id)}
              <button type="button" class="toc-c" class:cur={cur === c.id} data-tocid={c.id} onclick={() => goTo(c.id, "toc")}>{c.title}</button>
            {/each}
          {/each}
        </nav>
      {/if}
      {#if panes.book}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="col book" bind:this={bookEl} data-pane-el="book" data-keep-scroll="book" onscroll={() => onScroll("book")} onclick={onBookClick}>
          <h5 class="sticky">{src.title}{video ? " · transcript" : ""}</h5>
          {#if loadedId !== sourceId}<p class="small">Loading…</p>{/if}
          {#each chunks as ch (loadedId + ch.index)}
            <div class="chunk" data-ci={ch.index} style="contain-intrinsic-size:auto {ch.est}px"></div>
          {/each}
          <div class="scrollpad"></div>
        </div>
      {/if}
      {#if panes.cards}
        <div class="col ground cardsp" bind:this={cardsEl} data-pane-el="cards" data-keep-scroll="cards" onscroll={() => onScroll("cards")}>
          <h5 class="sticky">Cards in {video ? "video" : "source"} order · {cards.length}</h5>
          {#each cards as c (c.id)}
            <LazyCard card={c} current={cur === c.id} {sourceId} root={cardsEl} />
          {:else}
            <p class="small">No cards for this source yet.</p>
          {/each}
          <div class="scrollpad"></div>
        </div>
      {/if}
      {#if !panes.toc && !panes.book && !panes.cards}
        <div class="col"><p class="small">Turn on at least one pane.</p></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .toggles{display:flex;gap:10px;align-items:center;margin-left:auto}
  .toggles label{font-size:.8rem;display:flex;gap:4px;align-items:center;cursor:pointer}
  .sync{font-family:var(--mono);font-size:.66rem;color:var(--good)}
  .sticky{position:sticky;top:-14px;background:inherit;padding:6px 0;margin-top:-6px;z-index:2}
  .toc{gap:1px;background:var(--paper)}
  .toc button{font:inherit;font-size:.8rem;text-align:left;background:none;border:0;border-left:2px solid transparent;color:var(--ink);cursor:pointer;padding:3px 8px;width:100%;border-radius:0 4px 4px 0}
  .toc .toc-h{font-weight:700;margin-top:6px}
  .toc .toc-h.lv3,.toc .toc-h.lv4{font-weight:400;padding-left:14px}
  .toc .toc-c{padding-left:20px;font-size:.76rem;color:var(--muted)}
  .toc button.cur{border-left-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
  .toc .toc-h.cur{background:none}
  .book{gap:0;padding:14px 18px 14px 46px}
  .book .sticky{margin-left:-32px;padding-left:32px}
  .chunk{flex:none;content-visibility:auto;display:flex;flex-direction:column;gap:2px;margin-left:-40px;padding-left:40px}
  .cardsp{gap:10px}
  .book :global(.rp){font-family:var(--serif);font-size:1.02rem;line-height:1.65;padding:3px 10px;border-left:3px solid transparent;border-radius:0 4px 4px 0;position:relative;cursor:pointer}
  .book :global([data-l]){position:relative}
  .book :global(.rp::before),.book :global(.cue::before),.book :global(.rh::before){content:attr(data-l);position:absolute;left:-40px;width:30px;text-align:right;font-family:var(--mono);font-size:.58rem;color:var(--muted);opacity:.6;top:.5em}
  .book :global(.rh){font-family:var(--serif);font-weight:600;font-size:1.15rem;padding:14px 10px 2px}
  .book :global(.rh.lv1){font-size:1.6rem}
  .book :global(.rh.lv2){font-size:1.3rem}
  .book :global(.inr){background:color-mix(in srgb,var(--accent) 8%,transparent);border-left-color:var(--accent)!important}
  .book :global(.rmath){padding:4px 10px;border-left:3px solid transparent}
  .book :global(.rcode){margin:4px 10px}
  .book :global(.rfig){margin:6px 10px 10px;display:flex;flex-direction:column;gap:4px;border-left:3px solid transparent;padding-left:6px}
  .book :global(.rfig img){max-height:360px;object-fit:contain;align-self:flex-start;border:1px solid var(--line);border-radius:4px;background:#fff}
  .book :global(.rfig figcaption){font-size:.72rem;color:var(--muted)}
  .book :global(.cue){display:grid;grid-template-columns:54px 1fr;gap:8px;padding:2px 8px;font-size:.92rem;border-left:3px solid transparent;cursor:pointer}
  .book :global(.cue .ts){font-family:var(--mono);font-size:.72rem;color:var(--accent);padding-top:.2em}
  .book :global(.mk){align-self:flex-start;font:inherit;font-family:var(--mono);font-size:.64rem;color:var(--accent);background:var(--accent-soft);border:0;border-radius:4px;padding:1px 8px;margin:10px 0 2px 10px;cursor:pointer}
  .book :global(.gapmk){font-size:.74rem;color:var(--muted);font-style:italic;margin:6px 10px;padding:2px 8px;border-left:3px solid var(--line);background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--muted) 12%,transparent) 0 2px,transparent 2px 7px)}
  .book :global(.gapmk.long){color:var(--rule-red);border-left-color:var(--rule-red);background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--rule-red) 16%,transparent) 0 2px,transparent 2px 7px)}
</style>
