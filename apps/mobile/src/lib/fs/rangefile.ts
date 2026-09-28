// RangeFile: read bytes [start, end) of a file as UTF-8. Native side: android/app/src/main/java/io/onerobot/readinghelper/RangeFilePlugin.java
import { registerPlugin } from "@capacitor/core";

export interface RangeFilePlugin {
  /** path is absolute ("/storage/emulated/0/Syncthing/library/sources/s_booka/content.md").
   *  Resolves { data: string } (UTF-8), or rejects with code "NOT_FOUND" if the file is missing. */
  read(opts: { path: string; start: number; end: number }): Promise<{ data: string }>;
}

export const RangeFile = registerPlugin<RangeFilePlugin>("RangeFile");
