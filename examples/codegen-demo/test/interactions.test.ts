/**
 * The interactive components work in the generated landing apps (a CSS app and a Motion app), with
 * the mouse and with the keyboard: the mobile menu (a drawer), the dialog, the dropdown menu, the
 * questions (accordion), the tabs and the carousel; the testimonials come from their data file.
 */
import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, LANDING_APPS } from "../src/apps";
import { serveApp } from "./serve";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

let browser: Browser;
const servers: Server[] = [];
const bases: Record<string, string> = {};

beforeAll(async () => {
  for (const [kind, dir] of Object.entries(LANDING_APPS)) {
    const app = join(FIXTURES, dir);
    execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--dir", app, "exec", "vite", "build", "--logLevel", "error"], { stdio: "inherit", shell: process.platform === "win32" });
    bases[kind] = await serveApp(app, servers);
  }
  browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
}, 180_000);
afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
});

const isOpen = (page: Page, id: string) => page.locator(`#${id}`).evaluate((el) => el.matches(":popover-open"));
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");

describe.each(Object.keys(LANDING_APPS))("%s app", (kind) => {
  it("the mobile menu: opens from the menu button, slides in from the right, closes with Esc or its button", async () => {
    const page = await browser.newPage({ viewport: PHONE });
    await page.goto(bases[kind]!);
    const menuButton = page.getByRole("button", { name: "Menu", exact: true });
    await menuButton.click();
    expect(await isOpen(page, "mobile-menu")).toBe(true);
    const drawer = page.getByRole("dialog", { name: "Mobile menu" });
    await expect.poll(async () => {
      const box = (await drawer.boundingBox())!;
      return [Math.round(box.x + box.width), Math.round(box.height)];
    }).toEqual([PHONE.width, PHONE.height]);
    expect(await drawer.getByRole("link", { name: "Pricing" }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await isOpen(page, "mobile-menu")).toBe(false);
    // keyboard: open, Tab goes into the menu, its close button closes it and focus goes back
    await menuButton.focus();
    await page.keyboard.press("Enter");
    expect(await isOpen(page, "mobile-menu")).toBe(true);
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("Close menu");
    await page.keyboard.press("Enter");
    expect(await isOpen(page, "mobile-menu")).toBe(false);
    expect(await focused(page)).toBe("Menu");
    await page.close();
  });

  it("the dialog: opens from the call to action over a dimmed page, closes with Cancel or Esc", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(bases[kind]!);
    await page.getByRole("button", { name: "Start for free" }).click();
    const dialog = page.getByRole("dialog", { name: "Dialog" });
    await expect.poll(() => isOpen(page, "dialog")).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - DESKTOP.width / 2)).toBeLessThan(2);
    expect(Math.round(box.width)).toBe(480);
    expect(await page.locator("#dialog").evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor)).toBe("rgba(0, 0, 0, 0.4)");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await isOpen(page, "dialog")).toBe(false);
    await page.getByRole("button", { name: "Start for free" }).click();
    await page.keyboard.press("Escape");
    expect(await isOpen(page, "dialog")).toBe(false);
    await page.close();
  });

  it("questions open and close (accordion), with the mouse and with the keyboard", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(bases[kind]!);
    const first = page.getByRole("button", { name: "Is there a free plan?" });
    const second = page.getByRole("button", { name: "Can I cancel anytime?" });
    await expect.poll(() => first.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => page.getByText("Yes. Start for free and upgrade when your team grows.").isVisible()).toBe(true);
    await expect.poll(() => page.getByText("Of course. Cancel with one click, no questions asked.").isVisible()).toBe(false);
    await second.click();
    await expect.poll(() => second.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => page.getByText("Of course. Cancel with one click, no questions asked.").isVisible()).toBe(true);
    await first.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => first.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(() => page.getByText("Yes. Start for free and upgrade when your team grows.").isVisible()).toBe(false);
    await page.close();
  });

  it("the testimonials come from their data, one card each", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(bases[kind]!);
    for (const name of ["Maya Patel", "Jonas Weber", "Sara Lind"]) await expect.poll(() => page.getByText(name, { exact: true }).count()).toBe(1);
    await page.close();
  });

  it("tabs switch their panel; the dropdown opens below its button; the carousel scrolls with the keyboard and snaps", async () => {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(`${bases[kind]}/components`);
    const details = page.getByRole("tab", { name: "Details" });
    await expect.poll(() => page.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => page.getByText("The details: sizes, materials, what is included.").isVisible()).toBe(false);
    await details.click();
    await expect.poll(() => details.getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => page.getByText("The details: sizes, materials, what is included.").isVisible()).toBe(true);
    await expect.poll(() => page.getByText("What it is and who it is for, in a sentence or two.").isVisible()).toBe(false);
    await page.getByRole("tab", { name: "Reviews" }).focus();
    await page.keyboard.press(" ");
    await expect.poll(() => page.getByText("What customers say about it.").isVisible()).toBe(true);

    const account = page.getByRole("button", { name: "Account" });
    await account.click();
    expect(await isOpen(page, "dropdown-menu")).toBe(true);
    const trigger = (await account.boundingBox())!;
    const menu = (await page.locator("#dropdown-menu").boundingBox())!;
    expect(Math.round(menu.y - (trigger.y + trigger.height))).toBe(8);
    expect(Math.round(menu.x)).toBe(Math.round(trigger.x));
    await page.keyboard.press("Escape");
    expect(await isOpen(page, "dropdown-menu")).toBe(false);

    const carousel = page.getByRole("region", { name: "Carousel" });
    await carousel.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // it snaps to a card: the scroll position is a whole number of cards (320 px + 24 px gap)
    await expect.poll(() => carousel.evaluate((el) => el.scrollLeft), { timeout: 3000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect((await carousel.evaluate((el) => el.scrollLeft)) % 344).toBe(0);
    await page.close();
  });
});
