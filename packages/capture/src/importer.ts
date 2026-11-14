import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { appFiles, type AppLayout, type Detection, detectApp } from "@appshape/codegen";
import { defaultTokens, extractTokensV3, extractTokensV4 } from "@appshape/dialect-tailwind";
import {
  type AnyOp,
  type BoardItem,
  clone,
  createId,
  type DesignNode,
  type Frame,
  isContainer,
  type Project,
  type RedactionConfig,
  type Tokens,
} from "@appshape/ir";
import { CONTAINER_NAME, FRAME_CLASS } from "@appshape/render";
import type { Browser, Page } from "playwright-core";
import { detectPackageManager, type PackageManager } from "./app-process";
import { type CapturedPage, captureContext, capturePage, launchBrowser, loadPage } from "./capture";
import { capturedImages, convertPage } from "./convert";
import { hasIcon } from "./icons";
import { createRedactor } from "./redact";
import { type AppRoute, discoverRoutes, routeName } from "./routes";
import { SourceResolver } from "./sourcemaps";
import { processAppCss, STYLE_FILE_PLACEHOLDER } from "./styles";

/** What the import writes besides the design (`.appshape/styles/`). */
export const STYLES_DIR = "styles";

/** `.appshape/styles/meta.json`. */
export interface StylesMeta {
  version: 1;
  capturedAt: string;
  /** Classes on the app's `<html>`, applied to frames. */
  htmlClasses: string[];
  /** The app's CSS uses cascade layers (Tailwind v4). */
  layered: boolean;
}

export interface ImportStatus {
  detection: Detection;
  packageManager: PackageManager;
  routes: AppRoute[];
}

export interface PageRequest {
  /** Route pattern (as discovered) or a path. */
  route: string;
  /** Concrete path to open, for dynamic routes (`/blog/hello`). Defaults to `route`. */
  path?: string;
}

export interface ImportProgress {
  step: string;
  done: number;
  total: number;
}

export interface ImportedPage {
  route: string;
  path: string;
  frameId: string;
  name: string;
  nodes: number;
  anchored: number;
  elements: number;
  unmappedClasses: number;
  mappedClasses: number;
  redacted: number;
  warnings: string[];
  /** Where each element was in the app (for fidelity checks; not sent to the editor). */
  rects: Map<string, [number, number, number, number]>;
}

export interface ImportResult {
  /** Apply these as one command (undoable in the editor). */
  ops: AnyOp[];
  pages: ImportedPage[];
  warnings: string[];
}

export interface ImportOptions {
  devUrl: string;
  pages: PageRequest[];
  redaction: RedactionConfig;
  onProgress?: (progress: ImportProgress) => void;
  /** Reuse a browser (tests); otherwise one is launched and closed. */
  browser?: Browser;
  /** Re-import pages whose frames have no design changes (replaces them). */
  replace?: boolean;
}

/**
 * Imports pages of a running app into the project: captures each page, converts it into an
 * imported frame and stores the app's CSS for the board. The design changes come back as ops.
 */
export class Importer {
  constructor(
    readonly appRoot: string,
    readonly dataDir: string,
  ) {}

  async status(): Promise<ImportStatus> {
    const detection = await detectApp(appFiles(this.appRoot));
    const packageManager = await detectPackageManager(this.appRoot, "npm");
    const routes = detection.kind === "app" ? await discoverRoutes(this.appRoot, detection.layout) : [];
    return { detection, packageManager, routes };
  }

  async import(project: Project, options: ImportOptions): Promise<ImportResult> {
    const detection = await detectApp(appFiles(this.appRoot));
    if (detection.kind !== "app") throw new Error(detection.kind === "none" ? "no app found in this folder" : detection.reason);
    const layout = detection.layout;
    const progress = options.onProgress ?? (() => undefined);
    const total = options.pages.length + 2;
    const warnings: string[] = [];

    progress({ step: "Reading the design system", done: 0, total });
    const tokens = await this.appTokens(layout, project.tokens, warnings);

    const browser = options.browser ?? (await launchBrowser());
    const captured: Array<{ request: PageRequest; page: CapturedPage }> = [];
    try {
      const context = await captureContext(browser, options.devUrl);
      const resolver = new SourceResolver(this.appRoot);
      const tab = await context.newPage();
      for (const [i, request] of options.pages.entries()) {
        const path = request.path ?? request.route;
        progress({ step: `Capturing ${path}`, done: i + 1, total });
        const url = new URL(path, options.devUrl).href;
        try {
          await loadPage(tab, url);
          const page = await capturePage(tab, { appRoot: this.appRoot, resolver, redactSelectors: options.redaction.selectors });
          captured.push({ request, page });
        } catch (error) {
          warnings.push(`${path}: ${(error as Error).message.split("\n")[0]}`);
        }
      }
      await context.close();
    } finally {
      if (!options.browser) await browser.close();
    }

    progress({ step: "Saving the app's styles", done: total - 1, total });
    return this.build(project, layout, tokens, captured, options, warnings);
  }

