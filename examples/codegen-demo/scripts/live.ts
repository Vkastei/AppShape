/**
 * Smoke test of the whole loop with real installs (needs network): a new project with the demo
 * design → Apply to code through the server API (as the editor does) → pnpm install → dev server
 * → the page in Edge. Usage: pnpm --filter @appshape/codegen-demo live [stack] [--keep]
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StackId } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import type { AppProcessStatus, CodeApplyResponse, CodePlanResponse } from "@appshape/protocol";
import { TOKEN_HEADER } from "@appshape/protocol";
import { startServer } from "@appshape/server";
import { ProjectFiles } from "@appshape/store";
import { chromium } from "playwright-core";
import { demoProject } from "../src/design";

const stack = (process.argv.find((a) => !a.startsWith("-") && a.includes("-") && !a.includes("/") && !a.includes("\\")) ?? "vite-react-router") as StackId;
const keep = process.argv.includes("--keep");

const appRoot = await mkdtemp(join(tmpdir(), `appshape-live-${stack}-`));
const location = { appRoot, dataDir: join(appRoot, ".appshape"), mode: "in-repo" as const };
await new ProjectFiles(location).save(demoProject(await defaultTokens()));
console.log(`project: ${appRoot}`);

const server = await startServer({ location, port: 0, log: { info: () => {}, warn: console.warn, error: console.error } });
const api = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${server.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { [TOKEN_HEADER]: server.token, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
};

let failed = false;
try {
  const plan = await api<CodePlanResponse>("/api/code/plan", { stack });
  console.log(`plan: ${plan.changes.length} files, ${plan.tasks.length} task(s), scaffold=${plan.scaffold}`);
  const result = await api<CodeApplyResponse>("/api/code/apply", { planId: plan.planId, stack });
  console.log(`applied: ${result.written.length} written, changeset ${result.changesetId ?? "-"}`);

  const started = Date.now();
  let status: AppProcessStatus;
  for (;;) {
    status = await api<AppProcessStatus>("/api/code/process");
    if (status.state === "running" || status.state === "failed" || Date.now() - started > 300_000) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`process: ${status.state} after ${Math.round((Date.now() - started) / 1000)}s ${status.url ?? ""}`);
  if (status.state !== "running" || !status.url) {
    console.log(status.log.slice(-30).join("\n"));
    failed = true;
  } else {
    const browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(status.url);
    await page.waitForSelector("h1", { timeout: 60_000 });
    const title = await page.locator("h1").first().textContent();
    console.log(`page h1: ${title}`);
    const shot = join(appRoot, "..", `appshape-live-${stack}.png`);
    await writeFile(shot, await page.screenshot());
    console.log(`screenshot: ${shot}`);
    await page.getByText("Start today").click();
    await page.waitForURL(/\/today$/);
    console.log(`navigation: ${page.url()}`);
    await browser.close();
    failed = title !== "Build better habits";
  }
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  await server.close();
  if (!keep) await rm(appRoot, { recursive: true, force: true }).catch(() => {});
}
console.log(failed ? "LIVE CHECK FAILED" : "LIVE CHECK OK");
process.exit(failed ? 1 : 0);
