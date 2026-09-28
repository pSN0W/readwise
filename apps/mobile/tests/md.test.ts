import { describe, expect, test } from "vitest";
import { renderMd } from "../src/lib/md.ts";

describe("markdown + math", () => {
  test("inline math with KaTeX", () => {
    const h = renderMd("more directions than dimensions: $k > d$.", true);
    expect(h).toContain("katex");
    expect(h).not.toContain("$k");
  });
  test("display math", () => {
    expect(renderMd("$$\\sum_i x_i$$")).toContain("katex-display");
  });
  test("dollar amounts are not math", () => {
    expect(renderMd("It costs $5 and $10.", true)).not.toContain("katex");
  });
  test("markdown works, raw HTML is shown as text", () => {
    const h = renderMd("**bold** <script>alert(1)</script>");
    expect(h).toContain("<strong>bold</strong>");
    expect(h).not.toContain("<script>");
  });
  test("only http(s) links become links", () => {
    expect(renderMd("[a](https://example.com)", true)).toContain('href="https://example.com"');
    expect(renderMd("[a](javascript:alert(1))", true)).not.toContain("href");
  });
});
