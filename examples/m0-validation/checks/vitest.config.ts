import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Acceptance checks for the M0 agent runs. Point APPSHAPE_FIXTURE_DIR at another copy of the fixture if needed. */
const fixture =
  process.env.APPSHAPE_FIXTURE_DIR ?? fileURLToPath(new URL("../../../fixtures/vite-react-router-tw4", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: { "@fixture": fixture },
    dedupe: ["react", "react-dom", "react-router"],
  },
  test: {
    include: ["checks/**/*.check.ts"],
    environment: "node",
  },
});
