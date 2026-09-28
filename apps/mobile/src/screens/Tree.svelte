<script lang="ts">
  // P3 Tree: Topics (your topic tree, 3 levels) or Books (source → section → cards).
  import { cardIdsUnder, sectionOf, type Card, type SourceMeta, type TopicNode } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { readShare } from "../lib/feed.ts";
  import { router } from "../lib/router.svelte.ts";
  import { sourceCards } from "../lib/stats.ts";
  import Chips from "../components/Chips.svelte";
  import SearchButton from "../components/SearchButton.svelte";

  interface Row { key: string; label: string; cards: Card[] }

  const vw = (c: Card) => app.view(c);
  const cardsOf = (ids: string[]) => ids.map((id) => app.lib?.cards.get(id)).filter((c): c is Card => !!c);

  // Topics
  const topicNode = $derived.by((): TopicNode | null => {
    if (!app.lib || app.treeKind !== "topics") return null;
    let n: TopicNode | undefined = app.tree();
    for (const name of app.treePath) n = n?.children.find((c) => c.name === name);
    return n ?? null;
  });

  // Books: meta of the opened source (for its table of contents)
  let meta = $state.raw<SourceMeta | null>(null);
  $effect(() => {
    const sid = app.treeKind === "books" ? app.treePath[0] : undefined;
    meta = null;
    if (sid && app.lib) void app.lib.meta(sid).then((m) => { if (app.treePath[0] === sid) meta = m; }).catch(() => {});
  });

  function sections(sid: string, m: SourceMeta): Map<string, Card[]> {
    const top = m.toc.length ? Math.min(...m.toc.map((t) => t.level)) : 1;
    const out = new Map<string, Card[]>();
    for (const c of sourceCards(app.lib!, sid)) {
      const r = c.refs.find((x) => x.source === sid);
      const sec = r ? sectionOf(m, r.start, top)?.title ?? "Start" : "Start";
      (out.get(sec) ?? out.set(sec, []).get(sec)!).push(c);
    }
    return out;
  }

  const view = $derived.by((): { rows: Row[]; cards: Card[]; scope: string } => {
    const lib = app.lib;
    if (!lib) return { rows: [], cards: [], scope: "all" };
    if (app.treeKind === "topics") {
      const n = topicNode;
      if (!n) return { rows: [], cards: [], scope: "all" };
      return {
        rows: n.children.map((c) => ({ key: c.name, label: c.name, cards: cardsOf(cardIdsUnder(c)) })),
        cards: cardsOf(n.cardIds),
        scope: n.path ? `topic:${n.path}` : "all",
      };
    }
    const [sid, sec] = app.treePath;
    if (!sid) return { rows: lib.sourceList().map((s) => ({ key: s.id, label: s.title, cards: sourceCards(lib, s.id) })), cards: [], scope: "all" };
    if (!meta) return { rows: [], cards: [], scope: `src:${sid}` };
    const secs = sections(sid, meta);
    if (sec === undefined) return { rows: [...secs].map(([k, cs]) => ({ key: k, label: k, cards: cs })), cards: [], scope: `src:${sid}` };
    return { rows: [], cards: secs.get(sec) ?? [], scope: `src:${sid}` };
  });

  const crumbLabel = (i: number, name: string) => (app.treeKind === "books" && i === 0 ? app.lib?.source(name)?.title ?? name : name);

  function setKind(k: "topics" | "books") { app.treeKind = k; app.treePath = []; }
  function open(key: string) { app.treePath = [...app.treePath, key]; }
</script>

<div class="screen" data-testid="tree">
  <div class="topbar">
    <span class="title">Topics</span>
    <div class="seg" role="group" aria-label="Tree kind">
      <button type="button" aria-pressed={app.treeKind === "topics"} data-testid="kind-topics" onclick={() => setKind("topics")}>Topics</button>
      <button type="button" aria-pressed={app.treeKind === "books"} data-testid="kind-books" onclick={() => setKind("books")}>Books</button>
    </div>
    <SearchButton />
  </div>
  <nav class="crumbs" aria-label="Where you are" data-testid="crumbs">
    <button type="button" onclick={() => (app.treePath = [])}>All</button>
    {#each app.treePath as p, i (i)}
      <span>›</span><button type="button" onclick={() => (app.treePath = app.treePath.slice(0, i + 1))}>{crumbLabel(i, p)}</button>
    {/each}
  </nav>
  <div class="plist" data-testid="tree-list">
    {#each view.rows as r (r.key)}
      {@const pct = readShare(r.cards, vw)}
      <button type="button" class="row-i" data-node={r.key} onclick={() => open(r.key)}>
        <b>{r.label} ›</b>
        <span class="m">{r.cards.length} cards · {pct}% read</span>
        <div class="meter"><i style="width:{pct}%"></i></div>
      </button>
    {/each}
    {#each view.cards as c (c.id)}
      {@const v = app.view(c)}
      <button type="button" class="row-i" data-open={c.id} onclick={() => router.go("feed", [], { scope: view.scope, card: c.id })}>
        <span class="head"><b>{c.title}</b><Chips view={v} /></span>
        {#if c.what}<span class="m">{c.what}</span>{/if}
      </button>
    {/each}
    {#if app.treeKind === "books" && app.treePath.length === 1 && !meta}<p class="small">Loading the table of contents…</p>{/if}
    {#if !view.rows.length && !view.cards.length && (app.treeKind === "topics" || meta)}<p class="empty">Nothing here.</p>{/if}
  </div>
</div>

<style>
  .head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
</style>
