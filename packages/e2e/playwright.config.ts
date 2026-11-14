import { defineConfig } from "@playwright/test";

// Uses an installed browser (no download needed). Override with APPSHAPE_BROWSER=chrome.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: process.env.APPSHAPE_BROWSER ?? "msedge",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
