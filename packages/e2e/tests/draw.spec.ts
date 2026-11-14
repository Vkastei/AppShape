import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type AppShapeApp, expect, runCli, test } from "./fixtures";

/** A new screen made from a page template. */
async function screenFrom(page: Page, app: AppShapeApp, name: string, template: string) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill(name);
  await page.getByLabel("Start from").selectOption(template);
  await page.getByRole("button", { name: "Create screen" }).click();
  await expect.poll(async () => (await app.readScreens()).get(name)).toBeDefined();
}

/** The placement of a screen on the board (the first one). */
async function placementOf(page: Page, app: AppShapeApp, name: string) {
  const frameId = (await app.readScreens()).get(name)!.id;
  const id = ((await app.readBoard()).items as { id: string; frameId?: string }[]).find((i) => i.frameId === frameId)!.id;
  return page.locator(`[data-frame-content="${id}"]`);
}

const requests = async (app: AppShapeApp) => {
  const names = await readdir(join(app.dataDir, "requests")).catch(() => [] as string[]);
  return Promise.all(names.filter((n) => n.endsWith(".json")).map(async (n) => JSON.parse(await readFile(join(app.dataDir, "requests", n), "utf8"))));
};

/** Drags with the mouse through points (client px). */
async function stroke(page: Page, points: [number, number][]) {
  await page.mouse.move(points[0]![0], points[0]![1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
}

test("draw on a screen, describe it and keep it as a note: it survives a reload and reaches the coding agent", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const home = await placementOf(page, app, "Home");
  // the heading in view, then draw: select the screen's placement first
  await home.locator("h1").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByTestId("draw-bar")).toBeVisible();
  const bar = page.getByTestId("draw-bar");

  // cross out the main heading in red (remove)
  await bar.getByRole("button", { name: "Color Remove" }).click();
  const h1 = (await home.locator("h1").boundingBox())!;
  await stroke(page, [[h1.x - 4, h1.y + h1.height / 2], [h1.x + h1.width / 2, h1.y + h1.height / 2 + 2], [h1.x + h1.width + 4, h1.y + h1.height / 2]]);
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await expect(dock).toBeVisible();
  await expect(page.getByTestId("markup")).toBeVisible();
  // a green box below it (add) and a label
  await bar.getByRole("button", { name: "Color Add" }).click();
  await bar.getByRole("button", { name: "Rectangle" }).click();
  await stroke(page, [[h1.x, h1.y + h1.height + 8], [h1.x + 200, h1.y + h1.height + 60]]);
  await bar.getByRole("button", { name: "Label" }).click();
  await page.mouse.click(h1.x + 210, h1.y + h1.height + 40);
  await page.getByLabel("Label text").fill("search");
  await page.keyboard.press("Enter");

  await expect.poll(async () => (await requests(app))[0]?.shapes.length).toBe(3);
  const [request] = await requests(app);
  const heading = (function find(n: any): any {
    if (n.type === "text" && n.semantic?.role === "heading" && n.semantic.level === 1) return n;
    for (const c of n.children ?? []) {
      const f = find(c);
      if (f) return f;
    }
  })((await app.readScreens()).get("Home")!.current);
  expect(request.shapes.map((s: any) => [s.kind, s.color])).toEqual([["pen", "remove"], ["rect", "add"], ["label", "add"]]);
  expect(request.shapes[0].targets).toEqual([heading.id]);

  // Ctrl+Z takes back the last mark; Ctrl+Y brings it back
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await requests(app))[0]?.shapes.length).toBe(2);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await requests(app))[0]?.shapes.length).toBe(3);

  // describe it and keep it as a note for the coding agent
  await dock.getByLabel("What should change?").fill("Replace the heading with a search field in the green box");
  await dock.getByRole("button", { name: "Keep as a note for the coding agent" }).click();
  await expect(dock.getByText("Kept as a note for your coding agent")).toBeVisible();
  await expect.poll(async () => (await requests(app))[0]?.route).toBe("note");
  expect((await requests(app))[0].message).toBe("Replace the heading with a search field in the green box");

  // close the board and open it again: the drawing is there
  await page.reload();
  await expect(page.getByTitle("Connected")).toBeVisible();
  await expect(page.getByTestId("markup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Note for the agent" })).toBeVisible();

  // the next Apply to code hands it to the coding agent, with a picture
  await page.getByRole("button", { name: "Apply to code" }).click();
  const apply = page.getByRole("dialog", { name: "Apply to code" });
  await apply.getByLabel("Vite + React Router").check();
  await apply.getByRole("button", { name: "Preview code" }).click();
  await expect(apply.getByText(/Change "Home" as drawn/)).toBeVisible();
  await apply.getByRole("button", { name: "Create app" }).click();
  await expect(apply.getByText(/^Created the app/)).toBeVisible({ timeout: 30_000 });
  const specs = await readdir(join(app.dataDir, "specs"));
  const spec = await readFile(join(app.dataDir, "specs", specs.find((f) => f.endsWith(".md"))!), "utf8");
  expect(spec).toContain('Change "Home" as drawn (at 1280px): Replace the heading with a search field in the green box');
  expect(spec).toMatch(new RegExp(`red \\(remove\\) stroke .* touches .*\`${heading.id}\``));
  const picture = /- \*\*Drawing:\*\* `\.appshape\/(specs\/[^`]+\.png)`/.exec(spec)![1]!;
  expect((await readFile(join(app.dataDir, picture))).subarray(1, 4).toString()).toBe("PNG");
});

test("a design proposed from the CLI shows on the board, is reviewed and accepted as one undo step", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const home = await placementOf(page, app, "Home");
  await home.locator("h1").scrollIntoViewIfNeeded();
  await page.keyboard.press("d");
  await page.getByTestId("draw-bar").getByRole("button", { name: "Ellipse" }).click();
  const h1 = (await home.locator("h1").boundingBox())!;
  await stroke(page, [[h1.x - 10, h1.y - 10], [h1.x + h1.width + 10, h1.y + h1.height + 10]]);
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await dock.getByLabel("What should change?").fill("A shorter heading");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await requests(app))[0]?.message).toBe("A shorter heading");
  const [request] = await requests(app);

  // the coding agent (here: by hand) reads the request and proposes the screen as JSX
  expect(runCli(app, ["requests", app.appRoot]).stdout).toContain(`${request.id}  draft`);
  const brief = runCli(app, ["request", request.id]);
  expect(brief.status).toBe(0);
  expect(brief.stdout).toContain("A shorter heading");
  expect(brief.stdout).toMatch(/blue \(change\) ellipse .* touches the heading|blue \(change\) ellipse .* touches/);
  const jsx = /```tsx\n([\s\S]+?)\n```/.exec(brief.stdout)![1]!;
  const before = /<h1 data-id="[^"]+"[^>]*>([^<]+)<\/h1>/.exec(jsx)![1]!;
  const file = join(app.appRoot, "design.tsx");
  await writeFile(file, jsx.replace(`>${before}</h1>`, ">Ship faster</h1>"));
  const proposed = runCli(app, ["propose", request.id, file]);
  expect(proposed.stdout).toContain(`Changed the text “${before.slice(0, 40)}`);

  // the board shows the proposal: after, before, the change pointed out
  await expect(dock.getByTestId("proposal")).toBeVisible();
  await expect(home.locator("h1")).toHaveText("Ship faster");
  await expect(page.getByText("Proposal", { exact: true })).toBeVisible();
  await dock.getByRole("radio", { name: "Before" }).click();
  await expect(home.locator("h1")).toHaveText(before);
  await dock.getByRole("radio", { name: "After" }).click();
  await dock.getByRole("list", { name: "Changes" }).getByRole("listitem").first().hover();
  await expect(page.getByTestId("proposal-highlight")).toBeVisible();

  // accept: the design changes and the drawing is gone, in one step
  await dock.getByRole("button", { name: "Accept" }).click();
  await expect(dock).toBeHidden();
  await expect.poll(async () => JSON.stringify((await app.readScreens()).get("Home")!.current)).toContain('"text":"Ship faster"');
  await expect.poll(async () => (await requests(app)).length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await requests(app))[0]?.status).toBe("proposed");
  await expect.poll(async () => JSON.stringify((await app.readScreens()).get("Home")!.current)).not.toContain('"text":"Ship faster"');

  // try again with a follow-up: back to the drawing, the first message kept in the history
  await page.getByRole("button", { name: "Proposal to review" }).click();
  await dock.getByRole("button", { name: "Try again" }).click();
  await dock.getByLabel("What should be different?").fill("Even shorter");
  await dock.getByRole("button", { name: "Ask again" }).click();
  await expect.poll(async () => (await requests(app))[0]?.status).toBe("draft");
  const again = (await requests(app))[0];
  expect([again.message, again.history.map((h: any) => h.message), again.proposal]).toEqual(["Even shorter", ["A shorter heading"], undefined]);
  await expect(home.locator("h1")).toHaveText(before);
});

test("sent to the coding agent: the board waits with the sentence to paste and shows the agent's proposal", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await screenFrom(page, app, "Home", "landing");
  const home = await placementOf(page, app, "Home");
  await home.locator("h1").scrollIntoViewIfNeeded();
  await page.keyboard.press("d");
  const h1 = (await home.locator("h1").boundingBox())!;
  await stroke(page, [[h1.x, h1.y + h1.height + 6], [h1.x + h1.width, h1.y + h1.height + 8]]);
  const dock = page.getByRole("dialog", { name: "Drawing on Home" });
  await dock.getByLabel("What should change?").fill("Add a line of small print under the heading");
  await dock.getByRole("button", { name: "Design it with your coding agent" }).click();

  // waiting, with the exact sentence for the agent (and a hint: no agent is connected here)
  const waiting = dock.getByTestId("waiting-for-agent");
  await expect(waiting).toBeVisible();
  await expect.poll(async () => (await requests(app))[0]?.status).toBe("designing");
  const [request] = await requests(app);
  expect([request.route, request.status]).toEqual(["agent", "designing"]);
  await expect(waiting.getByText(`Design AppShape request ${request.id}`)).toBeVisible();
  await expect(waiting.getByText("No coding agent is connected to this project yet.")).toBeVisible();
  // closed, the screen's badge says it's waiting
  await dock.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Waiting for your agent" })).toBeVisible();

  // the agent designs it (here through the CLI, as an agent without MCP would)
  const brief = runCli(app, ["request", request.id]).stdout;
  const jsx = /```tsx\n([\s\S]+?)\n```/.exec(brief)![1]!;
  const file = join(app.appRoot, "design.tsx");
  await writeFile(file, jsx.replace("</h1>", '</h1>\n<p className="text-xs text-muted-foreground">No credit card needed</p>'));
  expect(runCli(app, ["propose", request.id, file, "--by", "agent"]).status).toBe(0);

  // the board switches to the proposal
  await page.getByRole("button", { name: "Proposal to review" }).click();
  await expect(dock.getByText("by your coding agent")).toBeVisible();
  await expect(home.getByText("No credit card needed")).toBeVisible();
  await expect(dock.getByRole("list", { name: "Changes" })).toContainText("Added a text “No credit card needed”");

  // trying again asks the agent again
  await dock.getByRole("button", { name: "Try again" }).click();
  await dock.getByLabel("What should be different?").fill("Make it bold");
  await dock.getByRole("button", { name: "Ask again" }).click();
  await expect(dock.getByTestId("waiting-for-agent")).toBeVisible();
  await expect.poll(async () => (await requests(app))[0]?.status).toBe("designing");
  expect((await requests(app))[0].message).toBe("Make it bold");
});
