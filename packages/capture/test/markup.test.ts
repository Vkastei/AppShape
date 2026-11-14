import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_REDACTION, type DesignRequest, IR_VERSION, type Project } from "@appshape/ir";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { designPictures, launchBrowser, markupImage, pictureWindow } from "../src";

let browser: Browser;
let dir: string;
beforeAll(async () => {
  browser = await launchBrowser();
  dir = await mkdtemp(join(tmpdir(), "appshape-markup-"));
});
afterAll(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

const project: Project = {
  irVersion: IR_VERSION,
  name: "Test",
  adapters: [],
  tokens: { source: "tailwind-v4", groups: {} },
  components: [],
  board: { items: [] },
  changesets: [],
  redaction: DEFAULT_REDACTION,
  frames: [
    {
      id: "f",
      name: "Home",
      kind: "new",
      platform: "web",
      target: { adapter: "react-vite", route: "/" },
      viewports: [{ id: "phone", width: 390 }],
      current: { id: "root", type: "box", origin: "added", box: { height: { mode: "fixed", value: 600 } }, style: { background: "#ffffff" }, children: [] },
    },
  ],
};
const at = "2026-10-14T10:00:00.000Z";
const request: DesignRequest = {
  id: "rq_1",
  frameId: "f",
  viewportId: "phone",
  message: "",
  status: "draft",
  createdAt: at,
  updatedAt: at,
  shapes: [{ id: "s1", kind: "rect", color: "remove", width: 8, x: 40, y: 100, w: 200, h: 100 }],
};

/** The color of a pixel of a PNG, read in the browser. */
async function pixel(png: Uint8Array, x: number, y: number): Promise<{ width: number; height: number; rgb: number[] }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ src, x, y }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, rgb: [...context.getImageData(x, y, 1, 1).data.slice(0, 3)] };
      },
      { src: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, x, y },
    );
  } finally {
    await page.close();
  }
}

describe("the picture of a drawing", () => {
  it("shows the screen at the drawn size with the drawing on top (and without it)", async () => {
    const marked = await markupImage({ project, request, appRoot: dir, dataDir: dir, browser });
    const edge = await pixel(marked, 40, 150);
    expect([edge.width, edge.height]).toEqual([390, 600]);
    // the rectangle's left edge in the legend's red, the inside still the white screen
    expect(edge.rgb[0]).toBeGreaterThan(200);
    expect(edge.rgb[1]).toBeLessThan(110);
    expect((await pixel(marked, 140, 150)).rgb).toEqual([255, 255, 255]);
    expect((await pixel(await markupImage({ project, request, appRoot: dir, dataDir: dir, browser, clean: true }), 40, 150)).rgb).toEqual([255, 255, 255]);
  }, 30_000);

  it("cuts a long screen to the part around the drawing at full size, for the AI", async () => {
    // a 6000 px tall screen with the drawing near the bottom
    const tall: Project = { ...project, frames: [{ ...project.frames[0]!, current: { ...project.frames[0]!.current, box: { height: { mode: "fixed", value: 6000 } } } as Project["frames"][number]["current"] }] };
    const low = { ...request, shapes: [{ id: "s1", kind: "rect" as const, color: "remove" as const, width: 8, x: 40, y: 5000, w: 200, h: 100 }] };
    const { clean, marked, part } = await designPictures({ project: tall, request: low, appRoot: dir, dataDir: dir, browser });
    expect(part).toEqual({ top: 6000 - 2576, bottom: 6000, height: 6000 });
    const edge = await pixel(marked, 40, 5050 - part!.top);
    expect([edge.width, edge.height]).toEqual([390, 2576]);
    expect(edge.rgb[0]).toBeGreaterThan(200);
    expect((await pixel(clean, 40, 5050 - part!.top)).rgb).toEqual([255, 255, 255]);
    // a screen that fits, or a drawing taller than a picture: the whole screen
    expect(pictureWindow(390, 2000, { top: 100, bottom: 200 })).toBeUndefined();
    expect(pictureWindow(390, 6000, { top: 100, bottom: 5000 })).toBeUndefined();
    expect(pictureWindow(1280, 6000, { top: 100, bottom: 300 })).toEqual({ top: 0, bottom: 2576, height: 6000 });
  }, 30_000);
});
