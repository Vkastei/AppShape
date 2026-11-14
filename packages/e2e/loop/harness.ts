/**
 * The main loop with a real coding agent: a sandbox copy of an app with
 * its own git, `appshape dev` and the board, the agent started with the sentence the board shows,
 * the board watched while it works, and a score that doesn't trust what the agent reported.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TSX = join(REPO, "node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, "packages/cli/src/main.ts");
export const RUNS = join(REPO, "packages/e2e/loop-runs");

/** Which agent runs (`LOOP_AGENT`): Claude Code, or `dry` (does nothing but take the changeset; the baseline). */
export const AGENT = (process.env.LOOP_AGENT ?? "claude") as "claude" | "dry";
export const MODEL = process.env.LOOP_MODEL ?? "sonnet";
const TIMEOUT_MINUTES = Number(process.env.LOOP_TIMEOUT ?? 30);

export interface Sandbox {
  name: string;
  appRoot: string;
  dataDir: string;
  home: string;
  /** The board's URL (with its token). */
  url: string;
  /** Where this run's results go. */
  out: string;
  env: NodeJS.ProcessEnv;
  /** Runs the `appshape` CLI for the sandbox. */
  cli(args: string[]): { status: number | null; stdout: string; stderr: string };
  /** A git commit of the sandbox as it is now (its own repository); returns the commit id. */
  snapshot(message: string): string;
  stop(): Promise<void>;
}

/** The environment of everything the run starts: temp homes, no API keys, no parent session. */
function runEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, APPSHAPE_HOME: home, CODEX_HOME: join(home, "codex"), APPSHAPE_NO_INSTALL: "1" };
  // the agent runs on the person's Claude login, never on an API key; a nested Claude Code refuses to start inside a session
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  return env;
}

/**
 * A copy of an app (a fixture, or an empty folder for a new app) outside the repository, with its
 * own git baseline, an AppShape project, Claude Code connected (`appshape init --agent claude`) and
 * `appshape dev` running.
 */
export async function sandbox(name: string, from: { fixture?: string; linkModules?: string } = {}): Promise<Sandbox> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const run = `${name}-${AGENT === "dry" ? "dry" : MODEL}-${stamp}`;
  const appRoot = join(tmpdir(), "appshape-loop", run, "app");
  const home = join(tmpdir(), "appshape-loop", run, "home");
  const out = join(RUNS, run);
  await mkdir(appRoot, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(out, { recursive: true });
  if (from.fixture) {
    const source = join(REPO, "fixtures", from.fixture);
    await cp(source, appRoot, { recursive: true, filter: (src) => !/[\\/](node_modules|\.appshape|dist|\.next|\.output)([\\/]|$)/.test(src) });
  }
  const modules = from.linkModules ?? (from.fixture ? join(REPO, "fixtures", from.fixture) : undefined);
  if (modules) await symlink(join(modules, "node_modules"), join(appRoot, "node_modules"), "junction");
  // Turbopack (Next.js 16) refuses a node_modules that links outside the project: let it see the home folder
  const nextConfig = join(appRoot, "next.config.js");
  if (modules && existsSync(nextConfig)) {
    const config = await readFile(nextConfig, "utf8");
    await writeFile(nextConfig, config.replace("module.exports = {", `module.exports = { turbopack: { root: ${JSON.stringify(homedir())} },`));
  }
  const env = runEnv(home);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: appRoot, encoding: "utf8", env: { ...env, GIT_AUTHOR_NAME: "loop", GIT_AUTHOR_EMAIL: "loop@appshape.invalid", GIT_COMMITTER_NAME: "loop", GIT_COMMITTER_EMAIL: "loop@appshape.invalid" } });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git("init", "-q");
  await writeFile(join(appRoot, ".git", "info", "exclude"), "node_modules\ndist\n.next\n.appshape/.cache\n");
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, [TSX, CLI, ...args], { cwd: REPO, env: { ...env, INIT_CWD: appRoot }, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const init = cli(["init", appRoot, "--name", name, "--agent", "claude"]);
  if (init.status !== 0) throw new Error(`appshape init failed: ${init.stderr}${init.stdout}`);
  await writeFile(join(out, "init.txt"), init.stdout + init.stderr);
  const snapshot = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  snapshot("baseline");

  const child: ChildProcess = spawn(process.execPath, [TSX, CLI, "dev", appRoot, "--no-open", "--port", "0"], { cwd: REPO, env: { ...env, INIT_CWD: REPO } });
  const log = createWriteStream(join(out, "appshape-dev.log"));
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Board:\s+(\S+)/.exec(output);
      if (match) resolve(match[1]!);
    });
    child.on("exit", (code) => reject(new Error(`appshape dev exited with ${code}:\n${output}`)));
  });
  const stop = async () => {
    if (process.platform === "win32" && child.pid) {
      await new Promise((r) => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("exit", r).on("error", r));
    } else child.kill();
  };
  return { name, appRoot, dataDir: join(appRoot, ".appshape"), home, url, out, env, cli, snapshot, stop };
}

