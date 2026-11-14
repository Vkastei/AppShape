// A stand-in for Claude Code (`claude -p <prompt> --output-format stream-json …`) in the end-to-end
// tests: it takes the changeset of "Implement the AppShape changeset cs_…", reports its tasks as
// applied through AppShape's CLI (as the real agent does over MCP), and prints Claude Code's events.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const [tsx, cli] = (process.env.APPSHAPE_FAKE_CLAUDE_CLI ?? "").split("|");
const app = process.cwd();
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const appshape = (...args) => spawnSync(process.execPath, [tsx, cli, ...args, "--app", app], { encoding: "utf8", env: { ...process.env, INIT_CWD: app } });

say({ type: "system", subtype: "init", mcp_servers: [{ name: "appshape", status: "connected" }] });
const id = /\b(cs_[A-Za-z0-9]+)\b/.exec(prompt)?.[1];
if (!id) {
  say({ type: "result", subtype: "success", is_error: true, result: `Not a changeset: ${prompt}` });
  process.exit(1);
}
say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__appshape__get_changeset", input: { changesetId: id } }] } });
appshape("status", id, "in_progress");
const changeset = JSON.parse(readFileSync(join(app, ".appshape", "changesets", `${id}.json`), "utf8"));
for (const task of changeset.tasks ?? []) {
  say({ type: "assistant", message: { content: [{ type: "tool_use", id: `s_${task.id}`, name: "mcp__appshape__set_change_status", input: { changesetId: id, changeId: task.id, status: "applied" } }] } });
  appshape("status", id, task.id, "applied");
}
appshape("status", id, "applied");
await new Promise((r) => setTimeout(r, 300));
say({ type: "result", subtype: "success", is_error: false, result: `Implemented ${changeset.tasks?.length ?? 0} task(s) of ${id}.`, total_cost_usd: 0.01, num_turns: 3 });
