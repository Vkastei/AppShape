import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { markupRenderer } from "@appshape/capture";
import { CodeService, STACK_IDS, type StackId } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { applyCommandToProject, CHANGE_STATUSES, CHANGESET_STATUSES, type ChangesetStatus, type ChangeStatus } from "@appshape/ir";
import { startServer } from "@appshape/server";
import { AlreadyInitializedError, type DataLocation, initProject, ProjectFiles, ProjectLoadError, resolveLocation } from "@appshape/store";
import { listChangesets, loadProject, readSpec, setChangesetStatus, setChangeStatus } from "./agent";
import { listRequests, proposeDesign, readRequest, submitReview } from "./requests";
import { AGENT_IDS, type AgentId } from "@appshape/protocol";
import { AGENTS, connectAgent, setCliLauncher, startHub } from "@appshape/server";
import { BUNDLED, bundledLauncher, EDITOR_DIST, EDITOR_ROOT, editorBuilt, VERSION } from "./runtime";

const HELP = `appshape <command> [path] [options]

Commands
  start            Open the start page: open your app or start a new one (no terminal needed after this)
                     --port <n>         server port (default: a free one)
                     --no-open          do not open the browser
  init [path]      Create an AppShape project for the app at path (default: current folder)
                     --external <dir>   keep design data outside the app, in <dir>
                     --name <name>      project name (default: folder name)
                     --agent <id>       connect a coding agent: claude, cursor, codex or generic (AGENTS.md);
                                        works on existing projects too
  dev [path]       Open the board in the browser
                     --port <n>         server port (default 4590, falls back to a free port)
                     --no-open          do not open the browser
                     --rebuild          rebuild the editor first
  doctor [path]    Check all project files and show where the data lives

Existing app → board
  import [path]    Capture the app's pages as editable screens (starts its dev server)
                     --url <url>        use a dev server that is already running
                     --route <path>     only these pages (repeatable; dynamic routes as a concrete URL path)
                     --replace          re-import pages that are already on the board (if unchanged)

Design → code
  apply [path]     Show what applying the design to the code does; --yes writes it
                     --stack <id>       for a new app: ${STACK_IDS.join(", ")}
                     --diff             print the diffs
  changesets [path] [--status ready]    List changesets (tasks for coding agents)
  spec <id> [--json] [--app <path>]     Print a changeset's spec
  status <id> <in_progress|applied> [--note text] [--app <path>]
  status <id> <c1> <applied|failed|skipped> [--note text] [--app <path>]
  verify <id> [--change c1,c2] [--url <url>] [--json] [--app <path>]
                   Check the running app against the design (starts the dev server unless --url);
                   the changeset becomes verified or needs_fix. Images in .appshape/.cache/verify/
  mcp [path]       Run the AppShape MCP server (stdio) for coding agents

Draw & describe
  requests [path]                       List the drawings on screens (design requests)
  request <id> [--image file.png] [--app <path>]
                   Print a request: the message, the drawing in words and the screen as JSX
                   (--image also writes the screen with the drawing as a picture)
  review <id> <findings.json> [--app <path>]
                   Answer a review request: {"summary", "findings": [{"title", "why", "fix", "targets", "severity"}]}
  propose <id> <file.tsx> [more.tsx…] [--by <name>] [--app <path>]
                   Propose a design for a request (the screen as JSX); the board shows it for review.
                   Two or three files: variants to pick from
`;

const EDITOR_DEV_PORT = 5174;

/** pnpm runs root scripts in the repo root; INIT_CWD is where the user typed the command. */
const cwd = process.env.INIT_CWD ?? process.cwd();

