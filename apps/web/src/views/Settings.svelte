<script lang="ts">
  // Settings: copy prompt, device id, my tags, theme.
  import { DEFAULT_COPY_PROMPT, tagColor } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { applyTheme, prefs, type Theme } from "../lib/prefs.ts";

  let prompt = $state(app.st?.copyPrompt() ?? DEFAULT_COPY_PROMPT);
  let device = $state(app.deviceId);
  let fresh = $state("");
  let theme = $state<Theme>(prefs.theme());

  function savePrompt() { app.st?.setCopyPrompt(prompt); app.toast("Copy prompt saved"); }
  async function saveDevice(e: Event) {
    e.preventDefault();
    const d = device.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(d)) { app.toast("Use lowercase letters, digits and dashes"); return; }
    await app.setDeviceId(d);
    app.toast(`This browser now writes state/${d}.json`);
  }
  function addTag(e: Event) {
    e.preventDefault();
    const t = app.createTag(fresh);
    if (t) app.toast(`Created #${t}`);
    fresh = "";
  }
  function setTheme(t: Theme) { theme = t; prefs.setTheme(t); applyTheme(t); }
</script>

<div class="view">
  <div class="col ground wrap" data-keep-scroll="settings">
    <section class="box">
      <h3>Copy prompt</h3>
      <p class="small">Goes first when you copy a card for a deep dive. Then the card, then all its source lines.</p>
      <textarea class="inp" rows="5" bind:value={prompt} aria-label="Copy prompt"></textarea>
      <div class="row">
        <button class="btn primary" type="button" onclick={savePrompt}>Save prompt</button>
        <button class="btn" type="button" onclick={() => (prompt = DEFAULT_COPY_PROMPT)}>Reset to default</button>
      </div>
    </section>
    <section class="box">
      <h3>Device id</h3>
      <p class="small">This browser writes only <span class="mono">state/{app.deviceId}.json</span>. Other devices keep their own files.</p>
      <form class="row" onsubmit={saveDevice}>
        <input class="inp" style="max-width:240px" bind:value={device} aria-label="Device id" />
        <button class="btn" type="submit" disabled={device === app.deviceId}>Save</button>
      </form>
    </section>
    <section class="box">
      <h3>My tags</h3>
      <p class="small">Personal. Stored in your device file. Never sent to a model.</p>
      <div class="tags">
        {#each app.myTags() as t (t)}
          <span class="ptag" style="--tc: {tagColor(t)}">#{t} <button type="button" class="x" aria-label="Delete #{t}" onclick={() => app.st?.deleteTag(t)}>×</button></span>
        {/each}
      </div>
      <form class="row" onsubmit={addTag}>
        <input class="inp" style="max-width:240px" placeholder="new tag" bind:value={fresh} aria-label="New tag" />
        <button class="btn" type="submit" disabled={!fresh.trim()}>Create tag</button>
      </form>
    </section>
    <section class="box">
      <h3>Look</h3>
      <div class="row" role="radiogroup" aria-label="Theme">
        {#each ["system", "light", "dark"] as t (t)}
          <label><input type="radio" name="theme" checked={theme === t} onchange={() => setTheme(t as Theme)} /> {t === "system" ? "Same as system" : t === "light" ? "Light" : "Dark"}</label>
        {/each}
      </div>
    </section>
    <section class="box">
      <h3>Library</h3>
      <p class="small">Generation {app.lib?.generation} · {app.lib?.sourceList().length} sources · {app.lib?.cards.size} cards. The app checks for new cards every {Math.round(prefs.pollMs() / 1000)} s.</p>
    </section>
  </div>
</div>

<style>
  .wrap{padding:20px;gap:14px;align-items:stretch;border:0}
  .box{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;max-width:720px;width:100%;margin:0 auto}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .row label{font-size:.85rem;display:flex;gap:4px;align-items:center}
  .tags{display:flex;gap:6px;flex-wrap:wrap}
  .x{background:none;border:0;cursor:pointer;color:inherit;padding:0 0 0 2px;font-size:.9rem;line-height:1}
</style>
