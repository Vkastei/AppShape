import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Changeset,
  type ChangesetTask,
  componentSources,
  type DesignNode,
  findNode,
  type Frame,
  type Project,
  type SourceAnchor,
  type Viewport,
  walk,
} from "@appshape/ir";
import type { VerifyReport } from "@appshape/protocol";
import type { Browser, Page } from "playwright-core";
import { type BoardInput, openBoardPage } from "./board";
import { ANIMATION_MARKER, type CapturedNode, type CapturedPage, captureContext, capturePage, launchBrowser, loadPage, STILL_CSS, settleAnimations } from "./capture";
import { absorbTextRuns, compareElement, extraTexts, matchElements } from "./compare";
import { lucideIconsDir } from "./icons";
import { type MeasuredElement, measureScript } from "./measure";
import { SourceResolver } from "./sourcemaps";
import { schemeQueries } from "./styles";

/**
 * Verification (M6): the running app compared with the design, page by page and viewport by
 * viewport. Both are rendered in the same browser and measured the same way (`measure.ts`); app
 * elements are matched to design elements (`compare.ts`) and checked for box, text, visual styles,
 * links, images and icons. Changeset tasks become checks on the elements they are about.
 */

export interface VerifyFramesInput {
  appRoot: string;
  dataDir: string;
  project: Project;
  devUrl: string;
  frameIds: readonly string[];
  /** Where screenshots and diff images go (absolute). Paths in results are relative to `dataDir`. */
  outDir: string;
  browser?: Browser;
  /** Only these viewport ids (default: all of each screen's). */
  viewports?: readonly string[];
  /** Allowed difference in px for sizes and positions (default 3; 3 % for large boxes). */
  tolerance?: number;
  /** Per screen: elements not held to the design (and what's inside them): drawings kept as notes. */
  exempt?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ElementResult {
  /** Design node id (or rendered id inside an instance). */
  key: string;
  label: string;
  /** Empty = as designed; `["missing"]` = not found in the app. */
  problems: string[];
}

export interface FrameResult {
  frameId: string;
  viewport: string;
  url: string;
  /** Set when the page could not be checked. */
  error?: string;
  elements: ElementResult[];
  /** Texts in the app that no design element accounts for, per design element whose subtree has them. */
  extra: Map<string, string[]>;
  /** App texts (for checking deletions). */
  appTexts: Set<string>;
  mismatchRatio?: number;
  images?: { design: string; app: string; diff: string };
  /** Imported pages that matched completely: what the code renders, with fresh anchors. */
  rebaseline?: DesignNode;
}

const DYNAMIC = /\[[^\]]+\]|\/:[\w]+|\$[\w]+/;

/** The URL a screen is checked at (the capture URL for imported pages, else its route). */
export function frameUrl(frame: Frame, devUrl: string): string | undefined {
  const path = frame.capture?.url ?? frame.target.route;
  if (!path || (!frame.capture?.url && DYNAMIC.test(path))) return undefined;
  return new URL(path, devUrl).href;
}

/** The imported app's CSS as the board uses it (none for apps that were never imported). */
export async function boardStyles(dataDir: string): Promise<Pick<BoardInput, "appCss" | "htmlClasses" | "layered">> {
  const read = (name: string) => readFile(join(dataDir, "styles", name), "utf8").catch(() => "");
  const [shadow, document, meta] = await Promise.all([read("app.css"), read("document.css"), read("meta.json")]);
  let parsed: { htmlClasses?: string[]; layered?: boolean } = {};
  try {
    parsed = JSON.parse(meta) as typeof parsed;
  } catch {
    // nothing imported
  }
  return { appCss: { shadow: schemeQueries(shadow), document }, htmlClasses: parsed.htmlClasses ?? [], layered: parsed.layered ?? false };
}

function label(node: DesignNode | undefined, element: MeasuredElement): string {
  const text = (element.text ?? element.own).slice(0, 40);
  const name = node?.name ?? (node?.platformRaw?.element && node.platformRaw.element !== "#text" ? node.platformRaw.element : undefined) ?? element.tag;
  return `<${name}>${text ? ` "${text}${(element.text ?? element.own).length > 40 ? "…" : ""}"` : ""}`;
}

