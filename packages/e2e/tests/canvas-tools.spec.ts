import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { clickInScreen, expect, selectedLabel, test } from "./fixtures";

/** The board zoom, measured on the first screen (desktop, 1280 wide). */
const zoomOf = async (page: Page) => (await page.locator("[data-frame-content]").first().boundingBox())!.width / 1280;

async function newScreenWith(page: Page, kinds: string[]) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  for (const [i, kind] of kinds.entries()) {
    if (i > 0) await page.keyboard.press("Escape"); // back to the screen root
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
  }
}

test("clicking a link flow or an arrow goes to its target", async ({ board: page }) => {
  const contact = page.locator("[data-item-id=b_contact_desktop]");
  const centerOf = async () => {
    const box = (await contact.boundingBox())!;
    const canvas = (await page.getByTestId("canvas").boundingBox())!;
    return { dx: Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2)), top: box.y - canvas.y };
  };

  // Away from both screens, then click the dashed flow (Pricing's link → Contact)
  await page.getByRole("button", { name: "Zoom out" }).click();
  const flow = page.locator("[data-flow-target]").first();
  await expect(flow).toHaveAttribute("data-flow-target", "b_contact_desktop");
  await flow.click({ force: true });
  await expect.poll(async () => (await centerOf()).dx).toBeLessThan(4);
  await expect(contact).toHaveCSS("outline-style", "solid"); // selected

  // The drawn arrow: select it and show what it points at
  await page.getByRole("button", { name: "Zoom to fit (Shift+1)" }).click();
  await page.mouse.click(5, 300); // nothing selected
  const arrow = page.locator("path[data-item-id=b_arrow_contact]");
  const box = (await arrow.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await centerOf()).dx).toBeLessThan(4);
});

test("resizes elements with handles: corners keep proportions, sides don't", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Card"]);
  await expect(selectedLabel(page)).toHaveText("Card");
  const zoom = await zoomOf(page);
  const card = async () => (await app.readScreens()).get("Home")?.current.children[0];
  const selection = page.getByTestId("node-selection");
  const before = (await selection.boundingBox())!;

  // exact sizes: without snapping (Alt)
  await page.keyboard.down("Alt");
  // Left side: width only
  const side = (await page.getByTestId("resize-w").boundingBox())!;
  await page.mouse.move(side.x + 4, side.y + 4);
  await page.mouse.down();
  await page.mouse.move(side.x + 4 + 60 * zoom, side.y + 4, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await card())?.box?.width).toEqual({ mode: "fixed", value: Math.round(before.width / zoom) - 60 });
  expect((await card())?.box?.height).toBeUndefined();

  // Corner: both, in proportion
  const afterSide = (await selection.boundingBox())!;
  const corner = (await page.getByTestId("resize-sw").boundingBox())!;
  await page.mouse.move(corner.x + 4, corner.y + 4);
  await page.mouse.down();
  await page.mouse.move(corner.x + 4 - 50 * zoom, corner.y + 4 + 5 * zoom, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await card())?.box?.height?.mode).toBe("fixed");
  const { width, height } = (await card())!.box;
  const ratio = afterSide.width / afterSide.height;
  expect(Math.abs(width.value / height.value - ratio)).toBeLessThan(0.05);

  await page.keyboard.up("Alt");

  // One undo step per resize
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await card())?.box?.height).toBeUndefined();
});

