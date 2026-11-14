/// <reference lib="dom" />
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { JsxIndex, type JsxSite } from "./locate";
import { type SourcePosition, SourceResolver } from "./sourcemaps";
import { type WalkedNode, type WalkResult, walkScript } from "./walk";

/** Where a captured element lives in the app's code. */
export interface Anchor {
  /** Relative to the app root. */
  file: string;
  line: number;
  col: number;
  /** JSX element name at the anchor (`div`, `Link`, `Sparkles`). */
  element: string;
  /** Component function containing the JSX. */
  component?: string;
  /** In a `.map()` callback. */
  repeated: boolean;
  /** Under a condition or passed as a prop. */
  conditional: boolean;
  /** `owner`: the element was created by a library; the anchor is the library component's call site. */
  via: "element" | "owner";
}

export interface CapturedNode extends Omit<WalkedNode, "kids" | "s" | "o"> {
  anchor?: Anchor;
  /** Hidden framework markup (e.g. Next.js metadata), not part of the design. */
  framework?: boolean;
  /** Index into `CapturedPage.owners`. */
  owner?: number;
  kids?: CapturedNode[];
}

export interface CapturedOwner {
  name: string;
  server?: boolean;
  parent?: number;
  key?: string;
  /** Where the component instance was created (`<Card …/>`), when that is in the app's code. */
  callSite?: Anchor;
}

export interface CapturedPage extends Omit<WalkResult, "root" | "stacks" | "owners"> {
  root: CapturedNode;
  owners: CapturedOwner[];
  /** elements: rendered by React (with a fiber); markup from the HTML shell (`#root`) has no anchor. */
  stats: { elements: number; anchored: number; viaOwner: number; static: number };
  warnings: string[];
}

export interface CaptureOptions {
  appRoot: string;
  resolver?: SourceResolver;
  /** CSS selectors whose content is redacted (from the project's redaction config). */
  redactSelectors?: readonly string[];
}

/** Opens Edge (or Chrome) without a window. */
export async function launchBrowser(options: { headless?: boolean } = {}): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const errors: unknown[] = [];
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: options.headless ?? true });
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    return await chromium.launch({ headless: options.headless ?? true });
  } catch {
    throw new Error(`No browser found for capturing (tried Edge and Chrome): ${String(errors[0])}`);
  }
}

/**
 * A browser context for capturing an app: only the app's own origin is reachable (analytics,
 * ads and other third-party requests are blocked) and animations are reduced.
 */
export async function captureContext(browser: Browser, appUrl: string, viewport = { width: 1280, height: 800 }, motion = false): Promise<BrowserContext> {
  const origin = new URL(appUrl).origin;
  // motion off (stable pictures), unless the animations themselves are checked
  const context = await browser.newContext({ viewport, reducedMotion: motion ? "no-preference" : "reduce", colorScheme: "light", serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    return route.abort("blockedbyclient");
  });
  return context;
}

/** Loads a page and waits until it has settled: network idle, fonts, lazy content scrolled into view. */
export async function loadPage(page: Page, url: string, settleMs = 300): Promise<void> {
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(settleMs);
  await settleAnimations(page);
}

/**
 * Lets script animations end: scroll-triggered entrances (framer-motion's `whileInView`) are still
 * running after the scroll, with `opacity: 0` inline. Finishes Web Animations and waits until inline
 * styles stop changing (at most 4 s).
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          const finish = () => {
            for (const animation of document.getAnimations()) {
              const end = animation.effect?.getComputedTiming().endTime;
              if (typeof end === "number" && Number.isFinite(end)) {
                try {
                  animation.finish();
                } catch {
                  // not finishable
                }
              }
            }
          };
          let quiet: ReturnType<typeof setTimeout>;
          const done = () => {
            observer.disconnect();
            clearTimeout(quiet);
            clearTimeout(limit);
            resolve();
          };
          const observer = new MutationObserver(() => {
            clearTimeout(quiet);
            quiet = setTimeout(done, 300);
            finish();
          });
          observer.observe(document.body, { attributes: true, attributeFilter: ["style"], subtree: true });
          finish();
          quiet = setTimeout(done, 300);
          const limit = setTimeout(done, 4000);
        }),
    )
    .catch(() => undefined);
}

/** Shows animations in their end state while capturing (the board shows frames the same way). */
/**
 * Marks every element that animates (`data-aps-animated`): CSS animations (`animationstart`), Web
 * Animations (`element.animate`, Motion's opacity and transforms) and script-driven inline styles
 * (Motion's `y`, `scale`). Added before the page's own scripts run.
 */
