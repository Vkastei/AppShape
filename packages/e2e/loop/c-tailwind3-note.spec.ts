/**
 * Scenario C: Tailwind v3 and a drawing kept as a note, on a Next.js
 * Pages Router app. The brand color changes (Tailwind v3: a task for tailwind.config), the pricing
 * cards get a drawing with "same height, highlight the middle one" kept as a note (a task with the
 * picture), and a link's text changes directly.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { applyToCode, clickInScreen, openBoard, retext, showAgentChangesets } from "./board";
import { runAgent, sandbox, score, watchBoard } from "./harness";

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });

async function startNext(appRoot: string): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, [join(appRoot, "node_modules/next/dist/bin/next"), "dev", "-p", String(port)], { cwd: appRoot });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
      if (/Ready|Local:/.test(output)) resolve(`http://localhost:${port}`);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`next exited with ${code}:\n${output}`)));
  });
  return { url, child };
}

const kill = (child: ChildProcess) => {
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};

async function stroke(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}

test("C: Tailwind v3 and a drawing kept as a note", async ({ page }) => {
  const box = await sandbox("C-next-tw3", { fixture: "next-pages-router-tw3" });
  console.log(`sandbox ${box.appRoot}\nresults ${box.out}`);
  const next = await startNext(box.appRoot);
  try {
    const errors = await openBoard(page, box);
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());

    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog", { name: "Import pages" });
    await dialog.getByPlaceholder(/a running one/).fill(next.url);
    await dialog.getByRole("button", { name: /^Import \d+ pages?/ }).click();
    await expect(dialog.getByRole("table")).toBeVisible({ timeout: 180_000 });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("[data-frame-content] [data-aps]", { hasText: "Talk to us" }).first()).toBeVisible();
    kill(next.child);

    // the brand color (Tailwind v3: tailwind.config is the agent's)
    await page.getByRole("tab", { name: "Design" }).click();
    await page.getByRole("button", { name: "Color family brand" }).click();
    const brand = page.getByLabel("color brand-600", { exact: true });
    await brand.fill("#0d9488");
    await brand.press("Enter");
    await page.getByRole("tab", { name: "Screens" }).click();

    // a direct text change
    await retext(page, "Talk to us", "Ask us anything", "Pricing");

    // a drawing on the pricing cards, kept as a note
    await clickInScreen(page, "Starter", { screen: "Pricing" });
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const bar = page.getByTestId("draw-bar");
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Color Change" }).click();
    await bar.getByRole("button", { name: "Rectangle" }).click();
    const cards = page.locator("[data-item-id]").filter({ has: page.locator("[data-aps]", { hasText: "Ask us anything" }) });
    const top = (await cards.locator("[data-aps]", { hasText: /^\s*Starter\s*$/ }).first().boundingBox())!;
    const bottom = (await cards.locator("[data-aps]", { hasText: /^\s*Ask us anything\s*$/ }).first().boundingBox())!;
    const frame = (await cards.locator("[data-frame-content]").first().boundingBox())!;
    await stroke(page, [frame.x + 12, top.y - 16], [frame.x + frame.width - 12, bottom.y - 12]);
    const dock = page.getByRole("dialog", { name: /^Drawing on/ });
    await expect(dock).toBeVisible();
    await dock.getByLabel("What should change?").fill("Make the three plan cards the same height and highlight the middle one (the most popular plan).");
    await dock.getByRole("button", { name: /Keep as a note for the coding agent/ }).click();
    await page.keyboard.press("Escape");

    const applied = await applyToCode(page);
    await writeFile(join(box.out, "apply.json"), `${JSON.stringify(applied, null, 2)}\n`);
    console.log(`apply: ${applied.written}; ${applied.tasks} task(s) in ${applied.changesetId}: "${applied.sentence}"`);
    expect(applied.changesetId, "the apply hands tasks to the agent").toBeDefined();

    const before = box.snapshot("before the agent");
    await showAgentChangesets(page);
    const watch = watchBoard(box, page, applied.changesetId!);
    const agent = await runAgent(box, applied.sentence!, "agent");
    const statuses = await watch.stop();
    await page.screenshot({ path: join(box.out, "board-final.png") });

    const result = await score(box, { scenario: "C: Tailwind v3 and a drawing kept as a note", changesetId: applied.changesetId!, before, statuses, agent, scope: /^(src\/|tailwind\.config\.js$)/, build: ["run", "typecheck"] });
    await cp(join(box.dataDir, ".cache", "verify"), join(box.out, "verify"), { recursive: true }).catch(() => {});
    console.log(await readFile(join(box.out, "summary.md"), "utf8"));

    expect.soft(await readFile(join(box.appRoot, "tailwind.config.js"), "utf8"), "the new brand color").toMatch(/#0d9488/i);
    expect.soft(await readFile(join(box.appRoot, "src/pages/pricing.tsx"), "utf8"), "the direct edit").toContain("Ask us anything");
    expect.soft(result.finalStatus, "the loop closed").toBe("verified");
    expect.soft(result.independentVerify.status, "the independent verify agrees").toBe(0);
    expect.soft(result.outOfScope).toEqual([]);
    expect.soft(result.handEditsInAppShape).toEqual([]);
    expect.soft(result.build.status, result.build.output).toBe(0);
    expect.soft(errors, "board errors").toEqual([]);
  } finally {
    kill(next.child);
    await box.stop();
  }
});