  /**
   * Captures a page that is open in the capture browser, as it is now (logged in, a dialog open, a
   * later step of a form). It becomes a new frame next to the imported ones.
   */
  async captureOpenPage(project: Project, tab: Page, options: { devUrl: string; redaction: RedactionConfig; name?: string }): Promise<ImportResult> {
    const detection = await detectApp(appFiles(this.appRoot));
    if (detection.kind !== "app") throw new Error(detection.kind === "none" ? "no app found in this folder" : detection.reason);
    const warnings: string[] = [];
    const tokens = await this.appTokens(detection.layout, project.tokens, warnings);
    const page = await capturePage(tab, { appRoot: this.appRoot, redactSelectors: options.redaction.selectors });
    const path = new URL(page.url).pathname;
    const routes = await this.routesCache(detection.layout);
    const route = routes.find((r) => r.path === path)?.path ?? matchRoute(path, routes.map((r) => r.path)) ?? path;
    return this.build(project, detection.layout, tokens, [{ request: { route, path }, page }], { ...options, pages: [], asNewState: options.name ?? true }, warnings);
  }

  private async build(
    project: Project,
    layout: AppLayout,
    tokens: Tokens,
    captured: Array<{ request: PageRequest; page: CapturedPage }>,
    options: Pick<ImportOptions, "devUrl" | "redaction" | "replace"> & { pages: PageRequest[]; asNewState?: string | true },
    warnings: string[],
  ): Promise<ImportResult> {
    await this.saveStyles(captured.map((c) => c.page), options.devUrl, warnings);

    // Frames: new ids, or the existing frame of the route when re-importing.
    const ops: AnyOp[] = [];
    const usedIds = new Set(project.frames.map((f) => f.id));
    const byRoute = new Map(project.frames.filter((f) => f.kind === "imported" && f.target.route).map((f) => [f.target.route!, f]));
    const redactor = createRedactor(options.redaction);
    const pages: ImportedPage[] = [];
    const images = await this.copyImages(captured.flatMap((c) => capturedImages(c.page)), options.devUrl, options.redaction, warnings);
    const linkTargets = new Map<string, string>();
    for (const frame of project.frames) if (frame.target.route) linkTargets.set(frame.target.route, frame.id);
    const plans: Array<{ frame: Frame; links: Array<{ nodeId: string; path: string }>; replaces?: Frame }> = [];

    for (const { request, page } of captured) {
      const path = request.path ?? request.route;
      const existing = options.asNewState ? undefined : byRoute.get(request.route);
      if (existing && !options.replace) {
        warnings.push(`${request.route} is already imported (frame "${existing.name}")`);
        continue;
      }
      if (existing && existing.baseline && JSON.stringify(existing.baseline) !== JSON.stringify(existing.current)) {
        warnings.push(`${request.route} has design changes; not replaced`);
        continue;
      }
      const frameId = existing?.id ?? uniqueId(`${frameKey(request.route)}${options.asNewState ? "-state" : ""}`, usedIds);
      usedIds.add(frameId);
      const result = convertPage(page, {
        tokens,
        idPrefix: `n_${frameId.slice(2, 26)}_`,
        redactor,
        mapImage: (path) => images.get(path),
        hasIcon,
      });
      const name = existing?.name ?? (typeof options.asNewState === "string" ? options.asNewState : options.asNewState ? `${routeName(request.route)} (captured ${new Date().toTimeString().slice(0, 5)})` : routeName(request.route));
      const frame: Frame = {
        id: frameId,
        name,
        kind: "imported",
        platform: "web",
        target: { adapter: layout.stack, route: request.route, ...(routeFile(request.route, await this.routesCache(layout)) && { file: routeFile(request.route, await this.routesCache(layout))! }) },
        viewports: [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }],
        baseline: result.root,
        current: clone(result.root),
        capture: { at: new Date().toISOString(), url: path, redaction: options.redaction.mode },
      };
      if (!options.asNewState || !linkTargets.has(request.route)) linkTargets.set(request.route, frameId);
      if (path !== request.route && !linkTargets.has(path)) linkTargets.set(path, frameId);
      plans.push({ frame, links: result.links, ...(existing && { replaces: existing }) });
      pages.push({
        route: request.route,
        path,
        frameId,
        name,
        nodes: result.stats.nodes,
        elements: page.stats.elements,
        anchored: page.stats.anchored,
        unmappedClasses: result.stats.unmappedClasses,
        mappedClasses: result.stats.mappedClasses,
        redacted: result.stats.redacted,
        warnings: [...page.warnings, ...result.warnings],
        rects: result.rects,
      });
    }

