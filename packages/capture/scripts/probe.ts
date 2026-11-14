import { capturePage, captureContext, launchBrowser, loadPage, type CapturedNode } from "../src/index";

/** Captures one page and prints anchor coverage: `tsx scripts/probe.ts <appRoot> <url>`. */
const [appRoot, url] = process.argv.slice(2);
if (!appRoot || !url) throw new Error("usage: probe <appRoot> <url>");
const browser = await launchBrowser();
const context = await captureContext(browser, url);
const page = await context.newPage();
const started = Date.now();
await loadPage(page, url);
const loaded = Date.now();
const captured = await capturePage(page, { appRoot });
console.log(`load ${loaded - started}ms, capture ${Date.now() - loaded}ms`);
console.log(captured.stats, captured.warnings, "css sheets", captured.css.length, captured.css.map((c) => c.text.length));
const missing: string[] = [];
const sample: string[] = [];
const visit = (node: CapturedNode, depth: number) => {
  if (node.t !== "#text") {
    const a = node.anchor;
    if (!a) missing.push(`${node.t}.${(node.cls ?? []).slice(0, 3).join(".")} owner=${node.owner !== undefined ? captured.owners[node.owner]?.name : "-"}`);
    else if (sample.length < 60) sample.push(`${"  ".repeat(Math.min(depth, 8))}${node.t} -> ${a.file}:${a.line}:${a.col} <${a.element}> in ${a.component ?? "?"}${a.repeated ? " [map]" : ""}${a.conditional ? " [cond]" : ""}${a.via === "owner" ? " (via owner)" : ""}`);
  }
  for (const kid of node.kids ?? []) visit(kid, depth + 1);
};
visit(captured.root, 0);
console.log(sample.join("\n"));
console.log("missing", missing.length, missing.slice(0, 30));
await browser.close();
