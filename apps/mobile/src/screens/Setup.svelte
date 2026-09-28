<script lang="ts">
  // First run on the phone: pick the library folder and grant "All files access".
  import { app } from "../lib/app.svelte.ts";
  import { allFilesGranted, openAllFilesSettings } from "../lib/platform.ts";

  let path = $state(app.libraryPath);
  let granted = $state<boolean | null>(null);
  let msg = $state<string | null>(null);

  async function check() { granted = await allFilesGranted(); }
  $effect(() => { void check(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });

  async function test() {
    msg = "Testing…";
    await check();
    const text = await app.makeFS(path.trim()).readText("library.json");
    msg = text ? "OK. library.json found." : granted === false ? "Cannot read files yet. Allow All files access first." : "library.json not found in this folder.";
  }
  async function use() {
    app.setLibraryPath(path.trim());
    await app.open();
  }
</script>

<div class="setup">
  <h1>Reading helper</h1>
  <p>This app reads your library folder on this phone. It works offline and never calls a model.</p>

  <section class:ok={granted === true}>
    <h2>1 · All files access</h2>
    {#if granted === true}
      <p>Allowed.</p>
    {:else}
      <p>The library lives in a normal folder (Syncthing). Android asks you to allow "All files access" for that.</p>
      <button type="button" class="btn primary" onclick={openAllFilesSettings}>Open the setting</button>
      <p class="small">Turn on "Allow access to manage all files", then come back.</p>
    {/if}
  </section>

  <section>
    <h2>2 · Library folder</h2>
    <p class="small">The folder that has <code>library.json</code>.</p>
    <input class="inp" aria-label="Library folder" bind:value={path} />
    <div class="row">
      <button type="button" class="btn" onclick={test}>Test</button>
      <button type="button" class="btn primary" onclick={use}>Use this folder</button>
    </div>
    {#if msg}<p class="small">{msg}</p>{/if}
    {#if app.error}<p class="err">{app.error}</p>{/if}
  </section>
</div>

<style>
  .setup { padding: 24px 16px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; height: 100%; }
  h1 { font-size: 1.8rem; }
  h2 { font-size: 1.1rem; margin-bottom: 6px; }
  section { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  section.ok { border-color: var(--good); }
  .row { display: flex; gap: 8px; }
  .err { color: var(--rule-red); font-size: .9rem; }
</style>
