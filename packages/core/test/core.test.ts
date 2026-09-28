import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Library, StateStore, MemoryFS, mergeStates, viewOf, searchSources, searchAll, buildDeepDivePrompt,
  coverage, topicTree, topicsWithDecisions, openSuggestions, cardIdsUnder, toBlocks, pageOf, timeOf,
  rangeLabel, lineAtTime, readNote, readNotes, retiredInto, writeNote, listNotes, cardFields, normalizeTag,
} from "../src/index.ts";
import { NodeFS } from "./node-fs.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/library");

async function tempLibrary(): Promise<NodeFS> {
  const dir = await mkdtemp(join(tmpdir(), "rh-core-"));
  await cp(FIXTURE, dir, { recursive: true });
  return new NodeFS(dir);
}

test("opens the fixture and indexes cards and sources", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  assert.equal(lib.sourceList().length, 4);
  assert.equal(lib.cards.size, 13);
  assert.deepEqual(lib.resolveId("c_0099"), ["c_0005"]);
  assert.deepEqual(lib.cardsInSource("s_videoc").map((c) => c.title),
    ["Attention as lookup", "Superposition", "Sparse autoencoder", "Induction head"]);
  assert.equal(lib.cardsInTopic("ML/Interpretability").length, 9);
});

test("slices lines from content.md without copies", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const c = lib.cards.get("c_0003")!;
  const r = c.refs[0];
  const lines = await lib.lines(r.source, r.start, r.end);
  assert.equal(lines.length, r.end - r.start + 1);
  assert.ok(lines.some((l) => l.includes("more than $n$ features")));
  assert.ok(lines.some((l) => l.startsWith("![Figure 3")));
});

test("range reads: same lines as a full read, far fewer bytes", async () => {
  const fs = new NodeFS(FIXTURE);
  const lib = await Library.open(fs);
  const full = await Library.open({ ...fs, readText: fs.readText.bind(fs), writeText: fs.writeText.bind(fs), list: fs.list.bind(fs), url: fs.url.bind(fs) });
  for (const c of lib.cards.values()) {
    for (const r of c.refs) {
      const a = await lib.lines(r.source, r.start, r.end);
      const b = (await full.allLines(r.source)).slice(r.start - 1, r.end);
      assert.deepEqual(a, b, `${c.id} ${r.source}`);
    }
  }
  assert.ok(fs.rangeBytes > 0);
  const m = await lib.meta("s_booka");
  const before = fs.rangeBytes;
  await lib.lines("s_booka", 520, 530);
  assert.ok(fs.rangeBytes - before < m.content_bytes / 2, "read only part of the file");
  assert.deepEqual(await lib.lines("s_booka", 1, 1), ["# Interpretability Notes"]);
  const last = m.n_lines;
  assert.equal((await lib.lines("s_booka", last - 1, last + 50)).length, 2);
});

test("meta() does not load content.md", async () => {
  let contentReads = 0;
  const base = new NodeFS(FIXTURE);
  const fs = { readText: async (p: string) => { if (p.endsWith("content.md")) contentReads++; return base.readText(p); },
    writeText: base.writeText.bind(base), list: base.list.bind(base), url: base.url.bind(base) };
  const lib = await Library.open(fs);
  const m = await lib.meta("s_booka");
  assert.equal(contentReads, 0);
  assert.equal(m.anchors[0][0], 1);
});

test("page and time lookups", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const a = await lib.meta("s_booka");
  assert.equal(pageOf(a, 1), 1);
  assert.equal(pageOf(a, 40), 1);
  assert.equal(pageOf(a, 41), 2);
  assert.match(rangeLabel(a, 37, 89), /^lines 37–89, p\. 1–3$/);
  const v = await lib.meta("s_videoc");
  const sae = lib.cards.get("c_0005")!.refs.find((x) => x.source === "s_videoc")!;
  assert.equal(timeOf(v, sae.start), 1080);
  assert.match(rangeLabel(v, sae.start, sae.end), /^18:00–2\d:\d\d$/);
  assert.equal(lineAtTime(v, 1080), sae.start);
});

