import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type AgentRun, AgentRunSettingsSchema, AgentRunStartSchema, type AgentRunStatus } from "@appshape/protocol";
import { appshapeHome, type DataLocation, readText, writeFileAtomic } from "@appshape/store";
import type { Hono } from "hono";
import type { EventLog } from "./events";

/**
 * AppShape starts the coding agent itself (Claude Code, headless) in the app's folder, so the
 * person doesn't have to paste a sentence: after *Apply to code* and for drawings sent to the
 * agent. Only once the person said yes (`autoStart`, personal: `~/.appshape/agent.json`), or for one
 * run when they press *Start Claude Code*. The agent works with the person's own Claude login (no
 * API key from AppShape's environment), may edit files and run the app's scripts, can't install
 * packages or use the web, and has only AppShape's MCP server. Its progress goes to the activity log.
 */

/** What the agent may do on its own. */
const ALLOWED = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(pnpm run:*)", "Bash(pnpm typecheck:*)", "Bash(pnpm build:*)", "Bash(pnpm lint:*)", "Bash(pnpm exec tsc:*)", "Bash(npm run:*)", "Bash(yarn run:*)", "mcp__appshape"];
const DENIED = ["WebFetch", "WebSearch", "Bash(pnpm install:*)", "Bash(pnpm i:*)", "Bash(pnpm add:*)", "Bash(npm install:*)", "Bash(npm i:*)", "Bash(npx:*)", "Bash(yarn add:*)"];

const settingsFile = () => join(appshapeHome(), "agent.json");

async function readSettings(): Promise<{ autoStart: boolean }> {
  try {
    return { autoStart: Boolean((JSON.parse((await readText(settingsFile())) ?? "{}") as { autoStart?: unknown }).autoStart) };
  } catch {
    return { autoStart: false };
  }
}

/** The command that starts Claude Code: `APPSHAPE_CLAUDE_COMMAND` (tests: a script run with Node), else `claude` from the PATH. */
function claudeCommand(): { command: string; args: string[]; shell: boolean } | undefined {
  const override = process.env.APPSHAPE_CLAUDE_COMMAND;
  if (override) return /\.(m?js|cjs)$/.test(override) ? { command: process.execPath, args: [override], shell: false } : { command: override, args: [], shell: false };
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const path = found.status === 0 ? found.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) : undefined;
  if (!path) return undefined;
  // npm's shims on Windows are .cmd files: they need a shell
  return { command: path, args: [], shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(path) };
}

/** A command line argument for a shell (the .cmd case). */
const quote = (arg: string) => (/^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);

/** What a tool call is about, in a few words (for the activity log). */
function describe(name: string, input: Record<string, unknown> | undefined): string | undefined {
  const file = typeof input?.file_path === "string" ? input.file_path.split(/[\\/]/).slice(-2).join("/") : undefined;
  switch (name) {
    case "Read":
      return file && `Reading ${file}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
      return file && `Editing ${file}`;
    case "Bash":
      return `Running ${String(input?.command ?? "").slice(0, 80)}`;
    case "mcp__appshape__get_changeset":
      return "Reading the tasks";
    case "mcp__appshape__get_design_request":
      return "Looking at the drawing";
    case "mcp__appshape__set_change_status":
      return `Task ${String(input?.changeId ?? "")}: ${String(input?.status ?? "")}`;
    case "mcp__appshape__verify_changeset":
      return "Checking the result in the running app";
    case "mcp__appshape__propose_design":
      return "Proposing a design";
    case "mcp__appshape__submit_review":
      return "Sending the review";
    default:
      return undefined;
  }
}

export function agentRunRoutes(app: Hono, location: DataLocation, log: EventLog): { close(): Promise<void> } {
  const runs: AgentRun[] = [];
  let child: ChildProcess | undefined;

  const mcpConfig = join(location.appRoot, ".mcp.json");
  const status = async (): Promise<AgentRunStatus> => {
    const { autoStart } = await readSettings();
    const command = claudeCommand();
    const connected = existsSync(mcpConfig);
    const reason = !command ? "Claude Code isn't installed (claude isn't on the PATH)." : !connected ? "Claude Code isn't connected to this app yet (Settings → AI agents)." : undefined;
    return { available: !reason, ...(reason && { reason }), autoStart, runs: runs.slice(-10) };
  };

  const kill = (proc: ChildProcess) => {
    if (process.platform === "win32" && proc.pid) spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else proc.kill();
  };

  app.get("/api/agent-run", async (c) => c.json(await status()));

  app.put("/api/agent-run/settings", async (c) => {
    const parsed = AgentRunSettingsSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid settings" }, 400);
    await writeFileAtomic(settingsFile(), `${JSON.stringify({ autoStart: parsed.data.autoStart }, null, 2)}\n`);
    return c.json(await status());
  });

  app.post("/api/agent-run", async (c) => {
    const parsed = AgentRunStartSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    const now = await status();
    if (!now.available) return c.json({ error: now.reason }, 400);
    if (child) return c.json({ error: "Claude Code is already working on something in this app." }, 409);
    const command = claudeCommand()!;
    const prompt = parsed.data.prompt;
    const args = [
      ...command.args,
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ALLOWED.join(" "),
      "--disallowedTools",
      DENIED.join(" "),
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
    ];
    // the person's own login, not an API key AppShape was started with
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ELECTRON_RUN_AS_NODE"]) delete env[key];
    const run: AgentRun = { id: `run_${Date.now().toString(36)}`, prompt, state: "running", startedAt: new Date().toISOString() };
    runs.push(run);
    const step = log.step("agent", `Claude Code: ${prompt}`);
    const proc = command.shell ? spawn([quote(command.command), ...args.map(quote)].join(" "), { cwd: location.appRoot, env, shell: true }) : spawn(command.command, args, { cwd: location.appRoot, env });
    child = proc;
    let buffer = "";
    let errors = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] }; result?: string; total_cost_usd?: number; is_error?: boolean };
          for (const part of event.message?.content ?? []) {
            const text = part.type === "tool_use" && part.name ? describe(part.name, part.input) : undefined;
            if (text) log.add({ level: "info", source: "agent", text });
          }
          if (event.type === "result") {
            run.summary = (event.result ?? "").slice(0, 1200);
            if (typeof event.total_cost_usd === "number") run.costUsd = Math.round(event.total_cost_usd * 100) / 100;
            if (event.is_error) run.state = "failed";
          }
        } catch {
          // not JSON (a warning): ignored
        }
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => void (errors = (errors + chunk.toString()).slice(-2000)));
    proc.on("error", (error) => void (errors += error.message));
    proc.on("exit", (code) => {
      child = undefined;
      run.endedAt = new Date().toISOString();
      if (run.state === "running") run.state = code === 0 ? "done" : "failed";
      if (run.state === "stopped") step.done("Claude Code stopped");
      else if (run.state === "done") step.done("Claude Code is done", run.summary);
      else step.fail("Claude Code stopped with a problem", run.summary || errors.trim() || `exit code ${code}`);
    });
    return c.json(run);
  });

  app.post("/api/agent-run/stop", async (c) => {
    const proc = child;
    if (proc) {
      const run = runs.at(-1);
      if (run) run.state = "stopped";
      kill(proc);
    }
    return c.json(await status());
  });

  return {
    async close() {
      if (child) kill(child);
    },
  };
}
