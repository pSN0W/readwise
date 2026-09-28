import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { APP } from "./helpers.ts";
// @ts-expect-error generator script is JavaScript
import { makeSource } from "../scripts/gen-synthetic.mjs";

const TEST_DIR = resolve(APP, ".scratch/test-synth-unit");

describe("synthetic library generator anchors (T5)", () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("anchors in generated sources point exactly to line numbers", () => {
    const s1 = makeSource(TEST_DIR, "s_small1", "pdf", 250, 2);
    const s2 = makeSource(TEST_DIR, "s_small2", "video", 150, 1);

    for (const { meta } of [s1, s2]) {
      const contentBuf = readFileSync(resolve(TEST_DIR, `sources/${meta.id}/content.md`));
      const contentText = contentBuf.toString("utf8");
      const lines = contentText.split("\n");
      if (lines.length && lines[lines.length - 1] === "") lines.pop();

      expect(meta.anchor_step).toBe(100);
      expect(meta.content_bytes).toBe(contentBuf.length);
      expect(meta.anchors.length).toBeGreaterThan(0);

      for (const [lineNum, byteOffset] of meta.anchors) {
        expect(lineNum).toBeGreaterThanOrEqual(1);
        expect(lineNum).toBeLessThanOrEqual(lines.length);

        // Bytes from byteOffset should start with lines[lineNum - 1]
        const slice = contentBuf.subarray(byteOffset).toString("utf8");
        const expectedLine = lines[lineNum - 1];
        expect(slice.startsWith(expectedLine)).toBe(true);

        // Bytes before byteOffset should have exactly (lineNum - 1) newlines
        const before = contentBuf.subarray(0, byteOffset).toString("utf8");
        const newlineCount = (before.match(/\n/g) || []).length;
        expect(newlineCount).toBe(lineNum - 1);
      }
    }
  });
});