/** Checks the given screens at each of their viewports. */
export async function verifyFrames(input: VerifyFramesInput): Promise<FrameResult[]> {
  const browser = input.browser ?? (await launchBrowser());
  const styles = await boardStyles(input.dataDir);
  const sources = componentSources(input.project.frames);
  const routes = new Map(input.project.frames.filter((f) => f.target.route).map((f) => [f.id, f.target.route!]));
  const iconsDir = lucideIconsDir();
  const iconCache = new Map<string, string | undefined>();
  const iconShapes = (name: string) => iconCache.get(name);
  const resolver = new SourceResolver(input.appRoot);
  const results: FrameResult[] = [];
  await mkdir(input.outDir, { recursive: true });
  try {
    for (const frameId of input.frameIds) {
      const frame = input.project.frames.find((f) => f.id === frameId);
      if (!frame) continue;
      const url = frameUrl(frame, input.devUrl);
      for (const viewport of frame.viewports.filter((v) => !input.viewports?.length || input.viewports.includes(v.id))) {
        const base: FrameResult = { frameId, viewport: viewport.id, url: url ?? "", elements: [], extra: new Map(), appTexts: new Set() };
        if (!url) {
          results.push({ ...base, error: `${frame.name} has no URL to check (no route, or a dynamic route without an example)` });
          continue;
        }
        // icons the design uses, for recognizing them in the app by their shapes
        walk(frame.current, (n) => {
          if (n.type === "icon" && !iconCache.has(n.icon)) iconCache.set(n.icon, undefined);
        });
        for (const name of iconCache.keys()) {
          if (iconCache.get(name) === undefined) iconCache.set(name, await readFile(join(iconsDir, `${name}.svg`), "utf8").catch(() => ""));
        }
        results.push(await verifyViewport(browser, input, frame, viewport, url, { ...styles, sources, routes, iconShapes, resolver }));
      }
    }
  } finally {
    if (!input.browser) await browser.close();
  }
  return results;
}

interface ViewportContext extends Pick<BoardInput, "appCss" | "htmlClasses" | "layered"> {
  sources: ReturnType<typeof componentSources>;
  routes: Map<string, string>;
  iconShapes: (name: string) => string | undefined;
  resolver: SourceResolver;
}

