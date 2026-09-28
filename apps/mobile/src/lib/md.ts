// Markdown + KaTeX for card fields, notes and book paragraphs. Raw HTML in the source is shown as text.
import katex from "katex";
import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
    link(token) {
      const href = token.href ?? "";
      const text = this.parser.parseInline(token.tokens);
      if (!/^https?:\/\//i.test(href)) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const MATH = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g;

export function tex(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    return `<code>${escapeHtml(src)}</code>`;
  }
}

const cache = new Map<string, string>();
const CACHE_MAX = 4000;

/** Markdown (with $…$ and $$…$$ math) to HTML. `inline` = no <p> wrapper. Results are cached. */
export function renderMd(text: string, inline = false): string {
  const key = (inline ? "i:" : "b:") + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const math: string[] = [];
  const withTokens = text.replace(MATH, (_m, d: string | undefined, i: string | undefined) => {
    math.push(d !== undefined ? tex(d.trim(), true) : tex((i as string).trim(), false));
    return `%%MATH${math.length - 1}%%`;
  });
  let html = inline ? (marked.parseInline(withTokens) as string) : (marked.parse(withTokens) as string);
  html = html.replace(/%%MATH(\d+)%%/g, (_m, n: string) => math[Number(n)]);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, html);
  return html;
}
