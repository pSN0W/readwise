<script lang="ts">
  // Status chip + my tags for a card in a list row (Books › Cards, shelves).
  import { tagColor, type CardView } from "@rh/core";
  import Chips from "./Chips.svelte";

  let { view }: { view: CardView } = $props();
</script>

<span class="badges">
  <Chips {view} />
  {#each view.tags as t (t)}<span class="ptag" style="--tc: {tagColor(t)}">#{t}</span>{/each}
</span>

<style>
  .badges { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; }
</style>