test("merge rules across devices", () => {
  const m = mergeStates([
    { schema_version: 1, device_id: "a", updated_at: 1, cards: {
      c_1: { viewed: { rev: 1, ts: 10 }, tags: { v: ["x"], ts: 5 }, explored: { ts: 50 }, known: { v: true, ts: 1 } } } },
    { schema_version: 1, device_id: "b", updated_at: 2, cards: {
      c_1: { viewed: { rev: 2, ts: 3 }, tags: { v: ["y"], ts: 9 }, explored: { ts: 20 }, known: { v: false, ts: 2 } } } },
  ]);
  const e = m.cards.c_1;
  assert.deepEqual(e.viewed, { rev: 2, ts: 3 });
  assert.deepEqual(e.tags!.v, ["y"]);
  assert.equal(e.explored!.ts, 20);
  assert.equal(e.known!.v, false);
});

test("derived view: new, viewed, explored, known, updated", async () => {
  const fs = await tempLibrary();
  const lib = await Library.open(fs);
  const st = await StateStore.open(fs, "test-device", { resolveId: (id) => lib.resolveId(id), debounceMs: 5 });
  const c5 = lib.cards.get("c_0005")!; // rev 2, viewed at rev 1 on pixel-8
  const v = st.view(c5);
  assert.equal(v.status, "viewed");
  assert.equal(v.updated, true);
  assert.deepEqual(v.tags, ["revisit", "confusing"]); // laptop-web wrote later
  assert.equal(st.view(lib.cards.get("c_0001")!).known, true);
  assert.equal(st.view(lib.cards.get("c_0004")!).status, "new");
  st.markViewed(c5);
  assert.equal(st.view(c5).updated, false);
  st.markExplored(lib.cards.get("c_0004")!);
  assert.equal(st.view(lib.cards.get("c_0004")!).status, "explored");
  st.toggleTag("c_0004", "#Revisit");
  assert.deepEqual(st.view(lib.cards.get("c_0004")!).tags, ["revisit"]);
  st.createTag("Needs Math");
  assert.ok(st.myTags().includes("needs math"));
  st.setSplit("c_0003", true);
  st.decideTopic("t_0001", "accept");
  await st.flush();
  const again = await StateStore.open(fs, "test-device");
  assert.equal(again.view(lib.cards.get("c_0004")!).status, "explored");
  assert.equal(again.view(lib.cards.get("c_0003")!).split, true);
  assert.equal(again.topicDecisions().t_0001.action, "accept");
  assert.ok((await fs.list("state")).includes("test-device.json"));
});

test("retired ids migrate to new ids", async () => {
  const fs = new MemoryFS();
  await fs.writeText("state/me.json", JSON.stringify({ schema_version: 1, device_id: "me", updated_at: 0,
    cards: { c_old: { tags: { v: ["revisit"], ts: 1 } } } }));
  const st = await StateStore.open(fs, "me", { resolveId: (id) => (id === "c_old" ? ["c_a", "c_b"] : [id]), debounceMs: 1 });
  assert.equal(st.own.cards.c_old, undefined);
  assert.deepEqual(st.own.cards.c_a.tags!.v, ["revisit"]);
  assert.deepEqual(st.own.cards.c_b.tags!.v, ["revisit"]);
});

test("search resources by title, url, filename, author, keyword", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  assert.equal(searchSources(lib, "interp")[0].source.id, "s_booka");
  assert.equal(searchSources(lib, "youtube")[0].source.id, "s_videoc");
  assert.equal(searchSources(lib, "focus-and-habits.pdf")[0].source.id, "s_bookd");
  assert.equal(searchSources(lib, "blogger")[0].source.id, "s_blogb");
  assert.equal(searchSources(lib, "circuits")[0].source.id, "s_booka");
  assert.equal(searchSources(lib, "nothing matches this").length, 0);
  assert.equal(searchSources(lib, "").length, 4);
  const all = searchAll(lib, "sparse");
  assert.ok(all.some((h) => h.kind === "card" && h.card.id === "c_0005"));
});

