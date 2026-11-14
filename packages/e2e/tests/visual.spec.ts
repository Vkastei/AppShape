import { writeFile } from "node:fs/promises";
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
}

/** Selects an element: a click on a child of it, then Esc to its parent (or the element itself). */
async function select(page: Page, id: string, viaChild?: string) {
  const box = (await page.locator(`[data-frame-content] [data-aps="${viaChild ?? id}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (viaChild) await page.keyboard.press("Escape");
}

const node = async (app: AppShapeApp, index: number) => (await app.readScreens()).get("Home")?.current.children[index];
const computed = (page: Page, id: string, property: string) => page.locator(`[data-frame-content] [data-aps="${id}"]`).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test("gradients: a hero background and a gradient headline", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    {
      id: "hero",
      type: "box",
      origin: "added",
      layout: { mode: "flex", direction: "column", padding: { top: 48, right: 32, bottom: 48, left: 32 } },
      children: [{ id: "headline", type: "text", origin: "added", text: "Ship faster", semantic: { role: "heading", level: 1 }, style: { fontSize: "$fontSize.5xl" } }],
    },
  ]);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await select(page, "hero", "headline");
  await inspector.getByRole("radiogroup", { name: "Gradient", exact: true }).getByText("Linear").click();
  await inspector.getByRole("radiogroup", { name: "Gradient direction" }).getByTitle("To the bottom right corner").click();
  await inspector.getByRole("button", { name: "Gradient start color" }).click();
  await page.getByRole("dialog", { name: "Gradient start color colors" }).getByRole("button", { name: "sky-500", exact: true }).click();
  await inspector.getByRole("button", { name: "Add a middle color" }).click();
  await expect.poll(async () => (await node(app, 0))?.style?.gradient).toMatchObject({ type: "linear", angle: "to-br", stops: [{ color: "$color.sky-500" }, {}, {}] });
  await expect.poll(() => computed(page, "hero", "background-image")).toContain("linear-gradient");

  // the headline filled with a gradient
  await select(page, "headline");
  await inspector.getByRole("radiogroup", { name: "Gradient text" }).getByText("On").click();
  await expect.poll(async () => (await node(app, 0))?.children[0].style).toMatchObject({ backgroundClip: "text", color: "transparent", gradient: { type: "linear", angle: 90 } });
  await expect.poll(() => computed(page, "headline", "background-clip")).toBe("text");
});

test("a glass card: backdrop blur, a tinted shadow, custom shadows", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    {
      id: "card",
      type: "box",
      origin: "added",
      layout: { mode: "flex", padding: { top: 24, right: 24, bottom: 24, left: 24 } },
      style: { background: "$color.white/10", borderWidth: 1, borderColor: "$color.white/20" },
      children: [{ id: "t", type: "text", origin: "added", text: "Glass" }],
    },
  ]);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await select(page, "card", "t");
  await inspector.getByLabel("Backdrop blur").selectOption("md");
  await inspector.getByLabel("Shadow", { exact: true }).selectOption("xl");
  await inspector.getByRole("button", { name: "Shadow color" }).click();
  const custom = page.getByLabel("Shadow color custom");
  await custom.fill("$color.black/10");
  await custom.press("Enter");
  await expect.poll(async () => (await node(app, 0))?.style).toMatchObject({ backdropBlur: "$blur.md", shadow: "$shadow.xl", shadowColor: "$color.black/10" });
  await expect.poll(() => computed(page, "card", "backdrop-filter")).toContain("blur(");

  // custom shadows: a list
  await inspector.getByRole("button", { name: "Custom", exact: true }).click();
  await inspector.getByRole("button", { name: "Add a shadow" }).click();
  await inspector.getByLabel("Shadow 2 y").fill("2");
  await inspector.getByLabel("Shadow 2 y").press("Enter");
  await expect.poll(async () => (await node(app, 0))?.style?.shadow).toHaveLength(2);
  expect((await node(app, 0))?.style?.shadow[1]).toMatchObject({ x: 0, y: 2, blur: 2 });
});

test("a tilted badge: rotate by dragging, lift on hover", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    {
      id: "row",
      type: "box",
      origin: "added",
      layout: { mode: "flex", padding: { top: 64, right: 64, bottom: 64, left: 64 } },
      children: [{ id: "badge", type: "box", origin: "added", layout: { mode: "flex", padding: { top: 4, right: 12, bottom: 4, left: 12 } }, style: { background: "$color.amber-300" }, children: [{ id: "b", type: "text", origin: "added", text: "New" }] }],
    },
  ]);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await select(page, "badge", "b");
  // drag the round handle a quarter turn to the right (Shift: 15° steps)
  const handle = (await page.getByTestId("rotate-handle").boundingBox())!;
  const badge = (await page.locator('[data-frame-content] [data-aps="badge"]').boundingBox())!;
  const center = { x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 };
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(center.x + 60, center.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await node(app, 0))?.children[0].style?.rotate).toBe(90);
  // a gentle tilt typed in
  await inspector.getByLabel("Rotate", { exact: true }).fill("-6");
  await inspector.getByLabel("Rotate", { exact: true }).press("Enter");
  await expect.poll(async () => (await node(app, 0))?.children[0].style?.rotate).toBe(-6);
  await expect.poll(() => computed(page, "badge", "rotate")).toBe("-6deg");

  // hover: lift
  await inspector.getByRole("radiogroup", { name: "State" }).getByText("Hover").click();
  await inspector.getByLabel("Move y").selectOption("raw:-0.25rem");
  await expect.poll(async () => (await node(app, 0))?.children[0].overrides).toEqual([{ when: { state: "hover" }, style: { translate: { y: "-0.25rem" } } }]);
});

test("corners and sides one by one, blending, a see-through fill", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    { id: "tab", type: "box", origin: "added", layout: { mode: "flex", padding: { top: 16, right: 16, bottom: 16, left: 16 } }, style: { background: "$color.white" }, children: [{ id: "t", type: "text", origin: "added", text: "Tab" }] },
  ]);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await select(page, "tab", "t");
  // rounded only at the top
  await inspector.getByRole("button", { name: "Radius per corner" }).click();
  await inspector.getByLabel("Radius top left").selectOption("xl");
  await inspector.getByLabel("Radius top right").selectOption("xl");
  await expect.poll(async () => (await node(app, 0))?.style?.radius).toEqual({ topLeft: "$radius.xl", topRight: "$radius.xl" });
  // a line only at the bottom
  await inspector.getByRole("button", { name: "Border per side" }).click();
  await inspector.getByLabel("Border bottom").selectOption("2");
  await expect.poll(async () => (await node(app, 0))?.style?.borderWidth).toEqual({ bottom: 2 });
  await expect.poll(() => computed(page, "tab", "border-bottom-width")).toBe("2px");
  // blending
  await inspector.getByLabel("Blend mode").selectOption("multiply");
  await expect.poll(() => computed(page, "tab", "mix-blend-mode")).toBe("multiply");
  // the fill at 60 %
  await inspector.getByRole("button", { name: "Fill", exact: true }).click();
  await page.getByLabel("Fill opacity").fill("60");
  await expect.poll(async () => (await node(app, 0))?.style?.background).toBe("$color.white/60");
});
