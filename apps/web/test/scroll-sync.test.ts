import { describe, expect, test } from "vitest";
import { Library, toBlocks } from "@rh/core";
import { NodeFS } from "../../../packages/core/test/node-fs.ts";
import { cardAtLine, chunkBlocks, chunkOfLine, chunksInRange, lastLE, lineOfCard, topVisible, type Span } from "../src/lib/scroll-sync.ts";
import { FIXTURE } from "./helpers.ts";

const spans: Span[] = [
  { id: "a", start: 10, end: 20 },
  { id: "b", start: 30, end: 60 },
  { id: "c", start: 40, end: 45 }, // inside b (a merged card from another source may overlap)
  { id: "d", start: 70, end: 80 },
];

describe("line -> card", () => {
  test("lastLE", () => {
    expect(lastLE([1, 5, 9], 0, (x) => x)).toBe(-1);
    expect(lastLE([1, 5, 9], 5, (x) => x)).toBe(1);
    expect(lastLE([1, 5, 9], 100, (x) => x)).toBe(2);
  });
  test("inside a card, in a gap, before all, overlapping", () => {
    expect(cardAtLine(spans, 15)).toBe("a");
    expect(cardAtLine(spans, 25)).toBe("a"); // gap after a -> stay on a
    expect(cardAtLine(spans, 1)).toBe("a"); // before every card -> first card
    expect(cardAtLine(spans, 42)).toBe("c"); // latest start that holds the line
    expect(cardAtLine(spans, 50)).toBe("b"); // c ended, b still holds the line
    expect(cardAtLine(spans, 999)).toBe("d");
    expect(cardAtLine([], 5)).toBeNull();
    expect(lineOfCard(spans, "b")).toBe(30);
  });
});

describe("top visible item", () => {
  const tops = [0, 100, 250, 400];
  const heights = [100, 150, 150, 50];
  test("first item whose bottom is below y", () => {
    expect(topVisible(tops, heights, 0)).toBe(0);
    expect(topVisible(tops, heights, 99)).toBe(0);
    expect(topVisible(tops, heights, 100)).toBe(1);
    expect(topVisible(tops, heights, 260)).toBe(2);
    expect(topVisible(tops, heights, 5000)).toBe(3);
    expect(topVisible([], [], 10)).toBe(-1);
  });
});

describe("chunks", () => {
  const blocks = Array.from({ length: 10 }, (_, i) => ({ line: i * 10 + 1, endLine: i * 10 + 5 }));
  const chunks = chunkBlocks(blocks, 4);
  test("split and find", () => {
    expect(chunks.map((c) => [c.first, c.last])).toEqual([[1, 35], [41, 75], [81, 95]]);
    expect(chunkOfLine(chunks, 1)).toBe(0);
    expect(chunkOfLine(chunks, 38)).toBe(0);
    expect(chunkOfLine(chunks, 41)).toBe(1);
    expect(chunkOfLine(chunks, 9999)).toBe(2);
    expect(chunksInRange(chunks, 30, 85)).toEqual([0, 1, 2]);
    expect(chunksInRange(chunks, 36, 40)).toEqual([]);
  });
});

describe("full mapping on the fixture book", () => {
  test("top visible block -> card -> other panes land on the card's first line", async () => {
    const lib = await Library.open(new NodeFS(FIXTURE));
    const lines = await lib.allLines("s_booka");
    const blocks = toBlocks("s_booka", lines);
    const cs = lib.cardsInSource("s_booka");
    const sp = cs.map((c) => { const r = c.refs.find((x) => x.source === "s_booka")!; return { id: c.id, start: r.start, end: r.end }; });
    // Pretend each block is 20px tall; the pane is scrolled so the block holding line 170 is on top.
    const tops = blocks.map((_, i) => i * 20);
    const hs = blocks.map(() => 20);
    const target = blocks.findLastIndex((b) => b.line <= 170);
    const top = topVisible(tops, hs, tops[target] + 5);
    const id = cardAtLine(sp, blocks[top].line);
    expect(id).toBe("c_0003"); // Superposition, lines 168-181
    const chunks = chunkBlocks(blocks, 40);
    const back = lineOfCard(sp, id!)!;
    expect(back).toBe(168);
    expect(chunks[chunkOfLine(chunks, back)].first).toBeLessThanOrEqual(168);
  });
});
