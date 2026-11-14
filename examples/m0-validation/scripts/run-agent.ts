/**
 * One scored M0 agent run: copies the repository (the working tree, so uncommitted changes count) into a
 * sandbox outside the repo, hides everything in examples/m0-validation except the specs, starts the agent
 * headless, then scores the sandbox from here: acceptance checks, typecheck, diff and scope.
 *
 *   pnpm m0:run cs_001 [--agent claude|codex|none] [--model <name>] [--timeout <minutes>]
 *
 * `--agent none` runs no agent: a control run that scores the unchanged app (all change checks fail).
 *
 * Results go to examples/m0-validation/runs/<run id>/ (gitignored); the sandbox stays for manual review.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PACKAGE, "../..");
const APP = "fixtures/vite-react-router-tw4";
const APP_PACKAGE = "@appshape-fixtures/vite-react-router-tw4";
const SPEC_DIR = "examples/m0-validation/specs/";
/** Files of this package the agent may see: the specs, plus what pnpm needs to install the workspace. */
const VISIBLE = new Set(["examples/m0-validation/package.json", "examples/m0-validation/tsconfig.json"]);

// ---- arguments

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const changeset = args.find((a) => /^cs_\d+$/.test(a));
const agent = flag("agent") ?? "claude";
const model = flag("model");
const timeoutMinutes = Number(flag("timeout") ?? 45);
if (!changeset || !existsSync(join(PACKAGE, "specs", `${changeset}.md`))) fail("usage: pnpm m0:run <cs_001|cs_002> [--agent claude|codex|none] [--model <name>] [--timeout <minutes>]");
if (agent !== "claude" && agent !== "codex" && agent !== "none") fail(`unknown agent ${agent} (claude, codex or none)`);

const INSTALL: Record<string, string> = {
  claude: "install Claude Code (https://claude.com/claude-code) and sign in",
  codex: "install the Codex CLI (npm i -g @openai/codex) and run codex login",
};
if (agent !== "none") {
  const found = spawnSync(process.platform === "win32" ? "where" : "which", [agent], { encoding: "utf8" });
  if (found.status !== 0) fail(`${agent} is not installed or not on PATH: ${INSTALL[agent]}, then open a new terminal.`);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const runId = `${changeset}-${agent}${model ? `-${model}` : ""}-${stamp}`;
const sandbox = join(tmpdir(), "appshape-m0", runId);
const out = join(PACKAGE, "runs", runId);
mkdirSync(out, { recursive: true });

// ---- sandbox

step(`sandbox ${sandbox}`);
const listed = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT }).stdout.split("\0");
const files = listed.filter((f) => f && existsSync(join(ROOT, f)) && (!f.startsWith("examples/m0-validation/") || f.startsWith(SPEC_DIR) || VISIBLE.has(f)));
for (const file of files) {
  mkdirSync(dirname(join(sandbox, file)), { recursive: true });
  cpSync(join(ROOT, file), join(sandbox, file));
}
// a baseline commit in the sandbox's own repository (neutral identity, never the user's)
const git = (...a: string[]) => run("git", a, { cwd: sandbox, env: { ...process.env, GIT_AUTHOR_NAME: "M0 baseline", GIT_AUTHOR_EMAIL: "m0@appshape.invalid", GIT_COMMITTER_NAME: "M0 baseline", GIT_COMMITTER_EMAIL: "m0@appshape.invalid" } });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "M0 baseline");

step("installing the app's dependencies");
let install = run("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--filter", APP_PACKAGE], { cwd: sandbox, check: false });
if (install.status !== 0 && existsSync(join(ROOT, ".npmrc"))) {
  // the store lacks a package: install through the user's registry config (.npmrc is gitignored, so it stays out of the diff)
  cpSync(join(ROOT, ".npmrc"), join(sandbox, ".npmrc"));
  install = run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--filter", APP_PACKAGE], { cwd: sandbox, check: false });
}
if (install.status !== 0) fail(`pnpm install failed in the sandbox:\n${install.stdout}${install.stderr}`);

// ---- the agent

const prompt = `You are implementing a design changeset exported by AppShape, a design tool.
Read the spec in examples/m0-validation/specs/${changeset}.md and implement it in the app at
${APP}.

Rules for this test run:
- Only edit files inside ${APP}/src.
- Do not read anything in examples/m0-validation except the spec file.
- AppShape's MCP tools and CLI are not available. Instead of set_change_status, finish with a
  table: change id | status (applied/failed/skipped) | note. Skip the verify step.
- When you are done, run: pnpm --filter ${APP_PACKAGE} typecheck`;
writeFileSync(join(out, "prompt.txt"), prompt);

