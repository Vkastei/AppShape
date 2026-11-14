import { defineConfig } from "@playwright/test";

// The main loop with a real coding agent: one long test per scenario.
//   pnpm agent:loop                      # every scenario with Claude Code (Sonnet)
//   LOOP_MODEL=opus pnpm agent:loop -g B # one scenario, another model
//   LOOP_AGENT=dry pnpm agent:loop       # no agent: the harness and the "nothing done" baseline
export default defineConfig({
  testDir: "loop",
  timeout: 75 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "loop-runs/.playwright",
  use: {
    channel: process.env.APPSHAPE_BROWSER ?? "msedge",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    // a step that can never happen fails fast instead of waiting for the test timeout
    actionTimeout: 30_000,
  },
});
