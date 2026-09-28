// Hash routing: #/read/s_booka?line=1201 -> { view: "read", id: "s_booka", params }.
export interface Route { view: string; id: string; params: URLSearchParams }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const q = h.indexOf("?");
  const path = q === -1 ? h : h.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : h.slice(q + 1));
  const [view = "", ...rest] = path.split("/");
  return { view: view || "focus", id: decodeURIComponent(rest.join("/")), params };
}

class Router {
  route = $state<Route>(parseHash(typeof location === "undefined" ? "" : location.hash));
  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", () => { this.route = parseHash(location.hash); });
    }
  }
  go(path: string): void {
    const h = "#/" + path.replace(/^#?\/?/, "");
    if (location.hash === h) this.route = parseHash(h);
    else location.hash = h;
  }
  /** Change the URL without adding a history entry or re-rendering. */
  replace(path: string): void {
    history.replaceState(null, "", "#/" + path.replace(/^#?\/?/, ""));
  }
}
export const router = new Router();

export function readHref(sourceId: string, line?: number, card?: string): string {
  const p = new URLSearchParams();
  if (line) p.set("line", String(line));
  if (card) p.set("card", card);
  const qs = p.toString();
  return `#/read/${encodeURIComponent(sourceId)}${qs ? "?" + qs : ""}`;
}
