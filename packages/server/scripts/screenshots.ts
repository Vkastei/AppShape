import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchBrowser } from "@appshape/capture";
import { initProject } from "@appshape/store";
import { startServer } from "../src";


/**
 * Screenshots of the board UI (toasts, activity log, settings) on a copy of the demo project, for
 * reviewing the look: `tsx scripts/screenshots.ts <outDir>` (build the editor first).
 */
const out = process.argv[2]!;
const root = await mkdtemp(join(tmpdir(), "aps-ui-"));
await cp(resolve("../../examples/m0-validation/generated/demo-project"), join(root, ".appshape"), { recursive: true });
const server = await startServer({ location: { appRoot: root, dataDir: join(root, ".appshape"), mode: "in-repo" }, port: 0, editorDir: resolve("../editor/dist"), log: { info() {}, warn() {}, error() {} } });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${server.url}/#token=${server.token}`);
  await page.getByTitle("Connected").waitFor();
  const api = (method: string, path: string, body?: unknown) =>
    page.evaluate(([m, p, b, t]) => fetch(p as string, { method: m as string, headers: { "x-appshape-token": t as string, "content-type": "application/json" }, ...(b ? { body: b as string } : {}) }).then((r) => r.status), [method, path, body ? JSON.stringify(body) : "", server.token] as const);
  await api("PUT", "/api/settings", { name: "Habit tracker" });
  await api("POST", "/api/import", { pages: [{ route: "/" }], devUrl: "http://127.0.0.1:9/" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "ui-toasts.png") });
  await page.getByRole("button", { name: /Activity/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "ui-activity.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Project settings" }).click();
  await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Privacy" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "ui-settings.png") });
  await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "AI agents" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "ui-agents.png") });
  await page.keyboard.press("Escape");

  // a selected element with the inspector
  await page.locator("[data-frame-content] [data-aps]", { hasText: "Contact us" }).last().click({ force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "ui-selection.png") });
  await page.getByRole("button", { name: "Apply to code" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "ui-apply.png") });
  await page.keyboard.press("Escape");
} finally {
  await browser.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}

// an empty project: the introduction and the double-click menu
const blank = await mkdtemp(join(tmpdir(), "aps-ui-blank-"));
await initProject(blank, { name: "Bakery" });
const empty = await startServer({ location: { appRoot: blank, dataDir: join(blank, ".appshape"), mode: "in-repo" }, port: 0, editorDir: resolve("../editor/dist"), log: { info() {}, warn() {}, error() {} } });
const browser2 = await launchBrowser();
try {
  const page = await browser2.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${empty.url}/#token=${empty.token}`);
  await page.getByTitle("Connected").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "ui-welcome.png") });
  await page.getByRole("button", { name: "Close the introduction" }).click();
  await page.mouse.dblclick(700, 420);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "ui-quickmenu.png") });
} finally {
  await browser2.close();
  await empty.close();
  await rm(blank, { recursive: true, force: true });
}
