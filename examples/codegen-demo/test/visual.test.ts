/**
 * The generated app looks like the design: builds the generated Vite + React Router app, opens
 * its pages in Edge and compares screenshots with the board's rendering of the same screens.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { componentSources, type Project } from "@appshape/ir";
import { renderFrame } from "@appshape/render";
import { type Browser, chromium, type Page } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES } from "../src/apps";
import { demoProject } from "../src/design";

const APP = join(FIXTURES, "generated-vite-react-router");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
/** Icons are lucide SVGs in the app and placeholders on the board: hide both. */
const HIDE_ICONS = "svg.lucide, [data-aps-icon] { visibility: hidden !important; }";

let browser: Browser;
let server: Server;
let base: string;
let project: Project;

beforeAll(async () => {
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--dir", APP, "exec", "vite", "build", "--logLevel", "error"], { stdio: "inherit", shell: process.platform === "win32" });
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const file = extname(url.pathname) ? join(APP, "dist", url.pathname) : join(APP, "dist", "index.html"); // SPA fallback
    const content = await readFile(file).catch(() => undefined);
    if (content) res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(content);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
  project = demoProject(await defaultTokens());
}, 120_000);
afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function shot(page: Page): Promise<Buffer> {
  await page.addStyleTag({ content: HIDE_ICONS });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ fullPage: true, animations: "disabled" });
}

/** Share of differing pixels between two PNGs (compared in the browser). */
async function difference(a: Buffer, b: Buffer): Promise<{ ratio: number; sizes: string }> {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ([x, y]) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
      };
      const [p, q] = await Promise.all([load(x!), load(y!)]);
      const w = Math.min(p.w, q.w);
      const h = Math.min(p.h, q.h);
      let diff = 0;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = (row * p.w + col) * 4;
          const j = (row * q.w + col) * 4;
          if (Math.abs(p.data[i]! - q.data[j]!) + Math.abs(p.data[i + 1]! - q.data[j + 1]!) + Math.abs(p.data[i + 2]! - q.data[j + 2]!) > 24) diff++;
        }
      }
      return { ratio: diff / (Math.max(p.w, q.w) * Math.max(p.h, q.h)), sizes: `${p.w}x${p.h} vs ${q.w}x${q.h}` };
    },
    [`data:image/png;base64,${a.toString("base64")}`, `data:image/png;base64,${b.toString("base64")}`],
  );
  await page.close();
  return result;
}

describe("generated app vs. board", () => {
  for (const [frameId, route] of [["f_home", "/"], ["f_today", "/today"]] as const) {
    for (const width of [390, 1280]) {
      it(`${route} at ${width}px`, async () => {
        const frame = project.frames.find((f) => f.id === frameId)!;
        const viewport = { width, height: 900 };

        const board = renderFrame(frame.current, { tokens: project.tokens, sources: componentSources(project.frames), viewportHeight: viewport.height });
        const boardPage = await browser.newPage({ viewport });
        await boardPage.setContent(`<!doctype html><style>body{margin:0}${board.css}</style>${renderToStaticMarkup(board.element)}`);
        const expected = await shot(boardPage);

        // the end state: entrances off (reduced motion shows everything at once)
        const appPage = await browser.newPage({ viewport, reducedMotion: "reduce" });
        await appPage.goto(`${base}${route}`);
        await appPage.waitForSelector("#root > *");
        const actual = await shot(appPage);

        const { ratio, sizes } = await difference(expected, actual);
        if (process.env.APPSHAPE_SHOTS) {
          // Debugging aid: APPSHAPE_SHOTS=<dir> saves both screenshots and logs the difference.
          const name = `${route === "/" ? "home" : route.slice(1)}-${width}`;
          await writeFile(join(process.env.APPSHAPE_SHOTS, `app-${name}.png`), actual);
          await writeFile(join(process.env.APPSHAPE_SHOTS, `board-${name}.png`), expected);
          console.log("difference", name, ratio, sizes);
        }
        expect(sizes).toBe(sizes.split(" vs ")[0] + " vs " + sizes.split(" vs ")[0]);
        expect(ratio).toBeLessThan(0.002);
        await boardPage.close();
        await appPage.close();
      }, 60_000);
    }
  }
});
