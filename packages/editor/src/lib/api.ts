import type { AgentRun, AgentRunStatus, AiEstimate, AiStatus, AiUpdate } from "@appshape/protocol";
import {
  type AgentId,
  type AppProcessStatus,
  type AppStylesResponse,
  type ClientMessage,
  type CodeApplyRequest,
  type CodeApplyResponse,
  type CodePlanResponse,
  type CodeStatusResponse,
  type FontCatalogResponse,
  type IconListResponse,
  type ImportRequest,
  type ImportResponse,
  type ImportStatusResponse,
  type InstalledFontsResponse,
  type LogEntry,
  type ProjectSnapshot,
  type ServerMessage,
  type SettingsResponse,
  type SettingsUpdate,
  ServerMessageSchema,
  type StackId,
  TOKEN_HEADER,
  type UiState,
  type UploadedAsset,
  type VerifyRequest,
  type VerifyResponse,
} from "@appshape/protocol";

const TOKEN_KEY = "appshape-token";

let launchAction: string | undefined;
let launchPage: string | undefined;

/** What the start page asked the board to do first (`#token=…&open=import`), once. */
export function takeLaunchAction(): string | undefined {
  const action = launchAction;
  launchAction = undefined;
  return action;
}

/** The page template a new app starts with (`&page=landing`, from the new-app wizard), once. */
export function takeLaunchPage(): string | undefined {
  const page = launchPage;
  launchPage = undefined;
  return page;
}

/** The CLI opens `/#token=…`; keep it for this tab and remove it from the address bar. */
export function readToken(): string | undefined {
  const match = /token=([^&]+)/.exec(window.location.hash);
  if (match) {
    launchAction = /[#&]open=([a-z]+)/.exec(window.location.hash)?.[1];
    launchPage = /[#&]page=([a-z-]+)/.exec(window.location.hash)?.[1];
    sessionStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]!));
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, headers: { [TOKEN_HEADER]: token, "content-type": "application/json", ...init.headers } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
}

export async function fetchSnapshot(token: string): Promise<ProjectSnapshot> {
  return (await (await request(token, "/api/project")).json()) as ProjectSnapshot;
}

export async function fetchUiState(token: string): Promise<UiState> {
  return (await (await request(token, "/api/ui-state")).json()) as UiState;
}

export async function saveUiState(token: string, state: UiState): Promise<void> {
  await request(token, "/api/ui-state", { method: "PUT", body: JSON.stringify(state) });
}

export function assetUrl(token: string, src: string): string {
  return `/api/assets/${encodeURI(src.slice("asset:".length))}?token=${encodeURIComponent(token)}`;
}

/** Root-relative images of imported pages are files in the app's `public/` folder. */
export function appPublicUrl(token: string, src: string): string {
  return src.startsWith("/") && !src.startsWith("//") ? `/api/app-public${encodeURI(src)}?token=${encodeURIComponent(token)}` : src;
}

export function iconUrl(token: string, set: string, name: string): string | undefined {
  return set === "lucide" && /^[a-z0-9-]+$/.test(name) ? `/api/icons/lucide/${name}.svg?token=${encodeURIComponent(token)}` : undefined;
}

/** WebSocket to the server with automatic reconnect. */
export class Connection {
  private socket: WebSocket | undefined;
  private closed = false;
  private retry: number | undefined;

  constructor(
    private readonly token: string,
    private readonly handlers: {
      onMessage: (message: ServerMessage) => void;
      onStatus: (connected: boolean) => void;
    },
  ) {
    this.connect();
  }

  private connect(): void {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/ws?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    socket.onopen = () => this.handlers.onStatus(true);
    socket.onmessage = (event) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) this.handlers.onMessage(parsed.data);
      else console.warn("appshape: unexpected message", parsed.error);
    };
    socket.onclose = () => {
      this.handlers.onStatus(false);
      if (!this.closed) this.retry = window.setTimeout(() => this.connect(), 1000);
    };
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.retry);
    this.socket?.close();
  }
}

// ---- Applying the design to code