    // Links between imported pages become navigation (flows on the board).
    for (const { frame, links } of plans) {
      const targets = new Map<string, string>();
      for (const link of links) {
        const target = linkTargets.get(link.path) ?? linkTargets.get(link.path.replace(/\/$/, "") || "/");
        if (target && target !== frame.id) targets.set(link.nodeId, target);
      }
      if (targets.size === 0) continue;
      for (const tree of [frame.baseline!, frame.current]) {
        walk(tree, (node) => {
          const target = targets.get(node.id);
          if (target && node.type === "link") node.targetFrameId = target;
        });
      }
    }

    ops.push(...tokenOps(project.tokens, tokens, await defaultTokens()));
    for (const plan of plans) {
      if (plan.replaces) ops.push({ id: createId("op"), frameId: plan.frame.id, op: "deleteFrame" });
      ops.push({ id: createId("op"), frameId: plan.frame.id, op: "createFrame", frame: plan.frame });
    }
    ops.push(...placeFrames(project, plans.filter((p) => !p.replaces).map((p) => ({ frameId: p.frame.id, height: captured.find((c) => (c.request.path ?? c.request.route) === (p.frame.capture?.url ?? ""))?.page.pageHeight ?? 900 }))));
    return { ops, pages, warnings };
  }

  // ── tokens ──────────────────────────────────────────────────────────────

  private async appTokens(layout: AppLayout, fallback: Tokens, warnings: string[]): Promise<Tokens> {
    try {
      return layout.tailwind === 4 ? await extractTokensV4(this.appRoot) : await extractTokensV3(this.appRoot);
    } catch (error) {
      warnings.push(`could not read the Tailwind theme: ${(error as Error).message}`);
    }
    return fallback;
  }

  // ── styles and images ───────────────────────────────────────────────────

  private routes: AppRoute[] | undefined;
  private async routesCache(layout: AppLayout): Promise<AppRoute[]> {
    this.routes ??= await discoverRoutes(this.appRoot, layout);
    return this.routes;
  }

  private async saveStyles(pages: CapturedPage[], devUrl: string, warnings: string[]): Promise<void> {
    if (pages.length === 0) return;
    // Every capture adds the stylesheets it saw (pages can load different CSS); the raw sheets of
    // earlier captures are kept in the cache.
    const cacheFile = join(this.dataDir, ".cache", "app-sheets.json");
    let earlier: Array<{ href?: string; text: string }> = [];
    try {
      earlier = JSON.parse(await readFile(cacheFile, "utf8")) as typeof earlier;
    } catch {
      // first import
    }
    const seen = new Set<string>();
    const sheets = [...earlier, ...pages.flatMap((p) => p.css)].filter((s) => (seen.has(s.text) ? false : (seen.add(s.text), true)));
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(sheets));
    const css = processAppCss(sheets, pages[0]!.url, { frameClass: FRAME_CLASS, container: CONTAINER_NAME });
    const dir = join(this.dataDir, STYLES_DIR);
    await mkdir(join(dir, "files"), { recursive: true });
    let failed = 0;
    for (const [url, placeholder] of css.assets) {
      const name = placeholder.slice(STYLE_FILE_PLACEHOLDER.length + 1);
      const target = join(dir, "files", name);
      if (await exists(target)) continue;
      const data = await download(url.startsWith("http") ? url : new URL(url, devUrl).href);
      if (data) await writeFile(target, data);
      else failed++;
    }
    if (failed) warnings.push(`${failed} file(s) referenced by the app's CSS could not be downloaded`);
    await writeFile(join(dir, "app.css"), css.shadow);
    await writeFile(join(dir, "document.css"), css.document);
    const htmlClasses = [...new Set(pages.flatMap((p) => p.htmlClasses))];
    // Tailwind v4 puts utilities in cascade layers; the board then layers its node rules after them.
    const layered = /@layer\s+[\w-]+\s*,|@layer\s+utilities\b/.test(css.shadow);
    const meta: StylesMeta = { version: 1, capturedAt: new Date().toISOString(), htmlClasses, layered };
    await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  }

  /**
   * Where each image of the capture comes from on the board: files in `public/` keep their path
   * (served from the app folder), other same-origin images are copied to `.appshape/assets/`,
   * external images become placeholders unless redaction is off.
   */
  private async copyImages(paths: string[], devUrl: string, redaction: RedactionConfig, warnings: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const path of new Set(paths)) {
      if (!path.startsWith("/")) {
        if (redaction.mode === "off") map.set(path, path);
        continue;
      }
      const publicFile = join(this.appRoot, "public", ...decodeURIComponent(path).split("/").filter(Boolean));
      if (await exists(publicFile)) {
        map.set(path, path);
        continue;
      }
      const ext = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.exec(path)?.[1]?.toLowerCase() ?? "png";
      const name = `${createHash("sha1").update(path).digest("hex").slice(0, 12)}.${ext}`;
      const target = join(this.dataDir, "assets", "imported", name);
      if (!(await exists(target))) {
        const data = await download(new URL(path, devUrl).href);
        if (!data) {
          warnings.push(`image not found: ${path}`);
          continue;
        }
        await mkdir(join(this.dataDir, "assets", "imported"), { recursive: true });
        await writeFile(target, data);
      }
      map.set(path, `asset:${posix.join("imported", name)}`);
    }
    return map;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string): Promise<Buffer | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

