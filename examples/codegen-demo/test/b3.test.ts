/**
 * Benchmark B3: the landing page with entrance and scroll animations, a mobile menu, a dialog,
 * questions that open and data-driven testimonials, generated for a CSS app and a Motion app,
 * passes AppShape's verify (the running app against the design, element by element, on a phone and
 * on a desktop; the end state with motion off, and every animation playing with motion on).
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFrames } from "@appshape/capture";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { type DesignNode, type Project, walk } from "@appshape/ir";
import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, LANDING_APPS } from "../src/apps";
import { landingProject } from "../src/landing";
import { serveApp } from "./serve";

let browser: Browser;
let project: Project;
let dataDir: string;
const servers: Server[] = [];
const bases: Record<string, string> = {};

beforeAll(async () => {
  for (const [kind, dir] of Object.entries(LANDING_APPS)) {
    const app = join(FIXTURES, dir);
    execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--dir", app, "exec", "vite", "build", "--logLevel", "error"], { stdio: "inherit", shell: process.platform === "win32" });
    bases[kind] = await serveApp(app, servers);
  }
  browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
  project = landingProject(await defaultTokens());
  dataDir = await mkdtemp(join(tmpdir(), "appshape-b3-"));
}, 180_000);
afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("B3: the landing page passes verify", () => {
  for (const kind of Object.keys(LANDING_APPS)) {
    it(`${kind} app, on a phone and on a desktop`, async () => {
      const results = await verifyFrames({ appRoot: join(FIXTURES, LANDING_APPS[kind as keyof typeof LANDING_APPS]), dataDir, project, devUrl: bases[kind]!, frameIds: ["f_home", "f_components"], outDir: join(dataDir, kind), browser });
      expect(results.map((r) => `${r.frameId} ${r.viewport}`)).toEqual(["f_home desktop", "f_home mobile", "f_components desktop", "f_components mobile"]);
      for (const result of results) {
        const problems = result.elements.filter((e) => e.problems.length > 0).map((e) => `${e.label}: ${e.problems.join("; ")}`);
        expect({ page: `${result.frameId} ${result.viewport}`, error: result.error, problems, extra: [...result.extra.values()].flat() }).toEqual({ page: `${result.frameId} ${result.viewport}`, error: undefined, problems: [], extra: [] });
        expect(result.elements.length).toBeGreaterThan(20);
      }
    }, 180_000);
  }

  it("finds an animation the design has and the app doesn't", async () => {
    // the FAQ's line under its heading fades in, in the design only
    const changed = structuredClone(project);
    const home = changed.frames.find((f) => f.id === "f_home")!;
    let line: DesignNode | undefined;
    walk(home.current, (n) => {
      if (!line && n.type === "text" && n.text.startsWith("Can't find what you're looking for")) line = n;
    });
    line!.style = { ...line!.style, motion: { preset: "fade", trigger: "scroll" } };
    const [result] = await verifyFrames({ appRoot: join(FIXTURES, LANDING_APPS.css), dataDir, project: changed, devUrl: bases.css!, frameIds: ["f_home"], viewports: ["desktop"], outDir: join(dataDir, "missing"), browser });
    const problems = result!.elements.filter((e) => e.problems.length > 0).map((e) => `${e.label}: ${e.problems.join("; ")}`);
    expect(problems).toEqual([expect.stringMatching(/Can't find what you're looking for.*: no animation in the app \(the design has "fade"\)$/)]);
  }, 180_000);
});
