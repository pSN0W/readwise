// Small per-browser settings in localStorage (never synced, never sent anywhere).
function get(key: string): string | null {
  try { return localStorage.getItem("rh." + key); } catch { return null; }
}
function set(key: string, v: string | null): void {
  try { if (v === null) localStorage.removeItem("rh." + key); else localStorage.setItem("rh." + key, v); } catch { /* private mode */ }
}
export type Theme = "system" | "light" | "dark";
export interface Panes { toc: boolean; book: boolean; cards: boolean }

export const prefs = {
  deviceId(): string { return get("deviceId") ?? "laptop-web"; },
  setDeviceId(v: string) { set("deviceId", v); },
  theme(): Theme { const t = get("theme"); return t === "light" || t === "dark" ? t : "system"; },
  setTheme(t: Theme) { set("theme", t === "system" ? null : t); },
  panes(kind: string): Panes {
    try { const p = JSON.parse(get("panes." + kind) ?? "null"); if (p && typeof p === "object") return { toc: !!p.toc, book: !!p.book, cards: !!p.cards }; } catch { /* ignore */ }
    return { toc: true, book: true, cards: true };
  },
  setPanes(kind: string, p: Panes) { set("panes." + kind, JSON.stringify(p)); },
  lastSource(): string | null { return get("lastSource"); },
  setLastSource(id: string) { set("lastSource", id); },
  /** Poll interval for library.json (ms). Default 10 s; tests set it lower. */
  pollMs(): number { const n = Number(get("pollMs")); return n >= 200 ? n : 10000; },
};

export function applyTheme(t: Theme): void {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
