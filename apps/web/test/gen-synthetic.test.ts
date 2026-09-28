import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("gen-synthetic anchors", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "synth-test-"));
    execSync(`npx tsx scripts/gen-synthetic.ts ${tmpDir}`, {
      env: {
        ...process.env,
        SYNTH_N_SOURCES: "2",
        SYNTH_N_CARDS: "10",
        SYNTH_BIG_LINES: "500",
        SYNTH_BIG_IMAGES: "5",
        SYNTH_BIG_CARDS: "2",
      },
      cwd: join(__dirname, ".."),
    });
  });

  it("generates correct anchors in meta.json", () => {
    const lib = JSON.parse(readFileSync(join(tmpDir, "library.json"), "utf8"));
    const dec = new TextDecoder();
    
    expect(lib.sources.length).toBe(2);

    for (const src of lib.sources) {
      const metaPath = join(tmpDir, "sources", src.id, "meta.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const contentPath = join(tmpDir, "sources", src.id, "content.md");
      const contentStr = readFileSync(contentPath, "utf8");
      const contentBytes = readFileSync(contentPath);
      
      expect(typeof meta.content_bytes).toBe("number");
      expect(typeof meta.anchor_step).toBe("number");
      expect(Array.isArray(meta.anchors)).toBe(true);

      expect(meta.content_bytes).toBe(contentBytes.length);
      expect(meta.anchor_step).toBe(100);

      const lines = contentStr.split("\n");

      for (const [lineNo, byteOffset] of meta.anchors) {
        expect(typeof lineNo).toBe("number");
        expect(typeof byteOffset).toBe("number");

        const expectedLine = lines[lineNo - 1];
        
        let endOffset = byteOffset;
        while (endOffset < contentBytes.length && contentBytes[endOffset] !== 10) {
          endOffset++;
        }
        
        const lineBytes = contentBytes.subarray(byteOffset, endOffset);
        const actualLine = dec.decode(lineBytes);

        expect(actualLine).toBe(expectedLine);
      }
    }
  });
});
