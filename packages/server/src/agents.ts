import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentId, AgentStatus } from "@appshape/protocol";

/**
 * Connecting coding agents to a project: each gets the AppShape MCP server (its own config file)
 * and the workflow instructions (the file it reads). Used by the board's settings and
 * `appshape init --agent <id>`.
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const START = "<!-- appshape:start -->";
const END = "<!-- appshape:end -->";

export const AGENT_INSTRUCTIONS = `${START}
## AppShape (design → code)

The UI of this app is designed in AppShape (\`.appshape/\`, edited in the AppShape board, not by hand).
AppShape writes the code it can generate exactly (pages, components, the Tailwind theme) and hands
everything else to you as **changesets**: tasks with a file, a line and the target code.

Working on a changeset (MCP server \`appshape\`; CLI equivalents in brackets):

1. \`list_changesets\` with status \`ready\` (\`appshape changesets --status ready\`).
2. \`get_changeset\` for the spec (\`appshape spec <id>\`), then \`set_changeset_status\` → \`in_progress\`.
3. Do every task. A *target* code block is what AppShape would generate at that place: merge it with
   the existing code and keep existing logic. Keep generated Tailwind classes unless a task says otherwise.
   Then run the app's own checks (its \`typecheck\` or \`build\` script) and fix what they find.
4. Report each task with \`set_change_status\` (\`appshape status <id> <c1> applied\`), then set the
   changeset to \`applied\`.
5. \`verify_changeset\` (\`appshape verify <id>\`) opens the running app and compares it with the
   design. Each failed check says what the app renders instead (e.g. \`font-size 20px (found 18px)\`)
   and \`.appshape/.cache/verify/\` has screenshots and diff images. Fix and verify again until the
   changeset is \`verified\`.

Use \`get_frame\` (format \`jsx\`) to see the code AppShape generates for a new screen or component.
Pages brought in from the app are edited in place: their own file is the source (\`get_frame\` with
format \`json\` shows their design).

### Design requests (Draw & describe)

People also mark up screens on the board (red = remove, green = add, blue = change) and describe
the change. When asked to "design AppShape request <id>" (or \`list_design_requests\` shows one
waiting for you):

1. \`get_design_request\` (\`appshape request <id> --image drawing.png\`): the message, the drawing in
   words with the elements each mark touches, a picture, and the screen as design JSX.
2. Change that JSX as asked, and nothing else: keep the \`data-id\` of every element you keep, use the
   project's components, \`<Icon name>\` and the design tokens' Tailwind classes.
3. \`propose_design\` with the whole screen (\`appshape propose <id> design.tsx --by agent\`). Fix what
   AppShape can't read and propose again. The person reviews it on the board; don't edit \`.appshape/\`
   or the app's code for it.

A request whose job is a **review** ("## The job: review this screen") asks for findings, not a
design: answer with \`submit_review\` (\`appshape review <id> findings.json\`), and change nothing.
${END}
`;

/** How AppShape's command line is started: from the repo (tsx), a bundle (node) or the desktop app (its exe as Node). */
export interface CliLauncher {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

let launcher: CliLauncher = { command: "node", args: [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), join(REPO, "packages", "cli", "src", "main.ts")] };

/** Set by the bundled CLI and the desktop app, so agents start the AppShape that is installed. */
export function setCliLauncher(value: CliLauncher): void {
  launcher = value;
}

export function cliLauncher(): CliLauncher {
  return launcher;
}

/** How an agent starts the MCP server for this app. */
export function mcpCommand(appRoot: string): CliLauncher {
  return { command: launcher.command, args: [...launcher.args, "mcp", appRoot], ...(launcher.env && { env: launcher.env }) };
}

interface AgentSpec {
  name: string;
  /** The MCP config file (absolute) and the instructions file (absolute). */
  files(appRoot: string): { mcp: string; instructions: string };
  description: string;
}

/** Codex reads one global config: one entry per project. */
const codexName = (appRoot: string) => `appshape-${basename(appRoot).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app"}`;

export const AGENTS: Record<AgentId, AgentSpec> = {
  claude: {
    name: "Claude Code",
    description: "Anthropic's coding agent in the terminal and editors.",
    files: (root) => ({ mcp: join(root, ".mcp.json"), instructions: join(root, "CLAUDE.md") }),
  },
  cursor: {
    name: "Cursor",
    description: "The AI code editor.",
    files: (root) => ({ mcp: join(root, ".cursor", "mcp.json"), instructions: join(root, ".cursor", "rules", "appshape.mdc") }),
  },
  codex: {
    name: "Codex",
    description: "OpenAI's coding agent (its settings are shared by all your projects).",
    files: (root) => ({ mcp: join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), instructions: join(root, "AGENTS.md") }),
  },
  generic: {
    name: "Other agents",
    description: "Agents that read AGENTS.md; add the MCP server below in their settings.",
    files: (root) => ({ mcp: "", instructions: join(root, "AGENTS.md") }),
  },
};

