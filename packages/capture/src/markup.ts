import { componentSources, type DesignRequest, type Project, themedTokens } from "@appshape/ir";
import { markupSvg } from "@appshape/render";
import type { Browser } from "playwright-core";
import { BOARD_ORIGIN, boardHtml, serveBoard } from "./board";
import { launchBrowser } from "./capture";
import { boardStyles } from "./verify";

/**
 * Draw & describe: the screen as the person saw it while drawing, with the drawing on top. The
 * coding agent gets it with a design request kept as a note; the AI gets it with every request.
 */

/** The longest edge of a picture (larger screens are scaled down to it). */
export const MAX_IMAGE_EDGE = 2576;

export interface MarkupImageInput {
  project: Project;
  request: DesignRequest;
  appRoot: string;
  dataDir: string;
  /** Leave the drawing off (the clean picture). */
  clean?: boolean;
  /** A browser to use (else one is started and closed). */
  browser?: Browser;
}

/** The part of a long screen a picture shows (design px from the top). */
export interface PicturePart {
  top: number;
  bottom: number;
  /** The whole screen's height. */
  height: number;
}

/**
 * The screen at the request's size, rendered like the board renders it, with the drawing on top,
 * as a PNG (at most `MAX_IMAGE_EDGE` px on its long edge; a long screen is scaled down whole).
 */
export async function markupImage(input: MarkupImageInput): Promise<Uint8Array> {
  return (await pictures(input, [Boolean(input.clean)], false)).images[0]!;
}

/**
 * The two pictures AppShape's AI gets: the screen as it is and with the drawing, at full size.
 * A screen too long for one picture is cut to the part around the drawing (`part`) instead of
 * being scaled down until its text can't be read.
 */
export async function designPictures(input: Omit<MarkupImageInput, "clean">): Promise<{ clean: Uint8Array; marked: Uint8Array; part?: PicturePart }> {
  const { images, part } = await pictures(input, [true, false], true);
  return { clean: images[0]!, marked: images[1]!, ...(part && { part }) };
}

/** Where shapes are, top to bottom (design px). */
function shapesSpan(request: DesignRequest): { top: number; bottom: number } | undefined {
  if (request.shapes.length === 0) return undefined;
  const ys = request.shapes.flatMap((s) => (s.kind === "pen" ? s.points.map((p) => p[1]) : s.kind === "arrow" ? [s.from[1], s.to[1]] : s.kind === "label" ? [s.y - 16, s.y + 8] : [s.y, s.y + s.h]));
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** The window of a long screen around the drawing that fits one picture at full size, if it needs one. */
export function pictureWindow(width: number, full: number, span: { top: number; bottom: number } | undefined): PicturePart | undefined {
  const scale = Math.min(1, MAX_IMAGE_EDGE / width);
  const fits = Math.floor(MAX_IMAGE_EDGE / scale);
  if (full <= fits || !span) return undefined;
  // the drawing in the middle, with as much around it as fits; a drawing taller than that is scaled
  if (span.bottom - span.top > fits - 160) return undefined;
  const top = Math.round(Math.max(0, Math.min(full - fits, (span.top + span.bottom) / 2 - fits / 2)));
  return { top, bottom: top + fits, height: full };
}

async function pictures(input: Omit<MarkupImageInput, "clean">, cleans: boolean[], cut: boolean): Promise<{ images: Uint8Array[]; part?: PicturePart }> {
  const { project, request } = input;
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new Error(`unknown screen ${request.frameId}`);
  const viewport = frame.viewports.find((v) => v.id === request.viewportId) ?? frame.viewports[0]!;
  const styles = await boardStyles(input.dataDir);
  const html = boardHtml({
    root: frame.current,
    tokens: themedTokens(project.tokens, frame.theme),
    components: project.components,
    sources: componentSources(project.frames),
    ...styles,
    width: viewport.width,
    height: viewport.height ?? 800,
    appRoot: input.appRoot,
    dataDir: input.dataDir,
  });
  const browser = input.browser ?? (await launchBrowser());
  try {
    // measure first, then scale (or cut) so the long edge fits
    const probe = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height ?? 800 }, reducedMotion: "reduce", colorScheme: "light" });
    let height: number;
    try {
      await serveBoard(probe, html, input);
      await probe.goto(`${BOARD_ORIGIN}/`);
      await probe.evaluate(() => document.fonts.ready);
      height = await probe.evaluate(() => Math.ceil(document.getElementById("host")!.getBoundingClientRect().height));
    } finally {
      await probe.close();
    }
    const span = shapesSpan(request);
    const full = Math.max(height, Math.ceil(span?.bottom ?? 0) + 16, viewport.height ?? 0);
    const part = cut ? pictureWindow(viewport.width, full, span) : undefined;
    const shown = part ? part.bottom - part.top : full;
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(viewport.width, shown));
    const page = await browser.newPage({ viewport: { width: viewport.width, height: Math.min(full, 4000) }, deviceScaleFactor: scale, reducedMotion: "reduce", colorScheme: "light" });
    try {
      await serveBoard(page, html, input);
      await page.goto(`${BOARD_ORIGIN}/`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate((full) => {
        // the drawing goes over the screen (the host's own children don't show: it has a shadow root)
        document.body.style.position = "relative";
        document.body.style.minHeight = `${full}px`;
      }, full);
      const images: Uint8Array[] = [];
      for (const clean of cleans) {
        await page.evaluate((svg) => {
          document.getElementById("aps-markup")?.remove();
          if (svg) document.body.insertAdjacentHTML("beforeend", svg.replace("<svg", '<svg id="aps-markup"'));
        }, clean ? "" : markupSvg(request.shapes, viewport.width, full));
        await page.waitForTimeout(50);
        const clip = part && { x: 0, y: part.top, width: viewport.width, height: shown };
        images.push(new Uint8Array(await page.screenshot({ fullPage: true, type: "png", ...(clip && { clip }) })));
      }
      return { images, ...(part && { part }) };
    } finally {
      await page.close();
    }
  } finally {
    if (!input.browser) await browser.close();
  }
}

/**
 * Pictures of several requests with one browser (started on the first one); `close` when done.
 * A picture that can't be made (no browser) is undefined: the request goes on without one.
 */
export function markupRenderer(project: Project, appRoot: string, dataDir: string): { render(request: DesignRequest): Promise<Uint8Array | undefined>; close(): Promise<void> } {
  let browser: Promise<Browser> | undefined;
  return {
    async render(request) {
      try {
        return await markupImage({ project, request, appRoot, dataDir, browser: await (browser ??= launchBrowser()) });
      } catch {
        return undefined;
      }
    },
    async close() {
      if (browser) await browser.then((b) => b.close()).catch(() => {});
    },
  };
}
