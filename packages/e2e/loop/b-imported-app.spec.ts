/**
 * Scenario B: an imported app with its own components and data: the
 * app the M0 changesets were written for, now changed on the board. Direct edits go into the code;
 * a renamed plan (its name comes from data), a moved link, a new contact page with a behavior
 * note and a nav link in the hand-written navbar go to the agent.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { applyToCode, clickInScreen, noteOn, openBoard, retext, screenFromTemplate, selected, showAgentChangesets } from "./board";
import { REPO, runAgent, sandbox, score, watchBoard } from "./harness";

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });

async function startVite(appRoot: string): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, [join(appRoot, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort"], { cwd: appRoot });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
      if (/Local:/.test(output)) resolve(`http://localhost:${port}`);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited with ${code}:\n${output}`)));
  });
  return { url, child };
}

test("B: an imported app with its own components", async ({ page }) => {
  // the generated Vite app's modules: the fixture's own plus what AppShape adds (cva, clsx, lucide…)
  const box = await sandbox("B-imported", { fixture: "vite-react-router-tw4", linkModules: join(REPO, "fixtures/generated-vite-react-router") });
  console.log(`sandbox ${box.appRoot}\nresults ${box.out}`);
  const vite = await startVite(box.appRoot);
  try {
    const errors = await openBoard(page, box);

    // bring in the app's pages
    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog", { name: "Import pages" });
    await dialog.getByPlaceholder(/a running one/).fill(vite.url);
    await dialog.getByRole("button", { name: /^Import \d+ pages?/ }).click();
    await expect(dialog.getByRole("table")).toBeVisible({ timeout: 120_000 });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("[data-frame-content] [data-aps]", { hasText: "Ship apps faster" }).first()).toBeVisible();
    vite.child.kill();

    // direct edits (AppShape writes them) and changes it hands off
    await retext(page, "Ship apps faster", "Ship apps calmly", "Home");
    // the link above the paragraph: a move
    await clickInScreen(page, "See pricing", { screen: "Home" });
    await page.keyboard.press("Alt+ArrowUp");
    // a plan renamed: its name comes from the data
    await retext(page, "Pro", "Professional", "Pricing");
    // a new page with a form, and how its form behaves
    await screenFromTemplate(page, "Contact", "contact");
    await noteOn(page, "Send message", { kind: "behavior", text: "Send the form to /api/contact and show a thank-you message instead of the form" }, "Contact");
    // a nav link to it in the app's own navbar: the Pricing link duplicated and renamed
    await clickInScreen(page, "Pricing", { screen: "Home" });
    for (let i = 0; i < 3 && !/link/i.test(await selected(page)); i++) await page.keyboard.press("Escape");
    console.log(`selected for the duplicate: ${await selected(page)}`);
    await page.keyboard.press("Control+d");
    // the copy sits right of the original, in the same row: type over its text
    const homeItem = page.locator("[data-item-id]").filter({ has: page.locator("[data-aps]", { hasText: /^\s*Ship apps calmly\s*$/ }) }).first();
    const area = (await homeItem.boundingBox())!;
    const links = await homeItem.locator("[data-frame-content] [data-aps]", { hasText: /^\s*Pricing\s*$/ }).all();
    const inside = (b: { x: number; y: number }) => b.x >= area.x && b.x <= area.x + area.width && b.y >= area.y && b.y <= area.y + area.height;
    const boxes = (await Promise.all(links.map((l) => l.boundingBox()))).filter((b): b is NonNullable<typeof b> => Boolean(b && b.width && inside(b)));
    const row = boxes.sort((a, b) => a.y - b.y || b.x - a.x)[0]!;
    await page.mouse.dblclick(row.x + row.width / 2, row.y + row.height / 2);
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Contact");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-frame-content] [data-aps]", { hasText: /^\s*Contact\s*$/ }).first()).toBeVisible();
    // … and it goes to the contact page (the copy still went to /pricing)
    for (let i = 0; i < 3 && !/link/i.test(await selected(page)); i++) await page.keyboard.press("Escape");
    await page.getByLabel("On click", { exact: true }).selectOption("screen");
    await page.getByLabel("Target screen").selectOption({ label: "Contact (/contact)" });

    const applied = await applyToCode(page);
    await writeFile(join(box.out, "apply.json"), `${JSON.stringify(applied, null, 2)}\n`);
    console.log(`apply: ${applied.written}; ${applied.tasks} task(s) in ${applied.changesetId}: "${applied.sentence}"`);
    expect(applied.changesetId, "the apply hands tasks to the agent").toBeDefined();
    expect(applied.sentence).toBe(`Implement the AppShape changeset ${applied.changesetId}`);

    const before = box.snapshot("before the agent");
    await showAgentChangesets(page);
    const watch = watchBoard(box, page, applied.changesetId!);
    const agent = await runAgent(box, applied.sentence!, "agent");
    const statuses = await watch.stop();
    await page.screenshot({ path: join(box.out, "board-final.png") });

    const result = await score(box, { scenario: "B: an imported app with its own components", changesetId: applied.changesetId!, before, statuses, agent, scope: /^src\//, build: ["run", "typecheck"] });
    await cp(join(box.dataDir, ".cache", "verify"), join(box.out, "verify"), { recursive: true }).catch(() => {});
    console.log(await readFile(join(box.out, "summary.md"), "utf8"));

    const src = (file: string) => readFile(join(box.appRoot, "src", file), "utf8");
    expect.soft(await src("pages/Home.tsx"), "the direct edit").toContain("Ship apps calmly");
    expect.soft(await src("data/plans.ts"), "the plan is renamed in the data").toContain('"Professional"');
    expect.soft(await src("components/Navbar.tsx"), "the navbar links to the contact page").toMatch(/to="\/contact"/);
    expect.soft(await src("App.tsx"), "the contact route").toContain("/contact");
    expect.soft(result.finalStatus, "the loop closed").toBe("verified");
    expect.soft(result.independentVerify.status, "the independent verify agrees").toBe(0);
    expect.soft(result.outOfScope).toEqual([]);
    expect.soft(result.handEditsInAppShape).toEqual([]);
    expect.soft(result.build.status, result.build.output).toBe(0);
    expect.soft(errors, "board errors").toEqual([]);
  } finally {
    vite.child.kill();
    await box.stop();
  }
});
