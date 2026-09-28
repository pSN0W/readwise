import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { request, type Server } from "node:http";
import { parseLinks, parseMultipart, parseRange, safeLibraryPath, safeUploadName, writeKind } from "../server/handler.ts";
import { startServer, tempLibrary } from "./helpers.ts";

describe("path guard", () => {
  const root = resolve("/lib/root");
  test("allows normal library paths", () => {
    expect(safeLibraryPath(root, "library.json")).toBe(join(root, "library.json"));
    expect(safeLibraryPath(root, "sources/s_booka/assets/fig-003.svg")).toBe(join(root, "sources/s_booka/assets/fig-003.svg"));
    expect(safeLibraryPath(root, "sources/s%20x/a.md")).toBe(join(root, "sources/s x/a.md"));
  });
  test.each([
    "../secret", "sources/../../etc/passwd", "%2e%2e/secret", "sources/%2e%2e/%2e%2e/x", "..%2fsecret",
    "/etc/passwd", "%2Fetc%2Fpasswd", "a\\..\\b", "a%5c..%5cb", "x%00.json", "./library.json", "%E0%A4%A",
  ])("refuses %s", (p) => {
    expect(safeLibraryPath(root, p)).toBeNull();
  });
});

describe("write rules", () => {
  test("only this device's state file and notes can be written", () => {
    expect(writeKind("state/laptop-web.json")).toBe("state");
    expect(writeKind("notes/c_0003.md")).toBe("note");
    for (const p of ["cards.json", "library.json", "topics.yaml", "state/Laptop.json", "state/a.json.tmp", "state/x/y.json",
      "notes/c_0003.txt", "notes/../cards.json", "sources/s_booka/content.md", "reports/latest.json", "inbox/links.txt", "notes/x.md"]) {
      expect(writeKind(p), p).toBeNull();
    }
  });
  test("links and upload names", () => {
    expect(parseLinks("https://a.b/c\n  ftp://x\nnot a link\nhttp://y.z/q?x=1 \n")).toEqual(["https://a.b/c", "http://y.z/q?x=1"]);
    expect(safeUploadName("../../evil.pdf")).toBe("evil.pdf");
    expect(safeUploadName("C:\\x\\book.pdf")).toBe("book.pdf");
    expect(safeUploadName(".hidden")).toBe("hidden");
    expect(safeUploadName("links.txt")).toBeNull();
    expect(safeUploadName("a<b>.pdf")).toBe("a_b_.pdf");
  });
  test("multipart parser", () => {
    const b = "XyZ";
    const body = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1\r\n--${b}--\r\n`);
    expect(parseMultipart(body, `multipart/form-data; boundary=${b}`)).toEqual([{ filename: "a.pdf", data: Buffer.from("%PDF-1") }]);
  });
  test("parseRange basic", () => {
    expect(parseRange("bytes=3252-6656", 18643)).toEqual({ start: 3252, end: 6657 });
  });
  test("parseRange open end", () => {
    expect(parseRange("bytes=16617-", 18643)).toEqual({ start: 16617, end: 18643 });
  });
  test("parseRange suffix", () => {
    expect(parseRange("bytes=-100", 18643)).toEqual({ start: 18543, end: 18643 });
  });
  test("parseRange past end", () => {
    expect(parseRange("bytes=20000-20010", 18643)).toBe("unsatisfiable");
  });
  test("parseRange junk", () => {
    expect(parseRange("items=1-2", 18643)).toBeNull();
    expect(parseRange("bytes=1-2,5-6", 18643)).toBeNull();
    expect(parseRange(undefined, 18643)).toBeNull();
  });
});

describe("server routes", () => {
  let root = "";
  let url = "";
  let server: Server;
  beforeAll(async () => {
    root = await tempLibrary();
    ({ url, server } = await startServer(root));
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  test("GET a file with ETag, then 304", async () => {
    const r = await fetch(`${url}/library/library.json`);
    expect(r.status).toBe(200);
    const etag = r.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    expect(JSON.parse(await r.text()).generation).toBe(7);
    const r2 = await fetch(`${url}/library/library.json`, { headers: { "If-None-Match": etag } });
    expect(r2.status).toBe(304);
  });
  test("404 for a missing file, 403 for traversal", async () => {
    expect((await fetch(`${url}/library/nope.json`)).status).toBe(404);
    // fetch() cleans "..", so send raw paths with node:http
    const raw = (path: string, method = "GET") => new Promise<number>((ok, fail) => {
      const u = new URL(url);
      const r = request({ host: u.hostname, port: u.port, path, method }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      r.on("error", fail);
      r.end(method === "PUT" ? "{}" : undefined);
    });
    expect(await raw("/library/../package.json")).toBe(403);
    expect(await raw("/library/%2e%2e/%2e%2e/package.json")).toBe(403);
    expect(await raw("/library/state/..%2f..%2fcards.json", "PUT")).toBe(403);
  });
  test("list a folder (ignores .tmp)", async () => {
    await writeFile(join(root, "state", "x.json.tmp"), "{}");
    const r = await fetch(`${url}/library/state/?list`);
    expect(await r.json()).toEqual(["laptop-web.json", "pixel-8.json"]);
    expect(await (await fetch(`${url}/library/missing/?list`)).json()).toEqual([]);
  });
  test("PUT state and note; refuse other writes", async () => {
    const state = JSON.stringify({ schema_version: 1, device_id: "test-dev", updated_at: 1, cards: {} });
    expect((await fetch(`${url}/library/state/test-dev.json`, { method: "PUT", body: state })).status).toBe(204);
    expect(await readFile(join(root, "state/test-dev.json"), "utf8")).toBe(state);
    expect((await fetch(`${url}/library/state/other.json`, { method: "PUT", body: state })).status).toBe(400);
    expect((await fetch(`${url}/library/state/bad.json`, { method: "PUT", body: "{nope" })).status).toBe(400);
    expect((await fetch(`${url}/library/notes/c_0003.md`, { method: "PUT", body: "hi\n" })).status).toBe(204);
    expect(await readFile(join(root, "notes/c_0003.md"), "utf8")).toBe("hi\n");
    const before = await readFile(join(root, "cards.json"), "utf8");
    expect((await fetch(`${url}/library/cards.json`, { method: "PUT", body: "{}" })).status).toBe(403);
    expect((await fetch(`${url}/library/cards.json`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${url}/library/sources/s_booka/content.md`, { method: "PUT", body: "x" })).status).toBe(403);
    expect(await readFile(join(root, "cards.json"), "utf8")).toBe(before);
    expect((await readdir(join(root, "state"))).filter((n) => n.endsWith(".tmp") && n !== "x.json.tmp")).toEqual([]);
  });
  test("POST links appends to inbox/links.txt", async () => {
    const r = await fetch(`${url}/library/inbox/links`, { method: "POST", body: "https://example.org/a\nnot a url\n" });
    expect(await r.json()).toEqual({ added: 1 });
    expect(await readFile(join(root, "inbox/links.txt"), "utf8")).toMatch(/one URL per line.*\nhttps:\/\/example\.org\/a\n$/s);
    expect((await fetch(`${url}/library/inbox/links`, { method: "POST", body: "nothing" })).status).toBe(400);
  });
  test("POST multipart saves into inbox/ without overwriting", async () => {
    for (let i = 0; i < 2; i++) {
      const fd = new FormData();
      fd.append("file", new Blob(["%PDF-1.4 test"]), "../My Book.pdf");
      const r = await fetch(`${url}/library/inbox/`, { method: "POST", body: fd });
      expect(r.status).toBe(200);
      expect((await r.json()).saved).toEqual([i === 0 ? "My Book.pdf" : "My Book-1.pdf"]);
    }
    expect(await readFile(join(root, "inbox/My Book.pdf"), "utf8")).toBe("%PDF-1.4 test");
  });
  test("GET with Range → 206 partial content", async () => {
    const full = await readFile(join(root, "sources/s_booka/content.md"));
    const r = await fetch(`${url}/library/sources/s_booka/content.md`, { headers: { Range: "bytes=3252-6656" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes 3252-6656/${full.length}`);
    const body = new Uint8Array(await r.arrayBuffer());
    expect(body.length).toBe(3405);
    expect(Buffer.from(body).toString("utf8")).toBe(full.subarray(3252, 6657).toString("utf8"));
  });
  test("GET 416 for past-end range", async () => {
    const r = await fetch(`${url}/library/sources/s_booka/content.md`, { headers: { Range: "bytes=99999-" } });
    expect(r.status).toBe(416);
  });
  test("Range + path guard → 403 (guard first)", async () => {
    const raw = (path: string) => new Promise<number>((ok, fail) => {
      const u = new URL(url);
      const r = request({ host: u.hostname, port: u.port, path, method: "GET", headers: { Range: "bytes=0-10" } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      r.on("error", fail);
      r.end();
    });
    expect(await raw("/library/../package.json")).toBe(403);
  });
});
