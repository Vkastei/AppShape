/**
 * M6: the verification loop on copies of the fixture apps.
 * - an unchanged import verifies (the board and the app agree);
 * - a redesign applied directly verifies; the part handed to the agent fails until the code does it;
 * - after the "agent" changes the code, the changeset is verified and the page re-baselined, so the
 *   next plan is empty.
 */
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodeService } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { type AnyOp, applyCommandToProject, createId, DEFAULT_REDACTION, type DesignNode, type Project, walk } from "@appshape/ir";
import { emptyProject } from "@appshape/store";
import { describe, expect, it } from "vitest";
import { AppProcess, freePort, Importer, VerifyService } from "../src";

const FIXTURES = fileURLToPath(new URL("../../../fixtures", import.meta.url));
const CASES = [
  { dir: "vite-react-router-tw4", framework: "vite" as const },
  { dir: "next-app-router-tw4", framework: "next" as const },
];

const op = (o: Record<string, unknown>) => ({ id: createId("op"), ...o }) as AnyOp;
const nodes = (root: DesignNode) => {
  const out: DesignNode[] = [];
  walk(root, (n) => void out.push(n));
  return out;
};
const settle = () => new Promise((r) => setTimeout(r, 2500));

describe.each(CASES)("$dir", ({ dir, framework }) => {
  it("verifies direct edits, fails the agent's task until the code does it, then re-baselines", async () => {
    // inside the repository: Turbopack resolves packages only inside its root (the repo's lockfile)
    await mkdir(join(FIXTURES, ".copies"), { recursive: true });
    const copy = await mkdtemp(join(FIXTURES, ".copies", `${dir}-`));
    const dataDir = await mkdtemp(join(tmpdir(), "aps-verify-data-"));
    const source = resolve(FIXTURES, dir);
    await cp(source, copy, { recursive: true, filter: (src) => !/[\\/](node_modules|\.next|dist|\.appshape)([\\/]|$)/.test(src) });
    await symlink(join(source, "node_modules"), join(copy, "node_modules"), "junction");
    const app = new AppProcess(copy);
    const verifier = new VerifyService(copy, dataDir);
    try {
      await app.run({ install: false, start: true, port: await freePort(), framework });
      const devUrl = (await app.waitForUrl(90_000))!;
      expect(devUrl, app.status().log.join("\n")).toBeTruthy();

      // ---- import; unchanged, every page verifies
      const importer = new Importer(copy, dataDir);
      const routes = (await importer.status()).routes.filter((r) => !r.dynamic).map((r) => r.path);
      let project: Project = { ...emptyProject(dir), tokens: await defaultTokens() };
      const imported = await importer.import(project, { devUrl, pages: routes.map((route) => ({ route })), redaction: DEFAULT_REDACTION });
      expect(imported.warnings, app.status().log.slice(-15).join("\n")).toEqual([]);
      project = applyCommandToProject(project, imported.ops);
      const unchanged = await verifier.verifyFrames(project, project.frames.map((f) => f.id), { url: devUrl });
      for (const f of unchanged.frames) expect(f.failing, `${f.url} ${f.viewport}`).toEqual([]);

      // ---- redesign: the heading directly, the shared navbar logo on one page only (agent)
      const home = project.frames.find((f) => f.target.route === "/")!;
      const h1 = nodes(home.current).find((n) => n.type === "text" && n.platformRaw?.tag === "h1")!;
      const logo = nodes(home.current).find((n) => n.type === "link" && n.source?.file.includes("Navbar") === true)!;
      project = applyCommandToProject(project, [
        op({ frameId: home.id, op: "retext", nodeId: h1.id, text: "Ship faster" }),
        op({ frameId: home.id, op: "restyle", nodeId: h1.id, style: { color: "$color.gray-700" } }),
        op({ frameId: home.id, op: "restyle", nodeId: logo.id, style: { fontSize: "$fontSize.xl" } }),
      ]);
      const code = new CodeService(copy, dataDir);
      const plan = await code.plan(project);
      expect(plan.frameIds).toEqual([home.id]);
      const applied = await code.apply(project, plan.planId);
      expect(applied.changeset?.tasks).toHaveLength(1);
      project = { ...project, changesets: [applied.changeset!] };
      await settle();

      // the direct edit is in the app; the logo isn't
      const direct = await verifier.verifyFrames(project, [home.id], { url: devUrl });
      const desktop = direct.frames.find((f) => f.viewport === "desktop")!;
      expect(desktop.failing.map((e) => e.key)).toEqual([logo.id]);
      expect(desktop.failing[0]!.problems.join(" ")).toMatch(/font-size 20px \(found 18px\)/);
      expect(direct.rebaselined).toEqual([]);

      const first = await verifier.verifyChangeset(project, applied.changeset!.id, { url: devUrl });
      expect(first.report.status).toBe("needs_fix");
      expect(first.report.results[0]!.checks.find((c) => c.status === "fail")?.detail).toMatch(/font-size/);
      expect(first.changeset.status).toBe("needs_fix");
      expect(first.report.visual.length).toBeGreaterThan(0);
      project = { ...project, changesets: [first.changeset] };

      // ---- the "agent": the logo bigger on every page (the task allows that)
      const file = join(copy, logo.source!.file);
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      const at = lines.findIndex((l, i) => i >= logo.source!.line - 1 && l.includes("text-lg"));
      lines[at] = lines[at]!.replace("text-lg", "text-xl");
      await writeFile(file, lines.join("\n"));
      await settle();

      const second = await verifier.verifyChangeset(project, first.changeset.id, { url: devUrl });
      expect(second.report.results.map((r) => r.status)).toEqual(["pass"]);
      expect(second.report.status).toBe("verified");
      expect(second.changeset.status).toBe("verified");
      expect(second.changeset.history.at(-1)).toMatchObject({ status: "verified", by: "verify" });
      expect(second.rebaselined).toEqual([home.id]);
      expect(await verifier.readReport(first.changeset.id)).toMatchObject({ status: "verified" });

      // re-baselined: nothing left to apply, and the logo's anchor still points at its JSX
      const again = await code.plan(project);
      expect(again.changes).toEqual([]);
      expect(again.tasks).toEqual([]);
      const state = await code.readState();
      const anchored = nodes(state!.imported![home.id]!.tree).find((n) => n.id === logo.id)!;
      expect(anchored.source?.file).toBe(logo.source!.file);
      expect(anchored.platformRaw?.classes).toContain("text-xl");
    } finally {
      await verifier.close();
      await app.stop();
      await rm(copy, { recursive: true, force: true }).catch(() => {});
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 300_000);
});
