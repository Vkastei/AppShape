import type { Logger } from "@appshape/server";
import { app } from "electron";
import electronUpdater from "electron-updater";

/** Updates from the GitHub releases (installed builds only): downloaded in the background, installed on restart. */

export type UpdateState = { state: "downloading"; version: string; percent?: number } | { state: "ready"; version: string };

let state: UpdateState | undefined;
const { autoUpdater } = electronUpdater;

export const lastUpdate = () => state;

export function setupUpdates(send: (update: UpdateState) => void, log: Logger): void {
  // dev runs and builds without a release feed (no app-update.yml) don't update
  if (!app.isPackaged) return;
  autoUpdater.logger = { info: (m: unknown) => log.info(`update: ${m}`), warn: (m: unknown) => log.warn(`update: ${m}`), error: (m: unknown) => log.error(`update: ${m}`), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let version = "";
  const update = (next: UpdateState) => {
    state = next;
    send(next);
  };
  autoUpdater.on("update-available", (info) => {
    version = info.version;
    update({ state: "downloading", version });
  });
  autoUpdater.on("download-progress", (progress) => update({ state: "downloading", version, percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => update({ state: "ready", version: info.version }));
  autoUpdater.on("error", (error) => log.warn(`update check failed: ${error.message}`));
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000).unref();
}

export function installUpdate(): void {
  // silent install, then start the new version
  autoUpdater.quitAndInstall(true, true);
}
