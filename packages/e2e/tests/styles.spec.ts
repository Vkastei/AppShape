import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type AppShapeApp, expect, test } from "./fixtures";

async function screen(page: Page, app: AppShapeApp, name: string, heading: string) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill(name);
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get(name)).toBeDefined();
  const { id, current } = (await app.readScreens()).get(name)!;
  current.children = [{ id: `${name.toLowerCase()}-h2`, type: "text", origin: "added", text: heading, semantic: { role: "heading", level: 2 } }];
  await writeFile(join(app.dataDir, `frames/${id}/current.json`), JSON.stringify(current, null, 2));
  await expect(page.locator(`[data-frame-content] [data-aps="${name.toLowerCase()}-h2"]`)).toBeVisible();
}

const fontSize = (page: Page, id: string) => page.locator(`[data-frame-content] [data-aps="${id}"]`).evaluate((el) => getComputedStyle(el).fontSize);

test("text styles: changing H2 changes every H2 on every screen, per screen size", async ({ blankBoard: page, blankApp: app }) => {
  await screen(page, app, "Home", "Plans for every team");
  await screen(page, app, "About", "Our story");

  // the default styles, then both headings use H2
  await page.getByRole("tab", { name: "Design" }).click();
  const textStyles = page.getByRole("region", { name: "Text styles" });
  await textStyles.getByRole("button", { name: /Add the default styles/ }).click();
  await expect(textStyles.getByRole("button", { name: "Text style H2" })).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.getByRole("button", { name: "Zoom to fit (Shift+1)" }).click();
  for (const [name, id] of [["Home", "home-h2"], ["About", "about-h2"]] as const) {
    const box = (await page.locator(`[data-frame-content] [data-aps="${id}"]`).boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + box.height / 2);
    await inspector.getByLabel("Text style", { exact: true }).selectOption("h2");
    await expect.poll(async () => (await app.readScreens()).get(name)?.current.children[0].style).toEqual({ textStyle: "h2" });
  }
  // desktop screens: H2's size from tablets up (4xl)
  await expect.poll(() => fontSize(page, "home-h2")).toBe("36px");

  // one change in the design system: both screens follow
  await textStyles.getByRole("button", { name: "Text style H2" }).click();
  await textStyles.getByLabel("Style size md").selectOption("5xl");
  await expect.poll(() => fontSize(page, "home-h2")).toBe("48px");
  await expect.poll(() => fontSize(page, "about-h2")).toBe("48px");
  await expect.poll(async () => (await app.readTokens()).textStyles?.h2?.sizes).toEqual({ md: { fontSize: "$fontSize.5xl" } });

  // an element's own size wins over its style, and "Save…" makes a new style from it
  const box = (await page.locator('[data-frame-content] [data-aps="about-h2"]').boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await inspector.getByLabel("Font size").selectOption("2xl");
  await expect.poll(() => fontSize(page, "about-h2")).toBe("24px");
  await expect(inspector.getByText("Changed here: fontSize")).toBeVisible();
  await inspector.getByRole("button", { name: "Save as text style" }).click();
  await inspector.getByLabel("New text style name").fill("Section title");
  await inspector.getByLabel("New text style name").press("Enter");
  await expect.poll(async () => (await app.readScreens()).get("About")?.current.children[0].style).toEqual({ textStyle: "section-title" });
  await expect.poll(async () => (await app.readTokens()).textStyles?.["section-title"]).toMatchObject({ name: "Section title", fontSize: "$fontSize.2xl" });
});