async function json<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { [TOKEN_HEADER]: token, "content-type": "application/json", ...init.headers } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${init.method ?? "GET"} ${path}: ${response.status}`);
  return body;
}

export const codeStatus = (token: string) => json<CodeStatusResponse>(token, "/api/code");
export const codePlan = (token: string, stack?: StackId) => json<CodePlanResponse>(token, "/api/code/plan", { method: "POST", body: JSON.stringify(stack ? { stack } : {}) });
export const codeApply = (token: string, request: CodeApplyRequest) => json<CodeApplyResponse>(token, "/api/code/apply", { method: "POST", body: JSON.stringify(request) });
export const codeProcess = (token: string) => json<AppProcessStatus>(token, "/api/code/process");
export const codeRun = (token: string) => json<AppProcessStatus>(token, "/api/code/run", { method: "POST" });
export const codeStop = (token: string) => json<AppProcessStatus>(token, "/api/code/stop", { method: "POST" });

// ---- Importing pages of the app

export const importStatus = (token: string) => json<ImportStatusResponse>(token, "/api/import");
export const importDev = (token: string) => json<AppProcessStatus>(token, "/api/import/dev", { method: "POST" });
export const importPages = (token: string, request: ImportRequest) => json<ImportResponse>(token, "/api/import", { method: "POST", body: JSON.stringify(request) });
export const fetchSettings = (token: string) => json<SettingsResponse>(token, "/api/settings");
export const saveSettings = (token: string, update: SettingsUpdate) => json<SettingsResponse>(token, "/api/settings", { method: "PUT", body: JSON.stringify(update) });
export const connectAgentApi = (token: string, id: AgentId) => json<SettingsResponse>(token, `/api/agents/${id}`, { method: "POST" });
export const disconnectAgentApi = (token: string, id: AgentId) => json<SettingsResponse>(token, `/api/agents/${id}`, { method: "DELETE" });
export const fetchLogs = (token: string) => json<{ entries: LogEntry[] }>(token, "/api/logs");
export const verifyApp = (token: string, request: VerifyRequest) => json<VerifyResponse>(token, "/api/verify", { method: "POST", body: JSON.stringify(request) });
/** Screenshots and diff images of a verification (path relative to the data folder). */
export const verifyFileUrl = (token: string, path: string) => `/api/verify/files/${path.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(token)}`;
export const fetchAppStyles = (token: string) => json<AppStylesResponse>(token, "/api/app-styles");
let icons: Promise<IconListResponse> | undefined;
/** Fetched once per session. */
export const fetchIcons = (token: string) => (icons ??= json<IconListResponse>(token, "/api/icons/lucide").catch((error: unknown) => {
  icons = undefined;
  throw error;
}));
export const openCaptureBrowser = (token: string, devUrl?: string) => json<{ open: boolean }>(token, "/api/import/browser", { method: "POST", body: JSON.stringify(devUrl ? { devUrl } : {}) });
export const closeCaptureBrowser = (token: string) => json<{ open: boolean }>(token, "/api/import/browser", { method: "DELETE" });

/** Stores an image file in `.appshape/assets/uploads`; resolves to its `asset:` source. */
export async function uploadAsset(token: string, file: Blob, name: string): Promise<string> {
  const response = await fetch(`/api/assets?name=${encodeURIComponent(name)}`, { method: "POST", body: file, headers: { [TOKEN_HEADER]: token, "content-type": file.type || "application/octet-stream" } });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as UploadedAsset).src;
}

export async function fetchFontCatalog(token: string): Promise<FontCatalogResponse> {
  return (await (await request(token, "/api/fonts/catalog")).json()) as FontCatalogResponse;
}

export async function fetchInstalledFonts(token: string): Promise<InstalledFontsResponse> {
  return (await (await request(token, "/api/fonts")).json()) as InstalledFontsResponse;
}

/** Downloads a Google Fonts family into the project (self-hosted). */
export async function installFont(token: string, family: string): Promise<InstalledFontsResponse> {
  const response = await fetch("/api/fonts", { method: "POST", body: JSON.stringify({ family }), headers: { [TOKEN_HEADER]: token, "content-type": "application/json" } });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as InstalledFontsResponse;
}

/** CSS for classes kept as they are (Tailwind utilities with the project's theme), for the board. */
export async function fetchBoardCss(token: string, classes: string[]): Promise<string> {
  const response = await request(token, "/api/board-css", { method: "POST", body: JSON.stringify({ classes }) });
  return ((await response.json()) as { css: string }).css;
}

// ---- AppShape's AI (Draw & describe)

export const aiStatus = (token: string) => json<AiStatus>(token, "/api/ai");
export const saveAi = (token: string, update: AiUpdate) => json<AiStatus>(token, "/api/ai", { method: "PUT", body: JSON.stringify(update) });
export const aiEstimate = (token: string, requestId: string) => json<AiEstimate>(token, `/api/requests/${encodeURIComponent(requestId)}/estimate`);
export const startDesign = (token: string, requestId: string) => json<{ started: boolean; model: string }>(token, `/api/requests/${encodeURIComponent(requestId)}/design`, { method: "POST" });
export const cancelDesign = (token: string, requestId: string) => json<unknown>(token, `/api/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST" });
export const agentRunStatus = (token: string) => json<AgentRunStatus>(token, "/api/agent-run");
export const startAgentRun = (token: string, prompt: string) => json<AgentRun>(token, "/api/agent-run", { method: "POST", body: JSON.stringify({ prompt }) });
export const stopAgentRun = (token: string) => json<AgentRunStatus>(token, "/api/agent-run/stop", { method: "POST" });
export const saveAgentRunSettings = (token: string, autoStart: boolean) => json<AgentRunStatus>(token, "/api/agent-run/settings", { method: "PUT", body: JSON.stringify({ autoStart }) });