test("moves elements freely: only the element moves, from this screen size up, and goes back on request", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Button", "Heading"]);
  await expect(selectedLabel(page)).toHaveText("Heading");
  const zoom = await zoomOf(page);
  const sw = page.getByRole("switch", { name: /Move freely/ });
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("free-move-bar")).toBeVisible();

  const heading = page.locator("[data-frame-content] h2[data-aps]").first();
  const button = page.locator("[data-frame-content] button[data-aps]").first();
  const root = page.locator("[data-frame-content] .aps-frame > [data-aps]").first();
  const [start, buttonBefore, rootBefore] = [(await heading.boundingBox())!, (await button.boundingBox())!, (await root.boundingBox())!];
  const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.keyboard.down("Alt"); // exact offsets, no snapping
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 120 * zoom, grab.y + 80 * zoom, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  // a relative offset for the desktop size and up (lg); the base (phones) is unchanged
  const headingNode = async () => (await app.readScreens()).get("Home")?.current.children[1];
  await expect.poll(async () => (await headingNode())?.overrides?.[0]?.box?.position).toBe("relative");
  const node = await headingNode();
  expect(node.overrides[0].when).toEqual({ viewport: "lg" });
  expect(Math.abs(node.overrides[0].box.inset.left - 120)).toBeLessThan(2);
  expect(Math.abs(node.overrides[0].box.inset.top - 80)).toBeLessThan(2);
  expect(node.box?.position).toBeUndefined();
  // nothing else moved: the button and the screen stay as they were
  const home = (await app.readScreens()).get("Home")!.current;
  expect(home.children.map((c: { type: string }) => c.type)).toEqual(["button", "text"]);
  expect(home.box?.position).toBeUndefined();
  expect(await button.boundingBox()).toEqual(buttonBefore);
  expect((await root.boundingBox())!.height).toBeCloseTo(rootBefore.height, 0);
  const moved = (await heading.boundingBox())!;
  expect(Math.abs(moved.x - (start.x + 120 * zoom))).toBeLessThan(3);

  // the inspector shows it, and puts it back
  const placement = page.getByTestId("placement");
  await expect(placement).toContainText("lg and up");
  await placement.getByRole("button", { name: "Put back" }).click();
  await expect.poll(async () => (await headingNode())?.overrides?.[0]?.box?.inset).toBeUndefined();
  await expect.poll(async () => Math.abs((await heading.boundingBox())!.x - start.x)).toBeLessThan(2);

  // the switch ends with the element it was used on
  await clickInScreen(page, "Button");
  await expect(sw).toHaveAttribute("aria-checked", "false");

  // Ctrl-drag moves freely without the switch; arrow keys nudge
  await clickInScreen(page, "Heading");
  const again = (await heading.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.keyboard.down("Control");
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2 + 40 * zoom, again.y + again.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await headingNode())?.overrides?.[0]?.box?.inset?.left).toBeGreaterThan(30);
  const left = (await headingNode()).overrides[0].box.inset.left;
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await headingNode())?.overrides?.[0]?.box?.inset?.left).toBe(left + 1);
});

test("snaps board items to each other's edges, on both axes", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "Close the introduction" }).click();
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  for (const [x, y] of [
    [canvas.x + 200, canvas.y + 157],
    [canvas.x + 520, canvas.y + 330],
  ]) {
    await page.keyboard.press("n");
    await page.mouse.click(x!, y!);
    await page.keyboard.press("Escape");
  }
  await expect.poll(async () => (await app.readBoard()).items.filter((i) => i.type === "note").length).toBe(2);
  const [a, b] = (await app.readBoard()).items.filter((i) => i.type === "note");
  const boxA = (await page.locator(`[data-item-id="${a!.id}"]`).boundingBox())!;
  const boxB = (await page.locator(`[data-item-id="${b!.id}"]`).boundingBox())!;
  // drag B so its top is 3 px below A's top, a bit right of A
  const dy = boxA.y + 3 - boxB.y;
  const dx = boxA.x + boxA.width + 61 - boxB.x;
  await page.mouse.move(boxB.x + 20, boxB.y + 20);
  await page.mouse.down();
  await page.mouse.move(boxB.x + 20 + dx, boxB.y + 20 + dy, { steps: 8 });
  await expect(page.locator("[data-guide]").first()).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await app.readBoard()).items.find((i) => i.id === b!.id)?.y).toBe(a!.y);
  // the other axis snapped to the grid
  expect((((await app.readBoard()).items.find((i) => i.id === b!.id)!.x! % 24) + 24) % 24).toBe(0);
});

test("drops an element beside another one: both go into a new row", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Button", "Heading"]);
  const heading = (await page.locator("[data-frame-content] h2[data-aps]").first().boundingBox())!;
  const button = (await page.locator("[data-frame-content] button[data-aps]").first().boundingBox())!;
  await page.mouse.move(heading.x + 10, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.mouse.move(button.x + button.width - 4, button.y + button.height / 2, { steps: 10 });
  await expect(page.getByTestId("drop-label")).toHaveText("Beside Button");
  await page.mouse.up();
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children.map((c: { type: string }) => c.type)).toEqual(["box"]);
  const row = (await app.readScreens()).get("Home")!.current.children[0];
  expect(row.layout).toMatchObject({ mode: "flex", direction: "row" });
  expect(row.children.map((c: { type: string }) => c.type)).toEqual(["button", "text"]);
});

test("scaling a text by a corner changes its size", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Heading"]);
  const heading = page.locator("[data-frame-content] h2[data-aps]").first();
  const before = await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // the bottom-left corner (the right side of a full-width heading sits under the inspector), inwards
  const corner = (await page.getByTestId("resize-sw").boundingBox())!;
  const box = (await heading.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(corner.x + 4, corner.y + 4);
  await page.mouse.down();
  await page.mouse.move(corner.x + 4 + box.width / 4, corner.y + 4, { steps: 6 });
  await expect(page.getByTestId("size-badge")).toContainText("px text");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const text = async () => (await app.readScreens()).get("Home")?.current.children[0];
  await expect.poll(async () => (await text())?.style?.fontSize).toBe(`${Math.round(before * 0.75)}px`);
  // the box stays automatic: no fixed height
  expect((await text())?.box?.height).toBeUndefined();
});