/** The changeset as it is on disk. */
export async function readChangeset(box: Sandbox, id: string): Promise<{ status: string; tasks?: { id: string; title: string; kind: string; file?: string }[]; changeStatus?: Record<string, { status: string; note?: string }>; history: { status: string; by: string; at: string }[] }> {
  return JSON.parse(await readFile(join(box.dataDir, "changesets", `${id}.json`), "utf8"));
}

/** Screenshots the board each time the changeset's status changes, until `stop()`. */
export function watchBoard(box: Sandbox, page: Page, id: string): { stop(): Promise<string[]> } {
  const seen: string[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const status = await readChangeset(box, id).then((c) => c.status).catch(() => undefined);
      if (status && status !== seen.at(-1)) {
        seen.push(status);
        // the board needs a moment to show what the file says
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(box.out, `board-${seen.length}-${status}.png`) }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return seen;
    },
  };
}

export interface AgentRun {
  exitCode: number | null;
  timedOut: boolean;
  seconds: number;
  /** From Claude Code's result event. */
  result?: { costUsd?: number; turns?: number; text?: string; isError?: boolean };
  /** The tools the agent called, in order, with whether the result was an error. */
  tools: { name: string; input: unknown; error: boolean; result?: string }[];
  /** The MCP servers Claude Code saw at the start, with their status. */
  mcpServers: { name: string; status: string }[];
}