step(`running ${agent}${model ? ` (${model})` : ""}, up to ${timeoutMinutes} min`);
const started = Date.now();
const env = { ...process.env };
// a nested Claude Code refuses to start when it sees the parent's session; VS Code's Electron flag breaks child tools
for (const key of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ELECTRON_RUN_AS_NODE"]) delete env[key];
const agentRun =
  agent === "none"
    ? { status: 0, stdout: "(control run: no agent)", stderr: "", error: undefined }
    : agent === "claude"
    ? run(
        "claude",
        [
          "-p",
          prompt,
          ...(model ? ["--model", model] : []),
          "--output-format",
          "json",
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          "Read Edit Write Glob Grep Bash(pnpm:*)",
          "--disallowedTools",
          "WebFetch WebSearch",
          "--strict-mcp-config",
        ],
        { cwd: sandbox, env, check: false, timeout: timeoutMinutes * 60_000, shell: false },
      )
    : // codex 0.16x: edits only in the workspace, approvals reviewed automatically, no user config (MCP servers,
      // rules), the prompt on stdin, the final message into a file
      run(
        "codex",
        [
          "exec",
          "--approve-for-me", // implies the workspace-write sandbox
          "--ignore-user-config",
          "--ephemeral",
          "--color",
          "never",
          "--output-last-message",
          `"${join(out, "codex-last-message.md")}"`,
          ...(model ? ["--model", model] : []),
          "-",
        ],
        { cwd: sandbox, env, check: false, timeout: timeoutMinutes * 60_000, input: prompt },
      );
const minutes = (Date.now() - started) / 60_000;
const timedOut = (agentRun.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
if (agentRun.error && !timedOut) fail(`${agent} did not start: ${agentRun.error.message}`);
writeFileSync(join(out, "agent-output.txt"), agentRun.stdout + (agentRun.stderr ? `\n--- stderr\n${agentRun.stderr}` : ""));
let report = agentRun.stdout;
let cost: number | undefined;
let turns: number | undefined;
if (agent === "claude") {
  try {
    const json = JSON.parse(agentRun.stdout) as { result?: string; total_cost_usd?: number; num_turns?: number };
    report = json.result ?? report;
    cost = json.total_cost_usd;
    turns = json.num_turns;
  } catch {
    // not JSON (e.g. an error message): keep the raw output
  }
}
const lastMessage = join(out, "codex-last-message.md");
if (agent === "codex" && existsSync(lastMessage)) report = readFileSync(lastMessage, "utf8");
writeFileSync(join(out, "agent-report.md"), report);

// ---- scoring

step("scoring");
git("add", "-A");
const stat = git("diff", "--cached", "--stat", "HEAD").stdout;
writeFileSync(join(out, "diff.patch"), git("diff", "--cached", "HEAD").stdout);
const changed = git("diff", "--cached", "--name-only", "HEAD").stdout.split("\n").filter(Boolean);
const outside = changed.filter((f) => !f.startsWith(`${APP}/src/`));

const typecheck = run("pnpm", ["--filter", APP_PACKAGE, "typecheck"], { cwd: sandbox, check: false });
writeFileSync(join(out, "typecheck.txt"), typecheck.stdout + typecheck.stderr);

const checksFile = join(out, "checks.json");
run("pnpm", ["exec", "vitest", "run", "--config", "checks/vitest.config.ts", "--reporter=json", `--outputFile=${checksFile}`, changeset], {
  cwd: PACKAGE,
  env: { ...process.env, APPSHAPE_FIXTURE_DIR: join(sandbox, APP) },
  check: false,
});
type Assertion = { title: string; status: string; failureMessages?: string[] };
const results: Assertion[] = existsSync(checksFile)
  ? (JSON.parse(readFileSync(checksFile, "utf8")) as { testResults: { assertionResults: Assertion[] }[] }).testResults.flatMap((r) => r.assertionResults)
  : [];
const changeChecks = results.filter((r) => !r.title.startsWith("scope"));
const scopeChecks = results.filter((r) => r.title.startsWith("scope"));
const passed = (list: Assertion[]) => list.filter((r) => r.status === "passed").length;

const summary = `# M0 run ${runId}

| | |
|---|---|
| Agent | ${agent}${model ? ` (${model})` : ""} |
| Changeset | ${changeset} |
| Agent exit | ${timedOut ? `timed out after ${timeoutMinutes} min` : agentRun.status} |
| Duration | ${minutes.toFixed(1)} min${turns !== undefined ? ` · ${turns} turns` : ""}${cost !== undefined ? ` · $${cost.toFixed(2)}` : ""} |
| **Change checks** | **${passed(changeChecks)}/${changeChecks.length}** |
| Scope guard | ${scopeChecks.length ? `${passed(scopeChecks)}/${scopeChecks.length}` : "none for this changeset"} |
| Typecheck | ${typecheck.status === 0 ? "passes" : "fails (typecheck.txt)"} |
| Files outside ${APP}/src | ${outside.length ? outside.map((f) => `\`${f}\``).join(", ") : "none"} |

## Checks

${results.map((r) => `- ${r.status === "passed" ? "✅" : "❌"} ${r.title}${r.status === "passed" ? "" : `: ${(r.failureMessages?.[0] ?? "").split("\n")[0]}`}`).join("\n") || "- (no results: see checks.json)"}

## Diff

\`\`\`
${stat.trim()}
\`\`\`

The agent's own report is in agent-report.md, the full diff in diff.patch. Sandbox for manual review
(\`pnpm --filter ${APP_PACKAGE} dev\` there): ${sandbox}
`;
writeFileSync(join(out, "summary.md"), summary);
console.log(`\n${summary}\nResults: ${out}`);

// ---- helpers

function run(command: string, a: string[], options: SpawnSyncOptions & { check?: boolean } = {}) {
  const { check = true, ...rest } = options;
  // pnpm and codex are .cmd shims on Windows: they need a shell, given one command line (arguments here never contain shell syntax)
  const shell = rest.shell ?? (process.platform === "win32" && (command === "pnpm" || command === "codex"));
  const options_ = { encoding: "utf8" as const, maxBuffer: 256 * 1024 * 1024, ...rest, shell };
  const result = shell ? spawnSync([command, ...a].join(" "), options_) : spawnSync(command, a, options_);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (check && result.status !== 0) fail(`${command} ${a.join(" ")} failed:\n${stdout}${stderr}`);
  return { status: result.status, stdout, stderr, error: result.error };
}

function step(message: string) {
  console.log(`[m0] ${message}`);
}

function fail(message: string): never {
  console.error(`[m0] ${message}`);
  process.exit(1);
}
