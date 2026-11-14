import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickInScreen, expect, test } from "./fixtures";

// AppShape starts Claude Code itself; a stand-in script plays it (it reports through the CLI).
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
test.beforeAll(() => {
  process.env.APPSHAPE_CLAUDE_COMMAND = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
  process.env.APPSHAPE_FAKE_CLAUDE_CLI = `${join(REPO, "node_modules/tsx/dist/cli.mjs")}|${join(REPO, "packages/cli/src/main.ts")}`;
});
test.afterAll(() => {
  delete process.env.APPSHAPE_CLAUDE_COMMAND;
  delete process.env.APPSHAPE_FAKE_CLAUDE_CLI;
});

test("AppShape starts Claude Code after Apply to code, and on its own once allowed", async ({ blankBoard: page, blankApp: app }) => {
  test.setTimeout(120_000);
  // a screen with a note for the agent, created as an app
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Heading", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Apply to code" });
  await page.getByRole("button", { name: "Apply to code" }).click();
  await dialog.getByLabel("Vite + React Router").check();
  await dialog.getByRole("button", { name: "Preview code" }).click();
  await dialog.getByRole("button", { name: "Create app" }).click();
  await expect(dialog.getByText(/^Created the app/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // Claude Code connected to the app (Settings → AI agents)
  await page.getByRole("button", { name: "Project settings" }).click();
  const settings = page.getByRole("dialog", { name: /settings/i });
  await settings.getByRole("button", { name: "AI agents" }).click();
  await settings.getByTestId("agent-claude").getByRole("button", { name: "Connect" }).click();
  await expect(settings.getByTestId("agent-claude")).toContainText("Connected");
  await expect(settings.getByTestId("agent-autostart")).toContainText("Let AppShape start Claude Code");
  await page.keyboard.press("Escape");

  const note = async (text: string) => {
    await clickInScreen(page, "Heading");
    await page.getByLabel("Note kind").selectOption("data");
    await page.getByLabel("Note text").fill(text);
    await page.getByLabel("Note text").press("Enter");
  };
  const apply = async () => {
    await page.getByRole("button", { name: "Apply to code" }).click();
    await dialog.getByRole("button", { name: /^Apply/ }).click();
    await expect(dialog.getByText(/task for your coding agent \(cs_/)).toBeVisible();
    return /\((cs_[A-Za-z0-9]+)\)/.exec((await dialog.getByText(/task for your coding agent/).textContent()) ?? "")![1]!;
  };
  const statusOf = async (id: string) => JSON.parse(await readFile(join(app.dataDir, "changesets", `${id}.json`), "utf8")).status;

  // the first time: a button, and the choice to let it start on its own from now on
  await note("The heading comes from the CMS");
  const first = await apply();
  await dialog.getByLabel("From now on, start it on its own").check();
  await dialog.getByRole("button", { name: "Start Claude Code now" }).click();
  await expect(dialog.getByTestId("agent-run")).toContainText("Claude Code is done.", { timeout: 60_000 });
  await expect(dialog.getByTestId("agent-run")).toContainText(`Implemented 1 task(s) of ${first}.`);
  await expect.poll(() => statusOf(first)).toBe("applied");
  // its steps are in the activity log
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("region", { name: "Activity" })).toContainText("Task c1: applied");
  await page.keyboard.press("Escape");

  // from then on, on its own after Apply to code
  await note("The heading is translated");
  const second = await apply();
  await expect(dialog.getByTestId("agent-run")).toContainText("Claude Code is done.", { timeout: 60_000 });
  await expect.poll(() => statusOf(second)).toBe("applied");
  expect(JSON.parse(await readFile(join(app.appRoot, ".mcp.json"), "utf8")).mcpServers.appshape).toBeDefined();
});