async function main(argv: string[]): Promise<number> {
  if (BUNDLED) setCliLauncher(bundledLauncher());
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      external: { type: "string" },
      name: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      rebuild: { type: "boolean" },
      "editor-dev": { type: "boolean" },
      agent: { type: "string" },
      yes: { type: "boolean", short: "y" },
      stack: { type: "string" },
      diff: { type: "boolean" },
      status: { type: "string", multiple: true },
      json: { type: "boolean" },
      note: { type: "string" },
      app: { type: "string" },
      url: { type: "string" },
      route: { type: "string", multiple: true },
      replace: { type: "boolean" },
      change: { type: "string" },
      image: { type: "string" },
      by: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, pathArg] = positionals;
  const path = resolve(cwd, pathArg ?? ".");

  const app = resolve(cwd, values.app ?? ".");
  switch (command) {
    case "init":
      return init(path, values.external ? resolve(cwd, values.external) : undefined, values.name, values.agent);
    case "apply":
      return apply(path, { yes: Boolean(values.yes), diff: Boolean(values.diff), stack: values.stack });
    case "changesets":
      return changesets(path, values.status);
    case "import":
      return importPages(path, { url: values.url, routes: values.route, replace: Boolean(values.replace) });
    case "spec":
      return spec(app, positionals[1], Boolean(values.json));
    case "status":
      return status(app, positionals.slice(1), values.note);
    case "verify":
      return verify(app, positionals[1], { url: values.url, changeIds: values.change?.split(",").map((c) => c.trim()).filter(Boolean), json: Boolean(values.json) });
    case "requests":
      return requests(path);
    case "request":
      return request(app, positionals[1], values.image ? resolve(cwd, values.image) : undefined);
    case "propose":
      return propose(app, positionals[1], positionals.slice(2).map((p) => resolve(cwd, p)), values.by);
    case "review":
      return review(app, positionals[1], positionals[2] ? resolve(cwd, positionals[2]) : undefined);
    case "mcp": {
      const location = await locate(path);
      if (!location) return 1;
      const { runMcpServer } = await import("./mcp");
      await runMcpServer(location);
      await new Promise(() => {}); // until stdin closes
      return 0;
    }
    case "start":
      return start({ ...(values.port !== undefined && { port: Number(values.port) }), open: !values["no-open"] });
    case "dev":
      return dev(path, {
        ...(values.port !== undefined && { port: Number(values.port) }),
        ...(values["no-open"] && { open: false }),
        rebuild: Boolean(values.rebuild),
        editorDev: Boolean(values["editor-dev"]),
      });
    case "doctor":
      return doctor(path);
    default:
      console.log(HELP);
      return command && !values.help ? 1 : 0;
  }
}

/** `appshape import`: capture pages of the running app into the project. */
async function importPages(path: string, options: { url: string | undefined; routes: string[] | undefined; replace: boolean }): Promise<number> {
  const location = await locate(path);
  if (!location) return 1;
  const { AppProcess, devServerOptions, Importer } = await import("@appshape/capture");
  const importer = new Importer(location.appRoot, location.dataDir);
  const status = await importer.status();
  if (status.detection.kind !== "app") {
    console.error(status.detection.kind === "none" ? "No app found in this folder." : `Can't import this app: ${status.detection.reason}.`);
    return 1;
  }
  const known = new Map(status.routes.map((r) => [r.path, r]));
  const pages = options.routes?.length
    ? options.routes.map((route) => (known.has(route) ? { route } : { route: matchRoute(route, status.routes.map((r) => r.path)) ?? route, path: route }))
    : status.routes.filter((r) => !r.dynamic).map((r) => ({ route: r.path }));
  const skipped = options.routes?.length ? [] : status.routes.filter((r) => r.dynamic).map((r) => r.path);
  if (pages.length === 0) {
    console.error("No pages to import.");
    return 1;
  }
  const settings = (await new ProjectFiles(location).load()).project.settings?.app;
  let devUrl = options.url ?? settings?.devUrl;
  const app = devUrl ? undefined : new AppProcess(location.appRoot);
  if (app) {
    const framework = status.detection.layout.stack.startsWith("next") ? "next" : "vite";
    console.log(`Starting the app (${settings?.packageManager ?? status.packageManager} run ${settings?.devScript ?? "dev"})…`);
    await app.run(await devServerOptions(settings, framework));
    devUrl = await app.waitForUrl();
    if (!devUrl) {
      console.error(`The dev server did not start:\n${app.status().log.slice(-20).join("\n")}`);
      await app.stop();
      return 1;
    }
  }
  try {
    const files = new ProjectFiles(location);
    const { project } = await files.load();
    const result = await importer.import(project, {
      devUrl: devUrl!,
      pages,
      redaction: project.redaction,
      replace: options.replace,
      onProgress: (p) => console.log(`  ${p.step}`),
    });
    await files.save(applyCommandToProject(project, result.ops));
    for (const page of result.pages) {
      const anchored = page.elements ? Math.round((page.anchored / page.elements) * 100) : 0;
      const mapped = Math.round((page.mappedClasses / Math.max(1, page.mappedClasses + page.unmappedClasses)) * 100);
      console.log(`${page.route.padEnd(32)} ${page.name.padEnd(28)} ${anchored}% in code, ${mapped}% editable styles${page.redacted ? `, ${page.redacted} redacted` : ""}`);
    }
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
    if (skipped.length) console.log(`Skipped dynamic routes (import them with --route <path>): ${skipped.join(", ")}`);
    console.log(`Imported ${result.pages.length} page(s). Open the board: appshape dev`);
    return 0;
  } finally {
    await app?.stop();
  }
}

