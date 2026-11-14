import type { FolderInfo, FolderListing, HubCheck, HubCreateRequest, HubOpenResponse, HubState } from "@appshape/protocol";
import { TOKEN_HEADER } from "@appshape/protocol";

/** The desktop app's bridge (its preload script); absent in the browser. */
export interface DesktopBridge {
  pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  /** Update status from GitHub releases; returns the unsubscribe function. */
  onUpdate(listener: (update: DesktopUpdate) => void): () => void;
  installUpdate(): void;
  /** The `appshape` command in terminals. */
  cliOnPath(): Promise<CliOnPath>;
  setCliOnPath(on: boolean): Promise<CliOnPath>;
}

export interface CliOnPath {
  on: boolean;
  dir: string;
  /** The PATH couldn't be changed automatically: add `dir` yourself. */
  manual: boolean;
}

export type DesktopUpdate = { state: "downloading"; version: string; percent?: number } | { state: "ready"; version: string };

declare global {
  interface Window {
    appshapeDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.appshapeDesktop;

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { [TOKEN_HEADER]: token, "content-type": "application/json", ...init.headers } });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      // plain text
    }
    throw new Error(message || `${response.status}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const hubApi = {
  state: (token: string) => call<HubState>(token, "/api/hub"),
  checks: (token: string, refresh = false) => call<HubCheck[]>(token, `/api/hub/checks${refresh ? "?refresh=1" : ""}`),
  folder: (token: string, path: string) => call<FolderInfo>(token, `/api/hub/folder?path=${encodeURIComponent(path)}`),
  folders: (token: string, path?: string) => call<FolderListing>(token, `/api/hub/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  open: (token: string, path: string, importPages = false) => call<HubOpenResponse>(token, "/api/hub/open", { method: "POST", body: JSON.stringify({ path, importPages }) }),
  create: (token: string, request: HubCreateRequest) => call<HubOpenResponse>(token, "/api/hub/create", { method: "POST", body: JSON.stringify(request) }),
  stop: (token: string, path: string) => call<void>(token, "/api/hub/stop", { method: "POST", body: JSON.stringify({ path }) }),
  forget: (token: string, path: string) => call<void>(token, "/api/hub/forget", { method: "POST", body: JSON.stringify({ path }) }),
};

/** Opens a board: in the browser from the desktop app, in this tab from the browser start page. */
export async function showBoard(url: string): Promise<void> {
  const bridge = desktop();
  if (bridge) await bridge.openExternal(url);
  else window.location.assign(url);
}
