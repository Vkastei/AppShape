import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { clickInScreen, expect, test } from "./fixtures";

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

/** The app's own dev server (AppShape can start it too; here the dialog gets its URL). */
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

/** Existing app → board → edit → code, without AI. */
test("imports the pages of a running app, edits one, and applies the edit to its code", async ({ fixtureBoard: page, fixtureApp: app }) => {
  test.setTimeout(180_000);
  const vite = await startVite(app.appRoot);
  try {
    await page.getByRole("button", { name: "Import pages" }).click();
    const dialog = page.getByRole("dialog", { name: "Import pages" });
    await expect(dialog.getByRole("checkbox", { name: "/", exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "/pricing" })).toBeChecked();
    await dialog.getByPlaceholder(/a running one/).fill(vite.url);
    await dialog.getByRole("button", { name: "Import 2 pages" }).click();
    await expect(dialog.getByRole("table")).toBeVisible({ timeout: 120_000 });
    await expect(dialog.getByRole("row", { name: /Home/ })).toContainText("100%");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    // What happened shows up at the top; the message opens the activity log at that entry
    const toast = page.getByTestId("toast").filter({ hasText: "Brought in 2 pages" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: /Brought in 2 pages/ }).click();
    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity.getByText("Bringing in 2 pages from your app…")).toBeVisible();
    await expect(activity.locator(".bg-amber-50")).toContainText("Brought in 2 pages");
    await page.keyboard.press("Escape");
    await expect(activity).toBeHidden();

    // The pages are screens now, rendered with the app's own CSS
    await expect(page.getByText("/pricing").first()).toBeVisible();
    const styles = await (await page.request.get(`${new URL(app.url).origin}/api/app-styles?token=${new URL(app.url).hash.slice("#token=".length)}`)).json();
    expect(styles.shadow).toContain("@container aps-frame");

    // Each element knows its code
    await clickInScreen(page, "Ship apps faster");
    await expect(page.getByLabel("Source")).toContainText("src/pages/Home.tsx:6");
    const text = page.getByLabel("Text", { exact: true });
    await text.fill("Ship faster");
    await text.press("Control+Enter");

    // … so the edit goes straight into the code
    await page.getByRole("button", { name: "Apply to code" }).click();
    const apply = page.getByRole("dialog", { name: "Apply to code" });
    await expect(apply.getByText("src/pages/Home.tsx", { exact: true })).toBeVisible();
    await apply.getByRole("button", { name: /^Apply 1 file change/ }).click();
    await expect(apply.getByText(/^Updated the code/)).toBeVisible();
    const home = await readFile(join(app.appRoot, "src/pages/Home.tsx"), "utf8");
    expect(home).toContain(`<h1 className="text-5xl font-bold tracking-tight text-gray-900">Ship faster</h1>`);

    // … and the running app shows it: every element of the page matches the design
    await apply.getByRole("button", { name: "Check in the app" }).click();
    const rows = apply.getByTestId("verify-frame");
    await expect(rows).toHaveCount(2, { timeout: 120_000 });
    await expect(rows.first()).toContainText("Home · desktop");
    for (const row of await rows.all()) await expect(row).toContainText("elements match");
  } finally {
    vite.child.kill();
  }
});
