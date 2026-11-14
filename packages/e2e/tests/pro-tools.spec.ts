import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type AppShapeApp, expect, test } from "./fixtures";

/** A screen "Home" whose content is written on disk (the board follows). */
async function screenWith(page: Page, app: AppShapeApp, children: unknown[]) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get("Home")).toBeDefined();
  const { id, current } = (await app.readScreens()).get("Home")!;
  current.children = children;
  await writeFile(join(app.dataDir, `frames/${id}/current.json`), JSON.stringify(current, null, 2));
  await expect(page.locator(`[data-frame-content] [data-aps="${(children[0] as { id: string }).id}"]`)).toBeVisible();
  return id as string;
}

async function element(page: Page, id: string) {
  return (await page.locator(`[data-frame-content] [data-aps="${id}"]`).boundingBox())!;
}

const home = async (app: AppShapeApp) => (await app.readScreens()).get("Home")?.current;

test("rich text: a bold word and a link inside a paragraph", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [{ id: "p", type: "text", origin: "added", text: "Read the docs today" }]);
  const box = await element(page, "p");
  await page.mouse.dblclick(box.x + 8, box.y + box.height / 2);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeFocused();
  const toolbar = page.getByRole("toolbar", { name: "Text formatting" });

  // "Read" bold: select the first word, then the toolbar's B
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await toolbar.getByRole("button", { name: "Bold" }).click();
  // "docs" a link
  await page.keyboard.press("End");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+ArrowLeft");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await toolbar.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByLabel("Link address").fill("/docs");
  await page.getByLabel("Link address").press("Enter");
  await editor.press("Enter");

  await expect.poll(async () => (await home(app))?.children[0].spans).toEqual([
    { text: "Read", style: { fontWeight: "$fontWeight.bold" } },
    { text: " the " },
    { text: "docs", href: "/docs" },
    { text: " today" },
  ]);
  // the board shows them, and the inspector keeps the formatting safe
  await expect(page.locator('[data-frame-content] [data-aps="p"] a[href="/docs"]')).toHaveText("docs");
  await expect(page.getByText("Formatted text: double-click it on the board to edit")).toBeVisible();
});

test("advanced classes: a class without an inspector setting shows on the board and stays in the design", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    { id: "glass", type: "box", origin: "added", layout: { mode: "flex", padding: { top: 16, right: 16, bottom: 16, left: 16 } }, style: { background: "$color.white/50" }, children: [{ id: "t", type: "text", origin: "added", text: "Glass" }] },
  ]);
  const box = await element(page, "glass");
  await page.mouse.click(box.x + 4, box.y + 4);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByRole("button", { name: "Advanced" }).click();
  const classes = inspector.getByLabel("Classes", { exact: true });
  await expect(classes).toHaveValue(/flex/);
  await classes.fill(`${await classes.inputValue()} rounded-xl backdrop-blur-md text-balance`);
  await classes.press("Control+Enter");

  // known classes become settings, the rest is kept as it is (and marked)
  await expect.poll(async () => (await home(app))?.children[0].style).toMatchObject({ radius: "$radius.xl", backdropBlur: "$blur.md" });
  await expect.poll(async () => (await home(app))?.children[0].platformRaw?.unmapped).toEqual(["text-balance"]);
  await expect(inspector.getByLabel("Kept as they are")).toContainText("text-balance");
  // the board has the CSS for it
  await expect.poll(() => page.locator('[data-frame-content] [data-aps="glass"]').evaluate((el) => getComputedStyle(el).textWrap)).toContain("balance");
});

test("page settings and the site icon go into the generated page", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [{ id: "h", type: "text", origin: "added", text: "Welcome", semantic: { role: "heading", level: 1 } }]);
  const box = await element(page, "h");
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.press("Escape"); // the screen itself
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByLabel("Page title").fill("Acme — Ship faster");
  await inspector.getByLabel("Page title").press("Enter");
  await inspector.getByLabel("Page description").fill("Plans for teams of every size.");
  await inspector.getByLabel("Page description").press("Control+Enter");
  await expect.poll(async () => {
    const { id } = (await app.readScreens()).get("Home")!;
    return JSON.parse(await readFile(join(app.dataDir, `frames/${id}/frame.json`), "utf8")).meta;
  }).toEqual({ title: "Acme — Ship faster", description: "Plans for teams of every size." });

  await page.getByRole("button", { name: "Apply to code" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply to code" });
  await dialog.getByLabel("Vite + React Router").check();
  await dialog.getByRole("button", { name: "Preview code" }).click();
  await dialog.getByRole("button", { name: "Create app" }).click();
  await expect(dialog.getByText(/^Created the app/)).toBeVisible();
  expect(await readFile(join(app.appRoot, "src/pages/Home.tsx"), "utf8")).toContain("<title>Acme — Ship faster</title>");
  expect(await readFile(join(app.appRoot, "src/pages/Home.tsx"), "utf8")).toContain('<meta name="description" content="Plans for teams of every size." />');
});

test("command palette, rename with F2, select same, shortcut overview", async ({ blankBoard: page, blankApp: app }) => {
  const button = (id: string, radius: string) => ({ id, type: "button", origin: "added", style: { radius }, children: [{ id: `${id}-t`, type: "text", origin: "added", text: id }] });
  await screenWith(page, app, [button("b1", "$radius.md"), button("b2", "$radius.md"), button("b3", "$radius.lg")]);

  // Ctrl+K: a toolbar action
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("dark mode");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show screens in light mode" })).toBeVisible();

  // an element's action: select same style
  const box = await element(page, "b1");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Control+k");
  await palette.getByRole("combobox").fill("same style");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByText("2 elements")).toBeVisible();

  // F2: the layer name (Esc first: back to the first of the two)
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByText("2 elements")).toHaveCount(0);
  await page.keyboard.press("F2");
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByLabel("Layer name")).toBeFocused();
  await page.keyboard.type("Primary action");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await home(app))?.children[0].name).toBe("Primary action");

  // ?: every shortcut
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+?");
  const overview = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(overview.getByText("Command palette", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overview).toHaveCount(0);
});