async function verifyViewport(browser: Browser, input: VerifyFramesInput, frame: Frame, viewport: Viewport, url: string, ctx: ViewportContext): Promise<FrameResult> {
  const result: FrameResult = { frameId: frame.id, viewport: viewport.id, url, elements: [], extra: new Map(), appTexts: new Set() };
  const size = { width: viewport.width, height: viewport.height ?? 800 };
  const slug = `${frame.id}-${viewport.id}`;

  // ---- the design, as the board renders it
  const boardPage = await openBoardPage(browser, {
    root: frame.current,
    tokens: input.project.tokens,
    components: input.project.components,
    sources: ctx.sources,
    ...(ctx.appCss && { appCss: ctx.appCss }),
    ...(ctx.htmlClasses && { htmlClasses: ctx.htmlClasses }),
    ...(ctx.layered !== undefined && { layered: ctx.layered }),
    width: size.width,
    height: size.height,
    appRoot: input.appRoot,
    dataDir: input.dataDir,
  });
  let design: MeasuredElement[];
  let designShot: Buffer;
  // texts the design shows without an element of their own (form fields' labels)
  let fieldLabels = new Set<string>();
  try {
    const measured = (await boardPage.evaluate(measureScript("board"))) as { elements: MeasuredElement[]; labels?: string[] };
    design = measured.elements;
    fieldLabels = new Set(measured.labels ?? []);
    // the element names of the app (the root is <body>), without imported text runs (bare text in the app)
    const nodesById = new Map<string, DesignNode>();
    walk(frame.current, (n) => void nodesById.set(n.id, n));
    for (const d of design) {
      const tag = d.key ? nodesById.get(d.key)?.platformRaw?.tag : undefined;
      if (tag && tag !== "span") d.tag = tag;
    }
    design = absorbTextRuns(design, (d) => d.key !== undefined && nodesById.get(d.key)?.platformRaw?.element === "#text");
    designShot = await boardPage.screenshot({ fullPage: true });
  } finally {
    await boardPage.close();
  }

  // ---- the app
  const context = await captureContext(browser, input.devUrl, size);
  const appPage = await context.newPage();
  try {
    try {
      await loadPage(appPage, url);
    } catch (error) {
      return { ...result, error: `${url} did not load: ${(error as Error).message.split("\n")[0]}` };
    }
    await appPage.addStyleTag({ content: STILL_CSS });
    await appPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const app = ((await appPage.evaluate(measureScript("app"))) as { elements: MeasuredElement[] }).elements;
    const appShot = await appPage.screenshot({ fullPage: true });
    for (const a of app) if (a.vis && a.own) result.appTexts.add(a.own);

    // ---- compare
    const match = matchElements(design, app);
    const nodes = new Map<string, DesignNode>();
    walk(frame.current, (n) => void nodes.set(n.id, n));
    const routeOf = (id: string) => ctx.routes.get(id);
    const redacted = new Set<string>();
    walk(frame.current, (n) => {
      if (n.redacted) walk(n, (inner) => void redacted.add(inner.id));
    });
    let complete = true;
    // elements a drawing asks to change (and everything inside them) aren't held to the design
    const free = new Set<number>();
    const exempt = input.exempt?.get(frame.id);
    if (exempt?.size) design.forEach((d, di) => d.key !== undefined && exempt.has(d.key) && Array.from({ length: d.end - di + 1 }, (_, k) => free.add(di + k)));
    for (let di = 0; di < design.length; di++) {
      const d = design[di]!;
      if (!d.vis || d.key === undefined || free.has(di)) continue;
      const problems = compareElement(design, app, match, di, { routeOf, iconShapes: ctx.iconShapes, redacted, ...(input.tolerance !== undefined && { tolerance: input.tolerance }) });
      if (problems.length) complete = false;
      result.elements.push({ key: d.key, label: label(nodes.get(d.key), d), problems });
      const ai = match.get(di);
      if (ai !== undefined && d.end > di) {
        const extra = extraTexts(design, app, match, ai, free).filter((t) => !hasDescendantText(design, di, t) && !fieldLabels.has(t));
        // only the innermost design element reports an extra text
        if (extra.length) result.extra.set(d.key, extra);
      }
    }
    // texts reported by an element are not reported by its ancestors again
    for (const [key, texts] of result.extra) {
      const di = design.findIndex((e) => e.key === key);
      const inner = new Set<string>();
      for (const [other, otherTexts] of result.extra) {
        const oi = design.findIndex((e) => e.key === other);
        if (oi > di && oi <= design[di]!.end) for (const t of otherTexts) inner.add(t);
      }
      const own = texts.filter((t) => !inner.has(t));
      if (own.length) result.extra.set(key, own);
      else result.extra.delete(key);
    }
    if (result.extra.size) complete = false;

    // ---- animations: each one the design has plays in the app (checked with motion on)
    const animated = animatedKeys(frame.current);
    if (animated.own.size || animated.children.size) {
      const moving = await animatedInApp(browser, input.devUrl, url, size);
      if (moving) {
        for (const [di, problem] of animationProblems(design, moving, matchElements(design, moving), animated)) {
          const element = result.elements.find((e) => e.key === design[di]!.key);
          if (element && !element.problems.includes("missing")) {
            element.problems.push(problem);
            complete = false;
          }
        }
      }
    }

    // ---- visual diff (reported, not pass/fail)
    const diff = await diffImages(browser, designShot, appShot);
    const rel = (name: string) => join(input.outDir, name);
    await Promise.all([
      writeFile(rel(`${slug}-design.png`), designShot),
      writeFile(rel(`${slug}-app.png`), appShot),
      writeFile(rel(`${slug}-diff.png`), diff.image),
    ]);
    result.mismatchRatio = diff.ratio;
    const relative = (name: string) => join(input.outDir, name).slice(input.dataDir.length + 1).replace(/\\/g, "/");
    result.images = { design: relative(`${slug}-design.png`), app: relative(`${slug}-app.png`), diff: relative(`${slug}-diff.png`) };

    // ---- imported pages that match completely: the code's new baseline, anchored again
    if (complete && frame.kind === "imported" && viewport.id === frame.viewports[0]?.id) {
      const captured = await capturePage(appPage, { appRoot: input.appRoot, resolver: ctx.resolver }).catch(() => undefined);
      if (captured) result.rebaseline = rebaseline(frame.current, design, match, captured);
    }
  } finally {
    await context.close();
  }
  return result;
}

