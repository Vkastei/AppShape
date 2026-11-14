import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, selectedLabel, test } from "./fixtures";

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function newScreenWith(page: Page, kinds: string[]) {
  await page.getByRole("button", { name: "New screen" }).click();
  await page.getByLabel("Screen name").fill("Home");
  await page.getByRole("button", { name: "Create screen" }).click();
  for (const [i, kind] of kinds.entries()) {
    if (i > 0) await page.keyboard.press("Escape"); // back to the screen root
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
  }
}

/** Stands in for Google Fonts' metadata and the fontsource CDN (the app server reads them). */
let cdn: Server;
test.beforeAll(async () => {
  cdn = createServer((req, res) => {
    if (req.url === "/metadata/fonts") {
      res.end(JSON.stringify({ familyMetadataList: [{ family: "Fraunces", category: "Serif", fonts: { "400": {}, "700": {} }, axes: [{ tag: "wght", min: 100, max: 900 }], popularity: 1 }] }));
    } else if (req.url === "/npm/@fontsource-variable/fraunces@latest/index.css") {
      res.end("@font-face {\n  font-family: 'Fraunces Variable';\n  font-weight: 100 900;\n  src: url(./files/fraunces-latin-wght-normal.woff2) format('woff2-variations');\n}");
    } else if (req.url?.endsWith(".woff2")) {
      res.end(Buffer.from("not really a font"));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;
  process.env.APPSHAPE_FONT_CATALOG = `${base}/metadata/fonts`;
  process.env.APPSHAPE_FONT_CDN = `${base}/npm`;
});
test.afterAll(async () => {
  await new Promise((resolve) => cdn.close(resolve));
});

test("copies, cuts and pastes elements, and gives one element another's look", async ({ blankBoard: page, blankApp: app }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await newScreenWith(page, ["Button", "Heading"]);
  await expect(selectedLabel(page)).toHaveText("Heading");
  const home = async () => (await app.readScreens()).get("Home")?.current;
  const types = async () => (await home())?.children.map((c: { type: string }) => c.type);

  // pasting onto the copied element puts the copy right after it
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect.poll(types).toEqual(["button", "text", "text"]);
  const [, original, copy] = (await home()).children;
  expect(copy.id).not.toBe(original.id);
  expect(copy.text).toBe(original.text);

  // cut the button; the screen is selected after it, so pasting puts it at the end
  const button = (await page.locator("[data-frame-content] button[data-aps]").first().boundingBox())!;
  await page.mouse.click(button.x + 8, button.y + button.height / 2);
  await expect(selectedLabel(page)).toHaveText("Button");
  await page.keyboard.press("Control+x");
  await expect.poll(types).toEqual(["text", "text"]);
  await page.keyboard.press("Control+v");
  await expect.poll(types).toEqual(["text", "text", "button"]);

  // the pasted button is selected: copy its look onto the first heading
  await page.keyboard.press("Control+Alt+c");
  const heading = (await page.locator("[data-frame-content] h2[data-aps]").first().boundingBox())!;
  await page.mouse.click(heading.x + 8, heading.y + heading.height / 2);
  await expect(selectedLabel(page)).toHaveText("Heading");
  await page.keyboard.press("Control+Alt+v");
  await expect.poll(async () => (await home()).children[0].style).toEqual((await home()).children[2].style);
});

test("adds images: into an image element, behind a screen, and onto the board", async ({ blankBoard: page, blankApp: app }) => {
  await newScreenWith(page, ["Image"]);
  const home = async () => (await app.readScreens()).get("Home")?.current;

  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload an image" }).click();
  await (await chooser).setFiles({ name: "team-photo.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await home())?.children?.[0]?.src).toMatch(/^asset:uploads\/team-photo-[0-9a-f]{10}\.png$/);
  const image = (await home())!.children[0];
  const src: string = image.src;
  expect(image.alt).toBe("Team photo");
  expect(await readFile(join(app.dataDir, "assets", src.slice("asset:".length)))).toEqual(PNG);
  await expect(page.locator("[data-frame-content] img[data-aps]").first()).toHaveAttribute("src", /\/api\/assets\/uploads\/team-photo-/);

  // a background image on the screen
  await page.keyboard.press("Escape");
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a background image" }).click();
  await (await chooser).setFiles({ name: "hero.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await home())?.style?.backgroundImage).toEqual({ src: expect.stringMatching(/^asset:uploads\/hero-/), size: "cover", position: "center", repeat: false });
  const root = page.locator("[data-frame-content] .aps-frame > [data-aps]").first();
  await expect.poll(() => root.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("/api/assets/uploads/hero-");
  await page.getByLabel("Background position").selectOption("top");
  await expect.poll(async () => (await home())?.style?.backgroundImage?.position).toBe("top");

  // a file dropped onto the empty board becomes a board image
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.evaluate(
    ({ data, x, y }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "moodboard.png", { type: "image/png" }));
      const target = document.querySelector('[data-testid="canvas"]')!;
      for (const type of ["dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { data: PNG.toString("base64"), x: canvas.x + 40, y: canvas.y + canvas.height - 80 },
  );
  await expect.poll(async () => (await app.readBoard()).items.find((i) => i.type === "image")).toMatchObject({ type: "image", src: expect.stringMatching(/^asset:uploads\/moodboard-/) });
});

test("picks a Google font: copied into the project, used through a font token, shown on the board", async ({ blankBoard: page, blankApp: app }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort()); // picker previews
  await newScreenWith(page, ["Heading"]);
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.getByLabel("Search fonts").fill("fraun");
  await page.getByRole("option", { name: /^Fraunces/ }).click();

  await expect.poll(async () => (await app.readTokens()).groups.fontFamily?.fraunces).toBe('"Fraunces Variable", ui-serif, Georgia, Cambria, "Times New Roman", serif');
  await expect.poll(async () => (await app.readScreens()).get("Home")?.current.children[0].style?.fontFamily).toBe("$fontFamily.fraunces");
  expect((await stat(join(app.dataDir, "assets", "fonts", "fraunces", "files", "fraunces-latin-wght-normal.woff2"))).size).toBeGreaterThan(0);
  // the board loads the project's own copy of the font
  await expect.poll(() => page.locator('style[data-font="fraunces"]').evaluate((el) => el.textContent)).toContain("/api/assets/fonts/fraunces/files/fraunces-latin-wght-normal.woff2?token=");
  const heading = page.locator("[data-frame-content] h2[data-aps]").first();
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Fraunces Variable"/);
  await expect(page.getByRole("button", { name: "Font", exact: true })).toContainText("fraunces · Fraunces Variable");
});
