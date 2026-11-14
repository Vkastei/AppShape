import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliLauncher } from "@appshape/server";

/** Set to true by the build (`scripts/build.mjs`): the CLI runs as one bundled file next to the built editor. */
declare const __APPSHAPE_BUNDLE__: boolean | undefined;
declare const __APPSHAPE_VERSION__: string | undefined;
export const BUNDLED = typeof __APPSHAPE_BUNDLE__ !== "undefined" && __APPSHAPE_BUNDLE__;
/** AppShape's version (the build sets it; "dev" in the repo). */
export const VERSION = typeof __APPSHAPE_VERSION__ !== "undefined" ? __APPSHAPE_VERSION__ : "dev";

const here = dirname(fileURLToPath(import.meta.url));

/** The editor's source folder (repo only; undefined in a bundle). */
export const EDITOR_ROOT = BUNDLED ? undefined : resolve(here, "..", "..", "editor");

/** The built editor: `editor/` next to the bundle, or the editor package's `dist/`. */
export const EDITOR_DIST = BUNDLED ? join(here, "editor") : resolve(here, "..", "..", "editor", "dist");

export const editorBuilt = () => existsSync(join(EDITOR_DIST, "index.html"));

/**
 * How the bundled CLI starts itself (for agents' MCP config): Node with this file, or the desktop
 * app's executable in Node mode.
 */
export function bundledLauncher(): CliLauncher {
  return {
    command: process.execPath,
    args: [fileURLToPath(import.meta.url)],
    ...(process.versions.electron && { env: { ELECTRON_RUN_AS_NODE: "1" } }),
  };
}
