import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("design checks find problems, fix them, and remember what is ignored", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get("Home")).toBeDefined();

  // a page with problems (written on disk; the board follows)
  const { id, current } = (await app.readScreens()).get("Home")!;
  current.children = [
    { id: "faint", type: "text", origin: "added", text: "Barely readable", style: { color: "#d4d4d8" } },
    { id: "deep", type: "text", origin: "added", text: "Deep heading", semantic: { role: "heading", level: 3 } },
    { id: "pic", type: "image", origin: "added", src: "https://example.com/a.png" },
  ];
  await writeFile(join(app.dataDir, `frames/${id}/current.json`), JSON.stringify(current, null, 2));
  // the screen shows how many problems it has; the badge opens its checks
  await page.getByRole("button", { name: "3 design check findings" }).click();
  const panel = page.getByRole("region", { name: "Design checks" });
  await expect(panel.getByText("Check design: Home")).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(4); // + the raw color, a hint
  await expect(panel.getByRole("listitem", { name: /^Text contrast/ })).toBeVisible();

  // Fix: the faint text gets a readable color token
  await panel.getByRole("listitem", { name: /^Text contrast/ }).getByRole("button", { name: /^Fix/ }).click();
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children[0].style?.color).toMatch(/^\$color\./);
  await expect(panel.getByRole("listitem", { name: /^Text contrast/ })).toHaveCount(0);

  // the heading becomes the H1
  await panel.getByRole("listitem", { name: /^Heading order/ }).getByRole("button", { name: /^Fix/ }).click();
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children[1].semantic?.level).toBe(1);

  // ignoring the missing alt text: gone from the list and the count, remembered for next time
  await panel.getByRole("listitem", { name: /^Missing alt text/ }).getByRole("button", { name: "Ignore" }).click();
  await expect(panel.getByRole("listitem", { name: /^Missing alt text/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /design check findings/ })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await readFile(join(app.dataDir, ".cache", "ui.json"), "utf8").catch(() => "{}")).ignoredChecks).toHaveLength(1);
});

test("responsive help: stack on phones, visibility per size, every size side by side", async ({ blankBoard: page, blankApp: app }) => {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Row", exact: true }).click();
  const row = async () => (await app.readScreens()).get("Home")?.current.children[0];

  await page.getByRole("button", { name: "Stack on phones" }).click();
  await expect.poll(async () => (await row())?.layout?.direction).toBe("column");
  await expect(page.getByText("Stacked on phones, side by side from tablets up")).toBeVisible();
  // the inspector shows what differs per size, and resets it
  await expect(page.getByText("Tablets and up (md)")).toBeVisible();

  // hidden on desktops only
  await page.getByRole("button", { name: "Show on desktop" }).click();
  await expect.poll(async () => (await row())?.overrides).toContainEqual({ when: { viewport: "lg" }, hidden: true });

  await page.getByRole("button", { name: "Reset to all sizes" }).first().click();
  await expect.poll(async () => (await row())?.overrides?.some((o: { layout?: { direction?: string } }) => o.layout?.direction)).toBeFalsy();

  // the screen at every size
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show all sizes" }).click();
  await expect.poll(async () => (await app.readBoard()).items.filter((i) => i.type === "frame").length).toBe(3);
});
