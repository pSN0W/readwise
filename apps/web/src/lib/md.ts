// Markdown + KaTeX -> sanitised HTML. Math is cut out first, rendered by KaTeX, and put back
// after DOMPurify (KaTeX escapes its input, and we never allow its "trust" features).
import { Marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";

const marked = new Marked({ gfm: true, breaks: false, async: false });
const mathCache = new Map<string, string>();
const htmlCache = new Map<string, string>();
const PURIFY = { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input"] };

export function renderMath(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  let out = mathCache.get(key);
  if (out === undefined) {
    out = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", trust: false, strict: "ignore" });
    if (mathCache.size > 5000) mathCache.clear();
    mathCache.set(key, out);
  }
  return out;
}

const TOKEN = (i: number) => `qqmath${i}qq`;
const INLINE_MATH = /(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?![\d$])/g;
const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/g;
/** Characters that mean "this text needs the Markdown parser". */
const NEEDS_MD = /[*_`[\]!<>&#|~\\$]|^\s*([-+]|\d+\.)\s/m;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Replace math with tokens; returns the text and the rendered pieces. */
function cutMath(src: string): { text: string; math: string[] } {
  const math: string[] = [];
  let text = src.replace(DISPLAY_MATH, (_m, t: string) => TOKEN(math.push(renderMath(t.trim(), true)) - 1));
  text = text.replace(INLINE_MATH, (_m, pre: string, t: string) => pre + TOKEN(math.push(renderMath(t, false)) - 1));
  return { text, math };
}

function putMath(html: string, math: string[]): string {
  return math.length ? html.replace(/qqmath(\d+)qq/g, (_m, i: string) => math[Number(i)] ?? "") : html;
}

/**
 * HTML with math tokens still in. `dirty` = came from the Markdown parser and must go through
 * finish() (DOMPurify). Plain text is only escaped, which is already safe.
 */
export function rawMarkdown(src: string, inline: boolean): { html: string; math: string[]; dirty: boolean } {
  if (!NEEDS_MD.test(src)) return { html: escapeHtml(src), math: [], dirty: false };
  const { text, math } = cutMath(src);
  const html = (inline ? marked.parseInline(text) : marked.parse(text)) as string;
  return { html, math, dirty: true };
}

/** Sanitise HTML and put the rendered math back in. */
export function finish(html: string, math: string[]): string {
  return putMath(DOMPurify.sanitize(html, PURIFY) as string, math);
}

/** Markdown (block) -> safe HTML. Cached; card fields repeat a lot. */
export function md(src: string, inline = false): string {
  const key = (inline ? "i" : "b") + src;
  let out = htmlCache.get(key);
  if (out === undefined) {
    const r = rawMarkdown(src, inline);
    out = r.dirty ? finish(r.html, r.math) : r.html;
    if (htmlCache.size > 20000) htmlCache.clear();
    htmlCache.set(key, out);
  }
  return out;
}
