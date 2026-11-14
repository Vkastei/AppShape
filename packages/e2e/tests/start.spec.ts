import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { IMPORT_FIXTURE } from "./fixtures";

/** `appshape start`: the start page in the browser (no desktop app), with AppShape's own folder picker. */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TSX = join(REPO, "node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, "packages/cli/src/main.ts");

let root: string;
let child: ChildProcess;
let startUrl: string;

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "appshape-start-"));
  child = spawn(process.execPath, [TSX, CLI, "start", "--no-open", "--port", "0"], { cwd: REPO, env: { ...process.env, APPSHAPE_HOME: join(root, "home"), CODEX_HOME: join(root, "codex") } });
  startUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Start page:\s+(\S+)/.exec(output);
      if (match) resolve(match[1]!);
    });
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => reject(new Error(`appshape start exited with ${code}:\n${output}`)));
  });
});

test.afterEach(async () => {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

test("opens an existing app from the browser start page, straight into bringing in its pages", async ({ page }) => {
  const app = join(root, "Shop");
  await cp(IMPORT_FIXTURE, app, { recursive: true, filter: (src) => !/[\\/](node_modules|\.appshape|dist)([\\/]|$)/.test(src) });
  await symlink(join(IMPORT_FIXTURE, "node_modules"), join(app, "node_modules"), "junction");

  await page.goto(startUrl);
  await expect(page.getByRole("heading", { name: "AppShape" })).toBeVisible();
  await page.getByRole("button", { name: /Open my app/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose your app's folder" });
  await picker.getByLabel("Folder path").fill(root);
  await picker.getByLabel("Folder path").press("Enter");
  await picker.getByRole("button", { name: "Shop" }).dblclick();
  await expect(picker.getByLabel("Folder path")).toHaveValue(app);
  await picker.getByRole("button", { name: "Choose this folder" }).click();

  await page.getByRole("dialog", { name: "Shop" }).getByRole("button", { name: "Open board and bring in pages" }).click();
  // the board of the new project, with the import dialog open
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Import pages|Bring in/i })).toBeVisible();
});

test("starts a new app from a template", async ({ page }) => {
  await page.goto(startUrl);
  await page.getByRole("button", { name: /Start a new app/ }).click();
  await page.getByRole("radio", { name: "Websites" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("searchbox").or(page.getByLabel("Search kinds of app")).fill("classic");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option").getByRole("button").dblclick();
  await page.getByLabel("App name").fill("bad/name");
  await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();
  await page.getByLabel("App name").fill("Blog");
  await page.getByRole("textbox", { name: "Location" }).fill(root);
  // a website starts with the landing page; any page template, or an empty board
  await expect(page.getByLabel("First page")).toHaveValue("landing");
  await page.getByLabel("First page").selectOption("pricing");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByTitle("Connected")).toBeVisible();
  // the board opens with the theme starter, and the first page is on it
  await expect(page.getByRole("button", { name: "Close theme starter" })).toBeVisible();
  await expect(page.locator("[data-item-id] [data-frame-content]").getByText("Simple pricing that grows with you")).toBeVisible();
});
