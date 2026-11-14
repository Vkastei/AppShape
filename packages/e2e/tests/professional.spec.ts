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

const button = (id: string) => ({
  id,
  type: "button",
  origin: "added",
  layout: { mode: "flex", padding: { top: "$spacing.2", right: "$spacing.4", bottom: "$spacing.2", left: "$spacing.4" } },
  style: { background: "$color.primary" },
  children: [{ id: `${id}-label`, type: "text", origin: "added", text: `Button ${id.slice(1)}` }],
});

async function clickElement(page: Page, id: string, shift = false) {
  const box = (await page.locator(`[data-frame-content] [data-aps="${id}"]`).boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up("Shift");
}

const node = async (app: AppShapeApp, path: number[]) => {
  let n = (await app.readScreens()).get("Home")?.current;
  for (const i of path) n = n?.children?.[i];
  return n;
};

test("several elements at once: five buttons get the same radius in one edit, then line up", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [{ id: "row", type: "box", origin: "added", layout: { mode: "flex", direction: "row", gap: "$spacing.4" }, children: ["b1", "b2", "b3", "b4", "b5"].map(button) }]);
  await clickElement(page, "b1");
  for (const id of ["b2", "b3", "b4", "b5"]) await clickElement(page, id, true);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByText("5 elements")).toBeVisible();
  await expect(page.getByTestId("node-selection")).toHaveCount(5);

  // one edit for all five
  await inspector.getByLabel("Radius", { exact: true }).selectOption("lg");
  const radii = async () => ((await node(app, [0]))?.children ?? []).map((b: { style?: { radius?: string } }) => b.style?.radius);
  await expect.poll(radii).toEqual(Array(5).fill("$radius.lg"));
  // values they don't share show as mixed, and one undo step takes it all back
  await page.keyboard.press("Control+z");
  await expect.poll(radii).toEqual(Array(5).fill(undefined));

  // in a row: aligning across it is each button's own alignment, spreading along it the row's
  await inspector.getByRole("button", { name: "Align bottom" }).click();
  await expect.poll(async () => ((await node(app, [0]))?.children ?? []).map((b: { box?: { alignSelf?: string } }) => b.box?.alignSelf)).toEqual(Array(5).fill("end"));
  await inspector.getByRole("button", { name: "Distribute horizontally" }).click();
  await expect.poll(async () => (await node(app, [0]))?.layout?.justify).toBe("between");
  await expect(inspector.getByRole("button", { name: "Distribute vertically" })).toBeDisabled();

  // a plain click selects one again
  await clickElement(page, "b3");
  await expect(page.getByTestId("node-selection")).toHaveCount(1);
});

test("every box property can be set in the inspector", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    { id: "bar", type: "box", origin: "added", layout: { mode: "flex", direction: "row", gap: "$spacing.4" }, children: [button("b1"), button("b2")] },
    { id: "grid", type: "box", origin: "added", layout: { mode: "grid", columns: 3 }, children: [button("g1"), button("g2")] },
  ]);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await clickElement(page, "b1");
  await page.keyboard.press("Escape"); // its parent: the row
  await expect(inspector.getByText("box", { exact: true })).toBeVisible();
  await inspector.getByRole("radiogroup", { name: "Pin" }).getByText("Sticky").click();
  await inspector.getByLabel("Z-index").selectOption("40");
  await inspector.getByLabel("Min height").selectOption("raw:100vh");
  await inspector.getByRole("radio", { name: "Clip" }).click();
  await expect.poll(async () => (await node(app, [0]))?.box).toMatchObject({ position: "sticky", inset: { top: 0 }, zIndex: 40, minHeight: "100vh" });
  await expect.poll(async () => (await node(app, [0]))?.style?.overflow).toBe("hidden");

  await clickElement(page, "b2");
  await inspector.getByLabel("Order", { exact: true }).selectOption("First");
  await inspector.getByLabel("Proportions").selectOption("16 / 9");
  await expect.poll(async () => (await node(app, [0, 1]))?.box).toMatchObject({ order: -9999, aspectRatio: "16 / 9" });

  await clickElement(page, "g1");
  await inspector.getByLabel("Column span").selectOption("2");
  await expect.poll(async () => (await node(app, [1, 0]))?.box?.colSpan).toBe(2);
  // the button now spans two columns on the board
  const width = async (id: string) => (await page.locator(`[data-frame-content] [data-aps="${id}"]`).boundingBox())!.width;
  expect(await width("g1")).toBeGreaterThan((await width("g2")) * 1.8);
});

test("a card lifts on hover with a 200 ms shadow transition", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    {
      id: "card",
      type: "box",
      origin: "added",
      layout: { mode: "flex", direction: "column", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
      style: { background: "$color.card", radius: "$radius.xl", shadow: "$shadow.sm" },
      children: [{ id: "title", type: "text", origin: "added", text: "A card" }],
    },
  ]);
  const card = page.locator('[data-frame-content] [data-aps="card"]');
  const shadow = () => card.evaluate((el) => getComputedStyle(el).boxShadow);
  const resting = await shadow();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await clickElement(page, "title");
  await page.keyboard.press("Escape"); // its parent: the card
  await expect(inspector.getByText("box", { exact: true })).toBeVisible();

  // Edit for: Hover — the board shows the card hovered, and edits go to the hover state
  await inspector.getByRole("radiogroup", { name: "State" }).getByText("Hover").click();
  await expect(page.getByTestId("node-selection").first()).toContainText("Hover");
  await inspector.getByLabel("Shadow", { exact: true }).selectOption("lg");
  await expect.poll(async () => (await node(app, [0]))?.overrides).toEqual([{ when: { state: "hover" }, style: { shadow: "$shadow.lg" } }]);
  await expect.poll(shadow).not.toBe(resting);

  // the transition belongs to the card itself (it runs into and out of hover)
  await inspector.getByLabel("Animate").selectOption("shadow");
  await inspector.getByRole("radio", { name: "200" }).click();
  await inspector.getByRole("radio", { name: "Out" }).click();
  await expect.poll(async () => (await node(app, [0]))?.style?.transition).toEqual({ property: "shadow", duration: 200, easing: "out" });

  // back to the default state: the board shows the card at rest
  await inspector.getByRole("radiogroup", { name: "State" }).getByText("Default").click();
  await expect.poll(shadow).toBe(resting);
});
