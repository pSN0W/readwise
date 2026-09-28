// Platform bits: native vs browser, clipboard, "All files access", app resume.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { App as CapApp } from "@capacitor/app";

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** Copy text. Returns false if the platform refused (then the UI shows the text to copy by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isNative()) { await Clipboard.write({ string: text }); return true; }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Small native plugin in android/app/src/main/java/.../AllFilesPlugin.java. */
interface AllFilesPlugin {
  isGranted(): Promise<{ granted: boolean }>;
  openSettings(): Promise<void>;
}
const AllFiles = registerPlugin<AllFilesPlugin>("AllFiles");

export async function allFilesGranted(): Promise<boolean | null> {
  if (!isNative()) return true;
  try { return (await AllFiles.isGranted()).granted; } catch { return null; }
}

export async function openAllFilesSettings(): Promise<void> {
  if (isNative()) await AllFiles.openSettings().catch(() => {});
}

/** Calls fn when the app comes back to the front. Returns an unsubscribe function. */
export function onResume(fn: () => void, onPause?: () => void): () => void {
  const vis = () => { if (document.visibilityState === "visible") fn(); else onPause?.(); };
  document.addEventListener("visibilitychange", vis);
  let sub: { remove: () => Promise<void> } | null = null;
  let sub2: { remove: () => Promise<void> } | null = null;
  if (isNative()) {
    void CapApp.addListener("resume", fn).then((s) => { sub = s; });
    if (onPause) void CapApp.addListener("pause", onPause).then((s) => { sub2 = s; });
  }
  return () => { document.removeEventListener("visibilitychange", vis); void sub?.remove(); void sub2?.remove(); };
}

/** Android back button → history back; at the feed root it leaves the app. */
export function onBackButton(): void {
  if (!isNative()) return;
  void CapApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && location.hash && location.hash !== "#/feed") history.back();
    else void CapApp.minimizeApp();
  });
}

export function store(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storeSet(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
}
