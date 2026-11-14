import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER, type SettingsResponse } from "@appshape/protocol";
import { type DataLocation, emptyProject, ProjectFiles } from "@appshape/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentStatus, connectAgent, disconnectAgent, type RunningServer, startServer } from "../src";

const quiet = { info() {}, warn() {}, error() {} };
let root: string;
let codexHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-settings-"));
  codexHome = await mkdtemp(join(tmpdir(), "appshape-codex-"));
  process.env.CODEX_HOME = codexHome;
});
afterEach(async () => {
  delete process.env.CODEX_HOME;
  await rm(root, { recursive: true, force: true });
  await rm(codexHome, { recursive: true, force: true });
});

describe("coding agents", () => {
  it("connects and removes agents without touching the rest of their files", async () => {
    await writeFile(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    await writeFile(join(root, "CLAUDE.md"), "# My notes\n");
    await writeFile(join(codexHome, "config.toml"), 'model = "o4"\n');

    for (const id of ["claude", "cursor", "codex", "generic"] as const) await connectAgent(id, root);
    for (const id of ["claude", "cursor", "codex", "generic"] as const) expect((await agentStatus(id, root)).connected, id).toBe(true);
    const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["other", "appshape"]);
    expect(mcp.mcpServers.appshape.args.at(-1)).toBe(root);
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toMatch(/^# My notes\n\n<!-- appshape:start -->/);
    expect(await readFile(join(root, ".cursor", "rules", "appshape.mdc"), "utf8")).toMatch(/^---\ndescription:/);
    const toml = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(toml).toMatch(/^model = "o4"\n\n\[mcp_servers\.appshape-appshape-settings-\w+\]\ncommand = "node"\nargs = \[/);

    // connecting again updates in place
    await connectAgent("claude", root);
    expect((await readFile(join(root, "CLAUDE.md"), "utf8")).match(/appshape:start/g)).toHaveLength(1);

    await disconnectAgent("claude", root);
    await disconnectAgent("codex", root);
    expect(JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")).mcpServers).toEqual({ other: { command: "x" } });
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe("# My notes\n\n");
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe('model = "o4"\n');
    // AGENTS.md is shared with "other agents", which are still connected
    expect((await agentStatus("generic", root)).connected).toBe(true);
  });
});

describe("settings routes", () => {
  let server: RunningServer;
  let location: DataLocation;
  beforeEach(async () => {
    location = { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" };
    await new ProjectFiles(location).save(emptyProject("Settings test"));
    server = await startServer({ location, port: 0, log: quiet, saveDelayMs: 10 });
  });
  afterEach(() => server.close());

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${server.url}${path}`, { method, headers: { [TOKEN_HEADER]: server.token, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as SettingsResponse & { error?: string } };
  };

  it("reads, validates and saves settings into project.json", async () => {
    const initial = await call("GET", "/api/settings");
    expect(initial.body).toMatchObject({ name: "Settings test", settings: {}, redaction: { mode: "strict" } });
    expect(initial.body.agents.map((a) => a.id)).toEqual(["claude", "cursor", "codex", "generic"]);

    expect((await call("PUT", "/api/settings", { settings: { app: { port: 99999 } } })).status).toBe(400);

    const saved = await call("PUT", "/api/settings", {
      name: "Shop",
      settings: { app: { devScript: "start", port: 3100 }, verify: { tolerance: 4 }, board: { open: false } },
      redaction: { ...initial.body.redaction, mode: "local-only" },
    });
    expect(saved.status).toBe(200);
    const file = JSON.parse(await readFile(join(location.dataDir, "project.json"), "utf8"));
    expect(file).toMatchObject({ name: "Shop", redaction: { mode: "local-only" }, settings: { app: { devScript: "start", port: 3100 }, verify: { tolerance: 4 }, board: { open: false } } });
    const logs = (await (await fetch(`${server.url}/api/logs`, { headers: { [TOKEN_HEADER]: server.token } })).json()) as { entries: { text: string }[] };
    expect(logs.entries.map((e) => e.text)).toContain("Settings saved");

    // empty settings leave project.json as it was before settings existed
    await call("PUT", "/api/settings", { settings: {} });
    expect(JSON.parse(await readFile(join(location.dataDir, "project.json"), "utf8")).settings).toBeUndefined();
  });

  it("connects an agent from the board", async () => {
    const res = await call("POST", "/api/agents/cursor");
    expect(res.body.agents.find((a) => a.id === "cursor")?.connected).toBe(true);
    expect(JSON.parse(await readFile(join(root, ".cursor", "mcp.json"), "utf8")).mcpServers.appshape.command).toBe("node");
    expect((await call("POST", "/api/agents/nope")).status).toBe(404);
  });
});
