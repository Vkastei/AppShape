import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type AppShapeApp, expect, test } from "./fixtures";

// AppShape's AI with the server's built-in fake model: nothing leaves the computer, no key needed.
test.beforeAll(() => {
  process.env.APPSHAPE_FAKE_AI = "1";
});
test.afterAll(() => {
  delete process.env.APPSHAPE_FAKE_AI;
});

async function screenFrom(page: Page, app: AppShapeApp, name: string, template: string) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill(name);
  await page.getByLabel("Start from").selectOption(template);
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get(name)).toBeDefined();
}

const requests = async (app: AppShapeApp) => {
  const names = await readdir(join(app.dataDir, "requests")).catch(() => [] as string[]);
  return Promise.all(names.filter((n) => n.endsWith(".json")).map(async (n) => JSON.parse(await readFile(join(app.dataDir, "requests", n), "utf8"))));
};

test("AppShape AI designs a drawing: what is sent is asked once, it designs, the proposal shows its cost, try again asks again", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const frameId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  const home = page.locator(`[data-frame-content="${placement}"]`);
  await home.locator("h1").scrollIntoViewIfNeeded();
  await page.keyboard.press("d");
  await page.getByTestId("draw-bar").getByRole("button", { name: "Ellipse" }).click();
  const h1 = (await home.locator("h1").boundingBox())!;
  await page.mouse.move(h1.x - 10, h1.y - 10);
  await page.mouse.down();
  await page.mouse.move(h1.x + h1.width + 10, h1.y + h1.height + 10, { steps: 5 });
  await page.mouse.up();
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await dock.getByLabel("What should change?").fill("A shorter heading");

  // the model and the expected cost; the first time, what is sent and to whom
  await expect(dock.getByTestId("ai-estimate")).toContainText(/Claude Opus 5\.5 · ≈ \$\d/);
  // a cheaper model, each with its expected cost; the choice is remembered
  const models = dock.getByRole("radiogroup", { name: "AI model" });
  await expect(models.getByRole("radio")).toHaveCount(3);
  await models.getByRole("radio", { name: /Haiku 5\.5/ }).click();
  await expect(dock.getByTestId("ai-estimate")).toContainText(/Claude Haiku 5\.5 · ≈ \$0\.0/);
  await models.getByRole("radio", { name: /Opus 5\.5/ }).click();
  await expect(models.getByRole("radio", { name: /Opus 5\.5/ })).toHaveAttribute("aria-checked", "true");
  await dock.getByRole("button", { name: /Design it with AppShape AI/ }).click();
  const consent = dock.getByRole("dialog", { name: "What is sent" });
  await expect(consent).toContainText("A picture of the screen (with and without your drawing), the screen as JSX");
  await consent.getByRole("button", { name: "Send and design" }).click();

  // designing, then the proposal
  await expect(dock.getByTestId("designing")).toBeVisible();
  await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect(home.locator("h1")).toHaveText("Designed by the fake AI");
  // made from the screen as it is (the server's copy and the board's are the same version)
  await expect(dock.getByText("The screen changed since")).toHaveCount(0);
  await expect(dock.getByText(/by fake · \$\d+\.\d\d/)).toBeVisible();
  await expect.poll(async () => (await requests(app))[0]?.status).toBe("proposed");
  const [request] = await requests(app);
  expect(request).toMatchObject({ route: "ai", status: "proposed", proposal: { by: "fake" } });
  expect(request.proposal.summary[0]).toContain("“Designed by the fake AI”");

  // try again: the follow-up goes to the AI right away
  await dock.getByRole("button", { name: "Try again" }).click();
  await dock.getByLabel("What should be different?").fill("Even shorter");
  await dock.getByRole("button", { name: "Ask again" }).click();
  await expect.poll(async () => (await requests(app))[0]?.history?.length).toBe(1);
  await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await requests(app))[0]?.message).toBe("Even shorter");

  // accept, and the settings count what it cost
  await dock.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => JSON.stringify((await app.readScreens()).get("Home")!.current)).toContain("Designed by the fake AI");
  await page.getByRole("button", { name: "Project settings" }).click();
  const settings = page.getByRole("dialog", { name: /settings/i });
  await settings.getByRole("button", { name: "AppShape AI" }).click();
  await expect(settings.getByTestId("ai-key")).toContainText("From ANTHROPIC_API_KEY");
  await expect(settings.getByTestId("ai-spent")).toContainText("2 designs");
});

