// CapacitorFS against a mocked @capacitor/filesystem (the real one needs a phone).
import { beforeEach, describe, expect, test, vi } from "vitest";

const files = new Map<string, string>();
const calls: string[] = [];
let refuseRenameOver = false;

const rangeCalls: { path: string; start: number; end: number }[] = [];
let rangeMockHandler: ((opts: { path: string; start: number; end: number }) => Promise<{ data: string }>) | null = null;

vi.mock("@capacitor/core", () => ({
  Capacitor: { convertFileSrc: (p: string) => p.replace("file://", "https://localhost/_capacitor_file_"), isNativePlatform: () => true },
}));
vi.mock("../src/lib/fs/rangefile.ts", () => ({
  RangeFile: {
    read: async (opts: { path: string; start: number; end: number }) => {
      rangeCalls.push(opts);
      if (rangeMockHandler) return rangeMockHandler(opts);
      throw { code: "UNIMPLEMENTED" };
    },
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      calls.push(`read ${path}`);
      if (!files.has(path)) throw new Error("File does not exist");
      return { data: files.get(path) };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => { calls.push(`write ${path}`); files.set(path, data); return { uri: path }; },
    rename: async ({ from, to }: { from: string; to: string }) => {
      calls.push(`rename ${from} -> ${to}`);
      if (refuseRenameOver && files.has(to)) throw new Error("exists");
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    deleteFile: async ({ path }: { path: string }) => { calls.push(`delete ${path}`); files.delete(path); },
    readdir: async ({ path }: { path: string }) => {
      const pre = path + "/";
      const names = new Set<string>();
      for (const k of files.keys()) if (k.startsWith(pre)) names.add(k.slice(pre.length).split("/")[0]);
      if (!names.size) throw new Error("Folder does not exist");
      return { files: [...names].map((name) => ({ name, type: "file" })) };
    },
  },
}));

const { CapacitorFS, DEFAULT_LIBRARY_PATH } = await import("../src/lib/fs/capfs.ts");
const ROOT = "/storage/emulated/0/Syncthing/library";

beforeEach(() => {
  files.clear();
  calls.length = 0;
  rangeCalls.length = 0;
  rangeMockHandler = null;
  refuseRenameOver = false;
  files.set(`${ROOT}/library.json`, '{"generation":1}');
  files.set(`${ROOT}/state/pixel-8.json`, "{}");
  files.set(`${ROOT}/state/android-phone.json.tmp`, "half");
  files.set(`${ROOT}/state/.syncthing.x.json.tmp`, "sync");
});

describe("CapacitorFS", () => {
  test("default folder", () => expect(DEFAULT_LIBRARY_PATH).toBe(ROOT));
  test("readText returns text or null", async () => {
    const fs = new CapacitorFS(ROOT + "/");
    expect(await fs.readText("library.json")).toBe('{"generation":1}');
    expect(await fs.readText("cards.json")).toBeNull();
  });
  test("writeText writes name.tmp, then renames (atomic)", async () => {
    const fs = new CapacitorFS(ROOT);
    await fs.writeText("state/android-phone.json", "{\"a\":1}");
    expect(calls).toEqual([
      `write ${ROOT}/state/android-phone.json.tmp`,
      `rename ${ROOT}/state/android-phone.json.tmp -> ${ROOT}/state/android-phone.json`,
    ]);
    expect(files.get(`${ROOT}/state/android-phone.json`)).toBe("{\"a\":1}");
    expect(files.has(`${ROOT}/state/android-phone.json.tmp`)).toBe(false);
  });
  test("if rename over an existing file fails: delete, then rename", async () => {
    refuseRenameOver = true;
    const fs = new CapacitorFS(ROOT);
    await fs.writeText("state/pixel-8.json", "new");
    expect(calls.some((c) => c.startsWith("delete"))).toBe(true);
    expect(files.get(`${ROOT}/state/pixel-8.json`)).toBe("new");
  });
  test("list hides temp and Syncthing files; missing folder = []", async () => {
    const fs = new CapacitorFS(ROOT);
    expect(await fs.list("state")).toEqual(["pixel-8.json"]);
    expect(await fs.list("notes")).toEqual([]);
  });
  test("url uses convertFileSrc", () => {
    const fs = new CapacitorFS(ROOT);
    expect(fs.url("sources/s_a/assets/f.png")).toBe(`https://localhost/_capacitor_file_${ROOT}/sources/s_a/assets/f.png`);
  });

  describe("readRange", () => {
    test("normal: read returns data", async () => {
      rangeMockHandler = async () => ({ data: "line 101…" });
      const fs = new CapacitorFS(ROOT);
      const text = await fs.readRange("sources/s_booka/content.md", 3252, 6657);
      expect(text).toBe("line 101…");
      expect(rangeCalls).toEqual([{ path: `${ROOT}/sources/s_booka/content.md`, start: 3252, end: 6657 }]);
    });

    test("missing: NOT_FOUND returns null, readFile not called", async () => {
      rangeMockHandler = async () => { throw { code: "NOT_FOUND" }; };
      const fs = new CapacitorFS(ROOT);
      calls.length = 0;
      const text = await fs.readRange("sources/s_booka/content.md", 3252, 6657);
      expect(text).toBeNull();
      expect(calls.some((c) => c.startsWith("read "))).toBe(false);
    });

    test("plugin missing: UNIMPLEMENTED falls back to readFile", async () => {
      rangeMockHandler = async () => { throw { code: "UNIMPLEMENTED" }; };
      files.set(`${ROOT}/sources/s_booka/content.md`, "0123456789hello world");
      const fs = new CapacitorFS(ROOT);
      const text = await fs.readRange("sources/s_booka/content.md", 10, 15);
      expect(text).toBe("hello");
      expect(calls.some((c) => c.startsWith(`read ${ROOT}/sources/s_booka/content.md`))).toBe(true);
    });

    test("multi-byte fallback with UTF-8 characters", async () => {
      rangeMockHandler = async () => { throw { code: "UNIMPLEMENTED" }; };
      files.set(`${ROOT}/sources/s_booka/content.md`, "a·b\nc\n");
      const fs = new CapacitorFS(ROOT);
      const text = await fs.readRange("sources/s_booka/content.md", 0, 5);
      expect(text).toBe("a·b\n");
    });

    test("empty: start equals end returns empty string with no calls", async () => {
      const fs = new CapacitorFS(ROOT);
      rangeCalls.length = 0;
      calls.length = 0;
      const text = await fs.readRange("sources/s_booka/content.md", 100, 100);
      expect(text).toBe("");
      expect(rangeCalls.length).toBe(0);
      expect(calls.length).toBe(0);
    });
  });
});