export const ANIMATION_MARKER = String.raw`(() => {
  const mark = (el) => { if (el && el.setAttribute) el.setAttribute("data-aps-animated", ""); };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { mark(this); return animate.apply(this, args); };
  document.addEventListener("animationstart", (e) => mark(e.target), true);
  new MutationObserver((records) => {
    for (const r of records) if (/opacity|transform|translate|scale|rotate/.test(r.target.getAttribute("style") || "")) mark(r.target);
  }).observe(document, { attributes: true, attributeFilter: ["style"], subtree: true });
})();`;

export const STILL_CSS = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important; }";

/** Captures the page as it is now (call `loadPage` first, or let the user navigate). */
export async function capturePage(page: Page, options: CaptureOptions): Promise<CapturedPage> {
  await settleAnimations(page);
  await page.evaluate((css) => {
    const style = document.createElement("style");
    style.setAttribute("data-aps-capture", "");
    style.textContent = css;
    document.head.appendChild(style);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, STILL_CSS);
  try {
    const walked = (await page.evaluate(walkScript({ redactSelectors: options.redactSelectors ?? [] }))) as WalkResult;
    return await resolveCapture(walked, options);
  } finally {
    await page.evaluate(() => document.querySelectorAll("style[data-aps-capture]").forEach((el) => el.remove())).catch(() => undefined);
  }
}

/** Turns stacks into anchors. Exported for tests that feed recorded walks. */
export async function resolveCapture(walked: WalkResult, options: CaptureOptions): Promise<CapturedPage> {
  const resolver = options.resolver ?? new SourceResolver(options.appRoot);
  const warnings: string[] = [];
  const indexes = new Map<string, Promise<JsxIndex | undefined>>();
  const indexFor = (file: string) => {
    let pending = indexes.get(file);
    if (!pending) {
      pending = readFile(join(options.appRoot, file), "utf8")
        .then((text) => new JsxIndex(file, text.replace(/\r\n/g, "\n")))
        .catch(() => undefined);
      indexes.set(file, pending);
    }
    return pending;
  };

  const siteCache = new Map<number, Promise<{ position: SourcePosition; site: JsxSite } | undefined>>();
  const siteFor = (stack: number | undefined) => {
    if (stack === undefined) return Promise.resolve(undefined);
    let pending = siteCache.get(stack);
    if (!pending) {
      pending = (async () => {
        const position = await resolver.callSite(walked.stacks[stack]!);
        if (!position) return undefined;
        const index = await indexFor(position.file);
        const site = index?.find(position.line, position.col);
        return site ? { position, site } : undefined;
      })();
      siteCache.set(stack, pending);
    }
    return pending;
  };

  const anchorOf = (site: JsxSite, file: string, via: Anchor["via"]): Anchor => ({
    file,
    line: site.line,
    col: site.col,
    element: site.element,
    ...(site.component && { component: site.component }),
    repeated: site.repeated,
    conditional: site.conditional,
    via,
  });

  const owners: CapturedOwner[] = [];
  for (const owner of walked.owners) {
    const entry: CapturedOwner = { name: owner.name };
    if (owner.server) entry.server = true;
    if (owner.parent !== undefined) entry.parent = owner.parent;
    if (owner.key !== undefined) entry.key = owner.key;
    const found = await siteFor(owner.s);
    if (found) entry.callSite = anchorOf(found.site, found.position.file, "element");
    owners.push(entry);
  }

  const stats = { elements: 0, anchored: 0, viaOwner: 0, static: 0 };
  const convert = async (node: WalkedNode): Promise<CapturedNode> => {
    const { kids, s, o, ...rest } = node;
    const out: CapturedNode = { ...rest };
    if (o !== undefined) out.owner = o;
    if (node.t !== "#text" && s === undefined && o === undefined) stats.static++;
    else if (node.t !== "#text") {
      stats.elements++;
      const found = await siteFor(s);
      if (found) {
        out.anchor = anchorOf(found.site, found.position.file, "element");
        stats.anchored++;
      } else {
        // Created by a library component: anchor at the nearest call site in app code.
        let current = o;
        let guard = 0;
        while (current !== undefined && guard++ < 50) {
          const owner = owners[current]!;
          if (owner.callSite) {
            out.anchor = { ...owner.callSite, via: "owner" };
            stats.anchored++;
            stats.viaOwner++;
            break;
          }
          current = owner.parent;
        }
        if (!out.anchor && node.hidden) {
          out.framework = true;
          stats.elements--;
          stats.static++;
        }
      }
    }
    if (kids) out.kids = await Promise.all(kids.map(convert));
    return out;
  };
  const root = await convert(walked.root);
  if (!walked.react) warnings.push("React was not found on the page (no fibers); elements have no source anchors.");
  if (resolver.misses.size > 0) warnings.push(`source maps missing for ${resolver.misses.size} script(s)`);
  const { stacks: _stacks, owners: _owners, root: _root, ...page } = walked;
  return { ...page, root, owners, stats, warnings };
}