test("variants: three designs side by side on the board; pick one and accept it", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const frameId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  const home = page.locator(`[data-frame-content="${placement}"]`);
  await home.locator("h1").scrollIntoViewIfNeeded();
  await page.keyboard.press("d");
  await page.getByTestId("draw-bar").getByRole("button", { name: "Ellipse" }).click();
  const h1 = (await home.locator("h1").boundingBox())!;
  await page.mouse.move(h1.x - 10, h1.y - 10);
  await page.mouse.down();
  await page.mouse.move(h1.x + h1.width + 10, h1.y + h1.height + 10, { steps: 5 });
  await page.mouse.up();
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await dock.getByLabel("What should change?").fill("A different heading");

  // three variants instead of one design: they cost more than one
  await expect(dock.getByTestId("ai-estimate")).toContainText(/≈ \$\d/);
  const one = Number(/≈ \$([\d.]+)/.exec((await dock.getByTestId("ai-estimate").textContent()) ?? "")?.[1]);
  const designs = dock.getByRole("radiogroup", { name: "How many designs" });
  await designs.getByRole("radio", { name: "3 variants" }).click();
  await expect(designs.getByRole("radio", { name: "3 variants" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => Number(/≈ \$([\d.]+)/.exec((await dock.getByTestId("ai-estimate").textContent()) ?? "")?.[1])).toBeGreaterThan(one);
  await dock.getByRole("button", { name: /Design it with AppShape AI/ }).click();
  await dock.getByRole("dialog", { name: "What is sent" }).getByRole("button", { name: "Send and design" }).click();

  // the first on the screen, the other two next to it
  await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect(dock).toContainText("3 variants");
  await expect(home.locator("h1")).toHaveText("Designed by the fake AI (1)");
  await expect(page.locator("[data-variant]")).toHaveCount(2);
  await expect(page.locator('[data-variant="2"]')).toContainText("A friendly headline");
  await expect(page.locator('[data-variant="3"] h1')).toHaveText("Designed by the fake AI (3)");
  // all three in view, next to the panel (once the camera has moved)
  await expect
    .poll(async () => {
      const panel = (await dock.boundingBox())!;
      const third = (await page.locator('[data-variant="3"]').boundingBox())!;
      return third.x + third.width < panel.x;
    })
    .toBe(true);

  // pick on the board, or in the panel
  await page.locator('[data-variant="3"]').getByRole("button", { name: "Pick" }).click();
  await expect(home.locator("h1")).toHaveText("Designed by the fake AI (3)");
  const picker = dock.getByRole("radiogroup", { name: "Variants" });
  await expect(picker.getByRole("radio", { name: /A short headline/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-variant]")).toHaveCount(2);
  await picker.getByRole("radio", { name: /A friendly headline/ }).click();
  await expect(home.locator("h1")).toHaveText("Designed by the fake AI (2)");

  // accept: the picked one goes into the design, the others with the drawing
  await dock.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => JSON.stringify((await app.readScreens()).get("Home")!.current)).toContain("Designed by the fake AI (2)");
  await expect(page.locator("[data-variant]")).toHaveCount(0);
  await expect.poll(async () => (await requests(app)).length).toBe(0);
});

/** A click at an element's center (the board's own layer takes the pointer, not the element). */
async function clickOn(page: Page, element: ReturnType<Page["locator"]>) {
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("AI shortcuts: make a screen work on phones, and a new section from a sentence", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const frameId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  const home = page.locator(`[data-frame-content="${placement}"]`);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  // select the heading, then climb to its section with Esc
  await clickOn(page, home.locator("h1"));
  for (let i = 0; i < 6 && !(await inspector.getByRole("button", { name: "New section below…" }).isVisible()); i++) await page.keyboard.press("Escape");

  // a new section below the hero: the panel asks for the sentence, a green box marks the spot
  await inspector.getByRole("button", { name: "New section below…" }).click();
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await expect(dock).toContainText("New section");
  await dock.getByLabel("What should the section be?").fill("Logos of five customers in one row");
  await dock.getByRole("button", { name: /Design it with AppShape AI/ }).click();
  await dock.getByRole("dialog", { name: "What is sent" }).getByRole("button", { name: "Send and design" }).click();
  await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await requests(app)).find((r) => r.intent === "section")?.status).toBe("proposed");
  const section = (await requests(app)).find((r) => r.intent === "section");
  expect(section).toMatchObject({ message: "Logos of five customers in one row", shapes: [{ kind: "rect", color: "add" }] });
  await dock.getByRole("button", { name: "Discard" }).click();

  // make it work on phones: the phone size shows on the board, the AI gets the job; the fake AI also
  // changes the heading on desktops, so the proposal warns about larger screens
  await clickOn(page, home.locator("h1"));
  for (let i = 0; i < 8 && !(await inspector.getByRole("button", { name: "Make it work on phones" }).isVisible()); i++) await page.keyboard.press("Escape");
  await inspector.getByRole("button", { name: "Make it work on phones" }).click();
  await expect.poll(async () => ((await app.readBoard()).items as { frameId?: string }[]).filter((i) => i.frameId === frameId).length).toBeGreaterThan(1);
  const phones = page.getByRole("dialog", { name: "Drawing on Home" });
  await expect(phones).toContainText("Make it work on phones");
  await phones.getByRole("button", { name: /Design it with AppShape AI/ }).click();
  await expect(phones.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect(phones).toContainText("Also looks different on larger screens");
  await expect.poll(async () => (await requests(app)).find((r) => r.intent === "phones")?.status).toBe("proposed");
});

test("Ask AI: review a page, fix a finding, and back to the review with it done", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const frameId = (await app.readScreens()).get("Home")!.id;
  const placement = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  const home = page.locator(`[data-frame-content="${placement}"]`);
  // a section selected: Ask AI at its corner
  await clickOn(page, home.locator("h1"));
  const ask = page.getByTestId("ask-ai");
  for (let i = 0; i < 6 && !(await ask.isVisible()); i++) await page.keyboard.press("Escape");
  await ask.getByRole("button", { name: "Ask AI" }).click();
  const menu = page.getByRole("menu", { name: "Ask AI" });
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expect(menu).toContainText("3 variants of this section");
  await menu.getByRole("menuitem", { name: /Review this page/ }).click();

  // reviewed by AppShape AI (asked once what is sent)
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await expect(dock).toContainText("Review this page");
  await dock.getByRole("button", { name: /Review it with AppShape AI/ }).click();
  await dock.getByRole("dialog", { name: "What is sent" }).getByRole("button", { name: "Send and design" }).click();
  const review = dock.getByTestId("review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toContainText("A clear page; one thing stands out.");
  await expect(review.getByRole("list", { name: "Findings" })).toContainText("A shorter main heading");
  // pointing at a finding outlines what it's about
  await review.getByRole("listitem").first().hover();
  await expect(page.getByTestId("proposal-highlight")).toHaveCount(1);

  // fix it: a change designed the same way, then back to the review
  await review.getByRole("button", { name: "Fix it" }).click();
  await expect(dock).toContainText("Fixing: A shorter main heading");
  await expect(dock.getByTestId("proposal")).toBeVisible({ timeout: 30_000 });
  await expect(home.locator("h1")).toHaveText("Designed by the fake AI");
  await dock.getByRole("button", { name: "Accept" }).click();
  await expect(review).toBeVisible();
  await expect(review).toContainText("All done.");
  await expect(review).toContainText("1 done: A shorter main heading");
  await expect.poll(async () => JSON.stringify((await app.readScreens()).get("Home")!.current)).toContain("Designed by the fake AI");
  await review.getByRole("button", { name: "Done with the review" }).click();
  await expect.poll(async () => (await requests(app)).length).toBe(0);
});
