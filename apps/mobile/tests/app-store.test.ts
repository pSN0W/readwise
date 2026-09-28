// The app store keeps the feed order fixed while you read (computed once per scope).
import { describe, expect, test, vi } from "vitest";
import { fixtureMemoryFS } from "./helpers.ts";

vi.mock("../src/lib/fs/devfs.ts", () => ({ DevFS: class {} }));

describe("app store feed", () => {
  test("order is computed once per scope and does not jump when states change", async () => {
    const mem = fixtureMemoryFS();
    const { app } = await import("../src/lib/app.svelte.ts");
    app.makeFS = () => mem;
    await app.open();
    expect(app.feed[0]).toBe("c_0003");
    const first = [...app.feed];
    app.st!.setKnown("c_0003", true);
    app.st!.markViewed(app.lib!.cards.get("c_0004")!);
    expect(app.feed).toEqual(first);
    app.next();
    expect(app.current()!.id).toBe("c_0004");
    app.prev();
    app.prev();
    expect(app.index).toBe(first.length - 1);
    // a new scope computes a new order; the same scope again puts Known last
    app.setScope("src:s_booka", "c_0005");
    expect(app.current()!.id).toBe("c_0005");
    app.setScope("all");
    expect(app.feed.slice(-3)).toEqual(["c_0001", "c_0003", "c_0010"]);
    await app.st!.flush();
  });
});
