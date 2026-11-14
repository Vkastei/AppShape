import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Stands in for Google Fonts' metadata and the fontsource CDN: any family, one variable file. */
let cdn: Server;
test.beforeAll(async () => {
  cdn = createServer((req, res) => {
    if (req.url === "/metadata/fonts") {
      const family = (name: string, category: string) => ({ family: name, category, fonts: { "400": {}, "700": {} }, axes: [{ tag: "wght", min: 100, max: 900 }], popularity: 1 });
      res.end(JSON.stringify({ familyMetadataList: [family("Fraunces", "Serif"), family("Inter", "Sans Serif")] }));
      return;
    }
    const sheet = /^\/npm\/@fontsource-variable\/([a-z0-9-]+)@latest\/index\.css$/.exec(req.url ?? "");
    if (sheet) {
      const name = sheet[1]!.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => `${dash ? " " : ""}${c.toUpperCase()}`);
      res.end(`@font-face {\n  font-family: '${name} Variable';\n  font-weight: 100 900;\n  src: url(./files/${sheet[1]}-latin-wght-normal.woff2) format('woff2-variations');\n}`);
    } else if (req.url?.endsWith(".woff2")) {
      res.end(Buffer.from("not really a font"));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;
  process.env.APPSHAPE_FONT_CATALOG = `${base}/metadata/fonts`;
  process.env.APPSHAPE_FONT_CDN = `${base}/npm`;
});
test.afterAll(async () => {
  await new Promise((resolve) => cdn.close(resolve));
});

const background = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

test("the theme starter makes a design system for light and dark mode, in one undoable step", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort()); // font previews
  await page.getByRole("tab", { name: "Design" }).click();
  await page.getByRole("button", { name: "Theme starter" }).click();
  const dialog = page.getByRole("dialog", { name: "Theme starter" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Brand color #0d9488" }).click();
  await dialog.getByRole("radio", { name: "Fonts Editorial" }).click();
  await dialog.getByRole("radiogroup", { name: "Shape" }).getByRole("radio", { name: "Round" }).click();
  await dialog.getByRole("radiogroup", { name: "Spacing" }).getByRole("radio", { name: "Airy" }).click();

  // the preview shows the choices on real UI, in both schemes
  const preview = '[data-testid="theme-preview"] button';
  await expect.poll(() => background(page, preview)).toBe("rgb(13, 148, 136)");
  const page_ = '[data-testid="theme-preview"] .aps-frame > [data-aps]';
  const light = await background(page, page_);
  await dialog.getByRole("button", { name: "Preview in dark mode" }).click();
  await expect.poll(() => background(page, page_)).not.toBe(light);

  await dialog.getByRole("button", { name: "Apply theme" }).click();
  await expect(dialog).toBeHidden();
  const tokens = async () => (await app.readTokens()) as { groups: Record<string, Record<string, string>>; dark?: Record<string, Record<string, string>> };
  await expect.poll(async () => (await tokens()).groups.color?.brand).toBe("#0d9488");
  const after = await tokens();
  expect(after.groups.fontFamily?.heading).toBe('"Fraunces Variable", ui-serif, Georgia, Cambria, "Times New Roman", serif');
  expect(after.groups.fontFamily?.sans).toBe('"Inter Variable", ui-sans-serif, system-ui, sans-serif');
  expect(after.groups.radius?.md).toBe("0.75rem");
  expect(after.groups.spacing?.["section-lg"]).toBe("8rem");
  expect(after.dark?.color?.background).toBeDefined();
  // the fonts are the project's own
  expect((await stat(join(app.dataDir, "assets", "fonts", "fraunces", "files", "fraunces-latin-wght-normal.woff2"))).size).toBeGreaterThan(0);

  // the design panel marks colors that change in dark mode, and edits their dark value there
  await page.getByRole("button", { name: "Show screens in dark mode" }).click();
  const field = page.getByLabel("color background", { exact: true });
  await expect(field).toHaveValue(after.dark!.color!.background!);
  await field.fill("#101010");
  await field.press("Enter");
  await expect.poll(async () => (await tokens()).dark?.color?.background).toBe("#101010");
  expect((await tokens()).groups.color?.background).toBe("#ffffff");
  await page.getByRole("button", { name: "Show screens in light mode" }).click();

  // one undo takes the dark edit back, the next the whole theme
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await tokens()).dark?.color?.background).toBe(after.dark!.color!.background);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await tokens()).groups.color?.brand).toBeUndefined();
  expect((await tokens()).dark).toBeUndefined();
});

test("starter components are added once, with their variants on the board, and follow dark mode", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  const insert = async (name: string) => {
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };

  await insert("Button (starter component)");
  const screens = async () => app.readScreens();
  await expect.poll(async () => (await screens()).get("Home")?.current.children?.[0]?.type).toBe("instance");
  const button = (await screens()).get("Button")!;
  expect((await screens()).get("Home")!.current.children[0].componentId).toBe(button.id);
  // the theme colors it needs came along (an existing design system keeps its own)
  expect((await app.readTokens()).groups.color?.primary).toBeDefined();
  // the component and its secondary, outline and ghost variants are on the board
  const placements = (await app.readBoard()).items.filter((i) => (i as { frameId?: string }).frameId === button.id);
  expect(placements.length).toBe(4);

  // the project has a Button now: Insert offers it as one of its components, not as a starter
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Button (starter component)" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Card (starter component)" }).click();
  await expect.poll(async () => (await screens()).get("Card")?.id).toBeDefined();

  await expect.poll(async () => (await screens()).get("Home")?.current.children?.length).toBe(2);
  const cardId: string = (await screens()).get("Home")!.current.children[1].id;
  const cardOnScreen = page.locator(`[data-frame-content] [data-aps="${cardId}"]`);
  const light = await cardOnScreen.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole("button", { name: "Show screens in dark mode" }).click();
  await expect.poll(() => cardOnScreen.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(light);
});
