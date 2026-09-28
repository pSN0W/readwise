<script lang="ts">
  import type { CardView } from "@rh/core";
  let { view }: { view: CardView } = $props();
  const label = { new: "New", viewed: "Viewed", explored: "Explored" } as const;
</script>

<span class="chips" data-testid="chips">
  {#if view.updated}<span class="st updated">Updated</span>{/if}
  <span class="st {view.status}" data-testid="state-chip">{label[view.status]}</span>
</span>
