import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { DEFAULT_REDACTION, IR_VERSION, type Project } from "@appshape/ir";
import { ProjectFiles } from "@appshape/store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const MAIN = join(REPO, "packages", "cli", "src", "main.ts");

let root: string;
const cli = (...args: string[]) =>
  execFileSync(process.execPath, [TSX, MAIN, ...args], { encoding: "utf8", env: { ...process.env, INIT_CWD: root, APPSHAPE_HOME: join(root, ".home") } });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-cli-"));
  const tokens = await defaultTokens();
  const project: Project = {
    irVersion: IR_VERSION,
    name: "CLI test",
    adapters: [],
    tokens,
    components: [],
    board: { items: [] },
    changesets: [],
    redaction: DEFAULT_REDACTION,
    frames: [
      {
        id: "f_home",
        name: "Home",
        kind: "new",
        platform: "web",
        target: { adapter: "react-vite", route: "/" },
        viewports: [{ id: "desktop", width: 1280 }],
        current: {
          id: "n_root",
          type: "box",
          origin: "added",
          layout: { mode: "flex", direction: "column", gap: "$spacing.4" },
          children: [{ id: "n_title", type: "text", origin: "added", text: "Hello", semantic: { role: "heading", level: 1 }, annotations: [{ id: "a_1", kind: "data", text: "Greet the signed-in user by name." }] }],
        },
      },
    ],
  };
  await new ProjectFiles({ appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" }).save(project);
}, 60_000);
afterAll(() => rm(root, { recursive: true, force: true }));

