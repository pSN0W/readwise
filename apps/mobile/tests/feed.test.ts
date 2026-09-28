import { beforeEach, describe, expect, test } from "vitest";
import { Library, StateStore, topicsWithDecisions, type Card } from "@rh/core";
import { feedOrder, parseScope, rank, readShare, scopeOptions } from "../src/lib/feed.ts";
import { topicTree } from "@rh/core";
import { fixtureMemoryFS } from "./helpers.ts";

let lib: Library;
let st: StateStore;
const view = (c: Card) => st.view(c);

beforeEach(async () => {
  const fs = fixtureMemoryFS();
  lib = await Library.open(fs);
  st = await StateStore.open(fs, "android-phone", { resolveId: (id) => lib.resolveId(id), debounceMs: 1e9 });
});

describe("feed order", () => {
  test("Everything: New first, then Viewed/Explored, Known last; source order inside a group", () => {
    expect(feedOrder(lib, "all", view)).toEqual([
      "c_0003", "c_0004", "c_0006", "c_0007", "c_0009", "c_0011", "c_0012", // new
      "c_0002", "c_0005", "c_0008", "c_0013", // viewed / explored
      "c_0001", "c_0010", // known
    ]);
  });

  test("Everything: ranks never go down, every card once", () => {
    const ids = feedOrder(lib, "all", view);
    const ranks = ids.map((id) => rank(view(lib.cards.get(id)!)));
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ids).size).toBe(lib.cards.size);
  });

  test("one source: the source's own order (cardsInSource)", () => {
    for (const s of lib.sourceList()) {
      expect(feedOrder(lib, `src:${s.id}`, view)).toEqual(lib.cardsInSource(s.id).map((c) => c.id));
    }
    expect(feedOrder(lib, "src:s_bookd", view)).toEqual(["c_0011", "c_0012", "c_0013"]);
  });

  test("topic: cards at or under the topic, New first", () => {
    expect(feedOrder(lib, "topic:ML/Interpretability/Circuits", view)).toEqual(["c_0007", "c_0009", "c_0008"]);
    expect(feedOrder(lib, "topic:Mind", view)).toEqual(["c_0011", "c_0012", "c_0013"]);
  });

  test("topic: includes topics the user accepted from suggestions", () => {
    const topicsOf = (c: Card) => topicsWithDecisions(c, lib.suggestions, st.topicDecisions());
    expect(feedOrder(lib, "topic:ML/Interpretability/Dictionary learning", view, topicsOf)).toEqual([]);
    st.decideTopic("t_0001", "accept");
    expect(feedOrder(lib, "topic:ML/Interpretability/Dictionary learning", view, topicsOf).sort()).toEqual(["c_0005", "c_0006"]);
  });

  test("state change moves a card in a new computation (the app keeps the old list while reading)", () => {
    const before = feedOrder(lib, "all", view);
    st.setKnown("c_0003", true);
    const after = feedOrder(lib, "all", view);
    expect(before[0]).toBe("c_0003");
    expect(after.slice(-3)).toEqual(["c_0001", "c_0003", "c_0010"]); // Known group, source order
  });

  test("filtering by unread returns only new, unviewed cards", () => {
    const unread = feedOrder(lib, "all", view, undefined, "unread");
    expect(unread).toEqual(["c_0003", "c_0004", "c_0006", "c_0007", "c_0009", "c_0011", "c_0012"]);
    for (const id of unread) {
      const v = view(lib.cards.get(id)!);
      expect(v.status).toBe("new");
      expect(v.known).toBe(false);
    }
  });

  test("filtering by viewed returns only already read or known cards", () => {
    const viewed = feedOrder(lib, "all", view, undefined, "viewed");
    expect(viewed).toEqual(["c_0002", "c_0005", "c_0008", "c_0013", "c_0001", "c_0010"]);
    for (const id of viewed) {
      const v = view(lib.cards.get(id)!);
      expect(v.status !== "new" || v.known).toBe(true);
    }
  });

  test("parseScope", () => {
    expect(parseScope("all")).toEqual({ kind: "all" });
    expect(parseScope("src:s_booka")).toEqual({ kind: "source", id: "s_booka" });
    expect(parseScope("topic:ML/Interpretability")).toEqual({ kind: "topic", path: "ML/Interpretability" });
  });

  test("scope options list Everything, sources and topics at every level", () => {
    const opts = scopeOptions(lib, topicTree(lib.cards.values()));
    expect(opts[0]).toEqual({ key: "all", label: "Everything" });
    const keys = opts.map((o) => o.key);
    expect(keys).toContain("src:s_videoc");
    expect(keys).toContain("topic:ML");
    expect(keys).toContain("topic:ML/Interpretability");
    expect(keys).toContain("topic:ML/Interpretability/Features");
  });

  test("read share", () => {
    const cs = lib.cardsInSource("s_bookd");
    expect(readShare(cs, view)).toBe(33);
    expect(readShare([], view)).toBe(0);
  });
});
