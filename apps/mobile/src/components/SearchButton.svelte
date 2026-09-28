<script lang="ts">
  import { router } from "../lib/router.svelte.ts";
</script>

<button type="button" class="iconbtn" aria-label="Search" data-testid="search-btn" onclick={() => router.go("search")}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
</button>
