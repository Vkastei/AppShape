/** Board steps the scenarios share (the same clicks a person makes). */
import { expect, type Page } from "@playwright/test";
import type { Sandbox } from "./harness";

export async function openBoard(page: Page, box: Sandbox): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(box.url);
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByTitle("Connected")).toBeVisible();
  return errors;
}

/** A new screen from a page template (the sidebar's New screen). */
export async function screenFromTemplate(page: Page, name: string, template: string) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill(name);
  await page.getByLabel("Start from").selectOption(template);
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect(page.locator("[data-item-id] [data-frame-content]").first()).toBeVisible();
}

/** Whole-text match (not an element that only contains the text). */
const exactly = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);

/** Brings a screen into view, as a person does: its entry in the sidebar's Screens list. */
export async function showScreen(page: Page, name: string) {
  await page.getByRole("tab", { name: "Screens" }).click().catch(() => {});
  // the entry shows the name, then the route and sizes
  const starts = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w ])`);
  await page.getByTitle("Show on board (double-click to rename)").filter({ hasText: starts }).first().click();
  // the camera moves; screens outside the view aren't rendered until it's there
  await page.waitForTimeout(700);
}

/**
 * Clicks an element inside a rendered screen (screens are inert, so by coordinates). With
 * `screen`, that screen is brought into view first and its topmost match is taken (the same text
 * can be on several screens); without, the last one on the board.
 */
export async function clickInScreen(page: Page, text: string, options: { double?: boolean; screen?: string } = {}) {
  if (options.screen) await showScreen(page, options.screen);
  // with a screen: inside its placement (found by the name on its label), the topmost match
  const scope = options.screen ? page.locator("[data-item-id]").filter({ has: page.locator("span.font-semibold", { hasText: exactly(options.screen) }) }).first() : page;
  const matches = scope.locator("[data-frame-content] [data-aps]", { hasText: exactly(text) });
  await expect(matches.first()).toBeAttached();
  let box: { x: number; y: number; width: number; height: number } | undefined;
  for (const element of await matches.all()) {
    const b = await element.boundingBox();
    if (!b || b.width === 0) continue;
    if (!box || (options.screen ? b.y < box.y : b.y > box.y)) box = b;
  }
  if (!box) throw new Error(`"${text}" isn't visible on the board`);
  const x = box.x + Math.min(box.width / 2, 12);
  const y = box.y + box.height / 2;
  if (options.double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
}

/** Replaces a text on a screen by typing over it. */
export async function retext(page: Page, from: string, to: string, screen?: string) {
  await clickInScreen(page, from, { double: true, ...(screen && { screen }) });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(to);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-frame-content] [data-aps]", { hasText: to }).first()).toBeVisible();
}

/** A note for the coding agent on the selected element. */
export async function noteOn(page: Page, text: string, note: { kind: string; text: string }, screen?: string) {
  await clickInScreen(page, text, screen ? { screen } : {});
  await page.getByLabel("Note kind").selectOption(note.kind);
  await page.getByLabel("Note text").fill(note.text);
  await page.getByLabel("Note text").press("Enter");
}

/** What the inspector says is selected (its heading). */
export const selected = async (page: Page) => ((await page.locator("aside[aria-label=Inspector] .text-sm").first().textContent()) ?? "").trim();

const applyDialog = (page: Page) => page.getByRole("dialog", { name: "Apply to code" });

/** The first apply of a new app: pick the stack, create it. */
export async function createApp(page: Page, stack: string) {
  await page.getByRole("button", { name: "Apply to code" }).click();
  const dialog = applyDialog(page);
  await expect(dialog.getByText("There is no app in")).toBeVisible();
  await dialog.getByLabel(stack).check();
  await dialog.getByRole("button", { name: "Preview code" }).click();
  await dialog.getByRole("button", { name: "Create app" }).click();
  await expect(dialog.getByText(/^Created the app: \d+ files written/)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

/**
 * *Apply to code* on an existing app: what it writes, and the agent changeset with the sentence
 * the board tells the person to give their agent (read from the board, as they would copy it).
 */
export async function applyToCode(page: Page): Promise<{ written: string; changesetId?: string; sentence?: string; tasks: number }> {
  await page.getByRole("button", { name: "Apply to code" }).click();
  const dialog = applyDialog(page);
  await dialog.getByRole("button", { name: /^Apply \d+ file change|^Apply/ }).click();
  const done = dialog.getByText(/^(Updated the code|Created the app)/);
  await expect(done).toBeVisible({ timeout: 60_000 });
  const written = (await done.textContent()) ?? "";
  const handoff = dialog.getByText(/tasks? for your coding agent \(cs_/);
  if (!(await handoff.isVisible())) return { written, tasks: 0 };
  const head = (await handoff.textContent()) ?? "";
  const changesetId = /\((cs_[A-Za-z0-9]+)\)/.exec(head)?.[1];
  const tasks = Number(/(\d+) tasks?/.exec(head)?.[1] ?? 0);
  const sentence = ((await dialog.locator("em").filter({ hasText: "AppShape changeset" }).first().textContent()) ?? "").replace(/^["“]|["”]$/g, "");
  return { written, tasks, ...(changesetId && { changesetId }), ...(sentence && { sentence }) };
}

/** Keeps the Apply dialog open on its *Agent changesets* list (where the board shows the agent's progress). */
export async function showAgentChangesets(page: Page) {
  const dialog = applyDialog(page);
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Apply to code" }).click();
  await expect(dialog).toBeVisible();
}
