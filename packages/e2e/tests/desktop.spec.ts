import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

/**
 * The desktop app (packages/desktop/app, staged by `pnpm --filter @appshape/desktop build`): its start
 * window opens and creates projects. System dialogs and the browser are replaced in the main process.
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
/** APPSHAPE_DESKTOP_EXE=…/release/win-unpacked/AppShape.exe tests the packaged app instead of the staged one. */
const PACKAGED = process.env.APPSHAPE_DESKTOP_EXE;
const APP = PACKAGED ? join(dirname(PACKAGED), "resources", "app") : join(REPO, "packages", "desktop", "app");
const ELECTRON = PACKAGED ?? (createRequire(join(REPO, "packages", "desktop", "package.json"))("electron") as string);

function withoutNodeMode(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

test.describe("desktop app", () => {
  test.skip(!existsSync(join(APP, "main.mjs")), "desktop app not staged");

  let root: string;
  let app: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "aps-desktop-"));
    app = await electron.launch({
      executablePath: ELECTRON,
      args: PACKAGED ? [] : [APP],
      // own per-user folder (recent projects) and Codex config, never the real ones; and not in Node
      // mode (set when the tests run inside VS Code, itself an Electron app)
      env: { ...withoutNodeMode(), APPSHAPE_HOME: join(root, "home"), CODEX_HOME: join(root, "codex"), APPSHAPE_USER_DATA: join(root, "electron") },
    });
    // boards would open in the real browser: remember them instead
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = async (url: string) => void opened.push(url);
    });
    window = await app.firstWindow();
  });

  test.afterEach(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 0; // "Close AppShape" when boards are open
    });
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

  test("starts with the start page and the computer checks", async () => {
    await expect(window.getByRole("heading", { name: "AppShape" })).toBeVisible();
    await expect(window.getByText("Apps you open show up here.")).toBeVisible();
    await expect(window.getByTestId("checks")).toContainText(/Your computer (is ready|needs)/, { timeout: 20_000 });
    await expect(window.getByRole("switch", { name: "appshape command in terminals" })).toBeVisible();
  });

  test("creates a new app and opens its board in the browser", async () => {
    await window.getByRole("button", { name: /Start a new app/ }).click();
    await window.getByRole("option", { name: /Website Pages that load fast/ }).getByRole("button").click();
    await window.getByRole("button", { name: "Next", exact: true }).click();
    await window.getByLabel("App name").fill("Bakery");
    await window.getByRole("textbox", { name: "Location" }).fill(join(root, "apps"));
    await window.getByLabel("Coding AI").selectOption("claude");
    await expect(window.getByText(join(root, "apps", "Bakery"))).toBeVisible();
    await window.getByRole("button", { name: "Create" }).click();

    await expect.poll(opened).toHaveLength(1);
    const [board] = await opened();
    expect(board).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=/);
    const project = JSON.parse(await readFile(join(root, "apps", "Bakery", ".appshape", "project.json"), "utf8"));
    expect(project.name).toBe("Bakery");
    expect(project.settings.code.stack).toBe("next-app");
    // the agent runs AppShape's MCP server with this app's executable in Node mode
    const mcp = JSON.parse(await readFile(join(root, "apps", "Bakery", ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.appshape.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(mcp.mcpServers.appshape.args.slice(-2)).toEqual(["mcp", join(root, "apps", "Bakery")]);

    // a new app's board opens with the theme starter, and a website with the landing page
    expect(board).toMatch(/&open=theme&page=landing$/);
    // the board is served, and the start page lists it as open
    const token = board!.split("#token=")[1]!.split("&")[0]!;
    const snapshot = await (await fetch(`${board!.split("#")[0]}api/project`, { headers: { "x-appshape-token": token } })).json();
    expect(snapshot.project.name).toBe("Bakery");
    await window.reload();
    const recent = window.getByTestId("recent-project");
    await expect(recent).toHaveCount(1);
    await expect(recent).toContainText("Board open");
  });

  test("opens an existing app and brings in its pages", async () => {
    const fixture = join(root, "Shop");
    await cp(join(REPO, "fixtures", "vite-react-router-tw4"), fixture, { recursive: true, filter: (src) => !/node_modules|\.appshape/.test(src) });
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
    }, fixture);
    await window.getByRole("button", { name: /Open my app/ }).click();
    const dialog = window.getByRole("dialog", { name: "Shop" });
    await expect(dialog).toContainText("A Vite + React Router app with Tailwind CSS");
    await dialog.getByRole("button", { name: "Open board and bring in pages" }).click();
    await expect.poll(opened).toHaveLength(1);
    expect((await opened())[0]).toContain("&open=import");
    expect(existsSync(join(fixture, ".appshape", "project.json"))).toBe(true);
  });

  test("runs the command line with its own executable (no Node needed)", async () => {
    await mkdir(join(root, "cli-app"));
    const out = execFileSync(ELECTRON, [join(APP, "cli", "appshape.mjs"), "init", join(root, "cli-app"), "--agent", "codex"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", APPSHAPE_HOME: join(root, "home"), CODEX_HOME: join(root, "codex") },
      encoding: "utf8",
    });
    expect(out).toContain("Connected Codex");
    const toml = await readFile(join(root, "codex", "config.toml"), "utf8");
    expect(toml).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }');
    expect(toml).toContain(JSON.stringify(join(APP, "cli", "appshape.mjs")));
  });
});
