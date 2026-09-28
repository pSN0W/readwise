<script lang="ts">
  // W9 Focus: one big card.
  // Scope = everything / one source / one topic.
  // Filters: search query, reading status (already read/unread/explored/known/updated), personal tags, has notes.
  // ← previous, → next (passing a card with → marks it Viewed). C copy, T tags, N note, / search, R reader mode.
  import { cardIdsUnder, topicTree, type Card } from "@rh/core";
  import { app, topicLabel } from "../lib/app.svelte.ts";
  import { router, readHref } from "../lib/router.svelte.ts";
  import CardView from "../components/Card.svelte";
  import FilterSelect, { type FilterItem } from "../components/FilterSelect.svelte";

  let {
    scope = "all",
    cardId = "",
    q = "",
    status = "all",
    tag = "all",
    notes = "all",
  }: {
    scope?: string;
    cardId?: string;
    q?: string;
    status?: string;
    tag?: string;
    notes?: string;
  } = $props();

  const lib = $derived(app.lib!);

  let searchInputEl: HTMLInputElement | undefined = $state();
  let stageEl: HTMLElement | undefined = $state();
  let searchQuery = $state("");
  let statusFilter = $state("all");
  let tagFilter = $state("all");
  let notesFilter = $state("all");
  let scopeFilter = $state("all");

  let scrollReveal = $state(true);
  let cardRevealed = $state(false);

  // Keep local filter state aligned when props change (e.g. hash navigation)
  $effect.pre(() => {
    searchQuery = q;
    statusFilter = status;
    tagFilter = tag;
    notesFilter = notes;
    scopeFilter = scope;
  });

  // When card ID changes, reset reveal state and stage scroll to top
  $effect(() => {
    void cardId;
    cardRevealed = false;
    if (stageEl) stageEl.scrollTop = 0;
  });

  /** Every card in reading order: sources in library order, cards in source order. */
  const ordered = $derived.by(() => {
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const s of lib.sourceList()) for (const c of app.cardsInSource(s.id)) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    for (const c of lib.cards.values()) if (!seen.has(c.id)) out.push(c);
    return out;
  });

  const tree = $derived(topicTree(lib.cards.values(), (c) => app.topicsOf(c)));
  const topicPaths = $derived.by(() => {
    const out: string[] = [];
    const walk = (n: typeof tree) => { for (const c of n.children) { out.push(c.path); walk(c); } };
    walk(tree);
    return out;
  });

  const scopeOptions = $derived.by((): FilterItem[] => [
    { value: "all", label: "Everything" },
    {
      group: "One source",
      options: lib.sourceList().map((s) => ({ value: "source:" + s.id, label: s.title })),
    },
    {
      group: "One topic",
      options: topicPaths.map((p) => ({ value: "topic:" + p, label: topicLabel(p) })),
    },
  ]);

  const statusOptions: FilterItem[] = [
    { value: "all", label: "All status" },
    { value: "read", label: "Already read" },
    { value: "unread", label: "New / Unread" },
    { value: "viewed", label: "Viewed" },
    { value: "explored", label: "Explored" },
    { value: "known", label: "Known" },
    { value: "updated", label: "Updated" },
  ];

  const tagOptions = $derived.by((): FilterItem[] => [
    { value: "all", label: "All tags" },
    { value: "any", label: "Has any tag" },
    { value: "none", label: "Untagged" },
    ...app.myTags().map((t) => ({ value: t, label: "#" + t })),
  ]);

  const notesOptions: FilterItem[] = [
    { value: "all", label: "All cards" },
    { value: "with-notes", label: "With notes" },
    { value: "no-notes", label: "No notes" },
  ];

  /** First apply the scope filter (everything, one source, or one topic). */
  const scoped = $derived.by(() => {
    if (scopeFilter.startsWith("source:")) return app.cardsInSource(scopeFilter.slice(7));
    if (scopeFilter.startsWith("topic:")) {
      const path = scopeFilter.slice(6);
      const find = (n: typeof tree): typeof tree | null => n.path === path ? n : n.children.map(find).find(Boolean) ?? null;
      const node = find(tree);
      const ids = new Set(node ? cardIdsUnder(node) : []);
      return ordered.filter((c) => ids.has(c.id));
    }
    return ordered;
  });

  /** Then apply the status, tag, notes, and search query filters. */
  const list = $derived.by(() => {
    void app.tick; // Recompute when state, tags, or notes change
    const sq = searchQuery.trim().toLowerCase();
    const st = statusFilter;
    const tg = tagFilter;
    const nt = notesFilter;

    return scoped.filter((c) => {
      const v = app.view(c);

      // Status filter
      if (st === "unread" && v.status !== "new") return false;
      if (st === "read" && v.status === "new") return false; // already read = viewed or explored
      if (st === "viewed" && v.status !== "viewed") return false;
      if (st === "explored" && v.status !== "explored") return false;
      if (st === "known" && !v.known) return false;
      if (st === "updated" && !v.updated) return false;

      // Tag filter
      if (tg === "any" && v.tags.length === 0) return false;
      if (tg === "none" && v.tags.length > 0) return false;
      if (tg !== "all" && tg !== "any" && tg !== "none") {
        if (!v.tags.includes(tg)) return false;
      }

      // Notes filter
      const hasNote = app.hasNote(c.id);
      if (nt === "with-notes" && !hasNote) return false;
      if (nt === "no-notes" && hasNote) return false;

      // Search query filter
      if (sq) {
        const titleMatch = c.title.toLowerCase().includes(sq);
        const whatMatch = c.what?.toLowerCase().includes(sq) ?? false;
        const whyMatch = c.why?.toLowerCase().includes(sq) ?? false;
        const howMatch = c.how?.toLowerCase().includes(sq) ?? false;
        const whenMatch = c.when?.toLowerCase().includes(sq) ?? false;
        const extraMatch = c.extra?.toLowerCase().includes(sq) ?? false;
        const topicMatch = c.topics.some((t) => t.toLowerCase().includes(sq));
        const tagMatch = v.tags.some((t) => t.toLowerCase().includes(sq));
        const noteMatch = app.note(c.id).toLowerCase().includes(sq);
        const srcMatch = c.refs.some((r) => app.sourceTitle(r.source).toLowerCase().includes(sq));
        if (!titleMatch && !whatMatch && !whyMatch && !howMatch && !whenMatch && !extraMatch && !topicMatch && !tagMatch && !noteMatch && !srcMatch) {
          return false;
        }
      }

      return true;
    });
  });

  const idx = $derived.by(() => {
    if (!list.length) return 0;
    const found = list.findIndex((c) => c.id === cardId);
    return found !== -1 ? found : 0;
  });

  const card = $derived(list[idx] as Card | undefined);
  let tagsOpen = $state(false);
  let noteEditing = $state(false);

  const hasActiveFilters = $derived(
    scopeFilter !== "all" || statusFilter !== "all" || tagFilter !== "all" || notesFilter !== "all" || searchQuery.trim() !== ""
  );

  function makeUrl(
    sc: string,
    id: string,
    qVal = searchQuery,
    stVal = statusFilter,
    tgVal = tagFilter,
    ntVal = notesFilter
  ): string {
    const p = new URLSearchParams();
    if (sc && sc !== "all") p.set("scope", sc);
    if (id) p.set("card", id);
    if (qVal.trim()) p.set("q", qVal.trim());
    if (stVal && stVal !== "all") p.set("status", stVal);
    if (tgVal && tgVal !== "all") p.set("tag", tgVal);
    if (ntVal && ntVal !== "all") p.set("notes", ntVal);
    const qs = p.toString();
    return `focus${qs ? "?" + qs : ""}`;
  }

  function applyFilters(newScope = scopeFilter, newStatus = statusFilter, newTag = tagFilter, newNotes = notesFilter, newQ = searchQuery) {
    scopeFilter = newScope;
    statusFilter = newStatus;
    tagFilter = newTag;
    notesFilter = newNotes;
    searchQuery = newQ;
    const targetCard = card && list.some((c) => c.id === card.id) ? card.id : (list[0]?.id ?? "");
    router.replace(makeUrl(newScope, targetCard, newQ, newStatus, newTag, newNotes));
  }

  function clearFilters() {
    applyFilters("all", "all", "all", "all", "");
  }

  function go(d: number) {
    if (!list.length) return;
    if (d > 0 && card) app.st?.markViewed(card);
    const n = list[(idx + d + list.length) % list.length];
    tagsOpen = false;
    noteEditing = false;
    cardRevealed = false;
    if (stageEl) stageEl.scrollTop = 0;
    router.go(makeUrl(scopeFilter, n.id));
  }

  function key(e: KeyboardEvent) {
    if (app.paletteOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const inInput = !!target.closest("input,textarea,select");

    if (inInput) {
      if (e.key === "Escape" && target === searchInputEl) {
        searchQuery = "";
        applyFilters(scopeFilter, statusFilter, tagFilter, notesFilter, "");
        searchInputEl?.blur();
        e.preventDefault();
      }
      return;
    }

    const k = e.key.toLowerCase();
    if (k === "r") {
      // Switch from Focus mode to Reader mode on current card
      if (card && card.refs[0]) {
        e.preventDefault();
        router.go(readHref(card.refs[0].source, card.refs[0].start, card.id));
        return;
      } else {
        e.preventDefault();
        router.go("read");
        return;
      }
    }

    // Scroll reveal via keyboard
    if (scrollReveal && !cardRevealed && (e.key === "ArrowDown" || e.key === " " || e.key === "PageDown")) {
      cardRevealed = true;
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (k === "c" && card) void app.copyCard(card);
    else if (k === "t") tagsOpen = !tagsOpen;
    else if (k === "n") { cardRevealed = true; noteEditing = true; }
    else if (e.key === "/") {
      e.preventDefault();
      searchInputEl?.focus();
      searchInputEl?.select();
      return;
    } else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={key} />

<div class="view">
  <div class="toolbar focus-bar">
    <div class="filter-item">
      <label class="small" for="w9scope">Scope</label>
      <FilterSelect
        id="w9scope"
        ariaLabel="Scope"
        value={scopeFilter}
        items={scopeOptions}
        onchange={(val) => applyFilters(val, statusFilter, tagFilter, notesFilter, searchQuery)}
      />
    </div>

    <div class="filter-item">
      <label class="small" for="w9status">Status</label>
      <FilterSelect
        id="w9status"
        ariaLabel="Status"
        value={statusFilter}
        items={statusOptions}
        onchange={(val) => applyFilters(scopeFilter, val, tagFilter, notesFilter, searchQuery)}
      />
    </div>

    <div class="filter-item">
      <label class="small" for="w9tag">Tags</label>
      <FilterSelect
        id="w9tag"
        ariaLabel="Tags"
        value={tagFilter}
        items={tagOptions}
        onchange={(val) => applyFilters(scopeFilter, statusFilter, val, notesFilter, searchQuery)}
      />
    </div>

    <div class="filter-item">
      <label class="small" for="w9notes">Notes</label>
      <FilterSelect
        id="w9notes"
        ariaLabel="Notes"
        value={notesFilter}
        items={notesOptions}
        onchange={(val) => applyFilters(scopeFilter, statusFilter, tagFilter, val, searchQuery)}
      />
    </div>

    <div class="filter-item search-box">
      <input
        bind:this={searchInputEl}
        type="search"
        class="inp"
        placeholder="Search cards & notes… (/)"
        aria-label="Search cards in focus mode"
        bind:value={searchQuery}
        oninput={() => applyFilters(scopeFilter, statusFilter, tagFilter, notesFilter, searchQuery)}
      />
      {#if searchQuery}
        <button type="button" class="clear-btn" aria-label="Clear search" onclick={() => applyFilters(scopeFilter, statusFilter, tagFilter, notesFilter, "")}>×</button>
      {/if}
    </div>

    {#if hasActiveFilters}
      <button type="button" class="btn small reset-btn" onclick={clearFilters} title="Reset all filters">Reset</button>
    {/if}

    <div class="actions-group">
      <button
        type="button"
        class="btn small reveal-toggle"
        class:active={scrollReveal}
        onclick={() => (scrollReveal = !scrollReveal)}
        title="Toggle scroll-to-reveal mode"
      >
        Scroll reveal: {scrollReveal ? "On" : "Off"}
      </button>

      <a
        class="btn small mode-btn"
        href={card && card.refs[0] ? readHref(card.refs[0].source, card.refs[0].start, card.id) : "#/read"}
        title="Switch to Reader mode at this card (shortcut: R)"
      >
        <kbd>R</kbd> Reader
      </a>
    </div>

    <span class="small count-text" data-testid="focus-pos">{list.length ? idx + 1 : 0} / {list.length}</span>
  </div>

  <div
    class="col ground stage"
    bind:this={stageEl}
    data-keep-scroll="focus"
    onscroll={(e) => { if (scrollReveal && !cardRevealed && (e.currentTarget as HTMLElement).scrollTop > 5) cardRevealed = true; }}
    onwheel={(e) => { if (scrollReveal && !cardRevealed && e.deltaY > 0) cardRevealed = true; }}
  >
    <div class="focusnav">
      <button type="button" onclick={() => go(-1)} disabled={!list.length} aria-label="Previous card">←</button>
      <span class="small">← previous · next →</span>
      <button type="button" onclick={() => go(1)} disabled={!list.length} aria-label="Next card">→</button>
    </div>
    {#if card}
      {#key card.id}
        <CardView {card} mode="big" bind:tagsOpen bind:noteEditing {scrollReveal} bind:revealed={cardRevealed} />
      {/key}
    {:else}
      <div class="empty-state">
        <p class="empty">No cards match the current filters.</p>
        {#if hasActiveFilters}
          <button type="button" class="btn" onclick={clearFilters}>Reset filters</button>
        {/if}
      </div>
    {/if}
    <div class="keys">
      <span><kbd>←</kbd>/<kbd>→</kbd> previous / next</span>
      <span><kbd>R</kbd> reader mode</span>
      {#if scrollReveal && !cardRevealed}<span><kbd>↓</kbd>/<kbd>Space</kbd> reveal details</span>{/if}
      <span><kbd>C</kbd> copy</span>
      <span><kbd>T</kbd> my tags</span>
      <span><kbd>N</kbd> note</span>
      <span><kbd>/</kbd> search</span>
    </div>
  </div>
</div>

<style>
  .focus-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 14px}
  .filter-item{display:flex;align-items:center;gap:6px}
  .search-box{position:relative;flex:1;min-width:180px;max-width:280px}
  .search-box input{width:100%;font-size:.82rem;padding:4px 24px 4px 8px}
  .clear-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0}
  .clear-btn:hover{color:var(--ink)}
  .reset-btn{font-size:.76rem;padding:3px 8px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);cursor:pointer;border-radius:4px}
  .actions-group{display:flex;gap:6px;align-items:center}
  .mode-btn{font-size:.76rem;padding:3px 8px;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
  .reveal-toggle{font-size:.74rem;padding:3px 8px}
  .reveal-toggle.active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
  .count-text{margin-left:auto;font-family:var(--mono);font-size:.8rem;color:var(--muted);white-space:nowrap}
  .stage{gap:14px;padding:20px;border:0}
  .focusnav{display:flex;align-items:center;justify-content:center;gap:16px}
  .focusnav button{font:inherit;font-size:1.1rem;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--paper);color:var(--ink);cursor:pointer}
  .focusnav button:disabled{opacity:.4;cursor:default}
  .empty-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 0}
  .keys{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;font-size:.78rem;color:var(--muted)}
</style>
