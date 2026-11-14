// Builds the appshape command as one file (dist/appshape.mjs) next to the built board (dist/editor/).
// Used by the desktop app and, later, an npm release. Packages that read their own files at runtime
// stay outside the bundle and are installed next to it (see EXTERNAL).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const editor = resolve(cli, "..", "editor");
const out = join(cli, "dist");

/**
 * Not bundled: Playwright (drives the installed Edge/Chrome, ships its own scripts), lucide-static
 * (icon files) and tailwindcss (its theme.css as the default design system). None has dependencies.
 */
export const EXTERNAL = ["playwright-core", "lucide-static", "tailwindcss"];

/** ws's optional native helpers. */
export const OPTIONAL = ["bufferutil", "utf-8-validate"];

/** CommonJS dependencies (TypeScript, …) call require() for Node's own modules and read __filename. */
export const ESM_BANNER = [
  'import { createRequire as __apsCreateRequire } from "node:module";',
  'import { fileURLToPath as __apsFileURLToPath } from "node:url";',
  "const require = __apsCreateRequire(import.meta.url);",
  "const __filename = __apsFileURLToPath(import.meta.url);",
  'const __dirname = __filename.slice(0, Math.max(__filename.lastIndexOf("/"), __filename.lastIndexOf("\\\\")));',
].join("\n");

/** Version shown in the app: the release version (APPSHAPE_VERSION) or the CLI package's. */
const packageVersion = () => JSON.parse(readFileSync(join(cli, "package.json"), "utf8")).version;

/** Where an external package is installed (for copying it next to a bundle). */
export const externalDir = (name) => join(cli, "node_modules", name);

export async function buildCli({ skipEditor = false, version = process.env.APPSHAPE_VERSION ?? packageVersion() } = {}) {
  rmSync(out, { recursive: true, force: true });
  await build({
    entryPoints: { appshape: join(cli, "src", "main.ts") },
    outdir: out,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: [...EXTERNAL, ...OPTIONAL],
    define: { __APPSHAPE_BUNDLE__: "true", __APPSHAPE_VERSION__: JSON.stringify(version) },
    banner: { js: ESM_BANNER },
    legalComments: "linked",
    logLevel: "warning",
  });

  if (!skipEditor) {
    const vite = spawnSync(process.execPath, [join(editor, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: editor, stdio: "inherit" });
    if (vite.status !== 0) throw new Error("building the editor failed");
  }
  if (!existsSync(join(editor, "dist", "index.html"))) throw new Error("the editor is not built");
  cpSync(join(editor, "dist"), join(out, "editor"), { recursive: true });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildCli({ skipEditor: process.argv.includes("--skip-editor") });
  console.log(`Built ${out}`);
}
