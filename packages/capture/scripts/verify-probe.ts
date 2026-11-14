import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { applyCommandToProject, DEFAULT_REDACTION, type Project } from "@appshape/ir";
import { AppProcess, freePort, Importer, launchBrowser, verifyFrames } from "../src/index";

/**
 * Calibration: imports an app and verifies it unchanged; every element should match.
 * `tsx scripts/verify-probe.ts <appRoot> [route…]`
 */
const [appRoot, ...only] = process.argv.slice(2);
if (!appRoot) throw new Error("usage: verify-probe <appRoot> [route…]");
const root = resolve(appRoot);
const app = new AppProcess(root);
const devProcess = app;
await app.run({ install: false, start: true, port: await freePort() });
const devUrl = await app.waitForUrl(90_000);
if (!devUrl) throw new Error(app.status().log.join("\n"));
const dataDir = await mkdtemp(join(tmpdir(), "aps-verify-"));
const browser = await launchBrowser();
try {
  const importer = new Importer(root, dataDir);
  const status = await importer.status();
  const routes = only.length ? only : status.routes.filter((r) => !r.dynamic).map((r) => r.path);
  let project: Project = { name: "probe", frames: [], components: [], changesets: [], board: { items: [] }, tokens: await defaultTokens() } as unknown as Project;
  const result = await importer.import(project, { devUrl, pages: routes.map((route) => ({ route })), redaction: DEFAULT_REDACTION, browser });
  project = applyCommandToProject(project, result.ops);
  if (!project.frames.length) console.log("no frames:", result.warnings);
  if (process.env.APPSHAPE_DUMP) {
    const { openBoardPage, measureScript, captureContext, loadPage, matchElements, boardStyles } = await import("../src/index");
    const frame = project.frames[0]!;
    const board = await openBoardPage(browser, { root: frame.current, tokens: project.tokens, ...(await boardStyles(dataDir)), appRoot: root, dataDir });
    const design = ((await board.evaluate(measureScript("board"))) as { elements: any[] }).elements;
    const ctx = await captureContext(browser, devUrl);
    const page = await ctx.newPage();
    await loadPage(page, new URL(frame.target.route!, devUrl).href);
    const app = ((await page.evaluate(measureScript("app"))) as { elements: any[] }).elements;
    const match = matchElements(design, app);
    const find = process.env.APPSHAPE_DUMP;
    const show = (list: any[], i: number) => i >= 0 && list[i];
    design.forEach((d, i) => { if ((d.text ?? d.own ?? "").includes(find)) console.log("D", i, "p", d.p, d.key, d.tag, d.r.map(Math.round).join(","), d.vis, "->", match.get(i), "| parent", show(design, d.p)?.tag, show(design, d.p)?.r.map(Math.round).join(",")); });
    app.forEach((a, i) => { if ((a.text ?? a.own ?? "").includes(find)) console.log("A", i, "p", a.p, a.tag, a.r.map(Math.round).join(","), a.vis, (a.cls ?? "").slice(0, 60), "| parent", show(app, a.p)?.tag, show(app, a.p)?.r.map(Math.round).join(",")); });
    for (const i of (process.env.APPSHAPE_APP ?? "").split(",").filter(Boolean).map(Number)) {
      const a = app[i]; const who = [...match].find(([, x]) => x === i);
      console.log("A*", i, "p", a.p, a.tag, a.r.map(Math.round).join(","), a.vis, (a.cls ?? "").slice(0, 50), "<- D", who?.[0], who ? design[who[0]].key + " " + design[who[0]].tag + " " + design[who[0]].r.map(Math.round).join(",") : "");
    }
    for (const i of (process.env.APPSHAPE_DES ?? "").split(",").filter(Boolean).map(Number)) { const d = design[i]; console.log("D*", i, "p", d.p, d.key, d.tag, d.r.map(Math.round).join(","), "->", match.get(i)); }
    await browser.close(); await devProcess.stop(); process.exit(0);
  }
  const started = Date.now();
  const frames = await verifyFrames({ appRoot: root, dataDir, project, devUrl, frameIds: project.frames.map((f) => f.id), outDir: join(dataDir, "verify"), browser });
  for (const f of frames) {
    const bad = f.elements.filter((e) => e.problems.length);
    console.log(`${f.url} ${f.viewport}: ${f.elements.length - bad.length}/${f.elements.length} ok, visual ${f.mismatchRatio}, extra ${f.extra.size}${f.error ? ` ERROR ${f.error}` : ""}${f.rebaseline ? " (rebaseline)" : ""}`);
    for (const e of bad.slice(0, Number(process.env.APPSHAPE_SHOW ?? 8))) console.log(`   ${e.key} ${e.label}: ${e.problems.join("; ")}`);
    for (const [k, t] of [...f.extra].slice(0, 4)) console.log(`   extra in ${k}: ${t.join(" | ").slice(0, 120)}`);
  }
  console.log(`verified in ${Date.now() - started} ms; images in ${dataDir}`);
} finally {
  await browser.close();
  await app.stop();
  if (!process.env.APPSHAPE_KEEP) await rm(dataDir, { recursive: true, force: true });
}
