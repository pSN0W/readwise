import { defineConfig, devices } from "@playwright/test";

const PORT = 8788; // not 8787, so a running production server does not clash with tests

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite build --logLevel warn && node scripts/scratch.ts e2e --fresh && node server/index.ts",
    env: { LIBRARY_DIR: ".scratch/e2e", PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
