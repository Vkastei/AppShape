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
  return id as string;
}

const home = async (app: AppShapeApp) => (await app.readScreens()).get("Home")?.current;
const text = (id: string, value: string) => ({ id, type: "text", origin: "added", text: value });
const card = (id: string, title: string) => ({ id, type: "box", origin: "added", layout: { mode: "flex", direction: "column", padding: { top: 16, right: 16, bottom: 16, left: 16 } }, style: { background: "$color.white" }, children: [text(`${id}t`, title)] });
/** Animations running on a board element (its own or, with `child`, its n-th child's). */
const animations = (page: Page, scope: string, id: string) =>
  page.locator(`${scope} [data-aps="${id}"]`).evaluate((el) => el.getAnimations().map((a) => ({ delay: Number(a.effect?.getTiming().delay ?? 0), state: a.playState })));

test("entrances: pick one, children one by one, preview it, play it on the board and in the prototype", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    { id: "grid", type: "box", origin: "added", layout: { mode: "grid", columns: 3, gap: 16, padding: { top: 24, right: 24, bottom: 24, left: 24 } }, children: [card("c1", "Fast"), card("c2", "Secure"), card("c3", "Friendly")] },
  ]);
  const box = (await page.locator('[data-frame-content] [data-aps="grid"]').boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const appear = inspector.getByRole("group", { name: "Appear" });

  // hovering a choice plays it on the board (the design doesn't change)
  await appear.getByRole("button", { name: "Slide up" }).hover();
  await expect.poll(async () => (await animations(page, "[data-frame-content]", "grid")).length).toBe(1);
  expect((await home(app))?.children[0].style?.motion).toBeUndefined();

  await appear.getByRole("button", { name: "Slide up" }).click();
  await expect.poll(async () => (await home(app))?.children[0].style?.motion).toEqual({ preset: "slide-up", trigger: "scroll" });
  await inspector.getByRole("radiogroup", { name: "Children one by one" }).getByRole("radio", { name: "100" }).click();
  // (a row's first option is named after the row: address it by its title)
  await inspector.getByRole("radiogroup", { name: "Plays" }).getByTitle("When the page opens").click();
  await expect.poll(async () => (await home(app))?.children[0].style?.motion).toEqual({ preset: "slide-up", trigger: "load", stagger: 100 });
  await expect(page.locator('[data-frame-content] [data-aps="grid"]')).toHaveAttribute("data-aps-motion", /"stagger":100/);

  // Play on the board: the cards one after another, 100 ms apart; the board ends where the design is
  await page.getByRole("button", { name: "Play animations of Home" }).click();
  await expect.poll(async () => [(await animations(page, "[data-frame-content]", "c1"))[0]?.delay, (await animations(page, "[data-frame-content]", "c3"))[0]?.delay]).toEqual([0, 200]);
  await expect.poll(async () => (await animations(page, "[data-frame-content]", "c3")).length, { timeout: 5000 }).toBe(0);
  await expect.poll(() => page.locator('[data-frame-content] [data-aps="c3"]').evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  // the command palette has it too
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("option", { name: /Preview the animation/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // the prototype runs it as the app does
  await page.getByRole("button", { name: "Play Home" }).click();
  const prototype = page.getByRole("dialog", { name: "Prototype: Home" });
  await expect.poll(async () => (await animations(page, '[role="dialog"]', "c2"))[0]?.delay).toBe(100);
  await page.keyboard.press("Escape");
  await expect(prototype).toBeHidden();

  // on hover: lift, with a transition so it animates
  await inspector.getByRole("radiogroup", { name: "On hover" }).getByRole("radio", { name: "Lift" }).click();
  await expect.poll(async () => (await home(app))?.children[0].overrides).toEqual([{ when: { state: "hover" }, style: { translate: { y: "-4px" } } }]);
  expect((await home(app))?.children[0].style?.transition).toEqual({ property: "default", duration: 200, easing: "out" });
  await inspector.getByRole("radiogroup", { name: "On hover" }).getByRole("radio", { name: "Grow" }).click();
  await expect.poll(async () => (await home(app))?.children[0].overrides?.[0].style).toEqual({ scale: 105 });

  // and away again
  await appear.getByRole("button", { name: "No animation" }).click();
  await expect.poll(async () => (await home(app))?.children[0].style?.motion).toBeUndefined();
});

test("prototype: an element below the fold waits until it scrolls into view", async ({ blankBoard: page, blankApp: app }) => {
  await screenWith(page, app, [
    { id: "spacer", type: "box", origin: "added", box: { height: { mode: "fixed", value: 1600 } }, children: [] },
    { id: "late", type: "box", origin: "added", layout: { padding: { top: 24, right: 24, bottom: 24, left: 24 } }, style: { motion: { preset: "fade", trigger: "scroll" } }, children: [text("lt", "Hello from below")] },
  ]);
  await page.getByRole("button", { name: "Play Home" }).click();
  const late = page.getByRole("dialog", { name: "Prototype: Home" }).locator('[data-aps="late"]');
  // waiting at its start: invisible
  await expect.poll(() => late.evaluate((el) => [el.getAnimations()[0]?.playState, getComputedStyle(el).opacity])).toEqual(["paused", "0"]);
  await late.evaluate((el) => el.scrollIntoView());
  await expect.poll(() => late.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5000 }).toBe("1");
});
