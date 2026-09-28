import { defineConfig } from "@playwright/test";

// E2E on a scratch copy of the fixture (.scratch/e2e-library). Pixel-size viewport with touch.
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["perf.spec.ts"],
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/make-scratch.mjs .scratch/e2e-library && npx vite --port 5174",
    env: { RH_LIBRARY: ".scratch/e2e-library" },
    url: "http://127.0.0.1:5174/__lib/f/library.json",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
