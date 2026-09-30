// Platform bits: native vs browser, clipboard, "All files access", app resume.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { App as CapApp } from "@capacitor/app";

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const isIOS = (): boolean => Capacitor.getPlatform() === "ios";

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

/** Only Android needs "All files access"; iOS gets access to the folder the user picks. */
export const needsAllFiles = (): boolean => Capacitor.getPlatform() === "android";

export async function allFilesGranted(): Promise<boolean | null> {
  if (!needsAllFiles()) return true;
  try { return (await AllFiles.isGranted()).granted; } catch { return null; }
}

export async function openAllFilesSettings(): Promise<void> {
  if (needsAllFiles()) await AllFiles.openSettings().catch(() => {});
}

/** Native folder picker: FolderPickerPlugin.java (Android) and ReadingHelperPlugins.swift (iOS). */
interface FolderPickerPlugin {
  pick(): Promise<{ path: string }>;
  /** iOS only: re-open the saved folder after a restart. */
  restore(): Promise<{ path?: string }>;
}
const FolderPicker = registerPlugin<FolderPickerPlugin>("FolderPicker");

/** Opens the system folder picker. Resolves the folder's absolute path, or null if cancelled. Throws with a message the UI can show. */
export async function pickFolder(): Promise<string | null> {
  try {
    return (await FolderPicker.pick()).path;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "CANCELLED") return null;
    throw new Error(err.code === "UNIMPLEMENTED" ? "Folder picker needs a newer app build. Type the path instead." : err.message ?? "Cannot open the folder picker.");
  }
}

/** iOS: regain access to the picked folder (its path can change after an app update). Null if none or not iOS. */
export async function restoreFolder(): Promise<string | null> {
  if (!isIOS()) return null;
  try { return (await FolderPicker.restore()).path ?? null; } catch { return null; }
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
