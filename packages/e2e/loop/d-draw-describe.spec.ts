/**
 * Scenario D: Draw & describe through the coding agent. A new app with
 * a pricing page; on it, *New section below…* the plans, described in a sentence and sent to the
 * coding agent. The agent reads the request (with its picture) and proposes the screen; the board
 * shows the proposal, it is accepted, applied to the code and checked in the app.
 */
import { spawnSync } from "node:child_process";
import { readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { applyToCode, clickInScreen, createApp, openBoard, screenFromTemplate, selected } from "./board";
import { AGENT, MODEL, REPO, runAgent, sandbox } from "./harness";

test("D: Draw & describe through the agent", async ({ page }) => {
  const box = await sandbox("D-draw-describe");
  console.log(`sandbox ${box.appRoot}\nresults ${box.out}`);
  try {
    const errors = await openBoard(page, box);
    await screenFromTemplate(page, "Pricing", "pricing");
    await createApp(page, "Vite + React Router");
    await symlink(join(REPO, "fixtures/generated-vite-react-router/node_modules"), join(box.appRoot, "node_modules"), "junction");
    const before = box.snapshot("the app");

    // a new section below the plans, from a sentence, for the coding agent
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await clickInScreen(page, "Simple pricing that grows with you", { screen: "Pricing" });
    for (let i = 0; i < 8 && !(await inspector.getByRole("button", { name: "New section below…" }).isVisible()); i++) await page.keyboard.press("Escape");
    console.log(`selected: ${await selected(page)}`);
    await inspector.getByRole("button", { name: "New section below…" }).click();
    const dock = page.getByRole("dialog", { name: "Drawing on Pricing" });
    await dock.getByLabel("What should the section be?").fill("Three short quotes from happy customers, as cards, with their name and role.");
    await dock.getByRole("button", { name: "Design it with your coding agent" }).click();
    const waiting = dock.getByTestId("waiting-for-agent");
    await expect(waiting).toBeVisible();
    const sentence = ((await waiting.locator("code").first().textContent()) ?? "").trim();
    await page.screenshot({ path: join(box.out, "board-1-waiting.png") });
    console.log(`sentence: "${sentence}"`);
    expect(sentence).toMatch(/^Design AppShape request rq_/);

    const agent = await runAgent(box, sentence, "agent");

    // the proposal on the board: reviewed and accepted
    const proposal = dock.getByTestId("proposal");
    const proposed = await proposal.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    await page.screenshot({ path: join(box.out, "board-2-proposal.png") });
    const codeTouched = spawnSync("git", ["status", "--porcelain", "--", "src"], { cwd: box.appRoot, encoding: "utf8" }).stdout.trim();
    const requests = await readdir(join(box.dataDir, "requests")).catch(() => [] as string[]);
    const request = requests.length ? JSON.parse(await readFile(join(box.dataDir, "requests", requests[0]!), "utf8")) : undefined;
    let applied: Awaited<ReturnType<typeof applyToCode>> | undefined;
    const rows: string[] = [];
    if (proposed) {
      await dock.getByRole("button", { name: "Accept" }).click();
      applied = await applyToCode(page);
      const dialog = page.getByRole("dialog", { name: "Apply to code" });
      await dialog.getByRole("button", { name: "Check in the app" }).click();
      const frames = dialog.getByTestId("verify-frame");
      await expect(frames.first()).toBeVisible({ timeout: 180_000 });
      await expect(dialog.getByRole("button", { name: "Check again" })).toBeVisible({ timeout: 180_000 });
      for (const row of await frames.all()) rows.push(((await row.textContent()) ?? "").replace(/\s+/g, " ").trim());
      await page.screenshot({ path: join(box.out, "board-3-checked.png") });
    }
    const inCode = spawnSync("git", ["diff", "--stat", before, "--", "src"], { cwd: box.appRoot, encoding: "utf8" }).stdout.trim().split("\n").at(-1) ?? "";
    const tools = agent.tools.map((t) => t.name);
    const summary = [
      `# D: Draw & describe through the agent · ${AGENT === "dry" ? "dry" : `claude ${MODEL}`}`,
      "",
      "| Check | Result |",
      "|---|---|",
      `| The agent read the request | ${tools.includes("mcp__appshape__get_design_request") ? "✓" : "✗"} |`,
      `| The agent proposed a design | ${tools.filter((t) => t === "mcp__appshape__propose_design").length}× propose_design; the board shows it: ${proposed ? "✓" : "✗"} |`,
      `| The agent left the code alone | ${codeTouched ? `✗ ${codeTouched}` : "✓"} |`,
      `| The proposal | ${request?.proposal ? `${request.proposal.summary?.length ?? 0} changes; warnings: ${(request.proposal.warnings ?? []).join(" / ") || "none"}` : "–"} |`,
      `| Accepted and applied | ${applied ? `${applied.written} ${applied.tasks} task(s)` : "–"} |`,
      `| In the code after applying | ${inCode || "nothing changed"} |`,
      `| Check in the app | ${rows.join(" · ") || "–"} |`,
      `| MCP | ${agent.mcpServers.map((m) => `${m.name}: ${m.status}`).join(", ") || "–"}; ${agent.tools.filter((t) => t.name.startsWith("mcp__") && t.error).length} tool errors |`,
      `| Time, turns, cost | ${agent.seconds}s, ${agent.result?.turns ?? "–"} turns, $${agent.result?.costUsd?.toFixed(2) ?? "–"} |`,
      "",
      "## Proposal",
      "",
      ...(request?.proposal?.summary ?? []).map((s: string) => `- ${s}`),
      "",
    ].join("\n");
    await writeFile(join(box.out, "summary.md"), summary);
    const patch = spawnSync("git", ["diff", before, "--", "src"], { cwd: box.appRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    await writeFile(join(box.out, "diff.patch"), patch.stdout);
    console.log(summary);

    expect.soft(tools, "the agent read the request").toContain("mcp__appshape__get_design_request");
    expect.soft(proposed, "the board shows the agent's proposal").toBe(true);
    expect.soft(codeTouched, "the agent left the code alone").toBe("");
    expect.soft(applied?.tasks ?? 0, "nothing left for the agent after applying").toBe(0);
    expect.soft(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect.soft(row, "the app matches the design").toMatch(/elements match/);
    expect.soft(errors, "board errors").toEqual([]);
  } finally {
    await box.stop();
  }
});