test("deep dive prompt has prompt, fields and every source's lines", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const c = lib.cards.get("c_0005")!;
  const text = await buildDeepDivePrompt(lib, c, "PROMPT");
  assert.ok(text.startsWith("PROMPT\n"));
  for (const f of ["What:", "Why:", "How:", "When:", "Additional info:"]) assert.ok(text.includes(f), f);
  assert.equal((text.match(/^### /gm) ?? []).length, 3);
  assert.ok(text.includes("To pull the features apart"));
  assert.ok(text.includes("https://www.youtube.com/watch?v=EXAMPLE0001"));
  assert.deepEqual(cardFields(lib.cards.get("c_0010")!).map((f) => f.key), ["what", "how", "when"]);
});

test("coverage matches the ingest report", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const cov = coverage(lib, "s_booka");
  const rep = lib.report!.sources.find((s) => s.source === "s_booka")!;
  for (const g of rep.checks.coverage.gaps) assert.ok(cov.gaps.some((x) => x[0] === g[0] && x[1] === g[1]));
  assert.equal(cov.covered_pct, rep.checks.coverage.covered_pct);
});

test("topic tree and decisions overlay", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const decisions = { t_0001: { action: "accept" as const, ts: 1 }, t_0004: { action: "reject" as const, ts: 1 } };
  const c5 = lib.cards.get("c_0005")!;
  assert.ok(topicsWithDecisions(c5, lib.suggestions, decisions).includes("ML/Interpretability/Dictionary learning"));
  assert.equal(openSuggestions(lib.suggestions, decisions).length, 2);
  const tree = topicTree(lib.cards.values());
  assert.deepEqual(tree.children.map((n) => n.name), ["Mind", "ML"].sort((a, b) => a.localeCompare(b)));
  const ml = tree.children.find((n) => n.name === "ML")!;
  assert.equal(cardIdsUnder(ml).length, 10);
});

test("notes: read, write, conflicts", async () => {
  const fs = await tempLibrary();
  assert.equal(await readNote(fs, "c_0008"), "Compare with copying heads in small models.\n");
  await writeNote(fs, "c_0004", "new note");
  assert.equal(await readNote(fs, "c_0004"), "new note\n");
  await fs.writeText("notes/c_0004.sync-conflict-20260927-ABC.md", "other");
  const n = await listNotes(fs);
  assert.ok(n.ids.includes("c_0004"));
  assert.deepEqual(n.conflicts.c_0004, ["notes/c_0004.sync-conflict-20260927-ABC.md"]);
});

test("content blocks keep line numbers and resolve image paths", async () => {
  const lib = await Library.open(new NodeFS(FIXTURE));
  const lines = await lib.allLines("s_booka");
  const blocks = toBlocks("s_booka", lines);
  const img = blocks.find((b) => b.type === "image")!;
  assert.equal(img.type === "image" && img.path, "sources/s_booka/assets/fig-003.svg");
  assert.ok(blocks.some((b) => b.type === "math"));
  const v = toBlocks("s_videoc", await lib.allLines("s_videoc"));
  assert.ok(v.filter((b) => b.type === "cue").length > 200);
  for (const b of blocks) assert.ok(b.line >= 1 && b.line <= lines.length);
});

test("tag normalisation", () => {
  assert.equal(normalizeTag("  #Read   Later "), "read later");
});

test("schema version guard", async () => {
  const fs = new MemoryFS({ "library.json": JSON.stringify({ schema_version: 2, generation: 1, updated_at: "", sources: [], topics: [] }) });
  await assert.rejects(Library.open(fs), /schema 2/);
});

test("view of card without state", () => {
  const v = viewOf({ id: "c_x", rev: 1, title: "x", topics: [], refs: [], images: [], created_at: "", updated_at: "" }, undefined);
  assert.deepEqual(v, { status: "new", known: false, updated: false, tags: [], split: false });
});

test("notes of retired ids show under the card they were merged into", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rh-notes-"));
  await cp(FIXTURE, dir, { recursive: true });
  const fs = new NodeFS(dir);
  const lib = await Library.open(fs);
  assert.deepEqual(retiredInto(lib, "c_0005"), ["c_0099"]);
  await writeNote(fs, "c_0099", "Old note from before the merge.");
  const notes = await readNotes(lib, fs, "c_0005");
  assert.equal(notes.length, 2);
  assert.deepEqual(notes[0], { id: "c_0005", text: "", own: true });
  assert.deepEqual(notes[1], { id: "c_0099", text: "Old note from before the merge.\n", own: false });
  assert.equal((await readNotes(lib, fs, "c_0001")).length, 1);
});
