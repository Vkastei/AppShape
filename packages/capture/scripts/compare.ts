import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { extractTokensV4 } from "@appshape/dialect-tailwind";
import { DEFAULT_REDACTION } from "@appshape/ir";
import { captureContext, capturePage, convertPage, createRedactor, hasIcon, launchBrowser, loadPage, SourceResolver } from "../src/index";
import { compareFrame } from "../test/fidelity";

/**
 * Board vs. app for imported pages: `tsx scripts/compare.ts <appRoot> <devUrl> <dataDir> <outDir> route…`.
 * Uses the styles an import wrote to <dataDir>; writes app-*.png and board-*.png to <outDir>.
 */
const [appRoot, devUrl, dataDir, outDir, ...routes] = process.argv.slice(2);
if (!appRoot || !devUrl || !dataDir || !outDir || routes.length === 0) throw new Error("usage: compare <appRoot> <devUrl> <dataDir> <outDir> route…");
const require = createRequire(import.meta.url);
const iconsDir = join(dirname(require.resolve("lucide-static/package.json")), "icons");
const tokens = await extractTokensV4(appRoot);
const appCss = { shadow: await readFile(join(dataDir, "styles", "app.css"), "utf8"), document: await readFile(join(dataDir, "styles", "document.css"), "utf8") };
const meta = JSON.parse(await readFile(join(dataDir, "styles", "meta.json"), "utf8")) as { htmlClasses: string[]; layered?: boolean };
const browser = await launchBrowser();
const context = await captureContext(browser, devUrl);
const tab = await context.newPage();
const resolver = new SourceResolver(appRoot);
for (const route of routes) {
  await loadPage(tab, new URL(route, devUrl).href);
  const page = await capturePage(tab, { appRoot, resolver });
  const slug = route.replace(/\W+/g, "_") || "home";
  await writeFile(join(outDir, `app-${slug}.png`), await tab.screenshot({ fullPage: true }));
  const converted = convertPage(page, { tokens, idPrefix: "n_x_", redactor: createRedactor({ ...DEFAULT_REDACTION, mode: "off" }), mapImage: (p) => p, hasIcon });
  const result = await compareFrame(browser, { root: converted.root, tokens, rects: converted.rects, appCss, htmlClasses: meta.htmlClasses, layered: meta.layered ?? /@layer utilities/.test(appCss.shadow), appRoot, dataDir, iconsDir, height: 800 }, { screenshot: true });
  await writeFile(join(outDir, `board-${slug}.png`), result.screenshot!);
  console.log(`${route}: ${result.matching}/${result.total} elements in place (${Math.round((result.matching / Math.max(1, result.total)) * 100)}%)`);
  const byId = new Map<string, { tag?: string; cls?: string[] }>();
  const index = (node: import("@appshape/ir").DesignNode) => {
    byId.set(node.id, { tag: node.platformRaw?.tag, cls: node.platformRaw?.classes });
    if ("children" in node) node.children.forEach(index);
  };
  index(converted.root);
  for (const m of result.mismatches.slice(0, Number(process.env.APPSHAPE_MISMATCHES ?? 12))) {
    const info = byId.get(m.id);
    console.log(`  ${m.id} <${info?.tag}> app ${m.expected.join(",")} board ${m.actual.join(",")}  ${(info?.cls ?? []).join(" ").slice(0, 110)}`);
  }
}
await browser.close();
