import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Component, ComponentSources, DesignNode, Tokens } from "@appshape/ir";
import { NODE_LAYER, RESET_LAYER, renderFrame } from "@appshape/render";
import type { Browser, Page } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lucideIconsDir } from "./icons";
import { SCHEME_PROPERTY, STYLE_FILE_PLACEHOLDER } from "./styles";

/**
 * A design page rendered the way the board renders it (shadow root, the app's CSS, real icons),
 * outside the editor: for comparing the board with the app (import fidelity, verification).
 */

export interface BoardInput {
  root: DesignNode;
  tokens: Tokens;
  components?: readonly Component[];
  sources?: ComponentSources;
  /** The imported app's CSS (empty for apps that were never imported). */
  appCss?: { shadow: string; document: string };
  /** Classes on the app's `<html>` (applied to the frame). */
  htmlClasses?: string[];
  /** The app CSS is layered: node rules go in a layer after it. */
  layered?: boolean;
  width?: number;
  height?: number;
  /** Folders the board serves files from. */
  appRoot: string;
  dataDir: string;
  iconsDir?: string;
}

export const BOARD_ORIGIN = "http://appshape.test";

const TYPES: Record<string, string> = {
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
};

/** The board's HTML for a design page. */
export function boardHtml(input: BoardInput): string {
  const width = input.width ?? 1280;
  const result = renderFrame(input.root, {
    tokens: input.tokens,
    viewportHeight: input.height ?? 800,
    ...(input.components && { components: input.components }),
    ...(input.sources && { sources: input.sources }),
    resolveAsset: (src) => `/__assets/${src.slice("asset:".length)}`,
    iconUrl: (_set, name) => `/__icons/${name}.svg`,
    ...(input.layered && { layer: NODE_LAYER }),
  });
  let markup = renderToStaticMarkup(createElement("div", { id: "frame-root" }, result.element));
  if (input.htmlClasses?.length) markup = markup.replace('class="aps-frame"', `class="aps-frame ${input.htmlClasses.join(" ")}"`);
  const files = (css: string) => css.split(`${STYLE_FILE_PLACEHOLDER}/`).join("/__files/");
  const shadowCss = `@layer ${RESET_LAYER};\n:host{display:block}\n${files(input.appCss?.shadow ?? "")}\n${result.css}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html{${SCHEME_PROPERTY}:light}body{margin:0}${files(input.appCss?.document ?? "")}</style></head><body>
<div id="host" style="width:${width}px"></div>
<template id="content"><style>${shadowCss.replace(/<\/style/gi, "<\\/style")}</style>${markup}</template>
<script>
  const host = document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(document.getElementById("content").content.cloneNode(true));
</script></body></html>`;
}

/** Serves the board page and its files (app CSS files, assets, icons, the app's public/) to a tab. */
export async function serveBoard(page: Page, html: string, input: Pick<BoardInput, "appRoot" | "dataDir" | "iconsDir">): Promise<void> {
  const iconsDir = input.iconsDir ?? lucideIconsDir();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BOARD_ORIGIN) return url.protocol === "data:" || url.protocol === "blob:" ? route.continue() : route.abort("blockedbyclient");
    const path = decodeURIComponent(url.pathname);
    if (path === "/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    let file: string;
    if (path.startsWith("/__files/")) file = join(input.dataDir, "styles", "files", path.slice("/__files/".length));
    else if (path.startsWith("/__assets/")) file = join(input.dataDir, "assets", path.slice("/__assets/".length));
    else if (path.startsWith("/__icons/")) file = join(iconsDir, path.slice("/__icons/".length));
    else file = join(input.appRoot, "public", path);
    try {
      const body = await readFile(file);
      const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? "";
      return route.fulfill({ status: 200, contentType: TYPES[ext] ?? "application/octet-stream", body });
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
  });
}

/** Opens a design page like the board shows it, settled (fonts loaded). The caller closes the tab. */
export async function openBoardPage(browser: Browser, input: BoardInput): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: input.width ?? 1280, height: input.height ?? 800 }, reducedMotion: "reduce", colorScheme: "light" });
  await serveBoard(page, boardHtml(input), input);
  await page.goto(`${BOARD_ORIGIN}/`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  return page;
}
