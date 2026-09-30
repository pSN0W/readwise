<script lang="ts">
  // P7 My shelf: my tags as shelves, my notes, the copy prompt, settings. Nothing here goes to a model.
  import { DEFAULT_COPY_PROMPT, type Card } from "@rh/core";
  import { app } from "../lib/app.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { allFilesGranted, needsAllFiles, openAllFilesSettings, pickFolder } from "../lib/platform.ts";
  import SearchButton from "../components/SearchButton.svelte";

  const page = $derived(router.route.parts[0] ?? "");
  const tagName = $derived(page === "tag" ? router.route.parts[1] ?? "" : "");

  const tags = $derived.by(() => {
    app.v;
    const st = app.st;
    return st ? st.myTags().map((t) => ({ t, n: st.cardsWithTag(t).filter((id) => app.lib?.cards.has(id)).length })) : [];
  });
  const tagCards = $derived.by((): Card[] => {
    app.v;
    if (!tagName || !app.st || !app.lib) return [];
    return app.st.cardsWithTag(tagName).map((id) => app.lib!.cards.get(id)).filter((c): c is Card => !!c);
  });

  let newTag = $state("");
  let prompt = $state("");
  let deviceId = $state(app.deviceId);
  let libPath = $state(app.libraryPath);
  let testMsg = $state<string | null>(null);
  $effect(() => { app.lib; prompt = app.st?.copyPrompt() ?? DEFAULT_COPY_PROMPT; });

  let notes = $state<{ id: string; title: string; text: string }[]>([]);
  $effect(() => {
    if (page !== "notes") return;
    const ids = [...app.noteIds];
    void Promise.all(ids.map(async (id) => ({ id, title: app.lib?.cards.get(id)?.title ?? `${id} (card not found)`, text: (await app.readNote(id)).trim() })))
      .then((n) => (notes = n.filter((x) => x.text)));
  });
  const conflicts = $derived(Object.entries(app.noteConflicts));

  function createTag() {
    const t = newTag.trim();
    if (!t || !app.st) return;
    const name = app.st.createTag(t);
    newTag = "";
    app.toast(`Created #${name}`);
  }
  function deleteTag(t: string) {
    if (!confirm(`Delete #${t}? Cards keep it until you untick it.`)) return;
    app.st?.deleteTag(t);
  }
  function savePrompt() {
    app.st?.setCopyPrompt(prompt);
    app.toast("Copy prompt saved");
  }
  async function saveDevice() {
    const id = deviceId.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id)) { app.toast("Use lowercase letters, digits and dashes"); return; }
    await app.st?.flush();
    app.setDeviceId(id);
    await app.open();
    app.toast(`Device id: ${id}`);
  }
  async function testPath() {
    testMsg = "Testing…";
    const granted = await allFilesGranted();
    if (granted === false) { testMsg = "No All files access yet. Open the setting first."; return; }
    const text = await app.makeFS(libPath.trim()).readText("library.json");
    testMsg = text ? "OK. library.json found." : "library.json not found in this folder.";
  }
  async function choosePath() {
    try {
      const p = await pickFolder();
      if (!p) return;
      libPath = p;
      await testPath();
    } catch (e) {
      testMsg = (e as Error).message;
    }
  }
  async function usePath() {
    app.setLibraryPath(libPath.trim());
    await app.open();
    if (!app.error) app.toast("Library folder saved");
  }
</script>

