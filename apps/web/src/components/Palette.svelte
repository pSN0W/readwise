<script lang="ts">
  // W14 Command palette (Ctrl+K): core searchAll over sources, cards, topics + my tags.
  import { searchAll, normalizeTag } from "@rh/core";
  import { app, kindIcon, topicLabel } from "../lib/app.svelte.ts";
  import { router, readHref } from "../lib/router.svelte.ts";

  let q = $state("");
  let sel = $state(0);
  let input: HTMLInputElement | undefined = $state();

  interface Item { kind: string; label: string; sub: string; href: string }
  const items = $derived.by((): Item[] => {
    const lib = app.lib;
    if (!lib) return [];
    const out: Item[] = [];
    const tq = normalizeTag(q);
    for (const t of app.myTags()) if (tq && t.includes(tq)) out.push({ kind: "my tag", label: "#" + t, sub: `${app.st?.cardsWithTag(t).length ?? 0} cards`, href: `#/board?tag=${encodeURIComponent(t)}` });
    for (const h of searchAll(lib, q, 30)) {
      if (h.kind === "source") out.push({ kind: "source", label: h.source.title, sub: kindIcon(h.source.kind), href: readHref(h.source.id) });
      else if (h.kind === "card") { const r = h.card.refs[0]; out.push({ kind: "card", label: h.card.title, sub: app.sourceTitle(r.source), href: readHref(r.source, r.start, h.card.id) }); }
      else out.push({ kind: "topic", label: topicLabel(h.path), sub: "focus on this topic", href: `#/focus?scope=${encodeURIComponent("topic:" + h.path)}` });
    }
    return out.slice(0, 40);
  });
  $effect(() => { void q; sel = 0; });
  $effect(() => { input?.focus(); });

  function open(it: Item | undefined) {
    if (!it) return;
    app.paletteOpen = false;
    router.go(it.href);
  }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); e.preventDefault(); }
    else if (e.key === "Enter") { open(items[sel]); e.preventDefault(); }
    else if (e.key === "Escape") { app.paletteOpen = false; e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { app.paletteOpen = false; e.preventDefault(); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => { if (e.target === e.currentTarget) app.paletteOpen = false; }}>
  <div class="pal" role="dialog" aria-label="Command palette" aria-modal="true">
    <input bind:this={input} bind:value={q} onkeydown={key} placeholder="Type a card, topic, source or #tag…" aria-label="Search everything" />
    <div class="list" role="listbox">
      {#each items as it, i (it.kind + it.href)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="item" class:on={i === sel} role="option" tabindex="-1" aria-selected={i === sel} onmousemove={() => { if (sel !== i) sel = i; }} onclick={() => open(it)}>
          <span class="l">{it.label}</span><span class="small">{it.kind} · {it.sub}</span>
        </div>
      {:else}
        <p class="small" style="padding:10px">Nothing found.</p>
      {/each}
    </div>
    <div class="foot small"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div>
  </div>
</div>

<style>
  .pal{width:580px;max-width:92vw;background:var(--paper);border-radius:10px;border:1px solid var(--line);box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:70vh}
  input{font:inherit;border:0;border-bottom:1px solid var(--line);border-radius:10px 10px 0 0;padding:14px;font-size:1rem;background:var(--paper);color:var(--ink);outline:none}
  .list{overflow-y:auto;padding:6px}
  .item{padding:8px 10px;border-radius:6px;display:flex;justify-content:space-between;gap:10px;cursor:pointer}
  .item.on{background:var(--accent-soft)}
  .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .item .small{white-space:nowrap}
  .foot{padding:6px 12px;border-top:1px solid var(--line);display:flex;gap:4px;align-items:center}
</style>