function hasDescendantText(design: readonly MeasuredElement[], di: number, text: string): boolean {
  for (let i = di + 1; i <= design[di]!.end; i++) if ((design[i]!.text ?? design[i]!.own).includes(text)) return true;
  return false;
}

/**
 * The design as the code's new baseline: each node gets the anchor and classes of the app element
 * that renders it (from a fresh capture); nodes without one lose their anchor (later edits to them
 * go to the agent).
 */
/** Elements that animate in the design (by node id, with the preset): the element itself, or with a stagger its children. */
export function animatedKeys(root: DesignNode): { own: Map<string, string>; children: Map<string, string> } {
  const own = new Map<string, string>();
  const children = new Map<string, string>();
  walk(root, (node) => {
    const motion = node.style?.motion;
    if (!motion) return;
    (motion.stagger ? children : own).set(node.id, motion.preset);
  });
  return { own, children };
}

/** The app with motion on, scrolled through: its elements, each marked when it animated. */
async function animatedInApp(browser: Browser, devUrl: string, url: string, size: { width: number; height: number }): Promise<MeasuredElement[] | undefined> {
  const context = await captureContext(browser, devUrl, size, true);
  try {
    await context.addInitScript(ANIMATION_MARKER);
    const page = await context.newPage();
    await loadPage(page, url);
    // scroll through again, step by step: scroll-in animations start when their element comes into view
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += Math.round(size.height * 0.6)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
    }
    await settleAnimations(page);
    await page.addStyleTag({ content: STILL_CSS });
    return ((await page.evaluate(measureScript("app"))) as { elements: MeasuredElement[] }).elements;
  } catch {
    return undefined;
  } finally {
    await context.close();
  }
}

/**
 * Design elements whose animation doesn't play in the app (by index in `design`, with the
 * problem): `app` measured with motion on, `match` from design to app.
 */
export function animationProblems(design: readonly MeasuredElement[], app: readonly MeasuredElement[], match: ReadonlyMap<number, number>, animated: ReturnType<typeof animatedKeys>): Map<number, string> {
  const problems = new Map<number, string>();
  design.forEach((d, di) => {
    if (!d.vis || d.key === undefined) return;
    const parent = d.p >= 0 ? design[d.p]?.key : undefined;
    const preset = animated.own.get(d.key) ?? (parent !== undefined ? animated.children.get(parent) : undefined);
    if (!preset) return;
    const ai = match.get(di);
    if (ai === undefined) return;
    // the element or a wrapper of it (a motion.div around a card), up to the design parent's element
    const stop = d.p >= 0 ? match.get(d.p) : undefined;
    for (let i: number | undefined = ai; i !== undefined && i >= 0 && i !== stop; i = app[i]?.p) if (app[i]?.anim) return;
    problems.set(di, `no animation in the app (the design has "${preset}")`);
  });
  return problems;
}

