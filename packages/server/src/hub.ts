import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import type { Server } from "node:http";
import { homedir } from "node:os";
import type { AddressInfo } from "node:net";
import { basename, dirname, join, resolve, sep } from "node:path";
import { serve } from "@hono/node-server";
import { detectPackageManager, findBrowser, refreshPath, toolVersion } from "@appshape/capture";
import { appFiles, detectApp } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { withTheme } from "@appshape/kit";
import {
  type FolderInfo,
  type FolderListing,
  type HubCheck,
  HubCreateSchema,
  type HubOpenResponse,
  HubOpenSchema,
  HubPathSchema,
  type HubState,
  STACK_LABELS,
  TOKEN_HEADER,
} from "@appshape/protocol";
import { addRecentProject, type DataLocation, initProject, ProjectFiles, readUserSettings, removeRecentProject, resolveLocation, samePath } from "@appshape/store";
import { Hono } from "hono";
import { connectAgent } from "./agents";
import type { AiKeyStore } from "./ai-routes";
import { HOST, readInside, type RunningServer, sameToken, startServer } from "./server";
import type { Logger } from "./session";

/**
 * AppShape without a project: the start page (open or create an app) for the desktop app's window
 * and `appshape start`. Every opened project gets its own board server; the hub stops them all.
 */

export interface HubOptions {
  version: string;
  /** Built editor (serves the start page and the boards). */
  editorDir?: string;
  port?: number;
  token?: string;
  /** Inside the desktop app. */
  desktop?: boolean;
  /** Where AppShape's AI gets the API key (the desktop app: its keychain). */
  aiKeys?: AiKeyStore;
  log?: Logger;
}

export interface OpenBoard {
  appRoot: string;
  name: string;
  server: RunningServer;
}

export interface RunningHub {
  url: string;
  port: number;
  token: string;
  /** The start page, with its token. */
  startUrl: string;
  boards(): OpenBoard[];
  open(path: string, options?: { importPages?: boolean }): Promise<HubOpenResponse>;
  close(): Promise<void>;
}

const pathKey = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));

/** Plain-language checks of what the user's computer needs. */
export async function computerChecks(): Promise<HubCheck[]> {
  const [node, npm, pnpm, git] = await Promise.all([toolVersion("node"), toolVersion("npm"), toolVersion("pnpm"), toolVersion("git")]);
  const browser = findBrowser();
  const nodeLink = { label: "Get Node.js", url: "https://nodejs.org/en/download" };
  const checks: HubCheck[] = [
    !node
      ? { id: "node", name: "Node.js", status: "missing", text: "Your app runs on Node.js. Install the LTS version, then check again.", link: nodeLink }
      : Number(node.split(".")[0]) < 20
        ? { id: "node", name: "Node.js", status: "outdated", version: node, text: `Version ${node} is too old for today's apps. Install the LTS version.`, link: nodeLink }
        : { id: "node", name: "Node.js", status: "ok", version: node, text: "Runs your app." },
  ];
  if (node) {
    checks.push(
      npm
        ? { id: "npm", name: "npm", status: "ok", version: npm, text: "Installs your app's packages (comes with Node.js)." }
        : { id: "npm", name: "npm", status: "missing", text: "Comes with Node.js; reinstall Node.js to get it back.", link: nodeLink },
    );
  }
  checks.push(
    pnpm
      ? { id: "pnpm", name: "pnpm", status: "ok", version: pnpm, text: "Installs packages faster; AppShape uses it for new apps." }
      : { id: "pnpm", name: "pnpm", status: "optional", text: "Not needed: new apps use npm. Only apps that already use pnpm need it.", link: { label: "About pnpm", url: "https://pnpm.io/installation" } },
    git
      ? { id: "git", name: "Git", status: "ok", version: git, text: "Keeps the history of your app's code." }
      : { id: "git", name: "Git", status: "optional", text: "Recommended: keeps the history of your app's code, so changes can be undone.", link: { label: "Get Git", url: "https://git-scm.com/downloads" } },
    browser
      ? { id: "browser", name: browser.name, status: "ok", text: "AppShape uses it to look at your app's pages." }
      : { id: "browser", name: "Browser", status: "missing", text: "AppShape needs Microsoft Edge or Google Chrome to look at your app's pages.", link: { label: "Get Chrome", url: "https://www.google.com/chrome/" } },
  );
  return checks;
}

