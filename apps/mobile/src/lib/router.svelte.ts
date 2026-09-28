// Hash routing: #/feed, #/books/<id>?mode=book, #/tree?kind=topics&path=…, #/shelf, #/outline/<id>, #/search
export interface Route {
  name: string;
  parts: string[];
  query: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  const raw = parts[0] ?? "feed";
  const name = raw === "tree" ? "topics" : raw;
  return { name, parts: parts.slice(1), query };
}

export function href(name: string, parts: string[] = [], query: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") q.set(k, v);
  const qs = q.toString();
  return `#/${[name, ...parts.map(encodeURIComponent)].join("/")}${qs ? `?${qs}` : ""}`;
}

class Router {
  route = $state<Route>(parseHash(typeof location === "undefined" ? "" : location.hash));
  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", () => { this.route = parseHash(location.hash); });
    }
  }
  go(name: string, parts: string[] = [], query: Record<string, string | undefined> = {}, replace = false): void {
    const h = href(name, parts, query);
    if (replace) { history.replaceState(null, "", h); this.route = parseHash(h); }
    else location.hash = h;
  }
}

export const router = new Router();