export function rebaseline(tree: DesignNode, design: readonly MeasuredElement[], match: ReadonlyMap<number, number>, captured: CapturedPage): DesignNode {
  const byMarker = new Map<number, CapturedNode>();
  const count = new Map<string, number>();
  const anchorKey = (n: CapturedNode) => (n.anchor ? `${n.anchor.file}:${n.anchor.line}:${n.anchor.col}` : undefined);
  const visit = (n: CapturedNode) => {
    const marker = n.attrs?.["data-aps-m"];
    if (marker !== undefined) byMarker.set(Number(marker), n);
    const key = anchorKey(n);
    if (key) count.set(key, (count.get(key) ?? 0) + 1);
    for (const kid of n.kids ?? []) visit(kid);
  };
  visit(captured.root);
  const seen = new Map<string, number>();
  const anchors = new Map<number, { source: SourceAnchor; classes: string[] }>();
  const ordered = [...byMarker.entries()].sort(([a], [b]) => a - b);
  for (const [marker, n] of ordered) {
    const a = n.anchor;
    const key = anchorKey(n);
    if (!a || !key) continue;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const total = count.get(key) ?? 1;
    const owner = n.owner !== undefined ? captured.owners[n.owner]?.name : undefined;
    anchors.set(marker, {
      source: {
        file: a.file,
        line: a.line,
        col: a.col,
        ...(a.component && { component: a.component }),
        ...(owner && owner !== a.component && { owner }),
        ...(total > 1 && { repeated: { count: total, index, ...(n.key !== undefined && { key: n.key }) } }),
      },
      classes: n.cls ?? [],
    });
  }
  const designIndex = new Map(design.map((e, i) => [e.key, i]));
  const copy = structuredClone(tree);
  walk(copy, (node) => {
    const di = designIndex.get(node.id);
    const ai = di !== undefined ? match.get(di) : undefined;
    const found = ai !== undefined ? anchors.get(ai) : undefined;
    if (found) {
      node.source = found.source;
      node.platformRaw = { ...node.platformRaw, ...(found.classes.length ? { classes: found.classes } : {}) };
    } else if (node.platformRaw?.element !== "#text") {
      delete node.source;
    }
  });
  return copy;
}

// A string, not a function: the bundler would add helpers the page doesn't have.
const DIFF_SCRIPT = String.raw`(async () => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(__A__), load(__B__)]);
  const w = Math.max(ia.width, ib.width);
  const h = Math.max(ia.height, ib.height);
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  };
  const da = read(ia);
  const db = read(ib);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const og = out.getContext("2d");
  const diff = og.createImageData(w, h);
  let differing = 0;
  for (let i = 0; i < da.length; i += 4) {
    const delta = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    if (delta > 40) {
      differing++;
      diff.data[i] = 230; diff.data[i + 1] = 30; diff.data[i + 2] = 30; diff.data[i + 3] = 255;
    } else {
      const l = 255 - (255 - (0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2])) * 0.15;
      diff.data[i] = l; diff.data[i + 1] = l; diff.data[i + 2] = l; diff.data[i + 3] = 255;
    }
  }
  og.putImageData(diff, 0, 0);
  return JSON.stringify({ ratio: differing / (w * h), url: out.toDataURL("image/png") });
})()`;

