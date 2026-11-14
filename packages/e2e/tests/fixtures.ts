import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
/** The demo project as generated (the fixture's own copy may have been changed in the editor). */
const DEMO = join(REPO, "examples", "m0-validation", "generated", "demo-project");
const TSX = join(REPO, "node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, "packages/cli/src/main.ts");

interface Item {
  id: string;
  type: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface AppShapeApp {
  url: string;
  dataDir: string;
  /** The app folder (where code is generated). */
  appRoot: string;
  readBoard(): Promise<{ items: Item[] }>;
  /** Screens with their current trees, by name. */
  readScreens(): Promise<Map<string, { id: string; current: any }>>;
  readTokens(): Promise<{ groups: Record<string, Record<string, string | number>>; textStyles?: Record<string, any>; effectStyles?: Record<string, any> }>;
}

/** The app fixture used for importing (a copy is made per test; its .appshape is the user's). */
export const IMPORT_FIXTURE = join(REPO, "fixtures", "vite-react-router-tw4");

/**
 * Starts `appshape dev` on a copy of the demo project, on a fresh `appshape init` project, or on
 * a fresh project for a copy of an app fixture (with the fixture's dependencies linked).
 */
async function startApp(kind: "demo" | "blank" | "fixture"): Promise<{ app: AppShapeApp; stop: () => Promise<void> }> {
  const appRoot = await mkdtemp(join(tmpdir(), "appshape-e2e-"));
  const dataDir = join(appRoot, ".appshape");
  const env = { ...process.env, INIT_CWD: REPO, APPSHAPE_HOME: join(appRoot, ".home"), APPSHAPE_NO_INSTALL: "1" };
  if (kind === "demo") {
    await cp(DEMO, dataDir, { recursive: true, filter: (src) => !src.includes(".cache") });
  } else {
    if (kind === "fixture") {
      await cp(IMPORT_FIXTURE, appRoot, { recursive: true, filter: (src) => !/[\\/](node_modules|\.appshape|dist)([\\/]|$)/.test(src) });
      await symlink(join(IMPORT_FIXTURE, "node_modules"), join(appRoot, "node_modules"), "junction");
    }
    const init = spawnSync(process.execPath, [TSX, CLI, "init", appRoot, "--name", "E2E app"], { cwd: REPO, env, encoding: "utf8" });
    if (init.status !== 0) throw new Error(`appshape init failed: ${init.stderr}`);
  }

  const child: ChildProcess = spawn(process.execPath, [TSX, CLI, "dev", appRoot, "--no-open", "--port", "0"], { cwd: REPO, env });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Board:\s+(\S+)/.exec(output);
      if (match) resolve(match[1]!);
    });
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => reject(new Error(`appshape dev exited with ${code}:\n${output}`)));
  });

  const json = async (path: string) => JSON.parse(await readFile(join(dataDir, path), "utf8"));
  const app: AppShapeApp = {
    url,
    dataDir,
    appRoot,
    readBoard: () => json("board.json"),
    readTokens: () => json("tokens.json"),
    readScreens: async () => {
      const screens = new Map<string, { id: string; current: any }>();
      for (const id of await readdir(join(dataDir, "frames")).catch(() => [] as string[])) {
        try {
          const meta = await json(`frames/${id}/frame.json`);
          screens.set(meta.name, { id, current: await json(`frames/${id}/current.json`) });
        } catch {
          // being written right now; the next poll sees it
        }
      }
      return screens;
    },
  };
  const stop = async () => {
    // on Windows, kill() ends only the CLI; the app's dev server it started would keep running
    if (process.platform === "win32" && child.pid) {
      await new Promise((r) => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("exit", r).on("error", r));
    } else child.kill();
    await new Promise((r) => setTimeout(r, 300));
    await rm(appRoot, { recursive: true, force: true }).catch(() => {});
  };
  return { app, stop };
}

async function openBoard(page: Page, app: AppShapeApp, use: (page: Page) => Promise<void>) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.url);
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByTitle("Connected")).toBeVisible();
  await use(page);
  expect(errors, "uncaught page errors").toEqual([]);
}

export const test = base.extend<{ app: AppShapeApp; board: Page; blankApp: AppShapeApp; blankBoard: Page; fixtureApp: AppShapeApp; fixtureBoard: Page }>({
  app: async ({}, use) => {
    const { app, stop } = await startApp("demo");
    await use(app);
    await stop();
  },
  /** The demo project's board. */
  board: async ({ page, app }, use) => openBoard(page, app, use),
  blankApp: async ({}, use) => {
    const { app, stop } = await startApp("blank");
    await use(app);
    await stop();
  },
  /** A fresh, empty project's board. */
  blankBoard: async ({ page, blankApp }, use) => openBoard(page, blankApp, use),
  fixtureApp: async ({}, use) => {
    const { app, stop } = await startApp("fixture");
    await use(app);
    await stop();
  },
  /** A fresh project for a copy of the Vite + React Router fixture app (for importing it). */
  fixtureBoard: async ({ page, fixtureApp }, use) => openBoard(page, fixtureApp, use),
});

/** Runs the `appshape` CLI for an app (like a coding agent in its terminal). */
export function runCli(app: AppShapeApp, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, INIT_CWD: app.appRoot, APPSHAPE_HOME: join(app.appRoot, ".home"), APPSHAPE_NO_INSTALL: "1" };
  const result = spawnSync(process.execPath, [TSX, CLI, ...args, "--app", app.appRoot], { cwd: REPO, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Clicks an element inside a rendered screen (screens are inert, so click by coordinates). */
export async function clickInScreen(page: Page, text: string, options: { double?: boolean; scope?: string } = {}) {
  const element = page.locator(`${options.scope ?? "[data-frame-content]"} [data-aps]`, { hasText: text }).last();
  const box = (await element.boundingBox())!;
  const x = box.x + Math.min(box.width / 2, 12);
  const y = box.y + box.height / 2;
  if (options.double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
}

export const selectedLabel = (page: Page) => page.locator("aside[aria-label=Inspector] .text-sm").first();

export { expect };
