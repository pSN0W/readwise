<script lang="ts" module>
  // One IntersectionObserver per scroll pane: a card mounts when it comes within ~2 screens.
  const observers = new WeakMap<Element, IntersectionObserver>();
  const callbacks = new WeakMap<Element, () => void>();
  function observe(root: HTMLElement | undefined, el: Element, cb: () => void): () => void {
    const key = root ?? document.documentElement;
    let io = observers.get(key);
    if (!io) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { callbacks.get(e.target)?.(); }
      }, { root: root ?? null, rootMargin: "1600px 0px" });
      observers.set(key, io);
    }
    callbacks.set(el, cb);
    io.observe(el);
    return () => { io.unobserve(el); callbacks.delete(el); };
  }
</script>

<script lang="ts">
  // A W2 card that renders as a light placeholder until it is near the viewport.
  import type { Card } from "@rh/core";
  import CardView from "./Card.svelte";

  let { card, current = false, sourceId = "", root }: { card: Card; current?: boolean; sourceId?: string; root?: HTMLElement } = $props();
  let shown = $state(false);
  let ph: HTMLElement | undefined = $state();
  const est = $derived(96 + Math.ceil(((card.what?.length ?? 0) + (card.why?.length ?? 0) + (card.how?.length ?? 0) + (card.when?.length ?? 0) + (card.extra?.length ?? 0)) / 60) * 20 + (card.images.length ? 230 : 0));

  $effect(() => {
    if (current) shown = true;
  });
  $effect(() => {
    if (shown || !ph) return;
    return observe(root, ph, () => { shown = true; });
  });
</script>

{#if shown}
  <CardView {card} mode="reader" {current} {sourceId} />
{:else}
  <div class="rcard ph" data-id={card.id} bind:this={ph} style="height:{est}px"><b>{card.title}</b></div>
{/if}

<style>
  .ph{flex:none;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-family:var(--serif);font-size:1.05rem;color:var(--muted)}
</style>
