import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { devfsPlugin } from "./server/devfs-plugin.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const core = resolve(here, "../../packages/core/src/index.ts");
// Library folder served by the dev file adapter. Default: a scratch copy of the fixture.
const libraryRoot = resolve(here, process.env.RH_LIBRARY ?? ".scratch/library");

export default defineConfig({
  base: "./",
  plugins: [svelte(), devfsPlugin(libraryRoot)],
  resolve: { alias: { "@rh/core": core } },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, fs: { allow: [here, resolve(here, "../../packages/core")] } },
  preview: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