const read = (file: string) => readFile(file, "utf8").catch(() => undefined);

async function write(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** The instructions inside a markdown file (replacing an earlier version of them). */
function withInstructions(text: string | undefined, block: string): string {
  const current = text ?? "";
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) return current.slice(0, start) + block.trimEnd() + current.slice(end + END.length);
  return `${current}${current && !current.endsWith("\n\n") ? (current.endsWith("\n") ? "\n" : "\n\n") : ""}${block}`;
}

function withoutInstructions(text: string): string {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  return start >= 0 && end > start ? (text.slice(0, start) + text.slice(end + END.length)).replace(/\n{3,}/g, "\n\n") : text;
}

const tomlString = (s: string) => JSON.stringify(s);

function codexBlock(appRoot: string): string {
  const { command, args, env } = mcpCommand(appRoot);
  const envLine = env ? `env = { ${Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }\n` : "";
  return `[mcp_servers.${codexName(appRoot)}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]\n${envLine}`;
}

/** The TOML config without the project's table. */
function withoutCodexBlock(text: string, appRoot: string): string {
  const header = `[mcp_servers.${codexName(appRoot)}]`;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === header);
  if (at < 0) return text;
  let end = at + 1;
  while (end < lines.length && !lines[end]!.trim().startsWith("[")) end++;
  return [...lines.slice(0, at), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

async function jsonMcp(file: string, change: (servers: Record<string, unknown>) => void): Promise<void> {
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse((await read(file)) ?? "{}") as typeof config;
  } catch {
    // unreadable: start over
  }
  const servers = { ...config.mcpServers };
  change(servers);
  await write(file, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`);
}

/** Connects (or updates) an agent: MCP config and instructions. Returns the files written. */
export async function connectAgent(id: AgentId, appRoot: string): Promise<string[]> {
  const spec = AGENTS[id];
  const files = spec.files(appRoot);
  const written: string[] = [];
  if (id === "claude" || id === "cursor") {
    await jsonMcp(files.mcp, (servers) => (servers.appshape = mcpCommand(appRoot)));
    written.push(files.mcp);
  } else if (id === "codex") {
    const current = (await read(files.mcp)) ?? "";
    const rest = withoutCodexBlock(current, appRoot).trimEnd();
    await write(files.mcp, `${rest ? `${rest}\n\n` : ""}${codexBlock(appRoot)}`);
    written.push(files.mcp);
  }
  const instructions = id === "cursor" ? `---\ndescription: How this app's UI is designed and implemented with AppShape\nalwaysApply: true\n---\n\n${AGENT_INSTRUCTIONS}` : AGENT_INSTRUCTIONS;
  await write(files.instructions, id === "cursor" ? instructions : withInstructions(await read(files.instructions), instructions));
  written.push(files.instructions);
  return written;
}

/** Removes AppShape from an agent's config and instructions (other content stays). */
export async function disconnectAgent(id: AgentId, appRoot: string): Promise<void> {
  const files = AGENTS[id].files(appRoot);
  if (id === "claude" || id === "cursor") {
    if ((await read(files.mcp)) !== undefined) await jsonMcp(files.mcp, (servers) => delete servers.appshape);
  } else if (id === "codex") {
    const current = await read(files.mcp);
    if (current !== undefined) await write(files.mcp, withoutCodexBlock(current, appRoot));
  }
  const text = await read(files.instructions);
  if (text === undefined) return;
  // AGENTS.md is read by Codex and by other agents: removing Codex keeps it, removing "other
  // agents" keeps it while Codex is still set up. Cursor's rule file is ours alone.
  if (id === "codex" || (id === "generic" && (await agentStatus("codex", appRoot)).mcp)) return;
  await write(files.instructions, id === "cursor" ? "" : withoutInstructions(text));
}

export async function agentStatus(id: AgentId, appRoot: string): Promise<AgentStatus> {
  const spec = AGENTS[id];
  const files = spec.files(appRoot);
  const mcpText = files.mcp ? await read(files.mcp) : undefined;
  const mcp =
    id === "codex"
      ? Boolean(mcpText?.includes(`[mcp_servers.${codexName(appRoot)}]`))
      : id === "generic"
        ? false
        : (() => {
            try {
              return Boolean((JSON.parse(mcpText ?? "{}") as { mcpServers?: Record<string, unknown> }).mcpServers?.appshape);
            } catch {
              return false;
            }
          })();
  const instructions = Boolean((await read(files.instructions))?.includes(START));
  return {
    id,
    name: spec.name,
    description: spec.description,
    connected: id === "generic" ? instructions : mcp && instructions,
    mcp,
    instructions,
    files: [files.mcp, files.instructions].filter(Boolean),
  };
}

export async function agentStatuses(appRoot: string): Promise<AgentStatus[]> {
  return Promise.all((Object.keys(AGENTS) as AgentId[]).map((id) => agentStatus(id, appRoot)));
}
