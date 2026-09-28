/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createLibraryHandler } from "./server/handler.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const libraryDir = resolve(process.env.LIBRARY_DIR ?? resolve(here, ".scratch/library"));

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "rh-library",
      configureServer(server) {
        const handle = createLibraryHandler(libraryDir);
        server.middlewares.use((req, res, next) => { if (!handle(req, res)) next(); });
        server.config.logger.info(`  library folder: ${libraryDir}`);
      },
    },
  ],
  resolve: { alias: { "@rh/core": resolve(here, "../../packages/core/src/index.ts") } },
  server: { fs: { allow: [resolve(here, "../..")] } },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
