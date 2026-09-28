import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";
import { Library, StateStore, writeNote, readNote } from "@rh/core";
import { HttpFS } from "../src/lib/http-fs.ts";
import { startServer, tempLibrary } from "./helpers.ts";

describe("HttpFS with a fake fetch", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("missing.json")) return new Response("no", { status: 404 });
    if (url.endsWith("/?list")) return new Response(JSON.stringify(["a.json", 3, "b.json"]));
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (url.includes("boom")) return new Response("x", { status: 500 });
    return new Response("hello");
  }) as unknown as typeof fetch;
  const fs = new HttpFS("/library", fake);

  test("readText: text, null on 404, error on 500, revalidates with ETag", async () => {
    expect(await fs.readText("library.json")).toBe("hello");
    expect(calls.at(-1)).toMatchObject({ url: "/library/library.json", init: { cache: "no-cache" } });
    expect(await fs.readText("missing.json")).toBeNull();
    await expect(fs.readText("boom.json")).rejects.toThrow(/500/);
  });
  test("writeText uses PUT; list keeps strings only; url encodes each part", async () => {
    await fs.writeText("state/laptop-web.json", "{}");
    expect(calls.at(-1)).toMatchObject({ url: "/library/state/laptop-web.json", init: { method: "PUT", body: "{}" } });
    expect(await fs.list("state/")).toEqual(["a.json", "b.json"]);
    expect(calls.at(-1)!.url).toBe("/library/state/?list");
    expect(fs.url("sources/s_a/assets/fig 1#.png")).toBe("/library/sources/s_a/assets/fig%201%23.png");
  });
});

describe("HttpFS against the real server + @rh/core", () => {
  let root = "";
  let server: Server;
  let fs: HttpFS;
  beforeAll(async () => {
    root = await tempLibrary();
    const s = await startServer(root);
    server = s.server;
    fs = new HttpFS(`${s.url}/library/`);
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  test("core opens the library, reads text, writes state and notes", async () => {
    const lib = await Library.open(fs);
    expect(lib.cards.size).toBe(13);
    const lines = await lib.lines("s_booka", 1, 3);
    expect(lines[0]).toBe("# Interpretability Notes");
    const st = await StateStore.open(fs, "laptop-web", { resolveId: (id) => lib.resolveId(id), debounceMs: 5 });
    st.setKnown("c_0004", true);
    await st.flush();
    const disk = JSON.parse(await readFile(join(root, "state/laptop-web.json"), "utf8"));
    expect(disk.cards.c_0004.known.v).toBe(true);
    await writeNote(fs, "c_0004", "my note");
    expect(await readNote(fs, "c_0004")).toBe("my note\n");
    expect(await lib.hasUpdate()).toBe(false);
  });
  test("readRange matches readText for every anchor pair of s_booka", async () => {
    const meta = await (await Library.open(fs)).meta("s_booka");
    const fullText = await fs.readText("sources/s_booka/content.md");
    expect(fullText).not.toBeNull();
    const fullBytes = new TextEncoder().encode(fullText!);
    const anchors = meta.anchors;
    for (let i = 0; i < anchors.length - 1; i++) {
      const [, start] = anchors[i];
      const [, end] = anchors[i + 1];
      const rangeText = await fs.readRange!("sources/s_booka/content.md", start, end);
      const expected = new TextDecoder().decode(fullBytes.subarray(start, end));
      expect(rangeText).toBe(expected);
    }
  });
  test("lib.lines uses Range (not a full GET for content.md)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const wrapped: typeof fetch = async (input, init?) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      calls.push({ url, init });
      return fetch(input, init);
    };
    const rangeFs = new HttpFS(`${root.replace(root, "")}`, wrapped);
    // Must create a fresh HttpFS pointing at the real server
    const rfs = new HttpFS(`http://127.0.0.1:${(server.address() as any).port}/library/`, wrapped);
    const lib2 = await Library.open(rfs);
    calls.length = 0; // reset after open
    const lines = await lib2.lines("s_booka", 168, 181);
    expect(lines.length).toBe(14);
    expect(lines[0]).toContain("Features supporting text");
    // Check we used a Range request
    const contentCalls = calls.filter((c) => c.url.includes("content.md"));
    const rangeCalls = contentCalls.filter((c) => c.init?.headers && (c.init.headers as Record<string, string>).Range);
    expect(rangeCalls.length).toBeGreaterThan(0);
    // No plain GET for content.md (only Range)
    const plainGets = contentCalls.filter((c) => !c.init?.headers || !(c.init.headers as Record<string, string>).Range);
    expect(plainGets.length).toBe(0);
  });
  test("readRange returns correct text when server returns 200 (no Range support)", async () => {
    // Simulate a server that ignores Range by using a fake fetch that returns 200
    const fullText = await readFile(join(root, "sources/s_booka/content.md"), "utf8");
    const fake = (async () => new Response(fullText, { status: 200 })) as unknown as typeof fetch;
    const fakeFs = new HttpFS("/library/", fake);
    const text = await fakeFs.readRange!("sources/s_booka/content.md", 3252, 6657);
    const expected = new TextDecoder().decode(new TextEncoder().encode(fullText).subarray(3252, 6657));
    expect(text).toBe(expected);
  });
  test("readRange with multi-byte characters", async () => {
    // Build a small text with multi-byte chars
    const src = "line one\nwith · middle dot\nand α alpha\nlast line\n";
    const bytes = new TextEncoder().encode(src);
    // Read bytes 9..26 which should be "with · middle dot"
    const start = 9;
    const end = 9 + new TextEncoder().encode("with · middle dot").length;
    const fake = (async () => new Response(bytes.subarray(start, end), { status: 206 })) as unknown as typeof fetch;
    const fakeFs = new HttpFS("/library/", fake);
    const text = await fakeFs.readRange!("test.md", start, end);
    expect(text).toBe("with · middle dot");
  });
});
