/** The capture browser: the user opens a state of the app and presses the injected button. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { applyCommandToProject, DEFAULT_REDACTION, type Project } from "@appshape/ir";
import { emptyProject } from "@appshape/store";
import { expect, it } from "vitest";
import { AppProcess, CaptureBrowser, freePort, Importer } from "../src";

const APP = resolve(fileURLToPath(new URL("../../../fixtures", import.meta.url)), "vite-react-router-tw4");

it("captures what the user has open, as a new screen", async () => {
  const app = new AppProcess(APP);
  await app.run({ install: false, start: true, port: await freePort(), framework: "vite" });
  const devUrl = (await app.waitForUrl(60_000))!;
  const dataDir = await mkdtemp(join(tmpdir(), "aps-capture-"));
  const browser = new CaptureBrowser();
  try {
    let project: Project = { ...emptyProject("capture"), tokens: await defaultTokens() };
    const importer = new Importer(APP, dataDir);
    await browser.open(
      devUrl,
      join(dataDir, ".cache", "browser"),
      async (page) => {
        const result = await importer.captureOpenPage(project, page, { devUrl, redaction: DEFAULT_REDACTION });
        project = applyCommandToProject(project, result.ops);
        return `Captured as "${result.pages[0]?.name}"`;
      },
      { headless: true },
    );
    const page = browser.page!;
    // the user goes somewhere (here: the pricing page) and presses the button
    await page.goto(new URL("/pricing", devUrl).href);
    await page.getByRole("button", { name: "Capture to AppShape" }).click();
    await expect.poll(() => page.locator("[data-appshape-ui]").locator("span").textContent(), { timeout: 30_000 }).toMatch(/^Captured as "Pricing \(captured \d\d:\d\d\)"$/);
    const frame = project.frames.find((f) => f.target.route === "/pricing")!;
    expect(frame.kind).toBe("imported");
    // the button itself is not part of the capture
    expect(JSON.stringify(frame.current)).not.toContain("Capture to AppShape");
    expect(JSON.stringify(frame.current)).toContain("Compare all features");
  } finally {
    await browser.close();
    await app.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 120_000);
