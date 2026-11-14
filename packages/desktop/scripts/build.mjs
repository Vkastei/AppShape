// Stages the desktop app in app/: the bundled CLI and board (cli/), the Electron main process with
// AppShape's server (main.mjs), the preload script, and the few packages that stay outside the
// bundles (node_modules/). electron-builder packs app/ (see electron-builder.config.cjs).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildCli, ESM_BANNER, EXTERNAL, externalDir, OPTIONAL } from "../../cli/scripts/build.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(desktop, "app");
const manifest = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const version = process.env.APPSHAPE_VERSION ?? manifest.version;

/** Only what AppShape reads from a package (lucide-static ships fonts and JS builds of every icon). */
const KEEP = {
  "lucide-static": (path) => path === "" || path === "package.json" || path === "LICENSE" || path === "tags.json" || path === "icons" || path.startsWith(`icons${sep}`),
};

// Electron downloads its binary on first use; make sure it is there for `electron app` and the packager.
const electronDir = join(desktop, "node_modules", "electron");
if (!existsSync(join(electronDir, "path.txt"))) {
  const result = spawnSync(process.execPath, [join(electronDir, "install.js")], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("downloading Electron failed");
}

const cliDist = await buildCli({ version, skipEditor: process.argv.includes("--skip-editor") });

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(cliDist, join(app, "cli"), { recursive: true });

await build({
  entryPoints: { main: join(desktop, "src", "main.ts") },
  outdir: app,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", ...EXTERNAL, ...OPTIONAL],
  banner: { js: ESM_BANNER },
  legalComments: "linked",
  logLevel: "warning",
});
// the window's icon (taskbar, title bar)
cpSync(join(desktop, "build", "icon.png"), join(app, "icon.png"));

await build({
  entryPoints: { preload: join(desktop, "src", "preload.ts") },
  outdir: app,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "warning",
});

const dependencies = {};
for (const name of EXTERNAL) {
  const source = realpathSync(externalDir(name));
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (Object.keys(pkg.dependencies ?? {}).length) throw new Error(`${name} has dependencies now; copy them too`);
  const keep = KEEP[name];
  cpSync(source, join(app, "node_modules", name), { recursive: true, dereference: true, filter: (src) => !keep || keep(relative(source, src)) });
  dependencies[name] = pkg.version;
}

writeFileSync(
  join(app, "package.json"),
  `${JSON.stringify(
    {
      name: "appshape",
      productName: "AppShape",
      version,
      description: "Design apps on a board; AppShape and your coding AI write the code.",
      author: "AppShape contributors",
      license: manifest.license,
      type: "module",
      main: "main.mjs",
      dependencies,
    },
    null,
    2,
  )}\n`,
);
console.log(`Staged AppShape ${version} in ${app}`);