/** Pixel difference of two screenshots, computed in the browser: ratio of differing pixels and a diff image. */
export async function diffImages(browser: Browser, a: Buffer, b: Buffer): Promise<{ ratio: number; image: Buffer }> {
  const page: Page = await browser.newPage();
  try {
    const dataUrl = (await page.evaluate(DIFF_SCRIPT.replace("__A__", JSON.stringify(`data:image/png;base64,${a.toString("base64")}`)).replace("__B__", JSON.stringify(`data:image/png;base64,${b.toString("base64")}`)))) as string;
    const parsed = JSON.parse(dataUrl) as { ratio: number; url: string };
    return { ratio: Math.round(parsed.ratio * 10000) / 10000, image: Buffer.from(parsed.url.slice(parsed.url.indexOf(",") + 1), "base64") };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Changesets

export interface VerifyChangesetInput extends Omit<VerifyFramesInput, "frameIds"> {
  changeset: Changeset;
  /** Only these changes (c1, c2, …). */
  changeIds?: readonly string[];
  /** What the code rendered before (code state of imported pages), for checking deletions. */
  before?: Readonly<Record<string, { tree: DesignNode }>>;
  now?: string;
}

export interface VerifyChangesetResult {
  report: VerifyReport;
  frames: FrameResult[];
}

type Check = VerifyReport["results"][number]["checks"][number];

/** Design node ids of a node's subtree, plus the rendered ids inside its instances. */
function subtreeKeys(node: DesignNode): { ids: Set<string>; instances: string[] } {
  const ids = new Set<string>();
  const instances: string[] = [];
  walk(node, (n) => {
    ids.add(n.id);
    if (n.type === "instance") instances.push(n.id);
  });
  return { ids, instances };
}

const inSubtree = (keys: ReturnType<typeof subtreeKeys>, key: string) => keys.ids.has(key) || keys.instances.some((i) => key.startsWith(`${i}/`));

const textOfNode = (node: DesignNode): string => {
  const parts: string[] = [];
  walk(node, (n) => {
    if (n.type === "text") parts.push(n.text);
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
};

/** The screens a task is checked on, and which part of them. */
interface Target {
  frameId: string;
  /** Undefined = the whole screen. */
  nodeId?: string;
  /** Deleted element: its text must be gone. */
  deleted?: DesignNode;
}

function targetsOf(task: Pick<ChangesetTask, "kind" | "frameId" | "nodeId">, project: Project, before: VerifyChangesetInput["before"]): Target[] {
  const frame = task.frameId ? project.frames.find((f) => f.id === task.frameId) : undefined;
  if (!frame) return [];
  if (frame.kind === "component") {
    // a component: its instances on the screens
    const out: Target[] = [];
    for (const screen of project.frames) {
      if (screen.kind === "component") continue;
      walk(screen.current, (n) => {
        if (n.type === "instance" && n.componentId === frame.id) out.push({ frameId: screen.id, nodeId: n.id });
      });
    }
    return out;
  }
  if (!task.nodeId) return [{ frameId: frame.id }];
  if (findNode(frame.current, task.nodeId)) return [{ frameId: frame.id, nodeId: task.nodeId }];
  const old = (before?.[frame.id]?.tree && findNode(before[frame.id]!.tree, task.nodeId)?.node) ?? (frame.baseline && findNode(frame.baseline, task.nodeId)?.node);
  return old ? [{ frameId: frame.id, deleted: old }] : [{ frameId: frame.id }];
}

function checksFor(target: Target, frames: readonly FrameResult[], project: Project): Check[] {
  const checks: Check[] = [];
  const frame = project.frames.find((f) => f.id === target.frameId)!;
  for (const result of frames.filter((r) => r.frameId === target.frameId)) {
    const where = frame.viewports.length > 1 ? ` (${result.viewport})` : "";
    if (result.error) {
      checks.push({ text: `${frame.name}${where} can be checked`, status: "skipped", detail: result.error });
      continue;
    }
    if (target.deleted) {
      const text = textOfNode(target.deleted);
      if (!text) checks.push({ text: `Removed element is gone from ${frame.name}${where}`, status: "skipped", detail: "the element has no text to look for" });
      else {
        const still = [...result.appTexts].some((t) => t === text || (text.length > 12 && t.includes(text)));
        checks.push({ text: `"${text.slice(0, 60)}" is gone from ${frame.name}${where}`, status: still ? "fail" : "pass", ...(still && { detail: "still on the page" }) });
      }
      continue;
    }
    const node = target.nodeId ? findNode(frame.current, target.nodeId)?.node : frame.current;
    if (!node) continue;
    const keys = subtreeKeys(node);
    const elements = result.elements.filter((e) => inSubtree(keys, e.key));
    const failing = elements.filter((e) => e.problems.length > 0);
    for (const e of failing.slice(0, 12)) {
      checks.push({ text: `${e.label}${where}`, status: "fail", detail: e.problems[0] === "missing" ? "not found where the design has it" : e.problems.join("; ") });
    }
    if (failing.length > 12) checks.push({ text: `${failing.length - 12} more elements differ${where}`, status: "fail" });
    const extra = [...result.extra].filter(([key]) => inSubtree(keys, key)).flatMap(([, texts]) => texts);
    if (extra.length) checks.push({ text: `No other content${where}`, status: "fail", detail: `not in the design: ${extra.slice(0, 5).map((t) => `"${t.slice(0, 40)}"`).join(", ")}` });
    if (!failing.length && !extra.length) {
      const what = target.nodeId ? (elements[0]?.label ?? "The element") : frame.name;
      checks.push({ text: `${what} matches the design${where}`, status: elements.length ? "pass" : "skipped", ...(!elements.length && { detail: "nothing visible to check at this size" }) });
    }
  }
  return checks;
}

const overall = (checks: readonly Check[]): Check["status"] =>
  checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "pass") ? "pass" : "skipped";

/**
 * Verifies a changeset: its tasks (handoff) or design changes (ops), on every screen they touch.
 * Tasks without a screen (routes, theme, setup) pass when all checked screens pass.
 */
export async function verifyChangeset(input: VerifyChangesetInput): Promise<VerifyChangesetResult> {
  const { changeset, project } = input;
  const items: { id: string; targets: Target[] }[] = [];
  for (const task of changeset.tasks ?? []) items.push({ id: task.id, targets: targetsOf(task, project, input.before) });
  for (const change of changeset.changes ?? []) {
    const targets = change.opIds.flatMap((opId) => {
      const op = changeset.ops.find((o) => o.id === opId);
      if (!op) return [];
      return targetsOf({ kind: "element", frameId: op.frameId, ...("nodeId" in op && op.nodeId ? { nodeId: op.nodeId as string } : {}) }, project, input.before);
    });
    items.push({ id: change.id, targets });
  }
  const selected = input.changeIds?.length ? items.filter((i) => input.changeIds!.includes(i.id)) : items;
  const frameIds = [...new Set(selected.flatMap((i) => i.targets.map((t) => t.frameId)))];
  // drawings kept as notes: what they touch may look different from the design
  const exempt = new Map<string, Set<string>>();
  for (const task of changeset.tasks ?? []) {
    if (!task.drawn?.length || !task.frameId) continue;
    const set = exempt.get(task.frameId) ?? exempt.set(task.frameId, new Set()).get(task.frameId)!;
    for (const id of task.drawn) set.add(id);
  }
  const frames = frameIds.length ? await verifyFrames({ ...input, frameIds, ...(exempt.size && { exempt }) }) : [];

  const results: VerifyReport["results"] = [];
  for (const item of selected) {
    const checks = item.targets.flatMap((t) => checksFor(t, frames, project));
    // a behavior or data note: the element is checked, what it does can't be seen in a picture
    const task = changeset.tasks?.find((t) => t.id === item.id);
    const unseen = task?.kind === "note" ? /^(Behavior|Data|Intent|Question|Note): (.+)$/s.exec(task.title) : null;
    if (unseen) checks.push({ text: `${unseen[1]} not checked: it can't be seen in a picture`, status: "skipped", detail: `try it in the app: ${unseen[2]!.slice(0, 160)}` });
    if (task?.drawn?.length) checks.push({ text: `What the drawing changes isn't in the design: check ${task.drawn.length === 1 ? "that element" : `those ${task.drawn.length} elements`} by eye`, status: "skipped", detail: "the rest of the screen is checked against the design" });
    results.push({ changeId: item.id, status: checks.length ? overall(checks) : "skipped", checks });
  }
  // screen-less tasks (routes, theme, setup): covered by the screens
  const pagesOk = frames.every((f) => f.error || (f.elements.every((e) => !e.problems.length) && f.extra.size === 0));
  for (const r of results) {
    if (r.checks.length === 0) {
      r.checks.push({ text: "All checked screens match the design", status: frames.length ? (pagesOk ? "pass" : "fail") : "skipped", ...(!frames.length && { detail: "no screen to check" }) });
      r.status = r.checks[0]!.status;
    }
  }
  const report: VerifyReport = {
    changesetId: changeset.id,
    status: results.some((r) => r.status === "fail") || !results.some((r) => r.status === "pass") ? "needs_fix" : "verified",
    checkedAt: input.now ?? new Date().toISOString(),
    results,
    visual: frames
      .filter((f) => f.mismatchRatio !== undefined)
      .map((f) => ({ frameId: f.frameId, viewport: f.viewport, mismatchRatio: f.mismatchRatio!, ...(f.images && { diffImage: f.images.diff }) })),
  };
  return { report, frames };
}

/**
 * Imported pages that matched completely at their first viewport (the one they were captured at):
 * their re-baselined trees.
 */
export function rebaselines(frames: readonly FrameResult[]): Record<string, DesignNode> {
  return Object.fromEntries(frames.filter((f) => f.rebaseline).map((f) => [f.frameId, f.rebaseline!]));
}

