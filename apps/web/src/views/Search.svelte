<script lang="ts">
  // Resource search: results as you type (core searchSources). Enter / click opens W2.
  import { searchSources } from "@rh/core";
  import { app, fs, kindIcon } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";

  let { sel = $bindable(0) }: { sel?: number } = $props();
  const lib = $derived(app.lib!);
  const hits = $derived.by(() => {
    const t0 = performance.now();
    const h = searchSources(lib, app.searchQuery, 200);
    const w = window as unknown as { __rhPerf: Record<string, number> };
    (w.__rhPerf ??= {}).searchMs = performance.now() - t0;
    return h;
  });
  $effect(() => { void app.searchQuery; sel = 0; });

  let links = $state("");
  let busy = $state(false);
  let over = $state(false);

  async function upload(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    busy = true;
    try {
      const saved = await fs.upload([...files]);
      app.toast(`Saved to inbox: ${saved.join(", ")}`);
    } catch (e) { app.toast("Upload failed: " + (e as Error).message); } finally { busy = false; }
  }
  async function addLinks(e: Event) {
    e.preventDefault();
    try {
      const n = await fs.addLinks(links);
      app.toast(`Added ${n} link${n === 1 ? "" : "s"} to inbox/links.txt`);
      links = "";
    } catch (err) { app.toast("Not added: " + (err as Error).message); }
  }
  function origin(s: (typeof hits)[number]["source"]): string {
    return s.origin.url ?? s.origin.filename ?? "";
  }
</script>

<div class="view">
  <div class="toolbar">
    <b>Sources</b>
    <span class="small">{hits.length} {app.searchQuery ? "found" : "in the library, newest first"} · type in the search box at the top · Enter opens the reader</span>
  </div>
  <div class="cols" style="grid-template-columns:minmax(0,1fr) 320px">
    <div class="col ground" role="listbox" aria-label="Search results">
      {#each hits as h, i (h.source.id)}
        {@const s = h.source}
        <a class="hit" class:on={i === sel} href="#/read/{encodeURIComponent(s.id)}" role="option" aria-selected={i === sel} data-sid={s.id}
          onmouseenter={() => (sel = i)}>
          <span class="kind">{kindIcon(s.kind)}</span>
          <span class="main">
            <b class="title">{s.title}</b>
            <span class="small">{(s.authors ?? []).join(", ")}{s.authors?.length ? " · " : ""}<span class="mono">{origin(s)}</span></span>
          </span>
          <span class="nums small">{s.n_cards} cards · {app.readPct(s.id)}% read{s.status !== "ready" ? " · " + s.status : ""}</span>
        </a>
      {:else}
        <p class="empty">No source matches “{app.searchQuery}”.</p>
      {/each}
    </div>
    <div class="col">
      <h5>Add a source</h5>
      <p class="small">The GPU machine picks up new files and links from <span class="mono">inbox/</span>.</p>
      <label class="drop" class:over ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)}
        ondrop={(e) => { e.preventDefault(); over = false; void upload(e.dataTransfer?.files ?? null); }}>
        <input type="file" multiple onchange={(e) => upload((e.target as HTMLInputElement).files)} disabled={busy} />
        <span>{busy ? "Uploading…" : "Drop a PDF or file here, or click to pick"}</span>
      </label>
      <form onsubmit={addLinks} class="links">
        <textarea class="inp" bind:value={links} placeholder="https://… (one link per line)" aria-label="Links to add"></textarea>
        <button class="btn primary" type="submit" disabled={!links.trim()}>Add links</button>
      </form>
    </div>
  </div>
</div>

<style>
  .hit{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:10px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:9px 12px;color:inherit;text-decoration:none}
  .hit.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .hit .kind{text-align:center}
  .main{display:flex;flex-direction:column;min-width:0}
  .main .small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .title{font-family:var(--serif);font-size:1.02rem}
  .nums{white-space:nowrap}
  .drop{display:block;border:2px dashed var(--line);border-radius:8px;padding:18px 12px;text-align:center;font-size:.85rem;color:var(--muted);cursor:pointer;position:relative}
  .drop.over{border-color:var(--accent);color:var(--accent)}
  .drop input{position:absolute;inset:0;opacity:0;cursor:pointer}
  .links{display:flex;flex-direction:column;gap:6px;margin-top:8px}
</style>
