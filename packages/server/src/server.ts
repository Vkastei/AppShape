import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { serve } from "@hono/node-server";
import {
  ClientMessageSchema,
  type ServerMessage,
  TOKEN_HEADER,
  UI_STATE_FILE,
  UiStateSchema,
} from "@appshape/protocol";
import { type AnyOp, type Changeset, createId, type Tokens } from "@appshape/ir";
import { themeBlock } from "@appshape/codegen";
import { defaultTokens, utilitiesCss } from "@appshape/dialect-tailwind";
import { type DataLocation, writeFileAtomic } from "@appshape/store";
import { Hono } from "hono";
import { type WebSocket, WebSocketServer } from "ws";
import { AppProcess } from "@appshape/capture";
import { agentRunRoutes } from "./agent-runs";
import { type AiKeyStore, aiRoutes, type AiRoutesOptions, envKeyStore } from "./ai-routes";
import { assetRoutes } from "./asset-routes";
import { codeRoutes } from "./code-routes";
import { EventLog } from "./events";
import { importRoutes } from "./import-routes";
import { settingsRoutes } from "./settings-routes";
import { verifyRoutes } from "./verify-routes";
import { type Logger, ProjectSession } from "./session";

export interface ServerOptions {
  location: DataLocation;
  /** 0 = pick a free port. */
  port?: number;
  /** Fixed token (development); random by default. */
  token?: string;
  /** Built editor to serve at `/`. */
  editorDir?: string;
  /** Extra origins allowed to open the WebSocket (e.g. the Vite dev server). */
  allowedOrigins?: string[];
  saveDelayMs?: number;
  log?: Logger;
  /** Where AppShape's AI gets the API key (default: ANTHROPIC_API_KEY). */
  aiKeys?: AiKeyStore;
  /** A design provider instead of the Claude API (tests). */
  aiProvider?: AiRoutesOptions["provider"];
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  session: ProjectSession;
  close(): Promise<void>;
}

export const HOST = "127.0.0.1";

const consoleLogger: Logger = {
  info: (m) => console.log(`[appshape] ${m}`),
  warn: (m) => console.warn(`[appshape] ${m}`),
  error: (m) => console.error(`[appshape] ${m}`),
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
};

