import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Logger, type RunningHub, setCliLauncher, startHub } from "@appshape/server";
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, Menu, shell } from "electron";
import { keychainKeyStore } from "./ai-key";
import { cliOnPath, refreshShim, setCliOnPath } from "./cli-path";
import { installUpdate, lastUpdate, setupUpdates } from "./updates";

/**
 * The desktop app: a window with the start page (open or create apps); boards open in the user's
 * browser. AppShape's server runs in this process, so no Node.js installation is needed for it.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** The bundled CLI and the built board, next to this file (see scripts/build.mjs). */
const CLI = join(here, "cli", "appshape.mjs");
const EDITOR = join(here, "cli", "editor");

// Coding agents start AppShape's MCP server with this app's executable in Node mode.
setCliLauncher({ command: process.execPath, args: [CLI], env: { ELECTRON_RUN_AS_NODE: "1" } });

let hub: RunningHub | undefined;
let win: BrowserWindow | undefined;
let quitting = false;

/** A log file for support (Help → Open log folder); boards' steps also go there. */
async function fileLogger(): Promise<Logger> {
  const dir = app.getPath("logs");
  await mkdir(dir, { recursive: true });
  const stream = createWriteStream(join(dir, "appshape.log"), { flags: "a" });
  const line = (level: string) => (message: string) => stream.write(`${new Date().toISOString()} ${level} ${message}\n`);
  return { info: line("info"), warn: line("warn"), error: line("error") };
}

function fromStartPage(event: IpcMainInvokeEvent): boolean {
  return Boolean(hub && event.senderFrame && new URL(event.senderFrame.url).origin === new URL(hub.url).origin);
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void {
  ipcMain.handle(`appshape:${channel}`, (event, ...args) => {
    if (!fromStartPage(event)) throw new Error("not allowed");
    return listener(event, ...(args as never[]));
  });
}

const isWebUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//.test(url);

function registerBridge(): void {
  handle("pick-folder", async (_event, options?: { title?: string; defaultPath?: string }) => {
    const result = await dialog.showOpenDialog(win!, {
      title: options?.title ?? "Choose a folder",
      ...(options?.defaultPath && { defaultPath: options.defaultPath }),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handle("open-external", async (_event, url: string) => {
    if (isWebUrl(url)) await shell.openExternal(url);
  });
  handle("update-state", () => lastUpdate());
  handle("install-update", async () => {
    quitting = true;
    await hub?.close();
    installUpdate();
  });
  handle("cli-on-path", () => cliOnPath());
  handle("set-cli-on-path", (_event, on: boolean) => setCliOnPath(Boolean(on), { exe: process.execPath, cli: CLI }));
}

function createWindow(): void {
  const origin = new URL(hub!.url).origin;
  win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 760,
    minHeight: 560,
    title: "AppShape",
    backgroundColor: "#FCFBFE",
    ...(existsSync(join(here, "icon.png")) && { icon: join(here, "icon.png") }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());
  // Links (downloads, docs) and boards open in the browser; the window only shows the start page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.origin === origin && target.pathname.startsWith("/start")) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });
  win.on("close", (event) => {
    const open = hub?.boards().length ?? 0;
    if (quitting || open === 0) return;
    const choice = dialog.showMessageBoxSync(win!, {
      type: "question",
      buttons: ["Close AppShape", "Keep it open"],
      defaultId: 1,
      cancelId: 1,
      title: "Close AppShape?",
      message: open === 1 ? "Your open board stops." : `Your ${open} open boards stop.`,
      detail: "Everything is saved. Open them again from the start window.",
    });
    if (choice !== 0) event.preventDefault();
  });
  win.on("closed", () => (win = undefined));
  void win.loadURL(hub!.startUrl);
}

function setMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "File", submenu: [{ role: "quit", label: "Close AppShape" }] },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
      { label: "Help", submenu: [{ label: "Open log folder", click: () => void shell.openPath(app.getPath("logs")) }] },
    ]),
  );
}

// Tests run with their own profile (logs, window state), so they don't meet an AppShape that is open.
if (process.env.APPSHAPE_USER_DATA) app.setPath("userData", process.env.APPSHAPE_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on("before-quit", (event) => {
    if (quitting || !hub) return;
    // stop the boards and the apps they started before leaving
    event.preventDefault();
    quitting = true;
    void hub.close().finally(() => app.exit(0));
  });
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    const log = await fileLogger();
    try {
      hub = await startHub({ version: app.getVersion(), editorDir: EDITOR, desktop: true, log, aiKeys: keychainKeyStore() });
    } catch (error) {
      log.error(`could not start: ${(error as Error).stack ?? error}`);
      dialog.showErrorBox("AppShape couldn't start", (error as Error).message);
      app.exit(1);
      return;
    }
    registerBridge();
    setMenu();
    void refreshShim({ exe: process.execPath, cli: CLI }).catch((error: Error) => log.warn(`command line: ${error.message}`));
    createWindow();
    setupUpdates((update) => win?.webContents.send("appshape:update", update), log);
  });
}
