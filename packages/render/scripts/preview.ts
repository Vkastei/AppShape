/**
 * Renders one frame to a standalone HTML file and optionally screenshots it with an installed
 * Edge/Chrome. Handy for eyeballing render fidelity.
 *
 *   pnpm --filter @appshape/render preview -- --data <dataDir> --frame f_pricing \
 *     [--version current|baseline] [--width 1280] [--html out.html] [--png out.png]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ProjectFiles } from "@appshape/store";
import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { renderFrame } from "../src";

const { values } = parseArgs({
  options: {
    data: { type: "string" },
    frame: { type: "string" },
    version: { type: "string", default: "current" },
    width: { type: "string", default: "1280" },
    html: { type: "string", default: "preview.html" },
    png: { type: "string" },
    browser: { type: "string", default: "msedge" },
  },
});
if (!values.data || !values.frame) throw new Error("--data and --frame are required");

const { project } = await new ProjectFiles({ appRoot: "", dataDir: resolve(values.data), mode: "in-repo" }).load();
const frame = project.frames.find((f) => f.id === values.frame);
if (!frame) throw new Error(`no frame ${values.frame}`);
const tree = values.version === "baseline" ? frame.baseline : frame.current;
if (!tree) throw new Error(`frame has no ${values.version}`);

const width = Number(values.width);
const { element, css, warnings } = renderFrame(tree, { tokens: project.tokens, components: project.components });
for (const warning of warnings) console.warn(`warning: ${warning}`);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#e5e7eb}.aps-frame{width:${width}px}</style><style>${css}</style></head><body>${renderToStaticMarkup(element)}</body></html>`;
writeFileSync(values.html!, html);
console.log(`wrote ${values.html}`);

if (values.png) {
  const browser = await chromium.launch({ channel: values.browser });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(html);
  await page.screenshot({ path: values.png, fullPage: true });
  await browser.close();
  console.log(`wrote ${values.png}`);
}
