import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("shows the demo frames rendered from IR, responsive per placement", async ({ board }) => {
  await expect(board.getByText("Simple pricing for every team")).toHaveCount(2);
  await expect(board.getByText("Contact us", { exact: true })).toBeVisible();
  await expect(board.getByText("Navbar → Contact")).toBeVisible();

  // The same frame at desktop and mobile width: md:grid-cols-3 applies only to the desktop one.
  const columns = await board.locator('[data-aps="n_plans"]').evaluateAll((grids) =>
    grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length).sort(),
  );
  expect(columns).toEqual([1, 3]);
});

test("creates, edits, moves, undoes and redoes a note", async ({ board, app }) => {
  await board.keyboard.press("n");
  const canvas = board.getByTestId("canvas");
  await canvas.click({ position: { x: 150, y: 700 } });
  await expect(board.locator("textarea[data-no-drag]")).toBeFocused();
  await board.keyboard.type("Hello from e2e");
  await board.keyboard.press("Control+Enter");

  const findNote = async () => (await app.readBoard()).items.find((i) => i.text === "Hello from e2e");
  await expect.poll(findNote).toBeTruthy();
  const created = (await findNote())!;

  const note = board.locator(`[data-item-id="${created.id}"]`);
  const box = (await note.boundingBox())!;
  await board.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await board.mouse.down();
  await board.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await board.mouse.up();
  await expect.poll(async () => (await findNote())!.x).toBeGreaterThan(created.x!);
  const moved = (await findNote())!;

  await board.keyboard.press("Control+z");
  await expect.poll(async () => (await findNote())!.x).toBe(created.x);
  await board.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await findNote())!.x).toBe(moved.x);
});

test("keeps board changes across reloads", async ({ board, app }) => {
  await board.keyboard.press("s");
  const canvas = board.getByTestId("canvas");
  const box = (await canvas.boundingBox())!;
  await board.mouse.move(box.x + 60, box.y + 600);
  await board.mouse.down();
  await board.mouse.move(box.x + 260, box.y + 760, { steps: 6 });
  await board.mouse.up();
  await expect.poll(async () => (await app.readBoard()).items.filter((i) => i.type === "section").length).toBe(2);

  await board.reload();
  await expect(board.getByText("Section", { exact: true })).toBeVisible();
});

test("deleting a frame placement removes its arrows", async ({ board, app }) => {
  // Screens are selected by their header; clicks inside select elements.
  await board.locator('[data-item-id="b_contact_desktop"] span', { hasText: "Contact" }).first().click();
  await board.keyboard.press("Delete");
  await expect.poll(async () => (await app.readBoard()).items.map((i) => i.id)).not.toContain("b_arrow_contact");
  expect((await app.readBoard()).items.map((i) => i.id)).not.toContain("b_contact_desktop");
  await expect(board.getByText("Navbar → Contact")).toHaveCount(0);
});

test("reloads when files change on disk", async ({ board, app }) => {
  await board.waitForTimeout(500); // let the watcher settle
  await writeFile(
    join(app.dataDir, "board.json"),
    `${JSON.stringify({ items: [{ type: "note", id: "b_external", x: 0, y: 0, text: "Written by git" }] }, null, 2)}\n`,
  );
  await expect(board.getByText("Written by git")).toBeVisible({ timeout: 10_000 });
  await expect(board.getByText("Navbar → Contact")).toHaveCount(0);
});

test("draws an arrow between items and resizes a note", async ({ board, app }) => {
  const note = board.locator('[data-item-id="b_note_pricing"]');
  const frame = board.locator('[data-item-id="b_contact_desktop"]');
  const from = (await note.boundingBox())!;
  const to = (await frame.boundingBox())!;

  await board.keyboard.press("a");
  await board.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await board.mouse.down();
  await board.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await board.mouse.up();
  await expect
    .poll(async () => (await app.readBoard()).items.filter((i) => i.type === "arrow").length)
    .toBe(2);
  const arrows = (await app.readBoard()).items.filter((i) => i.type === "arrow") as unknown as { from: { itemId: string }; to: { itemId: string } }[];
  expect(arrows.at(-1)).toMatchObject({ from: { itemId: "b_note_pricing" }, to: { itemId: "b_contact_desktop" } });

  await note.click();
  const handle = note.locator("[data-handle]");
  const h = (await handle.boundingBox())!;
  await board.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await board.mouse.down();
  await board.mouse.move(h.x + 60, h.y + 40, { steps: 5 });
  await board.mouse.up();
  await expect
    .poll(async () => ((await app.readBoard()).items.find((i) => i.id === "b_note_pricing") as { w?: number }).w)
    .toBeGreaterThan(300);
});
