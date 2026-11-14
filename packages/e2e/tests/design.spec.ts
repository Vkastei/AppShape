import { clickInScreen, expect, selectedLabel, test } from "./fixtures";

/** Designs a small two-screen app from scratch, the core use case of AppShape. */
test("designs, links and clicks through a two-screen app from scratch", async ({ blankBoard: page, blankApp: app }) => {
  // Screen 1 with a heading and a button
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  const insert = async (kind: string) => {
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
  };
  await insert("Heading");
  await expect(selectedLabel(page)).toHaveText("Heading");

  // Inline text editing
  await clickInScreen(page, "Heading", { double: true });
  await expect(page.getByTestId("text-editor")).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Build better habits");
  await page.keyboard.press("Enter");

  // Inspector: design-system font size
  await page.getByLabel("Font size").selectOption("5xl");

  await page.keyboard.press("Escape"); // select the screen root
  await insert("Button");
  await clickInScreen(page, "Button", { double: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Start today");
  await page.keyboard.press("Enter");

  // Screen 2
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Today");
  await page.getByRole("button", { name: "Create screen" }).click();
  await insert("Card");

  // Link the button to screen 2: a flow appears on the board
  await page.getByRole("button", { name: "Home" }).first().click();
  await clickInScreen(page, "Start today");
  await expect(selectedLabel(page)).toHaveText("Button");
  await page.getByLabel("On click").selectOption("screen");
  await page.getByLabel("Target screen").selectOption({ label: "Today (/today)" });
  await expect(page.getByTestId("flow")).toHaveCount(1);

  // Drag & drop: move the button above the heading
  const button = (await page.locator("[data-frame-content] button[data-aps]").first().boundingBox())!;
  const heading = (await page.locator("[data-frame-content] [data-aps]", { hasText: "Build better habits" }).last().boundingBox())!;
  await page.mouse.move(button.x + 5, button.y + button.height / 2);
  await page.mouse.down();
  await page.mouse.move(heading.x + 20, heading.y + 3, { steps: 10 });
  await page.mouse.up();

  // Saved as design data
  await expect
    .poll(async () => {
      const home = (await app.readScreens()).get("Home")?.current;
      return home?.children.map((c: { type: string }) => c.type);
    })
    .toEqual(["button", "text"]);
  const home = (await app.readScreens()).get("Home")!.current;
  const today = (await app.readScreens()).get("Today")!;
  expect(home.children[0]).toMatchObject({ type: "button", targetFrameId: today.id, children: [{ text: "Start today" }] });
  expect(home.children[1]).toMatchObject({ text: "Build better habits", style: { fontSize: "$fontSize.5xl" } });

  // Prototype: the button navigates
  await page.getByRole("button", { name: "Play Home" }).click();
  await expect(page.getByTestId("prototype-screen")).toHaveText("Home");
  await clickInScreen(page, "Start today", { scope: "[role=dialog]" });
  await expect(page.getByTestId("prototype-screen")).toHaveText("Today");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("prototype-screen")).toHaveText("Home");
  await page.keyboard.press("Escape");

  // Undo the drag, then reload: everything else persisted
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children.map((c: { type: string }) => c.type)).toEqual(["text", "button"]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Today" }).first()).toBeVisible();
  await expect(page.getByTestId("flow")).toHaveCount(1);
});

test("edits the design system and uses it in the inspector", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("tab", { name: "Design" }).click();
  await page.getByLabel("New color name").fill("brand");
  await page.getByLabel("New color value").fill("#0f766e");
  await page.getByRole("button", { name: "Add color" }).click();
  await expect.poll(async () => (await app.readTokens()).groups.color?.brand).toBe("#0f766e");

  await page.getByRole("tab", { name: "Screens" }).click();
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Settings");
  await page.getByLabel("Screen type").selectOption("phone");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Fill" }).click();
  await page.getByRole("button", { name: "brand", exact: true }).click();
  await expect.poll(async () => (await app.readScreens()).get("Settings")?.current.style?.background).toBe("$color.brand");

  // Undo the fill, then the color
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await app.readScreens()).get("Settings")?.current.style?.background).toBe("$color.white");
});

test("selects elements, keyboard structure editing and layers", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("List");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click();
  await page.keyboard.press("Control+d"); // duplicate
  await page.keyboard.press("Control+g"); // wrap in a stack
  await expect(selectedLabel(page)).toHaveText("Stack");
  await page.keyboard.press("Enter"); // into the stack
  await page.keyboard.press("Delete");
  const children = async () => (await app.readScreens()).get("List")?.current.children.map((c: { type: string; children?: unknown[] }) => `${c.type}${c.children ? `(${c.children.length})` : ""}`);
  await expect.poll(children).toEqual(["text", "box(0)"]);

  await page.getByRole("tab", { name: "Layers" }).click();
  await expect(page.getByRole("tree", { name: "Layers of List" })).toBeVisible();
  await page.getByRole("treeitem", { name: "Text" }).first().click();
  await expect(selectedLabel(page)).toHaveText("Text");
});
