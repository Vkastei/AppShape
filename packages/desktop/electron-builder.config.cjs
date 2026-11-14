// Packs app/ (staged by scripts/build.mjs) into installers. Windows first: a per-user NSIS installer
// that needs no admin rights. Releases on GitHub double as the update feed (electron-updater); the
// repository comes from GitHub Actions (GITHUB_REPOSITORY), local builds have no update feed.
const { version: electronVersion } = require("electron/package.json");

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "dev.appshape.desktop",
  productName: "AppShape",
  copyright: "AppShape contributors",
  electronVersion,
  directories: { app: "app", output: "release", buildResources: "build" },
  // Coding agents start the bundled CLI (app/cli/appshape.mjs) with AppShape's executable in Node
  // mode, and Playwright reads its own files: plain files are simpler than an asar archive.
  asar: false,
  npmRebuild: false,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "AppShape",
    artifactName: "AppShape-Setup-${version}.${ext}",
    deleteAppDataOnUninstall: false,
  },
  mac: { target: ["dmg"], category: "public.app-category.developer-tools", icon: "build/icon.png" },
  linux: { target: ["AppImage"], category: "Development", icon: "build/icon.png" },
  ...(owner && repo && { publish: [{ provider: "github", owner, repo, releaseType: "draft" }] }),
};
