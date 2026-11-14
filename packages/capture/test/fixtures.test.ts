/**
 * Import → board → apply on the four web fixtures (Vite + React Router v4, Vite + TanStack Router
 * v3, Next App Router v4, Next Pages Router v3), each with its real dev server:
 * - every page imports, every element is anchored to the JSX that renders it;
 * - the board renders each page with every element where the app has it;
 * - a redesign applies to (a copy of) the code without AI, the rest becomes agent tasks.
 */
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService, JsxIndex } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { type AnyOp, applyCommandToProject, createId, DEFAULT_REDACTION, type DesignNode, type Frame, isContainer, type Project } from "@appshape/ir";
import { emptyProject } from "@appshape/store";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppProcess, freePort, Importer, launchBrowser, lucideIconsDir, type StylesMeta } from "../src";
import { compareFrame } from "./fidelity";

const FIXTURES = fileURLToPath(new URL("../../../fixtures", import.meta.url));
const CASES = [
  { dir: "vite-react-router-tw4", framework: "vite", routes: ["/", "/pricing"] },
  { dir: "vite-tanstack-router-tw3", framework: "vite", routes: ["/", "/about", "/pricing"] },
  { dir: "next-app-router-tw4", framework: "next", routes: ["/", "/about", "/pricing"] },
  { dir: "next-pages-router-tw3", framework: "next", routes: ["/", "/about", "/pricing"] },
] as const;

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
}, 60_000);
afterAll(() => browser?.close());

const nodes = (root: DesignNode): DesignNode[] => [root, ...(isContainer(root) ? root.children.flatMap(nodes) : [])];
const op = (o: object) => ({ id: createId("op"), ...o }) as AnyOp;