/** The agent: Claude Code headless with only AppShape's MCP server, edits allowed, Bash only for pnpm, no web. */
export async function runAgent(box: Sandbox, prompt: string, label: string): Promise<AgentRun> {
  await writeFile(join(box.out, `${label}-prompt.txt`), prompt);
  if (AGENT === "dry") return dryAgent(box, prompt);
  const args = [
    "-p",
    prompt,
    "--model",
    MODEL,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    // pnpm for scripts and checks; no installs (node_modules is linked from a fixture of the repository)
    "--allowedTools",
    "Read Edit Write Glob Grep Bash(pnpm run:*) Bash(pnpm typecheck:*) Bash(pnpm build:*) Bash(pnpm lint:*) Bash(pnpm exec tsc:*) Bash(pnpm tsc:*) mcp__appshape",
    "--disallowedTools",
    "WebFetch WebSearch Bash(pnpm install:*) Bash(pnpm i:*) Bash(pnpm add:*) Bash(pnpm update:*) Bash(pnpm remove:*) Bash(npm:*) Bash(npx:*)",
    "--mcp-config",
    join(box.appRoot, ".mcp.json"),
    "--strict-mcp-config",
    "--setting-sources",
    "project,local",
  ];
  const started = Date.now();
  const child = spawn("claude", args, { cwd: box.appRoot, env: box.env, stdio: ["ignore", "pipe", "pipe"] });
  const transcript = createWriteStream(join(box.out, `${label}-transcript.jsonl`));
  const stderr = createWriteStream(join(box.out, `${label}-stderr.txt`));
  child.stderr!.pipe(stderr);
  const run: AgentRun = { exitCode: null, timedOut: false, seconds: 0, tools: [], mcpServers: [] };
  const pending = new Map<string, AgentRun["tools"][number]>();
  let buffer = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    transcript.write(chunk);
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init") run.mcpServers = event.mcp_servers ?? [];
        for (const part of event.message?.content ?? []) {
          if (part.type === "tool_use") {
            const call = { name: part.name as string, input: part.input, error: false };
            pending.set(part.id, call);
            run.tools.push(call);
            console.log(`  [${label}] ${part.name}${toolHint(part.input)}`);
          } else if (part.type === "tool_result") {
            const call = pending.get(part.tool_use_id);
            if (call) {
              call.error = Boolean(part.is_error);
              const text = typeof part.content === "string" ? part.content : (part.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
              call.result = text.slice(0, 2000);
            }
          }
        }
        if (event.type === "result") run.result = { costUsd: event.total_cost_usd, turns: event.num_turns, text: event.result, isError: event.is_error };
      } catch {
        // a partial line; the next chunk completes it
      }
    }
  });
  const timer = setTimeout(() => {
    run.timedOut = true;
    if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }, TIMEOUT_MINUTES * 60_000);
  run.exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  clearTimeout(timer);
  run.seconds = Math.round((Date.now() - started) / 1000);
  transcript.end();
  stderr.end();
  await writeFile(join(box.out, `${label}-tools.json`), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

const toolHint = (input: unknown) => {
  const i = input as Record<string, unknown> | undefined;
  const hint = i?.file_path ?? i?.command ?? i?.changesetId ?? i?.requestId ?? i?.pattern;
  return hint ? ` ${String(hint).slice(0, 80)}` : "";
};

/** The baseline: takes the changeset (in progress) and stops, through the CLI equivalents of the MCP tools. */
async function dryAgent(box: Sandbox, prompt: string): Promise<AgentRun> {
  const id = /\b(cs_[A-Za-z0-9]+)\b/.exec(prompt)?.[1];
  const tools: AgentRun["tools"] = [];
  if (id) {
    const spec = box.cli(["spec", id, "--app", box.appRoot]);
    tools.push({ name: "appshape spec", input: { id }, error: spec.status !== 0 });
    const status = box.cli(["status", id, "in_progress", "--app", box.appRoot]);
    tools.push({ name: "appshape status", input: { id, status: "in_progress" }, error: status.status !== 0 });
  }
  return { exitCode: 0, timedOut: false, seconds: 0, tools, mcpServers: [] };
}

export interface Score {
  scenario: string;
  agent: string;
  /** The changeset's status when the agent stopped, and every status it went through. */
  finalStatus: string;
  statuses: string[];
  /** `appshape verify` run by the harness afterwards. */
  independentVerify: { status: number | null; output: string };
  tasks: { id: string; title: string; status?: string; note?: string; file?: string; inDiff?: boolean }[];
  verifyRounds: number;
  /** Files the agent changed (against the snapshot taken right before it started). */
  changed: string[];
  outOfScope: string[];
  /** Edits the agent made in `.appshape/` by hand (Write/Edit on those files). */
  handEditsInAppShape: string[];
  build: { status: number | null; output: string };
  mcpErrors: { name: string; result?: string }[];
  mcpServers: { name: string; status: string }[];
  seconds: number;
  turns?: number;
  costUsd?: number;
  timedOut: boolean;
}

/** Scores a run: the changeset, an independent verify, the diff, the build, the transcript. */
export async function score(box: Sandbox, options: { scenario: string; changesetId: string; before: string; statuses: string[]; agent: AgentRun; scope: RegExp; build: string[] }): Promise<Score> {
  const changeset = await readChangeset(box, options.changesetId);
  const finalStatus = changeset.status;
  const independentVerify = (() => {
    const result = box.cli(["verify", options.changesetId, "--app", box.appRoot]);
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`.trim() };
  })();
  const diff = spawnSync("git", ["diff", "--name-only", options.before], { cwd: box.appRoot, encoding: "utf8" });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: box.appRoot, encoding: "utf8" });
  const changed = [...new Set([...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].map((l) => l.trim()).filter(Boolean))];
  const code = changed.filter((f) => !f.startsWith(".appshape/"));
  const outOfScope = code.filter((f) => !options.scope.test(f));
  const handEditsInAppShape = options.agent.tools
    .filter((t) => ["Edit", "Write", "MultiEdit"].includes(t.name))
    .map((t) => String((t.input as { file_path?: string })?.file_path ?? ""))
    .filter((p) => /[\\/]\.appshape[\\/]/.test(p))
    .map((p) => relative(box.appRoot, p));
  const tasks = (changeset.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    ...(t.file && { file: t.file }),
    ...(changeset.changeStatus?.[t.id] && { status: changeset.changeStatus[t.id]!.status, note: changeset.changeStatus[t.id]!.note }),
    // notes (a drawing, a behavior) may rightly be done in other files than the page's
    ...(t.file && t.kind !== "note" && { inDiff: code.includes(t.file.replace(/\\/g, "/")) }),
  }));
  const build = (() => {
    const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", options.build, { cwd: box.appRoot, encoding: "utf8", shell: process.platform === "win32", env: box.env });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`.trim().slice(-3000) };
  })();
  const result: Score = {
    scenario: options.scenario,
    agent: AGENT === "dry" ? "dry" : `claude ${MODEL}`,
    finalStatus,
    statuses: options.statuses,
    independentVerify,
    tasks,
    verifyRounds: options.agent.tools.filter((t) => /verify_changeset$/.test(t.name) || (t.name === "Bash" && /appshape\s+verify/.test(String((t.input as { command?: string })?.command)))).length,
    changed,
    outOfScope,
    handEditsInAppShape,
    build,
    mcpErrors: options.agent.tools.filter((t) => t.name.startsWith("mcp__") && t.error).map((t) => ({ name: t.name, ...(t.result && { result: t.result }) })),
    mcpServers: options.agent.mcpServers,
    seconds: options.agent.seconds,
    ...(options.agent.result?.turns !== undefined && { turns: options.agent.result.turns }),
    ...(options.agent.result?.costUsd !== undefined && { costUsd: options.agent.result.costUsd }),
    timedOut: options.agent.timedOut,
  };
  await writeFile(join(box.out, "score.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(box.out, "summary.md"), summary(result));
  const patch = spawnSync("git", ["diff", options.before, "--", ".", ":(exclude).appshape"], { cwd: box.appRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  await writeFile(join(box.out, "diff.patch"), patch.stdout);
  return result;
}

function summary(s: Score): string {
  const yes = (b: boolean) => (b ? "✓" : "✗");
  return [
    `# ${s.scenario} · ${s.agent}`,
    "",
    `| Check | Result |`,
    `|---|---|`,
    `| The loop closed (changeset verified) | ${yes(s.finalStatus === "verified")} ${s.finalStatus} (went through: ${s.statuses.join(" → ") || "–"}) |`,
    `| Independent verify | ${yes(s.independentVerify.status === 0)} |`,
    `| Every task reported | ${yes(s.tasks.every((t) => t.status))} ${s.tasks.filter((t) => t.status).length}/${s.tasks.length} |`,
    `| Applied tasks touch their file | ${yes(s.tasks.every((t) => t.status !== "applied" || t.inDiff !== false))} |`,
    `| Verify rounds | ${s.verifyRounds} |`,
    `| Scope | ${yes(s.outOfScope.length === 0)} ${s.outOfScope.join(", ") || "clean"} |`,
    `| No hand edits in .appshape | ${yes(s.handEditsInAppShape.length === 0)} ${s.handEditsInAppShape.join(", ")} |`,
    `| The app builds | ${yes(s.build.status === 0)} |`,
    `| MCP | ${s.mcpServers.map((m) => `${m.name}: ${m.status}`).join(", ") || "–"}; ${s.mcpErrors.length} tool errors |`,
    `| Time, turns, cost | ${s.seconds}s, ${s.turns ?? "–"} turns, $${s.costUsd?.toFixed(2) ?? "–"}${s.timedOut ? " (timed out)" : ""} |`,
    "",
    "## Tasks",
    "",
    ...s.tasks.map((t) => `- ${t.id} ${t.status ?? "(no status)"}: ${t.title}${t.note ? ` — ${t.note}` : ""}`),
    "",
    "## Independent verify",
    "",
    "```",
    s.independentVerify.output.slice(-4000),
    "```",
    "",
  ].join("\n");
}

/** Files of a folder, relative (for checks on what Apply to code wrote). */
export async function filesIn(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (["node_modules", ".git", ".appshape", "dist"].includes(entry.name)) continue;
      const path = join(d, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out.push(relative(dir, path).replace(/\\/g, "/"));
    }
  };
  await walk(dir);
  return out;
}

export const removeSandbox = (box: Sandbox) => rm(join(box.appRoot, ".."), { recursive: true, force: true }).catch(() => {});
