// DevFS: the dev server's write rules and the client adapter, over a real HTTP server
// on a scratch copy of the fixture (apps/mobile/.scratch/unit-devfs).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { Library, StateStore, writeNote } from "@rh/core";
import { canWrite, cleanPath, inside, writeLibFile, WriteDenied } from "../server/devfs-rules.ts";
import { devfsHandler, parseRange } from "../server/devfs-plugin.ts";
import { DevFS } from "../src/lib/fs/devfs.ts";
import { APP, FIXTURE } from "./helpers.ts";

const ROOT = resolve(APP, ".scratch/unit-devfs");
let server: Server;
let base = "";

beforeAll(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  cpSync(FIXTURE, ROOT, { recursive: true });
  const h = devfsHandler(ROOT);
  server = createServer((req, res) => void h(req, res, () => { res.statusCode = 404; res.end("next"); }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => {
  server?.close();
  rmSync(ROOT, { recursive: true, force: true });
});

const client = () => new DevFS(`${base}/__lib`);

describe("path guard", () => {
  test("clean paths pass, escapes fail", () => {
    expect(cleanPath("sources/s_booka/content.md")).toBe("sources/s_booka/content.md");
    for (const bad of ["", "../x", "a/../../x", "/etc/passwd", "a//b", "./a", "a\\b", "C:/x", "a/\0b", "state/.."]) expect(cleanPath(bad)).toBeNull();
    expect(inside("/lib", "state/a.json")).toBe("/lib/state/a.json");
    expect(inside("/lib", "../lib2/x")).toBeNull();
  });
  test("only state/, notes/, inbox/ are writable", () => {
    expect(canWrite("state/android-phone.json")).toBe(true);
    expect(canWrite("notes/c_0001.md")).toBe(true);
    expect(canWrite("inbox/links.txt")).toBe(true);
    for (const p of ["cards.json", "library.json", "topics.yaml", "sources/s_booka/content.md", "reports/latest.json", "state/", "state", "notes/../cards.json", "statex/a.json"]) {
      expect(canWrite(p)).toBe(false);
    }
  });
  test("write outside the allowed folders throws", async () => {
    await expect(writeLibFile(ROOT, "cards.json", "{}")).rejects.toBeInstanceOf(WriteDenied);
  });
});

describe("DevFS over HTTP", () => {
  test("readText: file text, null when missing", async () => {
    const fs = client();
    const lib = JSON.parse((await fs.readText("library.json"))!);
    expect(lib.generation).toBe(7);
    expect(await fs.readText("nope.json")).toBeNull();
    expect(await fs.readText("sources/s_booka/content.md")).toContain("# Interpretability Notes");
  });
  test("list: names in a folder, [] when missing, temp files hidden", async () => {
    const fs = client();
    expect(await fs.list("state")).toEqual(["laptop-web.json", "pixel-8.json"]);
    expect(await fs.list("missing")).toEqual([]);
    await fs.writeText("notes/c_0003.md.tmp", "half");
    expect(await fs.list("notes")).not.toContain("c_0003.md.tmp");
  });
  test("write: allowed paths are written atomically; read-only paths get 403", async () => {
    const fs = client();
    const text = '{"schema_version":1,"device_id":"other-test","updated_at":0,"cards":{}}\n';
    await fs.writeText("state/other-test.json", text);
    expect(readFileSync(resolve(ROOT, "state/other-test.json"), "utf8")).toBe(text);
    expect(readdirSync(resolve(ROOT, "state")).some((n) => n.endsWith(".tmp"))).toBe(false);
    await fs.writeText("inbox/new/deep.txt", "x");
    expect(existsSync(resolve(ROOT, "inbox/new/deep.txt"))).toBe(true);
    const before = readFileSync(resolve(ROOT, "cards.json"), "utf8");
    await expect(fs.writeText("cards.json", "{}")).rejects.toThrow(/403/);
    await expect(fs.writeText("sources/s_booka/content.md", "x")).rejects.toThrow(/403/);
    expect(readFileSync(resolve(ROOT, "cards.json"), "utf8")).toBe(before);
    const r = await fetch(`${base}/__lib/f/..%2F..%2Fpackage.json`);
    expect(r.status).toBe(400);
  });
  test("url() serves images", async () => {
    const fs = client();
    const r = await fetch(fs.url("sources/s_booka/assets/fig-003.svg"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("image/svg+xml");
  });
  test("works with @rh/core end to end: open, change state, write note", async () => {
    const fs = client();
    const lib = await Library.open(fs);
    const st = await StateStore.open(fs, "android-phone", { resolveId: (id) => lib.resolveId(id), debounceMs: 10 });
    st.setKnown("c_0004", true);
    await st.flush();
    const saved = JSON.parse(readFileSync(resolve(ROOT, "state/android-phone.json"), "utf8"));
    expect(saved.cards.c_0004.known.v).toBe(true);
    await writeNote(fs, "c_0004", "my note");
    expect(readFileSync(resolve(ROOT, "notes/c_0004.md"), "utf8")).toBe("my note\n");
  });
});

describe("parseRange", () => {
  test("parses range header", () => {
    expect(parseRange("bytes=3252-6656", 18643)).toEqual({ start: 3252, end: 6657 });
    expect(parseRange("bytes=16617-", 18643)).toEqual({ start: 16617, end: 18643 });
    expect(parseRange("bytes=-100", 18643)).toEqual({ start: 18543, end: 18643 });
    expect(parseRange("bytes=20000-", 18643)).toBe("unsatisfiable");
    expect(parseRange("x=1-2", 18643)).toBeNull();
    expect(parseRange(undefined, 18643)).toBeNull();
  });
});

describe("Range requests", () => {
  test("handler 206 serves range", async () => {
    const r = await fetch(`${base}/__lib/f/sources/s_booka/content.md`, { headers: { Range: "bytes=3252-6656" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 3252-6656/18643");
    const buf = await r.arrayBuffer();
    expect(buf.byteLength).toBe(3405);
    const text = new TextDecoder().decode(buf);
    expect(text.startsWith("Probing supporting text, sentence 1.")).toBe(true);
  });

  test("DevFS equals full across all anchor pairs", async () => {
    const fs = client();
    for (const src of ["s_booka", "s_videoc"]) {
      const full = (await fs.readText(`sources/${src}/content.md`))!;
      const meta = JSON.parse((await fs.readText(`sources/${src}/meta.json`))!);
      const fullBytes = new TextEncoder().encode(full);
      for (let i = 0; i < meta.anchors.length; i++) {
        const aByte = meta.anchors[i][1];
        const bByte = i + 1 < meta.anchors.length ? meta.anchors[i + 1][1] : meta.content_bytes;
        const rangeText = await fs.readRange(`sources/${src}/content.md`, aByte, bByte);
        const expected = new TextDecoder().decode(fullBytes.subarray(aByte, bByte));
        expect(rangeText).toBe(expected);
      }
    }
  });

  test("core uses it", async () => {
    let rangeCount = 0;
    let fullCount = 0;
    const trackingFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("sources/s_booka/content.md")) {
        const headers = new Headers(init?.headers);
        if (headers.has("range")) {
          rangeCount++;
        } else {
          fullCount++;
        }
      }
      return fetch(input, init);
    };
    const trackedFS = new DevFS(`${base}/__lib`, trackingFetch);
    const lib = await Library.open(trackedFS);
    const lines = await lib.lines("s_booka", 168, 181);
    expect(lines.length).toBe(14);

    const normalLib = await Library.open(client());
    const expectedLines = (await normalLib.allLines("s_booka")).slice(167, 181);
    expect(lines).toEqual(expectedLines);

    expect(rangeCount).toBe(1);
    expect(fullCount).toBe(0);
  });
});
