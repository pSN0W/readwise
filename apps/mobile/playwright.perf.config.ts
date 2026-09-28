import { defineConfig } from "@playwright/test";

// Performance run: production build (vite preview) over the synthetic library (.scratch/synth).
// Pixel 7 size, touch, 4x CPU throttling (set in the spec through CDP).
export default defineConfig({
  testDir: "e2e",
  testMatch: ["perf.spec.ts"],
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "npx vite preview --port 5174",
    env: { RH_LIBRARY: ".scratch/synth" },
    url: "http://127.0.0.1:5174/__lib/f/library.json",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