describe.each(CASES)("$dir", ({ dir, framework, routes }) => {
  it("imports with anchors, looks like the app, and applies a redesign", async () => {
    const appRoot = resolve(FIXTURES, dir);
    const app = new AppProcess(appRoot);
    await app.run({ install: false, start: true, port: await freePort(), framework });
    const devUrl = await app.waitForUrl(90_000);
    expect(devUrl, app.status().log.join("\n")).toBeTruthy();
    const dataDir = await mkdtemp(join(tmpdir(), "aps-import-"));
    const copy = await mkdtemp(join(tmpdir(), "aps-app-"));
    try {
      // ---- import
      const importer = new Importer(appRoot, dataDir);
      const status = await importer.status();
      expect(status.routes.filter((r) => !r.dynamic).map((r) => r.path).sort()).toEqual([...routes].sort());
      let project: Project = { ...emptyProject(dir), tokens: await defaultTokens() };
      const result = await importer.import(project, { devUrl: devUrl!, pages: routes.map((route) => ({ route })), redaction: DEFAULT_REDACTION, browser });
      expect(result.warnings).toEqual([]);
      project = applyCommandToProject(project, result.ops);
      expect(project.frames.map((f) => f.target.route).sort()).toEqual([...routes].sort());

      // ---- anchors: every anchored element points at JSX of the same element
      for (const page of result.pages) {
        expect(page.anchored / page.elements, `${page.route}: anchored`).toBeGreaterThanOrEqual(0.97);
        const frame = project.frames.find((f) => f.id === page.frameId)!;
        for (const node of nodes(frame.current)) {
          if (!node.source) continue;
          const text = await readFile(join(appRoot, node.source.file), "utf8");
          const site = new JsxIndex(node.source.file, text.replace(/\r\n/g, "\n")).sites.find((s) => s.line === node.source!.line && s.col === node.source!.col);
          const expected = node.platformRaw?.element ?? node.platformRaw?.tag;
          expect(site?.element, `${page.route} ${node.id} at ${node.source.file}:${node.source.line}:${node.source.col}`).toBe(expected);
        }
      }

      // ---- the board renders every element where the app has it
      const styles = join(dataDir, "styles");
      const meta = JSON.parse(await readFile(join(styles, "meta.json"), "utf8")) as StylesMeta;
      const appCss = { shadow: await readFile(join(styles, "app.css"), "utf8"), document: await readFile(join(styles, "document.css"), "utf8") };
      for (const page of result.pages) {
        const frame = project.frames.find((f) => f.id === page.frameId)!;
        const fidelity = await compareFrame(browser, { root: frame.current, tokens: project.tokens, rects: page.rects, appCss, htmlClasses: meta.htmlClasses, layered: meta.layered, appRoot, dataDir, iconsDir: lucideIconsDir() });
        expect(fidelity.mismatches, `${page.route}: ${fidelity.matching}/${fidelity.total} in place`).toEqual([]);
      }

      // ---- redesign, applied to a copy of the app
      await cp(appRoot, copy, { recursive: true, filter: (src) => !/[\\/](node_modules|\.next|dist)([\\/]|$)/.test(src) });
      await symlink(join(appRoot, "node_modules"), join(copy, "node_modules"), "junction");
      const frame = (route: string) => project.frames.find((f) => f.target.route === route)!;
      const find = (f: Frame, test: (n: DesignNode) => boolean) => nodes(f.current).find(test);
      const home = frame("/");
      const h1 = find(home, (n) => n.type === "text" && n.text === "Ship apps faster")!;
      const logo = find(home, (n) => n.type === "link" && n.source?.file.includes("Navbar") === true)!;
      const ops: AnyOp[] = [
        op({ frameId: home.id, op: "retext", nodeId: h1.id, text: "Ship faster" }),
        op({ frameId: home.id, op: "restyle", nodeId: h1.id, style: { color: "$color.gray-700" } }),
        // a navbar change on one page only: the navbar is shared, so this goes to the agent
        op({ frameId: home.id, op: "restyle", nodeId: logo.id, style: { fontSize: "$fontSize.xl" } }),
      ];
      const expectations: Array<[string, string]> = [["Ship faster", ""], ["text-5xl font-bold tracking-tight text-gray-700", ""]];
      // feature cards (where the fixture has them): all copies restyled, one title from the data module
      const titles = nodes(home.current).filter((n) => n.type === "text" && n.source?.file.includes("FeatureCard") && n.platformRaw?.tag === "h3");
      if (titles.length) {
        for (const t of titles) ops.push(op({ frameId: home.id, op: "restyle", nodeId: t.id, style: { color: "$color.gray-700" } }));
        const secure = titles.find((t) => t.type === "text" && t.text === "Secure")!;
        ops.push(op({ frameId: home.id, op: "retext", nodeId: secure.id, text: "Secure by design" }));
        expectations.push(["mt-4 text-lg font-semibold text-gray-700", "FeatureCard"], ['"Secure by design"', "features"]);
      }
      // delete a static paragraph on the pricing page, insert a line on another page
      const pricing = frame("/pricing");
      const footnote = nodes(pricing.current).find((n) => n.type === "box" && n.platformRaw?.tag === "p" && n.source && isContainer(n) && n.children.some((c) => c.type === "link"));
      if (footnote) ops.push(op({ frameId: pricing.id, op: "delete", nodeId: footnote.id }));
      const target = routes.includes("/about" as never) ? frame("/about") : pricing;
      const heading = find(target, (n) => n.type === "text" && n.platformRaw?.tag === "h1")!;
      const parent = nodes(target.current).find((n) => isContainer(n) && n.children.some((c) => c.id === heading.id))!;
      const index = isContainer(parent) ? parent.children.findIndex((c) => c.id === heading.id) : 0;
      ops.push(op({ frameId: target.id, op: "insert", parentId: parent.id, index: index + 1, node: { id: "n_added", type: "text", origin: "added", text: "AppShape was here", semantic: { role: "paragraph" }, style: { fontSize: "$fontSize.sm", color: "$color.gray-500" } } }));
      expectations.push(["AppShape was here", ""]);
      // board handles: the heading moved freely (absolute in its now relative parent) and resized
      ops.push(op({ frameId: target.id, op: "relayout", nodeId: heading.id, box: { position: "absolute", inset: { left: 24, top: 40 }, width: { mode: "fixed", value: 480 } } }));
      ops.push(op({ frameId: target.id, op: "relayout", nodeId: parent.id, box: { position: "relative" } }));
      expectations.push(["left-[24px]", ""], ["top-[40px]", ""], ["w-[480px]", ""]);
      project = applyCommandToProject(project, ops);

      const service = new CodeService(copy, dataDir);
      const plan = await service.plan(project);
      const after = plan.changes.map((c) => `${c.path}\n${c.after ?? ""}`).join("\n");
      for (const [text, file] of expectations) {
        expect(after, `${text} in ${file || "a changed file"}`).toContain(text);
        if (file) expect(plan.changes.some((c) => c.path.includes(file) && c.after?.includes(text))).toBe(true);
      }
      const footnoteText = footnote && nodes(footnote).find((n) => n.type === "text" && n.text.length > 4);
      if (footnoteText?.type === "text") expect(plan.changes.find((c) => c.path === footnote!.source!.file)?.after).not.toContain(footnoteText.text);
      expect(plan.tasks.map((t) => t.summary).join("\n")).toMatch(/Restyle <Link>.*(Navbar)/);
      expect(plan.tasks.length, plan.tasks.map((t) => t.summary).join(" | ")).toBe(1);
      expect(plan.warnings).toEqual([]);
      expect(plan.changes.every((c) => c.path.startsWith("src/"))).toBe(true);

      await service.apply(project, plan.planId);
      const again = await service.plan(project);
      expect(again.changes).toEqual([]);
      expect(again.tasks).toEqual([]);
    } finally {
      await app.stop();
      await rm(dataDir, { recursive: true, force: true });
      await rm(copy, { recursive: true, force: true });
    }
  }, 300_000);
});
