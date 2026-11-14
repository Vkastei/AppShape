import type { Page } from "@playwright/test";
import { type AppShapeApp, expect, test } from "./fixtures";

/** A new screen made from a page template (with the sections' starter components and overlays). */
async function screenFrom(page: Page, app: AppShapeApp, name: string, template: string) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill(name);
  await page.getByLabel("Start from").selectOption(template);
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get(name)).toBeDefined();
}

const prototype = (page: Page) => page.getByRole("dialog", { name: /^Prototype/ });

test("the header's menu button opens the mobile menu (a drawer) in the prototype; questions open and close", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  // the header brought its mobile menu: an overlay screen, opened by the menu button
  const screens = await app.readScreens();
  const menu = screens.get("Mobile menu")!;
  expect(menu).toBeDefined();
  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(`${app.dataDir}/frames/${menu.id}/frame.json`, "utf8"));
  expect(meta.overlay).toBe(true);
  await expect(page.getByText("overlay", { exact: true })).toBeVisible();

  // phones see the menu button: show all sizes, then try it on a phone
  await page.keyboard.press("Control+k");
  await page.getByRole("option", { name: /Show all sizes/ }).click();
  await page.getByRole("button", { name: "Play Home" }).first().click();
  const view = prototype(page);
  await view.getByLabel("Prototype viewport").selectOption({ label: "mobile · 390px" });
  await view.locator('[data-aps-action*="\\"open\\""]').first().click();
  const drawer = view.getByRole("dialog", { name: "Mobile menu" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Pricing")).toBeVisible();
  // its close button closes it; Esc too (the prototype stays)
  await drawer.locator('[data-aps-action*="close"]').click();
  await expect(drawer).toBeHidden();
  await view.locator('[data-aps-action*="\\"open\\""]').first().click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(view).toBeVisible();

  // a question opens when clicked, the open one closes
  const answer = view.getByText("Of course. Cancel with one click, no questions asked.");
  await expect(answer).toBeHidden();
  await view.getByText("Can I cancel anytime?").click();
  await expect(answer).toBeVisible();
  await view.getByText("Can I cancel anytime?").click();
  await expect(answer).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();
});

test("on click: open a new dialog from the inspector; repeated content from data", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const homeId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === homeId)!.id;
  const home = page.locator(`[data-frame-content="${placement}"]`);

  // the call to action's first button opens a new dialog
  const cta = home.locator("section", { hasText: "Ready to get started?" }).locator("button").first();
  const box = (await cta.boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await inspector.getByLabel("On click").selectOption("open");
  // it opens the overlay the project has (the mobile menu); a new dialog instead
  await expect(inspector.getByLabel("Overlay screen")).toHaveValue((await app.readScreens()).get("Mobile menu")!.id);
  await inspector.getByLabel("Overlay screen").selectOption({ label: "New: Dialog" });
  await expect.poll(async () => [...(await app.readScreens()).keys()]).toContain("Dialog");
  await expect(inspector.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { checked: true })).toHaveText("Modal");
  await page.getByRole("button", { name: "Play Home" }).first().click();
  const view = prototype(page);
  await view.getByText("Start for free", { exact: true }).click();
  const dialog = view.getByRole("dialog", { name: "Dialog" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("Cancel").click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();

  // repeated content: the testimonials are one card design plus data; edit an item
  await expect(home.getByText("Jonas Weber")).toBeVisible();
  // pan the board until the testimonials are in view
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let i = 0; i < 40 && (await home.getByText("Maya Patel").boundingBox())!.y > canvas.y + canvas.height - 200; i++) await page.mouse.wheel(0, 300);
  const card = (await home.getByText("Maya Patel").boundingBox())!;
  await page.mouse.dblclick(card.x + 2, card.y + card.height / 2);
  await page.keyboard.press("Escape");
  await expect(inspector.getByLabel("From data")).toHaveValue("name");
  const listNode = async () => {
    let found: { id: string; items: Record<string, string>[] } | undefined;
    const walk = (n: { type: string; items?: Record<string, string>[]; children?: unknown[]; id: string }) => {
      if (n.type === "list" && n.items) found ??= n as never;
      for (const c of (n.children ?? []) as never[]) walk(c);
    };
    walk((await app.readScreens()).get("Home")!.current);
    return found!;
  };
  expect((await listNode()).items.map((i) => i.name)).toEqual(["Maya Patel", "Jonas Weber", "Sara Lind"]);
  // the board shows each item; double-click the first name and edit it: the data changes
  const name = (await home.getByText("Maya Patel").boundingBox())!;
  await page.mouse.dblclick(name.x + 6, name.y + name.height / 2);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Maya P.");
  await editor.press("Enter");
  await expect.poll(async () => (await listNode()).items[0]!.name).toBe("Maya P.");
  await expect(home.getByText("Maya P.", { exact: true })).toBeVisible();
});

test("prototype transitions: a screen pushes in, and back the other way", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  await screenFrom(page, app, "About", "about");
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  // About (selected: it's new) arrives with a push
  await inspector.getByRole("radiogroup", { name: "Screen transition" }).getByRole("radio", { name: "Push" }).click();
  await expect.poll(async () => {
    const id = (await app.readScreens()).get("About")!.id;
    return JSON.parse(await (await import("node:fs/promises")).readFile(`${app.dataDir}/frames/${id}/frame.json`, "utf8")).transition;
  }).toBe("push");
  // Home's hero button goes to About
  await page.getByRole("button", { name: "Home" }).first().click();
  const homeId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === homeId)!.id;
  const hero = page.locator(`[data-frame-content="${placement}"]`).locator("button", { hasText: "Book a demo" });
  const box = (await hero.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await inspector.getByLabel("On click").selectOption("screen");
  await inspector.getByLabel("Target screen").selectOption({ label: "About (/about)" });

  await page.getByRole("button", { name: "Play Home" }).first().click();
  const view = prototype(page);
  await view.getByText("Book a demo", { exact: true }).click();
  await expect(view.getByTestId("prototype-screen")).toHaveText("About");
  // the new page moves in from the right while Home moves out
  const moving = () => view.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => JSON.stringify((a.effect as KeyframeEffect).getKeyframes()).includes("translate")).length);
  await expect.poll(moving, { timeout: 1000, intervals: [20] }).toBeGreaterThanOrEqual(2);
  await view.getByRole("button", { name: "Back" }).click();
  await expect(view.getByTestId("prototype-screen")).toHaveText("Home");
});
