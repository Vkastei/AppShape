import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type FolderInfo, type FolderListing, type HubOpenResponse, type HubState, TOKEN_HEADER } from "@appshape/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliLauncher, type RunningHub, setCliLauncher, startHub } from "../src";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/vite-react-router-tw4/", import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };
let root: string;
let hub: RunningHub;
const launcher = cliLauncher();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-hub-"));
  process.env.APPSHAPE_HOME = join(root, "home");
  process.env.CODEX_HOME = join(root, "codex");
  hub = await startHub({ version: "1.2.3", log: quiet });
});
afterEach(async () => {
  await hub.close();
  setCliLauncher(launcher);
  delete process.env.APPSHAPE_HOME;
  delete process.env.CODEX_HOME;
  await rm(root, { recursive: true, force: true });
});

async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${hub.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { [TOKEN_HEADER]: hub.token, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T };
}

describe("start page server (hub)", () => {
  it("needs the token", async () => {
    expect((await fetch(`${hub.url}/api/hub`)).status).toBe(401);
    const { data } = await api<HubState>("/api/hub");
    expect(data).toMatchObject({ version: "1.2.3", desktop: false, recent: [] });
    expect(hub.startUrl).toBe(`${hub.url}/start#token=${hub.token}`);
  });

  it("tells what is in a folder", async () => {
    const app = (await api<FolderInfo>(`/api/hub/folder?path=${encodeURIComponent(FIXTURE)}`)).data;
    expect(app).toMatchObject({ exists: true, empty: false, app: { kind: "app", stack: "vite-react-router", stackLabel: "Vite + React Router" }, packageManager: "pnpm" });
    expect(app.project?.name).toBeTruthy(); // the fixture has its own project

    await mkdir(join(root, "empty"));
    expect((await api<FolderInfo>(`/api/hub/folder?path=${encodeURIComponent(join(root, "empty"))}`)).data).toMatchObject({ exists: true, empty: true, app: { kind: "none" } });
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    expect((await api<FolderInfo>(`/api/hub/folder?path=${encodeURIComponent(root)}`)).data.app).toMatchObject({ kind: "unsupported" });
    expect((await api<FolderInfo>(`/api/hub/folder?path=${encodeURIComponent(join(root, "gone"))}`)).data.exists).toBe(false);

    const listing = (await api<FolderListing>(`/api/hub/folders?path=${encodeURIComponent(root)}`)).data;
    expect(listing.folders.map((f) => f.name)).toContain("empty");
    expect(listing.parent).toBe(resolve(root, ".."));
  });

  it("creates a new app with its stack and agent, opens its board and lists it", async () => {
    setCliLauncher({ command: "appshape-test", args: ["cli.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } });
    const created = await api<HubOpenResponse>("/api/hub/create", { name: "Bakery", parent: join(root, "apps"), stack: "next-app", agent: "claude" });
    expect(created.status).toBe(200);
    const dir = join(root, "apps", "Bakery");
    expect(created.data).toMatchObject({ appRoot: dir, name: "Bakery" });
    const project = JSON.parse(await readFile(join(dir, ".appshape", "project.json"), "utf8"));
    expect(project.settings).toEqual({ code: { stack: "next-app" } });
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8")).mcpServers.appshape).toEqual({ command: "appshape-test", args: ["cli.mjs", "mcp", dir], env: { ELECTRON_RUN_AS_NODE: "1" } });

    // the board opens with the theme starter; the app has the default theme already
    expect(created.data.board).toMatch(/&open=theme$/);
    const board = created.data.board.replace(/&open=theme$/, "");
    const [boardUrl, token] = board.split("/#token=") as [string, string];
    const snapshot = await (await fetch(`${boardUrl}/api/project`, { headers: { [TOKEN_HEADER]: token } })).json();
    expect(snapshot.project.name).toBe("Bakery");
    expect(snapshot.project.tokens.groups.color.primary).toBe("#4f46e5");
    expect(snapshot.project.tokens.dark.color.background).toBeDefined();

    const state = (await api<HubState>("/api/hub")).data;
    expect(state.recent).toMatchObject([{ appRoot: dir, name: "Bakery", missing: false, board }]);
    // opening it again gives the same board
    expect((await api<HubOpenResponse>("/api/hub/open", { path: dir })).data.board).toBe(board);

    // the folder is taken now; names must work as folder names
    expect((await api<{ error: string }>("/api/hub/create", { name: "Bakery", parent: join(root, "apps"), stack: "next-app" })).status).toBe(409);
    expect((await api("/api/hub/create", { name: "a/b", parent: root, stack: "next-app" })).status).toBe(400);

    expect((await api("/api/hub/stop", { path: dir })).status).toBe(204);
    await expect(fetch(`${boardUrl}/api/project`, { headers: { [TOKEN_HEADER]: token } })).rejects.toThrow();
    expect((await api<HubState>("/api/hub")).data.recent[0]!.board).toBeUndefined();
    await api("/api/hub/forget", { path: dir });
    expect((await api<HubState>("/api/hub")).data.recent).toEqual([]);
  });

  it("opens a folder without a project by creating one", async () => {
    const dir = join(root, "plain");
    await mkdir(dir);
    const opened = await api<HubOpenResponse>("/api/hub/open", { path: dir, importPages: true });
    expect(opened.status).toBe(200);
    // no app in it: nothing to bring in
    expect(opened.data.board).not.toContain("open=import");
    expect(JSON.parse(await readFile(join(dir, ".appshape", "project.json"), "utf8")).name).toBe("plain");
    expect((await api("/api/hub/open", { path: join(root, "missing") })).status).toBe(404);
  });
});