/** `appshape verify <changeset>`: the running app against the design. Exit code 0 = verified. */
async function verify(path: string, id: string | undefined, options: { url: string | undefined; changeIds: string[] | undefined; json: boolean }): Promise<number> {
  const location = await locate(path);
  if (!location) return 1;
  if (!id) {
    console.error("Usage: appshape verify <changesetId> [--change c1,c2] [--url <url>]");
    return 1;
  }
  const { VerifyService } = await import("@appshape/capture");
  const { formatVerification, verifyChangesetAt } = await import("./agent");
  const service = new VerifyService(location.appRoot, location.dataDir);
  try {
    const result = await verifyChangesetAt(location, service, id, {
      ...(options.url && { url: options.url }),
      ...(options.changeIds && { changeIds: options.changeIds }),
      log: (line) => console.error(line),
    });
    if (options.json) console.log(JSON.stringify(result.report, null, 2));
    else console.log(formatVerification(result, (await loadProject(location)).project));
    return result.report.status === "verified" ? 0 : 1;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  } finally {
    await service.close();
  }
}

/** The route pattern a concrete path belongs to (`/blog/hello` → `/blog/[slug]`). */
function matchRoute(path: string, patterns: string[]): string | undefined {
  const parts = path.split("/").filter(Boolean);
  return patterns.find((pattern) => {
    const p = pattern.split("/").filter(Boolean);
    if (p.some((s) => /^\[\.\.\.|^\[\[\.\.\./.test(s))) return parts.length >= p.length - 1;
    return p.length === parts.length && p.every((s, i) => /^(\[.+\]|[:$].+)$/.test(s) || s === parts[i]);
  });
}

async function locate(path: string): Promise<DataLocation | undefined> {
  const location = await resolveLocation(path);
  if (!location) console.error(`No AppShape project found for ${path}. Run: appshape init`);
  return location;
}

async function init(path: string, external: string | undefined, name: string | undefined, agentArg: string | undefined): Promise<number> {
  const agent = agentArg as AgentId | undefined;
  if (agent !== undefined && !(AGENT_IDS as readonly string[]).includes(agent)) {
    console.error(`Unknown agent "${agent}". Supported: ${AGENT_IDS.join(", ")}.`);
    return 1;
  }
  const connect = async (appRoot: string) => {
    const written = await connectAgent(agent!, appRoot);
    console.log(`Connected ${AGENTS[agent!].name}: wrote ${written.join(", ")}`);
  };
  const existing = agent ? await resolveLocation(path) : undefined;
  if (existing && agent) {
    await connect(existing.appRoot);
    return 0;
  }
  try {
    const location = await initProject(path, { ...(external && { external }), ...(name && { name }), tokens: await defaultTokens() });
    console.log(`Created ${location.mode === "external" ? "external " : ""}AppShape project in ${location.dataDir}`);
    if (location.mode === "in-repo") console.log("Commit the .appshape folder with your code (its .cache/ is ignored).");
    if (agent) await connect(location.appRoot);
    console.log(`Next: appshape dev ${path === cwd ? "" : path}`.trimEnd());
    return 0;
  } catch (error) {
    if (error instanceof AlreadyInitializedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

async function doctor(path: string): Promise<number> {
  const location = await resolveLocation(path);
  if (!location) {
    console.error(`No AppShape project found for ${path}. Run: appshape init`);
    return 1;
  }
  console.log(`App:  ${location.appRoot}\nData: ${location.dataDir} (${location.mode})`);
  try {
    const { project, problems } = await new ProjectFiles(location).load();
    console.log(
      `Project "${project.name}": ${project.frames.length} frame(s), ${project.board.items.length} board item(s), ` +
        `${project.components.length} component(s), ${project.changesets.length} changeset(s)`,
    );
    for (const p of problems) console.log(`  ${p.severity === "error" ? "✗" : "!"} ${p.file}: ${p.message}`);
    if (problems.length === 0) console.log("No problems found.");
    return problems.some((p) => p.severity === "error") ? 1 : 0;
  } catch (error) {
    if (error instanceof ProjectLoadError) {
      console.error(`✗ ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function apply(path: string, options: { yes: boolean; diff: boolean; stack: string | undefined }): Promise<number> {
  const location = await locate(path);
  if (!location) return 1;
  if (options.stack && !(STACK_IDS as readonly string[]).includes(options.stack)) {
    console.error(`Unknown stack ${options.stack}. Use one of: ${STACK_IDS.join(", ")}`);
    return 1;
  }
  const { project, files } = await loadProject(location);
  const configured = project.settings?.code?.stack;
  const stack = (options.stack ?? ((STACK_IDS as readonly string[]).includes(configured ?? "") ? configured : undefined)) as StackId | undefined;
  const service = new CodeService(location.appRoot, location.dataDir);
  const plan = await service.plan(project, stack ? { stack } : {});
  console.log(`${plan.scaffold ? "New app" : "App"}: ${location.appRoot} (${plan.layout.stack}, Tailwind v${plan.layout.tailwind})`);
  if (plan.changes.length === 0 && plan.tasks.length === 0) {
    console.log("The code is up to date with the design.");
    return 0;
  }
  for (const change of plan.changes) {
    const mark = change.after === undefined ? "-" : change.before === undefined ? "+" : "~";
    console.log(`  ${mark} ${change.path}  ${change.summary}`);
    if (options.diff) console.log(unifiedDiff(change.before ?? "", change.after ?? ""));
  }
  if (plan.tasks.length > 0) {
    console.log(`\nFor your coding agent (${plan.tasks.length}):`);
    for (const task of plan.tasks) console.log(`  • ${task.summary}${task.file ? `  (${task.file}${task.line ? `:${task.line}` : ""})` : ""}`);
  }
  for (const warning of plan.warnings) console.log(`  ! ${warning}`);
  if (!options.yes) {
    console.log("\nNothing written. Run again with --yes to apply.");
    return 0;
  }
  const pictures = markupRenderer(project, location.appRoot, location.dataDir);
  const result = await service.apply(project, plan.planId, { ...(stack && { stack }), markupImage: pictures.render }).finally(() => pictures.close());
  if (result.changeset) {
    const latest = (await files.load()).project;
    await files.save({ ...latest, changesets: [...latest.changesets, result.changeset] });
  }
  console.log(`\nWrote ${result.written.length} file(s)${result.deleted.length ? `, deleted ${result.deleted.length}` : ""}.`);
  if (result.changeset) console.log(`Changeset ${result.changeset.id} with ${result.changeset.tasks?.length} task(s): .appshape/${result.specFiles[0]}`);
  if (result.install) console.log(`Install dependencies: cd ${location.appRoot} && pnpm install`);
  return 0;
}

/** Minimal unified-style diff for the terminal. */
function unifiedDiff(before: string, after: string): string {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [...a.slice(start, endA).map((l) => `      - ${l}`), ...b.slice(start, endB).map((l) => `      + ${l}`)].join("\n");
}

async function changesets(path: string, statuses: string[] | undefined): Promise<number> {
  const location = await locate(path);
  if (!location) return 1;
  const valid = (statuses ?? []).filter((s): s is ChangesetStatus => (CHANGESET_STATUSES as readonly string[]).includes(s));
  const list = await listChangesets(location, valid);
  if (list.length === 0) console.log("No changesets.");
  for (const c of list) console.log(`${c.id}  ${c.status.padEnd(11)} ${c.changeCount} change(s)  ${c.title}`);
  return 0;
}

async function requests(path: string): Promise<number> {
  const location = await locate(path);
  if (!location) return 1;
  const list = await listRequests(location);
  if (list.length === 0) console.log("No drawings on screens.");
  for (const r of list) {
    const state = r.route === "note" ? "note" : r.status;
    console.log(`${r.id}  ${state.padEnd(9)} ${`${r.screen} (${r.viewport})`.padEnd(30)} ${r.marks} mark(s)  ${r.message.replace(/\s+/g, " ").slice(0, 60)}`);
  }
  return 0;
}

async function request(app: string, id: string | undefined, image: string | undefined): Promise<number> {
  const location = await locate(app);
  if (!location) return 1;
  if (!id) {
    console.error("Usage: appshape request <id> [--image file.png]");
    return 1;
  }
  const { request: found, brief } = await readRequest(location, id);
  console.log(brief);
  if (image) {
    const { markupImage } = await import("@appshape/capture");
    const { project } = await loadProject(location);
    await writeFile(image, await markupImage({ project, request: found, appRoot: location.appRoot, dataDir: location.dataDir }));
    console.error(`Wrote ${image}`);
  }
  return 0;
}

async function review(app: string, id: string | undefined, file: string | undefined): Promise<number> {
  const location = await locate(app);
  if (!location) return 1;
  if (!id || !file) {
    console.error("Usage: appshape review <id> <findings.json>");
    return 1;
  }
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { summary?: string; findings?: unknown };
    if (!Array.isArray(raw.findings)) throw new Error('The file needs "findings": [{ "title", "why", "fix", "targets", "severity" }].');
    const { findings } = await submitReview(location, id, raw as never, "agent");
    console.log(`Reviewed ${id}: ${findings} finding(s). The board shows them.`);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function propose(app: string, id: string | undefined, files: string[], by: string | undefined): Promise<number> {
  const location = await locate(app);
  if (!location) return 1;
  if (!id || files.length === 0 || files.length > 3) {
    console.error("Usage: appshape propose <id> <file.tsx> [variant2.tsx variant3.tsx]");
    return 1;
  }
  try {
    const designs = await Promise.all(files.map(async (f) => ({ jsx: await readFile(f, "utf8") })));
    const { summary, warnings } = await proposeDesign(location, id, designs.length > 1 ? designs : designs[0]!.jsx, by ?? "file");
    if (designs.length > 1) console.log(`Proposed ${designs.length} variants for ${id}:`);
    else console.log(summary.length ? `Proposed ${summary.length} change(s) for ${id}:` : `Proposed no changes for ${id} (the JSX is the screen as it is).`);
    for (const line of summary) console.log(`  • ${line}`);
    for (const warning of warnings) console.log(`  ! ${warning}`);
    console.log("Review it on the board: accept, try again or discard.");
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function spec(app: string, id: string | undefined, json: boolean): Promise<number> {
  const location = await locate(app);
  if (!location) return 1;
  if (!id) {
    console.error("Usage: appshape spec <changesetId> [--json]");
    return 1;
  }
  console.log(await readSpec(location, id, json ? "json" : "markdown"));
  return 0;
}

async function status(app: string, args: string[], note: string | undefined): Promise<number> {
  const location = await locate(app);
  if (!location) return 1;
  const [id, second, third] = args;
  if (!id || !second) {
    console.error("Usage: appshape status <changesetId> <in_progress|applied>  or  appshape status <changesetId> <c1> <applied|failed|skipped>");
    return 1;
  }
  const summary = third
    ? (CHANGE_STATUSES as readonly string[]).includes(third)
      ? await setChangeStatus(location, id, second, third as ChangeStatus, note)
      : undefined
    : (CHANGESET_STATUSES as readonly string[]).includes(second)
      ? await setChangesetStatus(location, id, second as ChangesetStatus, note)
      : undefined;
  if (!summary) {
    console.error(`Unknown status ${third ?? second}`);
    return 1;
  }
  console.log(`${summary.id}: ${summary.status}`);
  return 0;
}

interface DevOptions {
  port?: number;
  open?: boolean;
  rebuild: boolean;
  /** Run the editor from its Vite dev server (for working on AppShape itself). */
  editorDev: boolean;
}

async function dev(path: string, options: DevOptions): Promise<number> {
  const location = await resolveLocation(path);
  if (!location) {
    console.error(`No AppShape project found for ${path}. Run: appshape init`);
    return 1;
  }
  // the project's settings, unless flags say otherwise
  const board = (await new ProjectFiles(location).load().catch(() => undefined))?.project.settings?.board;
  const port = options.port ?? board?.port ?? 4590;
  const open = options.open ?? board?.open ?? true;
  if (!options.editorDev && (options.rebuild || !editorBuilt())) {
    if (!EDITOR_ROOT) {
      console.error(`The board is missing in ${EDITOR_DIST}; reinstall AppShape.`);
      return 1;
    }
    console.log("Building the editor…");
    await run(process.execPath, [resolve(EDITOR_ROOT, "node_modules/vite/bin/vite.js"), "build"], EDITOR_ROOT);
  }
  if (options.editorDev && !EDITOR_ROOT) {
    console.error("--editor-dev only works in the AppShape repository.");
    return 1;
  }

  const start = (port: number) =>
    startServer({
      location,
      port,
      ...(options.editorDev
        ? { allowedOrigins: [`http://localhost:${EDITOR_DEV_PORT}`, `http://127.0.0.1:${EDITOR_DEV_PORT}`] }
        : { editorDir: EDITOR_DIST }),
    });
  let server: Awaited<ReturnType<typeof start>>;
  try {
    server = await start(port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    server = await start(0);
  }

  let editorUrl = server.url;
  let vite: ReturnType<typeof spawn> | undefined;
  if (options.editorDev) {
    vite = spawn(process.execPath, [resolve(EDITOR_ROOT!, "node_modules/vite/bin/vite.js"), "--port", String(EDITOR_DEV_PORT), "--strictPort"], {
      cwd: EDITOR_ROOT!,
      stdio: "inherit",
      env: { ...process.env, APPSHAPE_API: server.url },
    });
    editorUrl = `http://localhost:${EDITOR_DEV_PORT}`;
  }

  const url = `${editorUrl}/#token=${server.token}`;
  console.log(`AppShape: ${location.dataDir}\nBoard:     ${url}\nPress Ctrl+C to stop.`);
  if (open) openBrowser(url);

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  console.log("Saving and stopping…");
  vite?.kill();
  await server.close();
  return 0;
}

/** `appshape start`: the start page in the browser; boards of opened projects run in the same process. */
async function start(options: { port?: number; open: boolean }): Promise<number> {
  if (!editorBuilt()) {
    if (!EDITOR_ROOT) {
      console.error(`The board is missing in ${EDITOR_DIST}; reinstall AppShape.`);
      return 1;
    }
    console.log("Building the editor…");
    await run(process.execPath, [resolve(EDITOR_ROOT, "node_modules/vite/bin/vite.js"), "build"], EDITOR_ROOT);
  }
  const hub = await startHub({ version: VERSION, editorDir: EDITOR_DIST, ...(options.port !== undefined && { port: options.port }) });
  console.log(`Start page: ${hub.startUrl}
Press Ctrl+C to stop.`);
  if (options.open) openBrowser(hub.startUrl);
  await new Promise<void>((done) => {
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });
  console.log("Saving and stopping…");
  await hub.close();
  return 0;
}

function run(command: string, args: string[], cwdPath: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: cwdPath, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command as string, args as string[], { stdio: "ignore", detached: true }).unref();
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