<div class="screen" data-testid="shelf">
  <div class="topbar">
    {#if page}<button type="button" class="navbtn" onclick={() => router.go("shelf")}>‹ Shelf</button>{/if}
    <span class="title">{page === "tag" ? `#${tagName}` : page === "notes" ? "My notes" : page === "settings" ? "Settings" : "My shelf"}</span>
    {#if !page}<span class="small">device only</span>{/if}
    <SearchButton />
  </div>
  <div class="plist">
    {#if page === "tag"}
      {#each tagCards as c (c.id)}
        <button type="button" class="row-i" data-open={c.id} onclick={() => router.go("feed", [], { scope: "all", card: c.id })}><b>{c.title}</b>{#if c.what}<span class="m">{c.what}</span>{/if}</button>
      {:else}
        <p class="empty">No cards yet. Use the tag menu at the top of a card.</p>
      {/each}
    {:else if page === "notes"}
      {#each notes as n (n.id)}
        <button type="button" class="row-i" data-open={n.id} onclick={() => router.go("feed", [], { scope: "all", card: n.id })}><b>{n.title}</b><span class="m">✎ {n.text}</span></button>
      {:else}
        <p class="empty">No notes yet. Tap a card in the Feed to write one.</p>
      {/each}
      {#each conflicts as [id, paths] (id)}
        <div class="row-i conflict"><b>Sync conflict · {app.lib?.cards.get(id)?.title ?? id}</b>{#each paths as p (p)}<span class="m">{p}</span>{/each}<span class="m">Open the card's note to compare. Delete the copy in your file manager when done.</span></div>
      {/each}
    {:else if page === "settings"}
      <div class="row-i static">
        <b>Device id</b>
        <span class="m">This phone writes only <code>state/{app.deviceId}.json</code>.</span>
        <div class="line"><input class="inp" aria-label="Device id" bind:value={deviceId} /><button type="button" class="btn" onclick={saveDevice}>Save</button></div>
      </div>
      <div class="row-i static">
        <b>Library folder</b>
        {#if app.native}
          <span class="m">The synced folder with library.json.</span>
          {#if needsAllFiles()}
            <input class="inp" aria-label="Library folder" bind:value={libPath} />
          {:else}
            <span class="m"><code>{libPath}</code></span>
          {/if}
          <div class="line"><button type="button" class="btn" onclick={choosePath}>Choose folder…</button>{#if needsAllFiles()}<button type="button" class="btn" onclick={testPath}>Test</button>{/if}<button type="button" class="btn primary" onclick={usePath}>Use this folder</button>{#if needsAllFiles()}<button type="button" class="btn" onclick={openAllFilesSettings}>All files access…</button>{/if}</div>
          {#if testMsg}<span class="m">{testMsg}</span>{/if}
        {:else}
          <span class="m">Browser dev mode: the dev server's scratch folder (<code>apps/mobile/.scratch/…</code>).</span>
        {/if}
      </div>
      <div class="row-i static"><b>Library</b><span class="m">Generation {app.lib?.generation} · {app.lib?.cards.size} cards · {app.lib?.sourceList().length} sources</span>
        <div class="line"><button type="button" class="btn" onclick={() => app.reload()}>Reload now</button></div></div>
    {:else}
      <div class="section-h">My tags</div>
      {#each tags as { t, n } (t)}
        <div class="tagline">
          <button type="button" class="row-i" data-shelf={t} onclick={() => router.go("shelf", ["tag", t])}><b>#{t}</b><span class="m">{n} card{n === 1 ? "" : "s"}</span></button>
          <button type="button" class="iconbtn del" aria-label={`Delete #${t}`} onclick={() => deleteTag(t)}>×</button>
        </div>
      {/each}
      <form class="line" onsubmit={(e) => { e.preventDefault(); createTag(); }}>
        <input class="inp" placeholder="new tag" aria-label="New tag" bind:value={newTag} /><button type="submit" class="btn">Create</button>
      </form>
      <div class="section-h">Notes</div>
      <button type="button" class="row-i" data-testid="my-notes" onclick={() => router.go("shelf", ["notes"])}><b>✎ My notes</b><span class="m">{app.noteIds.size} note{app.noteIds.size === 1 ? "" : "s"}{conflicts.length ? ` · ${conflicts.length} sync conflict${conflicts.length === 1 ? "" : "s"}` : ""}</span></button>
      <div class="section-h">Copy prompt</div>
      <div class="row-i static">
        <span class="m">Used by drag ←. Goes to your clipboard with the card and its source lines.</span>
        <textarea class="inp" rows="5" aria-label="Copy prompt" bind:value={prompt} data-testid="prompt"></textarea>
        <div class="line"><button type="button" class="btn primary" onclick={savePrompt}>Save</button><button type="button" class="btn" onclick={() => (prompt = DEFAULT_COPY_PROMPT)}>Default</button></div>
      </div>
      <div class="section-h">App</div>
      <button type="button" class="row-i" onclick={() => router.go("shelf", ["settings"])}><b>Settings</b><span class="m">Device id · library folder</span></button>
    {/if}
  </div>
</div>

<style>
  .static { cursor: default; gap: 6px; }
  .line { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .line .inp { flex: 1; min-width: 140px; }
  .tagline { display: flex; gap: 4px; align-items: stretch; }
  .del { font-size: 1.3rem; color: var(--muted); border: 1px solid var(--line); background: var(--paper); }
  .conflict { border-color: var(--rule-red); cursor: default; }
  textarea { resize: vertical; }
</style>
