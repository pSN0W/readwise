<script lang="ts">
  // P1 Feed. One card fills the screen.
  // drag → next card · drag ← copy for deep dive · vertical scroll reads deeper · tap = note.
  import { onDestroy, tick } from "svelte";
  import { app, mark } from "../lib/app.svelte.ts";
  import { scopeOptions } from "../lib/feed.ts";
  import { DragRecognizer } from "../lib/gesture.ts";
  import { ViewTimer } from "../lib/viewTimer.ts";
  import { router } from "../lib/router.svelte.ts";
  import FeedCard from "../components/FeedCard.svelte";
  import SearchButton from "../components/SearchButton.svelte";
  import FilterableSelect from "../components/FilterableSelect.svelte";

  // Opened from another screen: #/feed?scope=src:s_booka&card=c_0003
  $effect(() => {
    const q = router.route.query;
    if (q.scope || q.card) {
      app.setScope(q.scope ?? "all", q.card);
      router.go("feed", [], {}, true);
    }
  });

  const card = $derived.by(() => { app.index; app.feed; return app.current(); });
  const view = $derived.by(() => { app.v; return card ? app.view(card) : null; });
  const options = $derived.by(() => (app.lib ? scopeOptions(app.lib, app.tree()) : []));

  let el: HTMLDivElement | undefined = $state();
  let hintNext: HTMLSpanElement | undefined = $state();
  let hintCopy: HTMLSpanElement | undefined = $state();
  let entering = $state(false);
  const rec = new DragRecognizer();
  let pid: number | null = null;
  /** Set when the recogniser saw a tap; the browser's click that follows opens the note.
   *  (Opening on pointerup would let that click land on the new sheet's backdrop and close it.) */
  let tapAt = 0;

  const INTERACTIVE = "button, a, input, textarea, select, label, summary, [role=group], .ddpanel";

  function setHints(dx: number) {
    if (hintNext) hintNext.style.opacity = String(Math.max(0, Math.min(1, dx / 90)));
    if (hintCopy) hintCopy.style.opacity = String(Math.max(0, Math.min(1, -dx / 90)));
  }
  function snapBack() {
    setHints(0);
    if (!el) return;
    el.style.transition = "transform .18s ease-out";
    el.style.transform = "";
    const e = el;
    setTimeout(() => { e.style.transition = ""; }, 200);
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as Element).closest(INTERACTIVE)) { pid = null; return; }
    pid = e.pointerId;
    rec.down(e.clientX, e.clientY, e.timeStamp);
  }
  function onMove(e: PointerEvent) {
    if (pid !== e.pointerId || !el) return;
    const before = rec.mode;
    const mode = rec.move(e.clientX, e.clientY, e.timeStamp);
    if (mode === "horizontal") {
      if (before !== "horizontal") { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      el.style.transform = `translateX(${rec.dx}px) rotate(${rec.dx / 45}deg)`;
      setHints(rec.dx);
    }
  }
  async function onUp(e: PointerEvent) {
    if (pid !== e.pointerId) return;
    pid = null;
    const d = rec.up(e.clientX, e.clientY, e.timeStamp);
    const c = card;
    if (!c) return;
    if (d === "next") {
      setHints(0);
      const t0 = performance.now();
      mark("rh-swipe-commit");
      app.next();
      entering = true;
      await tick();
      requestAnimationFrame(() => {
        mark("rh-swipe-painted");
        recordPerf("swipe", performance.now() - t0);
      });
      setTimeout(() => (entering = false), 160);
    } else if (d === "copy") {
      snapBack();
      await app.copyCard(c);
    } else if (d === "tap") {
      tapAt = performance.now();
    } else {
      snapBack();
    }
  }
  function onClick(e: MouseEvent) {
    const c = card;
    if (!c || (e.target as Element).closest(INTERACTIVE)) return;
    if (performance.now() - tapAt < 800) { tapAt = 0; app.noteFor = c.id; }
  }
  /** Keyboard (dev / hardware keyboard): → next, ← copy, Enter = note. */
  function onKey(e: KeyboardEvent) {
    const c = card;
    if (!c || (e.target as Element) !== e.currentTarget) return;
    if (e.key === "ArrowRight") { e.preventDefault(); app.next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); void app.copyCard(c); }
    else if (e.key === "Enter") { e.preventDefault(); app.noteFor = c.id; }
  }
  function onCancel() {
    pid = null;
    rec.cancel();
    snapBack();
  }

  function recordPerf(name: string, ms: number) {
    const w = window as unknown as { __rhPerf?: Record<string, number[]> };
    ((w.__rhPerf ??= {})[name] ??= []).push(ms);
  }

  // Viewed after 2 s on screen (paused while the note sheet is open or the app is hidden).
  const timer = new ViewTimer();
  $effect(() => {
    const c = card;
    if (!c || !app.st) { timer.stop(); return; }
    const v = app.view(c);
    if (v.status !== "new" && !v.updated) { timer.stop(); return; }
    timer.show(c.id, () => { if (app.current()?.id === c.id) app.st?.markViewed(c); });
  });
  $effect(() => {
    if (app.noteFor) timer.pause(); else timer.resume();
  });
  const onVis = () => (document.visibilityState === "visible" ? timer.resume() : timer.pause());
  document.addEventListener("visibilitychange", onVis);
  onDestroy(() => { timer.stop(); document.removeEventListener("visibilitychange", onVis); });

  let readyMarked = false;
  $effect(() => {
    if (card && !readyMarked) {
      readyMarked = true;
      requestAnimationFrame(() => mark("rh-ready"));
    }
  });