export function sameToken(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Reads `relative` below `root`; refuses anything that escapes it. */
export async function readInside(root: string, relative: string): Promise<{ content: Uint8Array<ArrayBuffer>; type: string } | undefined> {
  if (!relative) return undefined;
  const file = resolve(root, normalize(decodeURIComponent(relative)));
  if (!file.startsWith(root + sep)) return undefined;
  try {
    return { content: new Uint8Array(await readFile(file)) as Uint8Array<ArrayBuffer>, type: MIME[extname(file).toLowerCase()] ?? "application/octet-stream" };
  } catch {
    return undefined;
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  // Everything the server does, for the editor's toasts and log panel (and the console).
  const log = new EventLog(options.log ?? consoleLogger);
  const token = options.token ?? randomBytes(24).toString("base64url");
  const session = new ProjectSession(options.location, log, options.saveDelayMs);
  const sockets = new Set<WebSocket>();
  const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message));
  log.subscribe((entry) => {
    for (const socket of sockets) send(socket, { type: "log", entry });
  });

  // Changeset statuses as last seen, so status changes by an agent (files on disk) are reported.
  let knownChangesets: Changeset[] = [];
  await session.open((snapshot, paths) => {
    log.changesetChanges(knownChangesets, snapshot.project.changesets);
    knownChangesets = snapshot.project.changesets;
    for (const socket of sockets) send(socket, { type: "reset", reason: `changed on disk: ${paths.join(", ")}`, snapshot });
  });
  knownChangesets = session.snapshot().project.changesets;

  let port = 0;
  const allowedHosts = () => [`${HOST}:${port}`, `localhost:${port}`];
  const allowedOrigins = () => [`http://${HOST}:${port}`, `http://localhost:${port}`, ...(options.allowedOrigins ?? [])];

  const app = new Hono();
  // Blocks DNS rebinding: only requests addressed to this local server are answered.
  app.use("*", async (c, next) => {
    if (!allowedHosts().includes(c.req.header("host") ?? "")) return c.text("forbidden host", 403);
    await next();
  });
  app.use("/api/*", async (c, next) => {
    const provided = c.req.header(TOKEN_HEADER) ?? c.req.query("token");
    if (!sameToken(provided, token)) return c.text("missing or invalid token", 401);
    await next();
  });

  app.get("/api/project", (c) => c.json(session.snapshot()));
  app.get("/api/logs", (c) => c.json({ entries: log.recent() }));

  const uiStatePath = join(options.location.dataDir, ...UI_STATE_FILE.split("/"));
  app.get("/api/ui-state", async (c) => {
    try {
      return c.json(UiStateSchema.parse(JSON.parse(await readFile(uiStatePath, "utf8"))));
    } catch {
      return c.json({});
    }
  });
  app.put("/api/ui-state", async (c) => {
    const parsed = UiStateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.text("invalid ui state", 400);
    // a patch: what isn't sent stays (the camera and ignored checks are saved separately)
    const before = await readFile(uiStatePath, "utf8")
      .then((text) => UiStateSchema.parse(JSON.parse(text)))
      .catch(() => ({}));
    await writeFileAtomic(uiStatePath, `${JSON.stringify({ ...before, ...parsed.data }, null, 2)}\n`);
    return c.body(null, 204);
  });

  // One app process (dev server) for running the app and for importing from it.
  const appProcess = new AppProcess(options.location.appRoot);
  log.watchApp(appProcess);
  // Project changes made by the server itself (changesets of an apply or a verification) go to every open editor.
  const publish = (reason: string) => {
    const snapshot = session.snapshot();
    knownChangesets = snapshot.project.changesets;
    for (const socket of sockets) send(socket, { type: "reset", reason, snapshot });
  };
  codeRoutes(app, session, options.location, log, appProcess, publish);
  const verification = verifyRoutes(app, session, options.location, log, appProcess, publish);
  settingsRoutes(app, session, options.location, log, publish);
  // Changes made on the server (captures from the capture browser) go to every open editor.
  const applyFromServer = (ops: AnyOp[]): boolean => {
    const command = { id: createId("c"), ops };
    const result = session.apply(command);
    if (!result.ok) {
      log.warn(`could not apply: ${result.error}`);
      return false;
    }
    for (const socket of sockets) send(socket, { type: "applied", rev: result.rev, command });
    return true;
  };
  const imports = importRoutes(app, session, options.location, log, appProcess, readInside, token, applyFromServer);
  const ai = aiRoutes(app, session, options.location, log, applyFromServer, { keys: options.aiKeys ?? envKeyStore, ...(options.aiProvider && { provider: options.aiProvider }) });

  const agentRuns = agentRunRoutes(app, options.location, log);
  assetRoutes(app, options.location, log);

  // CSS for classes the design keeps as they are ("Classes" in the inspector), so the board shows them.
  let defaults: Promise<Tokens> | undefined;
  const boardCss = new Map<string, Promise<string>>();
  app.post("/api/board-css", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { classes?: unknown } | undefined;
    const classes = Array.isArray(body?.classes) ? body.classes.filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, 2000) : [];
    const tokens = session.snapshot().project.tokens;
    const key = JSON.stringify([classes.toSorted(), tokens]);
    if (!boardCss.has(key)) {
      if (boardCss.size > 50) boardCss.clear();
      defaults ??= defaultTokens();
      boardCss.set(key, defaults.then((d) => utilitiesCss(classes, themeBlock(tokens, d))));
    }
    try {
      return c.json({ css: await boardCss.get(key)! });
    } catch (error) {
      boardCss.delete(key);
      return c.json({ error: (error as Error).message }, 500);
    }
  });
  app.get("/api/assets/*", async (c) => {
    const data = await readInside(resolve(options.location.dataDir, "assets"), c.req.path.slice("/api/assets/".length));
    // Uploaded files are shown as images, never run: an SVG with a script opened directly can't touch the board.
    return data
      ? c.body(data.content, 200, { "content-type": data.type, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" })
      : c.text("not found", 404);
  });

  if (options.editorDir) {
    const root = resolve(options.editorDir);
    app.get("*", async (c) => {
      const data = (await readInside(root, c.req.path.slice(1))) ?? (await readInside(root, "index.html"));
      if (!data) return c.text("editor not built", 404);
      return c.body(data.content, 200, { "content-type": data.type, "cache-control": "no-cache" });
    });
  }

  const server = await new Promise<Server>((resolveServer) => {
    const s = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: HOST }, () => resolveServer(s as Server));
  });
  port = (server.address() as AddressInfo).port;

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const origin = request.headers.origin;
    const ok =
      url.pathname === "/api/ws" &&
      allowedHosts().includes(request.headers.host ?? "") &&
      (origin === undefined || allowedOrigins().includes(origin)) &&
      sameToken(url.searchParams.get("token") ?? undefined, token);
    if (!ok) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws: WebSocket) => {
    sockets.add(ws);
    send(ws, { type: "hello", rev: session.currentRev });
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const commandId = (raw as { command?: { id?: unknown } })?.command?.id;
        send(ws, { type: "reject", commandId: typeof commandId === "string" ? commandId : "", error: "invalid message", rev: session.currentRev });
        return;
      }
      const { command } = parsed.data;
      const result = session.apply(command);
      if (!result.ok) {
        send(ws, { type: "reject", commandId: command.id, error: result.error, rev: result.rev });
        return;
      }
      send(ws, { type: "ack", commandId: command.id, rev: result.rev });
      for (const other of sockets) if (other !== ws) send(other, { type: "applied", rev: result.rev, command });
    });
  });

  const url = `http://${HOST}:${port}`;
  return {
    url,
    port,
    token,
    session,
    async close() {
      for (const socket of sockets) socket.close();
      wss.close();
      await imports.close();
      await ai.close();
      await agentRuns.close();
      await verification.close();
      await appProcess.stop();
      await new Promise<void>((done) => {
        server.close(() => done());
        // open board tabs keep connections alive
        server.closeAllConnections();
      });
      await session.close();
    },
  };
}