/** What is in a folder: an app AppShape can work with, a project, or nothing yet. */
export async function inspectFolder(path: string): Promise<FolderInfo> {
  const root = resolve(path);
  const info: FolderInfo = { path: root, name: basename(root) || root, exists: false, empty: true, app: { kind: "none" } };
  try {
    if (!(await stat(root)).isDirectory()) return info;
  } catch {
    return info;
  }
  info.exists = true;
  info.empty = (await readdir(root)).length === 0;
  const location = await resolveLocation(root);
  if (location) {
    const loaded = await new ProjectFiles(location).load().catch(() => undefined);
    info.project = { name: loaded?.project.name ?? basename(location.appRoot), appRoot: location.appRoot, dataDir: location.dataDir };
  }
  const detection = await detectApp(appFiles(root));
  if (detection.kind === "app") info.app = { kind: "app", stack: detection.layout.stack, stackLabel: STACK_LABELS[detection.layout.stack] };
  else if (detection.kind === "unsupported") info.app = { kind: "unsupported", reason: detection.reason };
  if (detection.kind !== "none") {
    const manager = await detectPackageManager(root, "npm");
    info.packageManager = manager;
    info.packageManagerMissing = !(await toolVersion(manager));
  }
  return info;
}

/** Sub-folders of a folder (for picking one in the browser, where there is no system dialog). */
export async function listFolders(path: string | undefined): Promise<FolderListing> {
  const home = homedir();
  const dir = resolve(path || home);
  let folders: FolderListing["folders"] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$") && e.name !== "node_modules")
      .map((e) => ({ name: e.name, path: join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // unreadable: no sub-folders
  }
  const places = [
    { name: "Home", path: home },
    { name: "Documents", path: join(home, "Documents") },
    { name: "Desktop", path: join(home, "Desktop") },
  ].filter((p) => existsSync(p.path));
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJ") if (existsSync(`${letter}:\\`)) places.push({ name: `${letter}:`, path: `${letter}:\\` });
  } else places.push({ name: "Computer", path: "/" });
  const parent = dirname(dir);
  return { path: dir, ...(parent !== dir && { parent }), folders, places };
}

/** Where new apps go by default. */
export function defaultParent(): string {
  const documents = join(homedir(), "Documents");
  return join(existsSync(documents) ? documents : homedir(), "AppShape");
}

export async function startHub(options: HubOptions): Promise<RunningHub> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const log = options.log ?? { info: (m: string) => console.log(`[appshape] ${m}`), warn: (m: string) => console.warn(`[appshape] ${m}`), error: (m: string) => console.error(`[appshape] ${m}`) };
  const open = new Map<string, OpenBoard>();
  const boardUrl = (board: OpenBoard, extra = "") => `${board.server.url}/#token=${board.server.token}${extra}`;
  let checks: Promise<HubCheck[]> | undefined;

  async function openProject(path: string, importPages = false): Promise<HubOpenResponse> {
    let location: DataLocation | undefined = await resolveLocation(resolve(path));
    let created = false;
    // a folder inside a project opens that project
    if (!location) {
      location = await initProject(resolve(path), { tokens: await defaultTokens() });
      created = true;
    }
    const key = pathKey(location.appRoot);
    let board = open.get(key);
    if (!board) {
      const loaded = await new ProjectFiles(location).load();
      const port = loaded.project.settings?.board?.port;
      const start = (p: number) => startServer({ location: location!, port: p, ...(options.editorDir && { editorDir: options.editorDir }), ...(options.log && { log: options.log }), ...(options.aiKeys && { aiKeys: options.aiKeys }) });
      let server: RunningServer;
      try {
        server = await start(port ?? 0);
      } catch (error) {
        if (port === undefined || (error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        server = await start(0);
      }
      board = { appRoot: location.appRoot, name: loaded.project.name, server };
      open.set(key, board);
      log.info(`Board for ${board.name}: ${server.url}`);
    }
    await addRecentProject(board.appRoot, board.name);
    const app = importPages && created ? (await detectApp(appFiles(board.appRoot))).kind === "app" : false;
    return { appRoot: board.appRoot, name: board.name, board: boardUrl(board, app ? "&open=import" : "") };
  }

  async function stopProject(path: string): Promise<void> {
    const key = pathKey(path);
    const board = open.get(key);
    if (!board) return;
    open.delete(key);
    await board.server.close();
  }

  let port = 0;
  const allowedHosts = () => [`${HOST}:${port}`, `localhost:${port}`];
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!allowedHosts().includes(c.req.header("host") ?? "")) return c.text("forbidden host", 403);
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (!sameToken(c.req.header(TOKEN_HEADER) ?? c.req.query("token"), token)) return c.text("missing or invalid token", 401);
    await next();
  });
  const fail = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });

  app.get("/api/hub", async (c) => {
    const settings = await readUserSettings();
    const state: HubState = {
      version: options.version,
      desktop: Boolean(options.desktop),
      platform: process.platform,
      sep,
      defaultParent: defaultParent(),
      recent: settings.recent.map((r) => {
        const board = open.get(pathKey(r.appRoot));
        return { ...r, missing: !existsSync(r.appRoot), ...(board && { board: boardUrl(board) }) };
      }),
    };
    return c.json(state);
  });

  app.get("/api/hub/checks", async (c) => {
    if (c.req.query("refresh") || !checks) {
      checks = (c.req.query("refresh") ? refreshPath() : Promise.resolve()).then(computerChecks);
    }
    return c.json(await checks);
  });

  app.get("/api/hub/folder", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path is required" }, 400);
    return c.json(await inspectFolder(path));
  });

  app.get("/api/hub/folders", async (c) => c.json(await listFolders(c.req.query("path"))));

  app.post("/api/hub/open", async (c) => {
    const parsed = HubOpenSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "path is required" }, 400);
    const info = await inspectFolder(parsed.data.path);
    if (!info.exists) return c.json({ error: "This folder doesn't exist (any more)." }, 404);
    try {
      return c.json(await openProject(info.path, parsed.data.importPages));
    } catch (error) {
      log.error(`Couldn't open ${info.path}: ${fail(error).error}`);
      return c.json(fail(error), 500);
    }
  });

  app.post("/api/hub/create", async (c) => {
    const parsed = HubCreateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }, 400);
    const { name, parent, stack, agent } = parsed.data;
    const dir = join(resolve(parent), name);
    const existing = await inspectFolder(dir);
    if (existing.exists && !existing.empty) return c.json({ error: `There is already a folder named "${name}" there. Pick another name or location.` }, 409);
    try {
      await mkdir(dir, { recursive: true });
      // a new app starts with the default theme; the board opens the theme starter first
      await initProject(dir, { name, tokens: withTheme(await defaultTokens()), settings: { code: { stack } } });
      if (agent) await connectAgent(agent, dir);
      const opened = await openProject(dir);
      return c.json({ ...opened, board: `${opened.board}&open=theme` });
    } catch (error) {
      log.error(`Couldn't create ${dir}: ${fail(error).error}`);
      return c.json(fail(error), 500);
    }
  });

  app.post("/api/hub/stop", async (c) => {
    const parsed = HubPathSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "path is required" }, 400);
    await stopProject(parsed.data.path);
    return c.body(null, 204);
  });

  app.post("/api/hub/forget", async (c) => {
    const parsed = HubPathSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "path is required" }, 400);
    await removeRecentProject(parsed.data.path);
    return c.body(null, 204);
  });

  if (options.editorDir) {
    const root = resolve(options.editorDir);
    app.get("/", (c) => c.redirect("/start"));
    app.get("*", async (c) => {
      const data = (await readInside(root, c.req.path.slice(1))) ?? (await readInside(root, "index.html"));
      if (!data) return c.text("editor not built", 404);
      return c.body(data.content, 200, { "content-type": data.type, "cache-control": "no-cache" });
    });
  }

  const server = await new Promise<Server>((resolveServer, reject) => {
    const s = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: HOST }, () => resolveServer(s as Server));
    (s as Server).once("error", reject);
  });
  port = (server.address() as AddressInfo).port;
  const url = `http://${HOST}:${port}`;

  return {
    url,
    port,
    token,
    startUrl: `${url}/start#token=${token}`,
    boards: () => [...open.values()],
    open: (path, o) => openProject(path, o?.importPages),
    async close() {
      await Promise.all([...open.keys()].map((key) => stopProject(open.get(key)!.appRoot)));
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}
