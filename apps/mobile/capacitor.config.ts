import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.onerobot.readinghelper",
  appName: "Reading Helper",
  webDir: "dist",
  android: { allowMixedContent: false },
};

export default config;
