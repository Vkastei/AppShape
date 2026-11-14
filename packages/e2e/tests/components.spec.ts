import type { Page } from "@playwright/test";
import { clickInScreen, type AppShapeApp, expect, selectedLabel, test } from "./fixtures";

/** Board placement of a frame by name (scope for clicks inside it). */
async function placementOf(app: AppShapeApp, name: string): Promise<string> {
  const frame = (await app.readScreens()).get(name)!;
  const item = (await app.readBoard()).items.find((i) => i.type === "frame" && (i as unknown as { frameId: string }).frameId === frame.id)!;
  return `[data-frame-content="${item.id}"]`;
}

/** Computed background of the button (in a screen) that shows `text`. */
const background = (page: Page, scope: string, text: string) =>
  page.locator(`${scope} button[data-aps]`, { hasText: text }).evaluate((el) => getComputedStyle(el).backgroundColor);

const instances = async (app: AppShapeApp) => {
  const home = (await app.readScreens()).get("Home")!.current;
  return home.children.filter((c: { type: string }) => c.type === "instance");
};

/** Builds a component, uses it twice, changes it, adds a variant and detaches an instance. */
test("makes a component and drives several instances with properties and variants", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Button", exact: true }).click();
  await clickInScreen(page, "Button", { double: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Buy now");
  await page.keyboard.press("Enter");

  // Make it a component: the button becomes an instance, the main component goes on the board
  await page.keyboard.press("Escape"); // from the label to the button
  await expect(selectedLabel(page)).toHaveText("Button");
  await page.keyboard.press("Control+Alt+k");
  await expect.poll(async () => (await app.readScreens()).get("Button")?.current.type).toBe("button");
  await expect.poll(async () => (await instances(app)).length).toBe(1);
  await expect(page.getByLabel("Component", { exact: true })).toHaveValue(/f_/);
  const home = await placementOf(app, "Home");

  // A second instance from the library; a different label via its property
  await page.getByRole("tab", { name: "Components" }).click();
  await expect(page.getByRole("button", { name: "Insert Button" })).toContainText("1 instance");
  await page.getByRole("button", { name: "Insert Button" }).click();
  await expect(page.getByRole("button", { name: "Insert Button" })).toContainText("2 instances");
  await page.getByLabel("Property label").fill("Learn more");
  await page.getByLabel("Property label").press("Enter");
  await expect(page.locator(`${home} [data-aps]`, { hasText: "Learn more" })).toHaveCount(2); // root + instance

  // Double-click a text property in an instance to edit it in place
  await clickInScreen(page, "Buy now", { double: true, scope: home });
  await expect(page.getByTestId("text-editor")).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Get started");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await instances(app)).map((i: { props: unknown }) => i.props)).toEqual([{ label: "Get started" }, { label: "Learn more" }]);

  // Edit the main component: both instances follow
  const before = await background(page, home, "Get started");
  await clickInScreen(page, "Get started", { scope: home });
  await page.getByLabel("Inspector").getByRole("button", { name: "Edit component" }).click();
  await expect(page.getByText("Main component")).toBeVisible();
  await page.getByLabel("Fill", { exact: true }).click();
  await page.getByRole("button", { name: "emerald-600" }).click();
  await page.getByRole("tab", { name: "Screens" }).click();
  await page.getByRole("button", { name: "Home" }).first().click();
  await expect.poll(() => background(page, home, "Get started")).not.toBe(before);
  const emerald = await background(page, home, "Get started");
  expect(await background(page, home, "Learn more")).toBe(emerald);

  // A variant: edits made for "secondary" only apply to instances that use it
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("list", { name: "Components" }).getByRole("button", { name: "Edit component" }).click();
  await page.getByRole("button", { name: "Add variant property" }).click();
  await page.getByLabel("Variant", { exact: true }).selectOption("variant=secondary");
  await page.getByLabel("Fill", { exact: true }).click();
  await page.getByRole("button", { name: "rose-600" }).click();
  await expect.poll(async () => (await app.readBoard()).items.filter((i) => (i as { props?: unknown }).props).length).toBe(1); // variant preview
  await page.getByRole("tab", { name: "Screens" }).click();
  await page.getByRole("button", { name: "Home" }).first().click();
  await clickInScreen(page, "Learn more", { scope: home });
  await page.getByRole("radio", { name: "secondary" }).click();
  await expect.poll(() => background(page, home, "Learn more")).not.toBe(emerald);
  expect(await background(page, home, "Get started")).toBe(emerald);

  // Detach the first instance: plain elements that look the same; undo brings the instance back
  await clickInScreen(page, "Get started", { scope: home });
  await page.keyboard.press("Control+Alt+b");
  await expect.poll(async () => (await app.readScreens()).get("Home")!.current.children.map((c: { type: string }) => c.type)).toEqual(["button", "instance"]);
  expect(await background(page, home, "Get started")).toBe(emerald);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await instances(app)).length).toBe(2);

  // Everything is saved
  await page.reload();
  await expect(page.locator(`${home} [data-aps]`, { hasText: "Learn more" }).last()).toBeVisible();
  await expect.poll(() => background(page, home, "Learn more")).not.toBe(emerald);
  const component = (await app.readScreens()).get("Button")!;
  expect(component.current.overrides).toEqual([{ when: { prop: { name: "variant", value: "secondary" } }, style: { background: "$color.rose-600" } }]);
});

test("refuses to put a component inside itself and drops components from the library", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Card", exact: true }).click();
  await page.getByRole("button", { name: "Create component" }).click();
  await expect.poll(async () => (await app.readScreens()).get("Card")?.current.type).toBe("box");

  // Inside the main component, inserting the component itself is refused
  await page.getByLabel("Inspector").getByRole("button", { name: "Edit component" }).click();
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Insert Card" }).click();
  await expect(page.getByRole("status")).toContainText("A component can't contain itself.");

  // Drag from the library onto the screen
  await page.getByRole("tab", { name: "Screens" }).click();
  await page.getByRole("button", { name: "Home" }).first().click();
  await page.getByRole("tab", { name: "Components" }).click();
  const home = await placementOf(app, "Home");
  const target = (await page.locator(home).boundingBox())!;
  await page.getByRole("button", { name: "Insert Card" }).dragTo(page.locator(home), { targetPosition: { x: target.width / 2, y: target.height - 20 } });
  await expect.poll(async () => (await instances(app)).length).toBe(2);
});
