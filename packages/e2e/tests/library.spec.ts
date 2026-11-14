import { expect, test } from "./fixtures";

test("builds pages from the library: templates, dragged sections, and a screen with its own theme", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  const screens = () => app.readScreens();
  const sectionNames = async (name: string) => ((await screens()).get(name)?.current.children ?? []).map((c: { name?: string }) => c.name);

  // a new screen from a page template
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByLabel("Start from").selectOption("pricing");
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(() => sectionNames("Home")).toEqual(["Header", "Pricing", "FAQ", "Call to action", "Footer"]);
  // the starter components it uses came along, once each
  const components = [...(await screens()).keys()].filter((n) => ["Button", "Card", "Badge", "Accordion item", "Nav link"].includes(n));
  expect(components.sort()).toEqual(["Accordion item", "Badge", "Button", "Card", "Nav link"]);

  // drag a section from the library between two sections of the screen
  await page.getByRole("tab", { name: "Library" }).click();
  const logos = page.getByRole("article", { name: "Section Logo strip" });
  // (the header brought its mobile menu, an overlay screen, along)
  const homeFrame = (await screens()).get("Home")!.id;
  const homePlacement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === homeFrame)!.id;
  const home = page.locator(`[data-frame-content="${homePlacement}"]`);
  const screen = (await home.boundingBox())!;
  const pricing = (await home.locator("section[data-aps]").first().boundingBox())!;
  await logos.dragTo(home, { targetPosition: { x: screen.width / 2, y: pricing.y - screen.y + 4 } });
  await expect.poll(() => sectionNames("Home")).toEqual(["Header", "Logos", "Pricing", "FAQ", "Call to action", "Footer"]);

  // a page template dropped onto the empty board becomes a new screen there
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.getByRole("group", { name: "Library category" }).getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("article", { name: "Page template Contact page" }).dragTo(page.getByTestId("canvas"), { targetPosition: { x: 12, y: canvas.height - 40 } });
  await expect.poll(() => sectionNames("Contact")).toEqual(["Header", "Contact", "FAQ", "Newsletter", "Footer"]);

  // + adds a section to the selected screen, after the section the selection is in
  await page.getByRole("group", { name: "Library category" }).getByRole("button", { name: "Stats" }).click();
  await page.getByRole("button", { name: "Add Numbers" }).click();
  await expect.poll(async () => (await sectionNames("Contact")).length).toBe(6);

  // the Contact screen gets its own theme; Home keeps the project's
  await page.keyboard.press("Escape"); // from the new section to the screen
  await page.getByRole("button", { name: "Own theme…" }).click();
  const dialog = page.getByRole("dialog", { name: "Theme starter" });
  await expect(dialog.getByRole("radio", { name: "Only Contact" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Brand color #e11d48" }).click();
  await dialog.getByRole("button", { name: "Apply theme" }).click();
  await expect(dialog).toBeHidden();
  const contactId = (await screens()).get("Contact")!.id;
  const tokens = async () => (await app.readTokens()) as { groups: Record<string, Record<string, string>>; themes?: Record<string, { name: string; groups: Record<string, Record<string, string>> }> };
  await expect.poll(async () => (await tokens()).themes?.contact?.groups.color?.brand).toBe("#e11d48");
  expect((await tokens()).groups.color?.brand).toBe("#4f46e5");
  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(`${app.dataDir}/frames/${contactId}/frame.json`, "utf8"));
  expect(meta.theme).toBe("contact");
  // on the board, the Contact screen's buttons are red, Home's stay indigo
  const board = await app.readBoard();
  const placement = (frameId: string) => (board.items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  const homeId = (await screens()).get("Home")!.id;
  const primaryButton = (frameId: string) => page.locator(`[data-frame-content="${placement(frameId)}"]`).locator("header button").first();
  const color = (frameId: string) => primaryButton(frameId).evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => color(contactId)).toBe("rgb(225, 29, 72)");
  expect(await color(homeId)).toBe("rgb(79, 70, 229)");
});
