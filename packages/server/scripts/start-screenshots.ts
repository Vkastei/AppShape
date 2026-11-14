import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchBrowser } from "@appshape/capture";
import { addRecentProject } from "@appshape/store";
import { startHub } from "../src";

/**
 * Screenshots of the start page (recent apps, new-app wizard, opening an app) with a temporary
 * per-user folder: `tsx scripts/start-screenshots.ts <outDir>` (build the editor first).
 */
const out = process.argv[2]!;
const root = await mkdtemp(join(tmpdir(), "aps-start-"));
process.env.APPSHAPE_HOME = join(root, "home");
const habit = join(root, "Habit tracker");
await cp(resolve("../../examples/m0-validation/generated/demo-project"), join(habit, ".appshape"), { recursive: true });
const shop = join(root, "Bakery shop");
await cp(resolve("../../fixtures/next-app-router-tw4"), shop, { recursive: true, filter: (src) => !/node_modules|\.next|\.appshape/.test(src) });
await mkdir(join(root, "Empty"), { recursive: true });
const day = 86_400_000;
await addRecentProject(join(root, "Old landing page"), "Old landing page", new Date(Date.now() - 20 * day));
await addRecentProject(join(root, "Team dashboard"), "Team dashboard", new Date(Date.now() - 3 * day));
await addRecentProject(habit, "Habit tracker", new Date(Date.now() - 2 * 3_600_000));

const hub = await startHub({ version: "0.1.0", editorDir: resolve("../editor/dist"), log: { info() {}, warn() {}, error() {} } });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(hub.startUrl);
  await page.getByText("Your computer").first().waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, "start-home.png") });
  await page.getByRole("button", { name: /Start a new app/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "start-new.png") });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "start-configure.png") });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: /Open my app/ }).click();
  await page.getByLabel("Folder path").fill(shop);
  await page.getByRole("button", { name: "Choose this folder" }).click();
  await page.getByRole("dialog", { name: "Bakery shop" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "start-open.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Open my app/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "start-picker.png") });
} finally {
  await browser.close();
  await hub.close();
  await rm(root, { recursive: true, force: true });
}