function walk(node: DesignNode, visit: (node: DesignNode) => void): void {
  visit(node);
  if (isContainer(node)) for (const child of node.children) walk(child, visit);
}

/** The route pattern a concrete path belongs to (`/blog/hello` → `/blog/[slug]`). */
export function matchRoute(path: string, patterns: string[]): string | undefined {
  const parts = path.split("/").filter(Boolean);
  return patterns.find((pattern) => {
    const p = pattern.split("/").filter(Boolean);
    if (p.some((s) => /^\[{1,2}\.\.\./.test(s))) return parts.length >= p.length - 1 && p.slice(0, -1).every((s, i) => /^(\[.+\]|[:$].+)$/.test(s) || s === parts[i]);
    return p.length === parts.length && p.every((s, i) => /^(\[.+\]|[:$].+)$/.test(s) || s === parts[i]);
  });
}

/** `f_home`, `f_idea-generator`, `f_blog-slug`. */
function frameKey(route: string): string {
  const slug = route
    .replace(/[[\]$:.]+/g, "")
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .toLowerCase()
    .slice(0, 40);
  return `f_${slug || "home"}`;
}

function uniqueId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

function routeFile(route: string, routes: AppRoute[]): string | undefined {
  return routes.find((r) => r.path === route)?.file;
}

/**
 * Token ops that make the project's design system the app's: add or update the app's tokens, and
 * remove AppShape's default tokens the app doesn't have (tokens the user made are kept).
 */
function tokenOps(current: Tokens, app: Tokens, defaults: Tokens): AnyOp[] {
  const ops: AnyOp[] = [];
  for (const [group, values] of Object.entries(current.groups)) {
    for (const [name, value] of Object.entries(values ?? {})) {
      const g = group as keyof Tokens["groups"];
      if (app.groups[g]?.[name] === undefined && defaults.groups[g]?.[name] === value) ops.push({ id: createId("op"), op: "setToken", group: g, name, value: null });
    }
  }
  for (const [group, values] of Object.entries(app.groups)) {
    for (const [name, value] of Object.entries(values ?? {})) {
      if (current.groups[group as keyof Tokens["groups"]]?.[name] === value) continue;
      ops.push({ id: createId("op"), op: "setToken", group: group as keyof Tokens["groups"], name, value });
    }
  }
  return ops;
}

/** Places new frames side by side in an "Imported pages" section, right of everything else. */
function placeFrames(project: Project, frames: Array<{ frameId: string; height: number }>): AnyOp[] {
  if (frames.length === 0) return [];
  let right = 0;
  for (const item of project.board.items) {
    const w = itemWidth(item, project);
    if ("x" in item) right = Math.max(right, item.x + w);
  }
  const gap = 200;
  const padding = 120;
  const x0 = project.board.items.length ? right + 400 : 0;
  const y0 = 0;
  const ops: AnyOp[] = [];
  let x = x0 + padding;
  let maxHeight = 0;
  const placements: BoardItem[] = [];
  for (const frame of frames) {
    placements.push({ type: "frame", id: createId("b"), frameId: frame.frameId, x, y: y0 + padding });
    x += 1280 + gap;
    maxHeight = Math.max(maxHeight, Math.min(frame.height, 12_000));
  }
  const section: BoardItem = { type: "section", id: createId("b"), name: "Imported pages", x: x0, y: y0, w: x - gap + padding - x0, h: maxHeight + padding * 2 };
  ops.push({ id: createId("op"), op: "addItem", item: section, index: 0 });
  for (const item of placements) ops.push({ id: createId("op"), op: "addItem", item });
  return ops;
}

function itemWidth(item: BoardItem, project: Project): number {
  switch (item.type) {
    case "frame": {
      const frame = project.frames.find((f) => f.id === item.frameId);
      const viewport = frame?.viewports.find((v) => v.id === item.viewportId) ?? frame?.viewports[0];
      return viewport?.width ?? 0;
    }
    case "section":
    case "image":
      return item.w;
    case "note":
      return item.w ?? 200;
    default:
      return 0;
  }
}