describe("appshape CLI and MCP server", () => {
  it("previews, applies, and tracks the agent's tasks", { timeout: 120_000 }, async () => {
    const preview = cli("apply", ".", "--stack", "vite-react-router");
    expect(preview).toContain("+ src/pages/Home.tsx  New page Home");
    expect(preview).toContain("Data: Greet the signed-in user by name.");
    expect(preview).toContain("Nothing written");
    expect(existsSync(join(root, "src", "pages", "Home.tsx"))).toBe(false);

    const applied = cli("apply", ".", "--stack", "vite-react-router", "--yes");
    expect(applied).toMatch(/Wrote \d+ file\(s\)/);
    expect(await readFile(join(root, "src", "pages", "Home.tsx"), "utf8")).toContain("<h1>Hello</h1>");
    expect(cli("apply", ".")).toContain("The code is up to date with the design.");

    const list = cli("changesets", ".", "--status", "ready");
    const id = /^(cs_\w+)/m.exec(list)![1]!;
    expect(cli("spec", id)).toContain("Greet the signed-in user by name.");
    expect(cli("status", id, "in_progress")).toContain(`${id}: in_progress`);
    cli("status", id, "c1", "applied", "--note", "uses useUser()");

    // MCP: what Claude Code sees
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [TSX, MAIN, "mcp", root], stderr: "ignore" }));
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["get_changeset", "get_component", "get_design_request", "get_frame", "get_tokens", "list_changesets", "list_components", "list_design_requests", "propose_design", "set_change_status", "set_changeset_status", "submit_review", "verify_changeset"]);
    const text = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError ?? false).toBe(false);
      return result.content[0]!.text;
    };
    expect(JSON.parse(await text("list_changesets", {})).changesets[0]).toMatchObject({ id, status: "in_progress", changeCount: 1 });
    expect(await text("get_changeset", { changesetId: id })).toContain("## How to implement this changeset");
    expect(await text("get_frame", { frameId: "f_home" })).toContain("// src/pages/Home.tsx (Vite + React Router)");
    expect(JSON.parse(await text("set_changeset_status", { changesetId: id, status: "applied", note: "done" })).changeset.status).toBe("applied");
    await client.close();

    const saved = JSON.parse(await readFile(join(root, ".appshape", "changesets", `${id}.json`), "utf8"));
    expect(saved.changeStatus.c1).toMatchObject({ status: "applied", note: "uses useUser()" });
    expect(saved.history.map((h: { status: string }) => h.status)).toEqual(["ready", "in_progress", "applied"]);
  });

  it("a coding agent designs a drawn request over MCP", { timeout: 120_000 }, async () => {
    // someone drew on Home and sent it to their coding agent
    const at = "2026-10-14T10:00:00.000Z";
    const files = new ProjectFiles({ appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" });
    const { project } = await files.load();
    const request = {
      id: "rq_1", frameId: "f_home", viewportId: "desktop", message: "Add a subtitle under the heading", status: "designing" as const, route: "agent" as const, createdAt: at, updatedAt: at,
      shapes: [{ id: "s_1", kind: "rect" as const, color: "add", x: 0, y: 60, w: 400, h: 40, targets: ["n_root"] }],
    };
    await files.save({ ...project, requests: [request] });

    const client = new Client({ name: "agent", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [TSX, MAIN, "mcp", root], stderr: "ignore" }));
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
    const text = (result: Awaited<ReturnType<typeof call>>) => (result.content[0] as { text: string }).text;

    // "Design AppShape request rq_1": the prompt, the waiting request, the brief with the picture
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["design_request", "implement_changeset"]);
    const prompt = await client.getPrompt({ name: "design_request", arguments: { requestId: "rq_1" } });
    expect(JSON.stringify(prompt.messages)).toContain("get_design_request");
    expect(JSON.parse(text(await call("list_design_requests", { waiting: true }))).requests).toEqual([expect.objectContaining({ id: "rq_1", screen: "Home", status: "designing", route: "agent", marks: 1 })]);
    const got = await call("get_design_request", { requestId: "rq_1" });
    expect(got.isError ?? false).toBe(false);
    const brief = text(got);
    expect(brief).toContain("Add a subtitle under the heading");
    expect(brief).toContain("green (add) rectangle at (0, 60), 400×40");
    const image = got.content.find((c) => c.type === "image") as { data: string; mimeType: string } | undefined;
    expect(image?.mimeType).toBe("image/png");
    expect(Buffer.from(image!.data, "base64").subarray(1, 4).toString()).toBe("PNG");

    // the agent changes the JSX and proposes it; a broken answer gets an error to fix
    const jsx = /```tsx\n([\s\S]+?)\n```/.exec(brief)![1]!;
    expect((await call("propose_design", { requestId: "rq_1", jsx: "Sorry, I can't." })).isError).toBe(true);
    const answer = jsx.replace("</h1>", '</h1>\n  <p className="text-muted-foreground">Good to see you again</p>');
    // variants: all of them together, each with its idea
    const other = jsx.replace("</h1>", '</h1>\n  <p className="text-muted-foreground">Welcome back</p>');
    expect((await call("propose_design", { requestId: "rq_1", jsx: answer, variants: [{ jsx: answer }, { jsx: other }] })).isError).toBe(true);
    const variants = JSON.parse(text(await call("propose_design", { requestId: "rq_1", variants: [{ jsx: answer, idea: "A warm subtitle" }, { jsx: other, idea: "A short one" }] })));
    expect(variants.summary).toEqual(["Variant 1: Added a text “Good to see you again”", "Variant 2: Added a text “Welcome back”"]);
    const asVariants = JSON.parse(await readFile(join(root, ".appshape", "requests", "rq_1.json"), "utf8"));
    expect(asVariants).toMatchObject({ status: "proposed", proposal: { variant: 1, idea: "A warm subtitle" }, alternatives: [{ variant: 2, idea: "A short one", summary: ["Added a text “Welcome back”"] }] });
    const proposed = JSON.parse(text(await call("propose_design", { requestId: "rq_1", jsx: answer, notes: ["The subtitle is a placeholder"] })));
    expect(proposed.summary).toEqual(["Added a text “Good to see you again”"]);
    await client.close();

    const saved = JSON.parse(await readFile(join(root, ".appshape", "requests", "rq_1.json"), "utf8"));
    expect(saved).toMatchObject({ status: "proposed", route: "agent", proposal: { by: "agent", summary: ["Added a text “Good to see you again”"], questions: ["The subtitle is a placeholder"] } });
    // one design again: the variants before are gone
    expect(saved).not.toHaveProperty("alternatives");
    expect(saved.proposal).not.toHaveProperty("variant");
    expect(saved.proposal.ops).toEqual([expect.objectContaining({ op: "insert", parentId: "n_root", index: 1 })]);
    // the CLI shows the same request
    expect(cli("requests", ".")).toContain("rq_1  proposed  Home (desktop)");
  });

  it("connects Claude Code", () => {
    expect(cli("init", ".", "--agent", "claude")).toContain("Connected Claude Code");
    return Promise.all([readFile(join(root, ".mcp.json"), "utf8"), readFile(join(root, "CLAUDE.md"), "utf8")]).then(([mcp, claude]) => {
      expect(JSON.parse(mcp).mcpServers.appshape.args.slice(-2)).toEqual(["mcp", root]);
      expect(claude).toContain("## AppShape (design → code)");
      expect(claude).toContain("### Design requests (Draw & describe)");
    });
  });
});
