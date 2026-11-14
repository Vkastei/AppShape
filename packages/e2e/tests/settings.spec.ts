import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("project settings are saved for the CLI and agents are connected from the board", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "Project settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Project settings" });
  await expect(dialog.getByLabel("Project name")).toHaveValue("E2E app");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();

  await dialog.getByLabel("Project name").fill("Shop");
  await dialog.getByRole("button", { name: "Your app" }).click();
  await dialog.getByLabel("App port").fill("3100");
  await dialog.getByLabel("Start script").fill("start");
  await dialog.getByRole("button", { name: "Privacy" }).click();
  await dialog.getByRole("radio", { name: /Only on this computer/ }).check();
  await dialog.getByLabel("Parts to hide").fill(".customer-name");
  await dialog.getByRole("button", { name: "Board", exact: true }).click();
  await dialog.getByLabel("Board port").fill("4700");

  // the command line page shows what the settings mean in a terminal
  await dialog.getByRole("button", { name: "Command line" }).click();
  await expect(dialog.getByText(/appshape dev .* --port 4700/)).toBeVisible();

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByTestId("toast").filter({ hasText: "Settings saved" })).toBeVisible();
  const project = JSON.parse(await readFile(join(app.dataDir, "project.json"), "utf8"));
  expect(project).toMatchObject({
    name: "Shop",
    redaction: { mode: "local-only", selectors: [".customer-name"] },
    settings: { app: { port: 3100, devScript: "start" }, board: { port: 4700 } },
  });

  // connecting an agent writes its files right away
  await dialog.getByRole("button", { name: "AI agents" }).click();
  const cursor = dialog.getByTestId("agent-cursor");
  await cursor.getByRole("button", { name: "Connect" }).click();
  await expect(cursor).toContainText("Connected");
  const mcp = JSON.parse(await readFile(join(app.appRoot, ".cursor", "mcp.json"), "utf8"));
  expect(mcp.mcpServers.appshape.args.at(-1)).toBe(app.appRoot);
  await cursor.getByRole("button", { name: "Remove" }).click();
  await expect(cursor).not.toContainText("Connected");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Shop", { exact: true }).first()).toBeVisible();
});
