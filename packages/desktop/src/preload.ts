// The start page's bridge to the desktop app (window.appshapeDesktop); see editor/src/start/hub.ts.
// Built as CommonJS (sandboxed preload scripts can't be modules).
import { contextBridge, ipcRenderer } from "electron";

type Listener = (update: unknown) => void;

contextBridge.exposeInMainWorld("appshapeDesktop", {
  pickFolder: (options?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke("appshape:pick-folder", options),
  openExternal: (url: string) => ipcRenderer.invoke("appshape:open-external", url),
  onUpdate: (listener: Listener) => {
    const handler = (_event: unknown, update: unknown) => listener(update);
    ipcRenderer.on("appshape:update", handler);
    void ipcRenderer.invoke("appshape:update-state").then((update: unknown) => update && listener(update));
    return () => ipcRenderer.removeListener("appshape:update", handler);
  },
  installUpdate: () => ipcRenderer.invoke("appshape:install-update"),
  cliOnPath: () => ipcRenderer.invoke("appshape:cli-on-path"),
  setCliOnPath: (on: boolean) => ipcRenderer.invoke("appshape:set-cli-on-path", on),
});