test("fixed elements stay on their screen, like an app's header bar", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Button", "Heading"]);
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children.length).toBe(2);
  // an imported app's header: position fixed, top-0 inset-x-0 (edited on disk; the board follows)
  const { id, current } = (await app.readScreens()).get("Home")!;
  current.children[1].box = { ...current.children[1].box, position: "fixed", inset: { top: 0, left: 0, right: 0 } };
  await writeFile(join(app.dataDir, `frames/${id}/current.json`), JSON.stringify(current, null, 2));

  const heading = page.locator("[data-frame-content] h2[data-aps]").first();
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const screen = (await page.locator("[data-frame-content] .aps-frame").first().boundingBox())!;
  const header = (await heading.boundingBox())!;
  // at the top of the screen, as wide as the screen (not at the board's corner with no width)
  expect(Math.abs(header.y - screen.y)).toBeLessThan(2);
  expect(Math.abs(header.x - screen.x)).toBeLessThan(2);
  expect(Math.abs(header.width - screen.width)).toBeLessThan(2);
});

test("editing white text keeps it readable", async ({ blankBoard: page }) => {
  await newScreenWith(page, ["Heading"]);
  await page.getByRole("button", { name: "Text color", exact: true }).click();
  const custom = page.getByLabel("Text color custom");
  await custom.fill("#ffffff");
  await custom.press("Enter");
  await clickInScreen(page, "Heading", { double: true });
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  const [color, background] = await editor.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
  expect(color).toBe("rgb(255, 255, 255)");
  expect(background).not.toBe("rgb(255, 255, 255)");
});

test("picks icons from a searchable list", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Icon"]);
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  await page.getByLabel("Search icons").fill("home");
  // lucide's tags: "home" finds `house`
  await page.getByRole("option", { name: "house", exact: true }).click();
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children[0].icon).toBe("house");
  await expect(page.getByRole("button", { name: "Icon", exact: true })).toContainText("house");
});

test("shows screens in dark mode", async ({ blankBoard: page }) => {
  await newScreenWith(page, ["Text"]);
  const frame = page.locator("[data-frame-content]").first();
  const dark = page.getByRole("button", { name: /Show screens in (dark|light) mode/ });
  if ((await dark.getAttribute("title"))?.includes("light")) await dark.click(); // the system is dark
  await expect(frame.locator(".aps-frame")).not.toHaveClass(/aps-dark/);
  await page.getByRole("button", { name: "Show screens in dark mode" }).click();
  await expect(frame.locator(".aps-frame")).toHaveClass(/aps-dark/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--aps-scheme").trim())).toBe("dark");
  await page.reload();
  await expect(page.locator("[data-frame-content] .aps-frame").first()).toHaveClass(/aps-dark/);
});

test("an empty board explains the steps and starts the first screen", async ({ blankBoard: page, blankApp: app }) => {
  const intro = page.getByRole("region", { name: "How AppShape works" });
  await expect(intro).toContainText("Send to code");
  await intro.getByRole("button", { name: "Add a web page" }).click();
  await expect(intro).toBeHidden();
  await expect.poll(async () => [...(await app.readScreens()).keys()]).toEqual(["Home"]);
});

test("right-clicking the empty board opens a menu of things to add there", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "Close the introduction" }).click();
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  const menu = page.getByRole("menu", { name: "Add to the board" });

  // double-click no longer opens it
  await page.mouse.dblclick(canvas.x + 300, canvas.y + 200);
  await expect(menu).toBeHidden();
  await page.mouse.click(canvas.x + 300, canvas.y + 200, { button: "right" });
  await menu.getByRole("menuitem", { name: "Note" }).click();
  await expect(menu).toBeHidden();
  await page.keyboard.type("Remember the footer");
  await page.mouse.click(canvas.x + 40, canvas.y + canvas.height - 40);
  await expect.poll(async () => (await app.readBoard()).items.find((i) => i.type === "note")?.text).toBe("Remember the footer");

  // keys pick entries; Escape closes
  await page.mouse.click(canvas.x + 700, canvas.y + 150, { button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.mouse.click(canvas.x + 700, canvas.y + 150, { button: "right" });
  await page.keyboard.press("p");
  await expect.poll(async () => [...(await app.readScreens()).keys()]).toEqual(["Screen 1"]);
  const placement = (await app.readBoard()).items.find((i) => i.type === "frame")!;
  const note = (await app.readBoard()).items.find((i) => i.type === "note")!;
  expect(placement.x!).toBeGreaterThan(note.x!); // placed where the pointer was, right of the note
});
