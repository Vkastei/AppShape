import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { clickInScreen, expect, test } from "./fixtures";

const applyDialog = (page: Page) => page.getByRole("dialog", { name: "Apply to code" });

async function applyToCode(page: Page, expectFiles: string[]) {
  await page.getByRole("button", { name: "Apply to code" }).click();
  const dialog = applyDialog(page);
  for (const file of expectFiles) await expect(dialog.getByText(file, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /^(Apply|Create app)/ }).click();
  await expect(dialog.getByText(/^(Created the app|Updated the code)/)).toBeVisible();
}

/** Design → code without AI, then design changes and hand edits, then a task for the agent. */
test("applies the design to code: create the app, update it, keep hand edits, hand off the rest", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  const insert = async (kind: string) => {
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
  };
  await insert("Heading");
  await page.keyboard.press("Escape");
  await insert("Button");
  await page.getByRole("button", { name: "Create component" }).click();

  // First apply: no app yet → pick a stack, preview, create
  await page.getByRole("button", { name: "Apply to code" }).click();
  const dialog = applyDialog(page);
  await expect(dialog.getByText("There is no app in")).toBeVisible();
  await dialog.getByLabel("Vite + React Router").check();
  await dialog.getByRole("button", { name: "Preview code" }).click();
  await expect(dialog.getByText("src/pages/Home.tsx", { exact: true })).toBeVisible();
  await expect(dialog.getByText("src/components/Button.tsx", { exact: true })).toBeVisible();
  await dialog.getByText("src/pages/Home.tsx", { exact: true }).click();
  await expect(dialog.getByTestId("diff")).toContainText('<h2 className="text-3xl font-bold tracking-tight">Heading</h2>');
  await dialog.getByRole("button", { name: "Create app" }).click();
  await expect(dialog.getByText(/^Created the app: \d+ files written/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  const home = join(app.appRoot, "src", "pages", "Home.tsx");
  expect(await readFile(home, "utf8")).toContain("<Button />");
  expect(JSON.parse(await readFile(join(app.appRoot, "package.json"), "utf8")).dependencies["react-router"]).toBeDefined();

  // A design change regenerates the untouched page
  await clickInScreen(page, "Heading", { double: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Build better habits");
  await page.keyboard.press("Enter");
  await applyToCode(page, ["src/pages/Home.tsx"]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(await readFile(home, "utf8")).toContain(">Build better habits</h2>");

  // Hand edits survive the next design change
  const edited = (await readFile(home, "utf8")).replace("export function Home() {\n", "export function Home() {\n  const today = new Date().toDateString();\n");
  await writeFile(home, edited);
  await clickInScreen(page, "Build better habits", { double: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Small steps, every day");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Apply to code" }).click();
  await expect(dialog.getByText("Update page Home (your edits kept)")).toBeVisible();
  await dialog.getByRole("button", { name: /^Apply/ }).click();
  await expect(dialog.getByText(/^Updated the code/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const merged = await readFile(home, "utf8");
  expect(merged).toContain("const today = new Date().toDateString();");
  expect(merged).toContain(">Small steps, every day</h2>");

  // A note for the AI becomes a task in a changeset with a spec
  await clickInScreen(page, "Small steps, every day");
  await page.getByLabel("Note kind").selectOption("data");
  await page.getByLabel("Note text").fill("Show today's date from the habit store");
  await page.getByLabel("Note text").press("Enter");
  await page.getByRole("button", { name: "Apply to code" }).click();
  await expect(dialog.getByRole("region", { name: "Tasks for the AI" })).toContainText("Data: Show today's date from the habit store");
  await dialog.getByRole("button", { name: /^Apply/ }).click();
  await expect(dialog.getByText(/1 task for your coding agent \(cs_/)).toBeVisible();
  const specs = await readdir(join(app.dataDir, "specs"));
  const markdown = await readFile(join(app.dataDir, "specs", specs.find((f) => f.endsWith(".md"))!), "utf8");
  expect(markdown).toContain("Data: Show today's date from the habit store");
  expect(markdown).toContain("src/pages/Home.tsx");
});
