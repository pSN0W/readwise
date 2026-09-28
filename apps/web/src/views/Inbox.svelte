<script lang="ts">
  // W11 Tag inbox: topics the model suggested. Accept / Rename / Reject, or tick several and Combine.
  // Decisions go to this device's state file (st.decideTopic) and show as applied at once.
  import type { TopicAction } from "@rh/core";
  import { app, cleanTopicPath, topicLabel } from "../lib/app.svelte.ts";

  const lib = $derived(app.lib!);
  const decisions = $derived.by(() => { void app.tick; return app.st?.topicDecisions() ?? {}; });
  const open = $derived(lib.suggestions.filter((s) => !decisions[s.id]));
  let ticked = $state<Record<string, boolean>>({});
  let renaming = $state<Record<string, string>>({});
  let into = $state("");

  function decide(id: string, action: TopicAction, path?: string) {
    app.st?.decideTopic(id, action, path);
  }
  function saveRename(id: string) {
    const p = cleanTopicPath(renaming[id] ?? "");
    if (!p) { app.toast("Use 1 to 3 levels, like ML/Interpretability/Features"); return; }
    decide(id, "rename", p);
    delete renaming[id];
    app.toast(`Renamed to ${topicLabel(p)}`);
  }
  function combine() {
    const ids = Object.keys(ticked).filter((k) => ticked[k] && !decisions[k]);
    if (!ids.length) { app.toast("Tick at least one suggestion first"); return; }
    const p = cleanTopicPath(into);
    if (!p) { app.toast("Type the topic to combine into, like ML/Interpretability/Features"); return; }
    for (const id of ids) decide(id, "combine", p);
    ticked = {};
    app.toast(`Combined ${ids.length} into ${topicLabel(p)}`);
  }
  function describe(d: { action: TopicAction; path?: string }): string {
    if (d.action === "accept") return "Accepted";
    if (d.action === "reject") return "Rejected";
    if (d.action === "rename") return `Renamed to ${topicLabel(d.path ?? "")}`;
    return `Combined into ${topicLabel(d.path ?? "")}`;
  }
</script>

<div class="view">
  <div class="toolbar">
    <span class="small">{open.length} waiting · The model suggested these while writing cards. Your choice shows at once; the GPU machine makes it permanent on its next run.</span>
  </div>
  <div class="col ground list" data-keep-scroll="inbox">
    {#each lib.suggestions as s (s.id)}
      {@const d = decisions[s.id]}
      <div class="sugg" class:done={!!d} data-sug={s.id}>
        <input type="checkbox" aria-label="Select {s.path}" disabled={!!d} bind:checked={ticked[s.id]} />
        <div class="body">
          {#if renaming[s.id] !== undefined}
            <form class="ren" onsubmit={(e) => { e.preventDefault(); saveRename(s.id); }}>
              <input class="inp" bind:value={renaming[s.id]} aria-label="New name" />
              <button class="btn primary" type="submit">Save</button>
              <button class="btn" type="button" onclick={() => delete renaming[s.id]}>Cancel</button>
            </form>
          {:else}
            <div class="p">{topicLabel(s.path)}</div>
          {/if}
          <div class="small">
            {s.reason ?? ""}{#if s.similar_existing}{" "}· close to <span class="mono">{topicLabel(s.similar_existing)}</span>{/if}
          </div>
          <div class="cards">
            {#each s.card_ids as id (id)}
              {@const c = lib.cards.get(id)}
              {#if c}
                <a class="src" href="#/focus?card={c.id}" title={app.topicsOf(c).map((t) => topicLabel(t)).join("\n")}>{c.title}</a>
                <span class="small applied">{app.topicsOf(c).map((t) => topicLabel(t, 1)).join(" · ")}</span>
              {/if}
            {/each}
          </div>
          {#if d}<div class="status" data-decision={d.action}><b>{describe(d)}</b></div>{/if}
        </div>
        <div class="btnrow">
          {#if !d}
            <button type="button" class="btn" onclick={() => { decide(s.id, "accept"); app.toast("Accepted"); }}>Accept</button>
            <button type="button" class="btn" onclick={() => (renaming[s.id] = s.path)}>Rename</button>
            <button type="button" class="btn" onclick={() => decide(s.id, "reject")}>Reject</button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="empty">No suggestions. The model has not proposed new topics.</p>
    {/each}
    <form class="sendbar" onsubmit={(e) => { e.preventDefault(); combine(); }}>
      <span class="small">Combine the ticked suggestions into:</span>
      <input class="inp" style="max-width:340px" bind:value={into} placeholder="ML/Interpretability/Features" aria-label="Combine into" />
      <button class="btn primary" type="submit">Combine</button>
    </form>
  </div>
</div>

<style>
  .list{padding:18px;gap:10px;border:0}
  .sugg{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--paper)}
  .sugg.done{opacity:.65}
  .body{display:flex;flex-direction:column;gap:4px;min-width:0}
  .p{font-family:var(--mono);font-size:.84rem}
  .cards{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}
  .applied{font-family:var(--mono);font-size:.62rem}
  .status{font-size:.8rem;color:var(--good)}
  .ren{display:flex;gap:6px}
  .btnrow{display:flex;gap:6px}
  .sendbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--accent-soft);border-radius:6px;padding:12px 14px}
</style>
