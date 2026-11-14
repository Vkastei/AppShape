/**
 * Scenario E: Ask AI → Review this page, through the coding agent that AppShape starts itself
 * (no sentence to paste). The agent reviews the landing page (submit_review); the first finding is
 * fixed, designed by the agent again (started on its own), accepted, and the review comes back.
 */
import { readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickInScreen, createApp, openBoard, screenFromTemplate } from "./board";
import { AGENT, MODEL, REPO, sandbox } from "./harness";

test("E: a review through the coding agent AppShape starts", async ({ page }) => {
  test.skip(AGENT === "dry", "needs Claude Code");
  const box = await sandbox("E-review-agent");
  console.log(`sandbox ${box.appRoot}\nresults ${box.out}`);
  const started = Date.now();
  try {
    const errors = await openBoard(page, box);
    await screenFromTemplate(page, "Home", "landing");
    await createApp(page, "Vite + React Router");
    await symlink(join(REPO, "fixtures/generated-vite-react-router/node_modules"), join(box.appRoot, "node_modules"), "junction");

    // Ask AI → Review this page → Review it with your coding agent
    await clickInScreen(page, "Ship a better product, faster", { screen: "Home" });
    const ask = page.getByTestId("ask-ai");
    for (let i = 0; i < 6 && !(await ask.isVisible()); i++) await page.keyboard.press("Escape");
    await ask.getByRole("button", { name: "Ask AI" }).click();
    await page.getByRole("menu", { name: "Ask AI" }).getByRole("menuitem", { name: /Review this page/ }).click();
    const dock = page.getByRole("dialog", { name: "Drawing on Home" });
    await dock.getByRole("button", { name: /Review it with your coding agent/ }).click();
    // AppShape starts Claude Code (and from now on on its own)
    await dock.getByLabel("From now on, start it on its own").check();
    await dock.getByRole("button", { name: "Start Claude Code now" }).click();
    await page.screenshot({ path: join(box.out, "board-1-reviewing.png") });
    const review = dock.getByTestId("review");
    await expect(review).toBeVisible({ timeout: 15 * 60_000 });
    await page.screenshot({ path: join(box.out, "board-2-review.png") });
    const requestFile = async () => JSON.parse(await readFile(join(box.dataDir, "requests", (await readdir(join(box.dataDir, "requests")))[0]!), "utf8"));
    const reviewed = await requestFile();
    console.log(JSON.stringify(reviewed.review, null, 2));

    // fix the first finding: the agent designs it, started on its own
    const first = reviewed.review.findings[0];
    await review.getByRole("button", { name: "Fix it" }).first().click();
    await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 15 * 60_000 });
    await page.screenshot({ path: join(box.out, "board-3-fix.png") });
    const fixed = await requestFile();
    await dock.getByRole("button", { name: "Accept" }).click();
    await expect(review).toBeVisible();
    await expect(review).toContainText(`1 done: ${first.title}`);
    await page.screenshot({ path: join(box.out, "board-4-back.png") });

    const summary = [
      `# E: a review through the coding agent AppShape starts · claude (${MODEL === "sonnet" ? "default model" : MODEL})`,
      "",
      `Time: ${Math.round((Date.now() - started) / 1000)} s (the two agent runs, started by AppShape)`,
      "",
      `## Review (${reviewed.review.findings.length} findings, by ${reviewed.review.by})`,
      "",
      reviewed.review.summary ?? "",
      "",
      ...reviewed.review.findings.map((f: { severity: string; title: string; why: string; fix: string; targets?: string[] }) => `- **${f.title}** (${f.severity}): ${f.why} → ${f.fix} [${(f.targets ?? []).join(", ")}]`),
      "",
      "## The fix of the first finding",
      "",
      ...(fixed.proposal?.summary ?? []).map((s: string) => `- ${s}`),
      ...(fixed.proposal?.warnings ?? []).map((w: string) => `- ⚠ ${w}`),
      "",
    ].join("\n");
    await writeFile(join(box.out, "summary.md"), summary);
    console.log(summary);
    expect.soft(reviewed.review.by).toBe("agent");
    expect.soft(reviewed.review.findings.length).toBeGreaterThan(0);
    expect.soft(errors, "board errors").toEqual([]);
  } finally {
    await box.stop();
  }
});
