import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { "@rh/core": resolve(here, "../../packages/core/src/index.ts") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