</script>

<div class="screen" data-testid="feed">
  <div class="topbar">
    <button type="button" class="navbtn" aria-label="Previous card" data-testid="prev" onclick={() => app.prev()}>‹</button>
    <FilterableSelect
      ariaLabel="What to read"
      testId="scope"
      value={app.scope}
      options={options}
      placeholder="Filter scope or topic…"
      onchange={(val) => app.setScope(val)}
    />
    <span class="pos" data-testid="pos">{app.feed.length ? app.index + 1 : 0} / {app.feed.length}</span>
    <SearchButton />
  </div>
  <div class="feed-filters" data-testid="feed-filters" role="group" aria-label="Filter cards by read status">
    <button type="button" class="f-pill" class:on={app.feedFilter === "all"} data-testid="filter-all" onclick={() => app.setFeedFilter("all")}>
      All <span class="count">{app.countAll}</span>
    </button>
    <button type="button" class="f-pill" class:on={app.feedFilter === "unread"} data-testid="filter-unread" onclick={() => app.setFeedFilter("unread")}>
      Unread <span class="count">{app.countUnread}</span>
    </button>
    <button type="button" class="f-pill" class:on={app.feedFilter === "viewed"} data-testid="filter-viewed" onclick={() => app.setFeedFilter("viewed")}>
      Read <span class="count">{app.countViewed}</span>
    </button>
  </div>
  {#if card}
    <div class="hwrap">
      <div class="under" aria-hidden="true"><span class="u-next" bind:this={hintNext}>NEXT →</span><span class="u-copy" bind:this={hintCopy}>← COPY</span></div>
      {#key card.id}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
        <div class="fc" role="article" tabindex="0" onkeydown={onKey} aria-label={card.title} class:enter={entering} bind:this={el} data-testid="card" data-card-id={card.id}
          onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onCancel} onclick={onClick}>
          <FeedCard {card} />
        </div>
      {/key}
    </div>
  {:else}
    <div class="empty">
      {#if app.feedFilter === "unread"}
        <p>You're all caught up! No unread cards in this scope.</p>
        <button type="button" class="btn" style="margin-top:10px" onclick={() => app.setFeedFilter("all")}>Show all cards</button>
      {:else}
        <p>No cards here yet. New cards appear after the GPU machine ingests a source.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .topbar { gap: 6px; }
  .feed-filters { display: flex; gap: 6px; padding: 0 12px 6px; overflow-x: auto; flex: none; scrollbar-width: none; }
  .feed-filters::-webkit-scrollbar { display: none; }
  .f-pill { display: inline-flex; align-items: center; gap: 5px; background: var(--paper); border: 1px solid var(--line); color: var(--muted); border-radius: 99px; padding: 3px 10px; font-size: .75rem; font-family: var(--sans); font-weight: 500; white-space: nowrap; transition: all .15s ease; cursor: pointer; }
  .f-pill.on { background: var(--accent); color: var(--paper); border-color: var(--accent); font-weight: 600; }
  .f-pill .count { font-family: var(--mono); font-size: .68rem; opacity: .8; }
  .f-pill.on .count { opacity: 1; }
  .hwrap { flex: 1; min-height: 0; position: relative; padding: 2px 10px 10px; }
  .under { position: absolute; inset: 2px 10px 10px; display: flex; justify-content: space-between; align-items: center; padding: 0 18px; font-family: var(--mono); font-size: .8rem; font-weight: 600; pointer-events: none; }
  .u-next { color: var(--accent); opacity: 0; }
  .u-copy { color: var(--good); opacity: 0; }
  .fc { position: relative; height: 100%; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; user-select: none; -webkit-user-select: none; will-change: transform; scroll-behavior: smooth; }
  .fc.enter { animation: enter .14s ease-out; }
  @keyframes enter { from { transform: translateX(28px); opacity: .5; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .fc.enter { animation: none; } }
</style>
