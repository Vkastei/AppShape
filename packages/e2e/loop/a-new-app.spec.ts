/**
 * Scenario A: a new app, then hand edits. The landing page is created
 * as an app; a developer edits the hero heading and the router by hand; the design changes the
 * heading, adds a behavior note and a pricing page. AppShape leaves the hand-edited heading, the
 * route in the hand-written router and the note to the agent.
 */
import { cp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { applyToCode, createApp, noteOn, openBoard, retext, screenFromTemplate, showAgentChangesets } from "./board";
import { REPO, runAgent, sandbox, score, watchBoard } from "./harness";

test("A: a new app with hand edits", async ({ page }) => {
  const box = await sandbox("A-new-app");
  console.log(`sandbox ${box.appRoot}\nresults ${box.out}`);
  try {
    const errors = await openBoard(page, box);

    // the landing page, created as an app (no tasks: AppShape writes all of it)
    await screenFromTemplate(page, "Home", "landing");
    await createApp(page, "Vite + React Router");
    await symlink(join(REPO, "fixtures/generated-vite-react-router/node_modules"), join(box.appRoot, "node_modules"), "junction");
    const home = join(box.appRoot, "src/pages/Home.tsx");
    const app = join(box.appRoot, "src/App.tsx");
    expect(await readFile(home, "utf8")).toContain("Ship a better product, faster");

    // hand edits, as a developer makes them: the hero heading gets an id, the router a page of its own
    const homeCode = await readFile(home, "utf8");
    const h1 = /<h1(\s)([^>]*>\s*Ship a better product, faster)/;
    expect(homeCode).toMatch(h1);
    await writeFile(home, homeCode.replace(h1, '<h1 id="hero-title"$1$2'));
    const appCode = await readFile(app, "utf8");
    const routes = /(<Routes>\n)(\s*)/;
    expect(appCode, appCode).toMatch(routes);
    await writeFile(app, appCode.replace(routes, (_m, open: string, pad: string) => `${open}${pad}<Route path="/blog" element={<p>The blog is coming soon.</p>} />\n${pad}`));
    box.snapshot("hand edits");

    // design changes: the hand-edited heading, a behavior note, a new page
    await retext(page, "Ship a better product, faster", "Ship calmer releases");
    await noteOn(page, "Get started", { kind: "behavior", text: "Scroll smoothly to the pricing section of this page" }, "Home");
    await screenFromTemplate(page, "Pricing", "pricing");

    const applied = await applyToCode(page);
    await writeFile(join(box.out, "apply.json"), `${JSON.stringify(applied, null, 2)}\n`);
    console.log(`apply: ${applied.written}; ${applied.tasks} task(s) in ${applied.changesetId}: "${applied.sentence}"`);
    expect(applied.changesetId, "the apply hands tasks to the agent").toBeDefined();
    expect(applied.sentence).toBe(`Implement the AppShape changeset ${applied.changesetId}`);

    // the agent, with the board's sentence; the board is watched meanwhile
    const before = box.snapshot("before the agent");
    await showAgentChangesets(page);
    const watch = watchBoard(box, page, applied.changesetId!);
    const agent = await runAgent(box, applied.sentence!, "agent");
    const statuses = await watch.stop();
    await page.screenshot({ path: join(box.out, "board-final.png") });

    const result = await score(box, { scenario: "A: a new app with hand edits", changesetId: applied.changesetId!, before, statuses, agent, scope: /^src\//, build: ["run", "build"] });
    await cp(join(box.dataDir, ".cache", "verify"), join(box.out, "verify"), { recursive: true }).catch(() => {});
    console.log(await readFile(join(box.out, "summary.md"), "utf8"));

    // what this scenario must show (soft: the report is written either way)
    const hand = await readFile(home, "utf8");
    expect.soft(hand, "the hand edit is kept").toContain('id="hero-title"');
    expect.soft(hand, "the new heading is in the code").toContain("Ship calmer releases");
    expect.soft(await readFile(app, "utf8"), "the hand-written route is kept").toContain('path="/blog"');
    expect.soft(result.finalStatus, "the loop closed").toBe("verified");
    expect.soft(result.independentVerify.status, "the independent verify agrees").toBe(0);
    expect.soft(result.outOfScope).toEqual([]);
    expect.soft(result.handEditsInAppShape).toEqual([]);
    expect.soft(result.build.status, result.build.output).toBe(0);
    expect.soft(errors, "board errors").toEqual([]);
  } finally {
    await box.stop();
  }
});
