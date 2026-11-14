/**
 * The entrances run in the generated apps: the features grid's cards slide in one after another
 * when the grid scrolls into view, in the CSS app (keyframes + ScrollReveal) and in the Motion app
 * (Motion code); with reduced motion the CSS app shows everything at once.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, MOTION_APP } from "../src/apps";

const APPS = { css: join(FIXTURES, "generated-vite-react-router"), motion: join(FIXTURES, MOTION_APP) };
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
/** Short enough that the features grid starts below the fold (at 1280 px wide). */
const VIEWPORT = { width: 1280, height: 240 };
const STAGGER = 120;

let browser: Browser;
const servers: Server[] = [];
const bases: Record<string, string> = {};

async function serve(dir: string): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const file = extname(url.pathname) ? join(dir, "dist", url.pathname) : join(dir, "dist", "index.html");
    const content = await readFile(file).catch(() => undefined);
    if (content) res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(content);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

beforeAll(async () => {
  for (const [name, dir] of Object.entries(APPS)) {
    execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--dir", dir, "exec", "vite", "build", "--logLevel", "error"], { stdio: "inherit", shell: process.platform === "win32" });
    bases[name] = await serve(dir);
  }
  browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
}, 180_000);
afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
});

const cards = (page: Page) => page.locator("main > div.grid > *");

/** Opacity of each card, sampled every frame for `ms` after `start` runs: when each one got half visible. */
async function halfVisibleTimes(page: Page, ms: number, start: () => Promise<void>): Promise<number[]> {
  await page.evaluate((duration) => {
    const items = [...document.querySelectorAll("main > div.grid > *")];
    const times: (number | null)[] = items.map(() => null);
    const t0 = performance.now();
    (window as unknown as { __times: Promise<(number | null)[]> }).__times = new Promise((resolve) => {
      const tick = () => {
        const now = performance.now() - t0;
        items.forEach((item, i) => {
          if (times[i] === null && Number(getComputedStyle(item).opacity) >= 0.5) times[i] = now;
        });
        if (now < duration && times.some((t) => t === null)) requestAnimationFrame(tick);
        else resolve(times);
      };
      requestAnimationFrame(tick);
    });
  }, ms);
  await start();
  const times = await page.evaluate(() => (window as unknown as { __times: Promise<(number | null)[]> }).__times);
  expect(times.every((t) => t !== null), `all cards became visible: ${JSON.stringify(times)}`).toBe(true);
  return times as number[];
}

describe("entrances in the generated apps", () => {
  for (const app of ["css", "motion"] as const) {
    it(`${app} app: the cards wait below the fold, then slide in one after another`, async () => {
      const page = await browser.newPage({ viewport: VIEWPORT });
      await page.goto(bases[app]!);
      await expect.poll(() => cards(page).count()).toBe(3);
      // the heading fades in when the page opens
      const heading = page.locator("h1");
      await expect.poll(async () => Number(await heading.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
      // below the fold: hidden, waiting
      await page.waitForTimeout(400);
      for (const opacity of await cards(page).evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).opacity)))) expect(opacity).toBe(0);
      // scrolled into view: one after another, a step apart
      const times = await halfVisibleTimes(page, 2000, () => page.locator("main > div.grid").evaluate((el) => el.scrollIntoView()));
      expect(times[1]! - times[0]!).toBeGreaterThan(STAGGER * 0.5);
      expect(times[2]! - times[1]!).toBeGreaterThan(STAGGER * 0.5);
      expect(times[2]! - times[0]!).toBeLessThan(STAGGER * 2 + 250);
      // and they end where the design has them
      await expect.poll(async () => cards(page).evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity))).toEqual(["1", "1", "1"]);
      await page.close();
    }, 30_000);
  }

  it("css app: with reduced motion everything shows at once", async () => {
    const page = await browser.newPage({ viewport: VIEWPORT, reducedMotion: "reduce" });
    await page.goto(bases.css!);
    await expect.poll(() => cards(page).count()).toBe(3);
    expect(await cards(page).evaluateAll((els) => els.map((el) => [getComputedStyle(el).opacity, el.getAnimations().length]))).toEqual([["1", 0], ["1", 0], ["1", 0]]);
    expect(await page.locator("h1").evaluate((el) => el.getAnimations().length)).toBe(0);
    await page.close();
  });
});
