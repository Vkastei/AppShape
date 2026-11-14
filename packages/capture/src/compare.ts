import { type MeasuredElement, TEXT_PROPS } from "./measure";

/**
 * Design ↔ app comparison of two measured pages (see `measure.ts`): which app element renders which
 * design element, and where they differ. Pure, so it can be tested without a browser.
 */

type Rect = MeasuredElement["r"];

const MIN_SCORE = 0.45;
const TIE = 0.02;

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCKS = new Set(["div", "section", "main", "header", "footer", "nav", "article", "aside", "ul", "ol", "li", "form", "p", "span", "label", "figure", "blockquote", "dl", "dt", "dd", "body"]);

/**
 * Removes design elements that are bare text in the app (imported text runs, rendered as spans on
 * the board) and gives their text to the parent, so both sides have the same elements.
 */
export function absorbTextRuns(design: readonly MeasuredElement[], isRun: (e: MeasuredElement) => boolean): MeasuredElement[] {
  const kept: MeasuredElement[] = [];
  const index = new Map<number, number>();
  const keptAncestor = (i: number): number => {
    let p = design[i]!.p;
    while (p >= 0 && !index.has(p)) p = design[p]!.p;
    return p >= 0 ? index.get(p)! : -1;
  };
  for (let i = 0; i < design.length; i++) {
    const e = design[i]!;
    const parent = keptAncestor(i);
    if (isRun(e) && parent >= 0) {
      const target = kept[parent]!;
      target.own = [target.own, e.own || e.text || ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    index.set(i, kept.length);
    kept.push({ ...e, p: parent });
  }
  for (let i = design.length - 1; i >= 0; i--) {
    const at = index.get(i);
    if (at === undefined) continue;
    let end = at;
    for (let j = design[i]!.end; j > i; j--) {
      const k = index.get(j);
      if (k !== undefined) {
        end = k;
        break;
      }
    }
    kept[at]!.end = end;
  }
  return kept;
}

export function iou(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  if (union <= 0) return a[0] === b[0] && a[1] === b[1] ? 1 : 0;
  return inter / union;
}

const relative = (r: Rect, parent: Rect | undefined): Rect => (parent ? [r[0] - parent[0], r[1] - parent[1], r[2], r[3]] : r);

function tagScore(a: string, b: string): number {
  if (a === b) return 1;
  if (HEADINGS.has(a) && HEADINGS.has(b)) return 0.7;
  if (BLOCKS.has(a) && BLOCKS.has(b)) return 0.5;
  if ((a === "a" || a === "button") && (b === "a" || b === "button")) return 0.6;
  if ((a === "img" || a === "svg") && (b === "img" || b === "svg")) return 0.4;
  return 0;
}

const textOf = (e: MeasuredElement) => e.text ?? e.own;

function textScore(d: MeasuredElement, a: MeasuredElement): number {
  const dt = textOf(d);
  const at = textOf(a);
  if (!dt && !at) return 1;
  if (!dt || !at) return 0.3;
  if (dt === at) return 1;
  if (at.includes(dt) || dt.includes(at)) return 0.7;
  const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter(Boolean));
  const x = words(dt);
  const y = words(at);
  const common = [...x].filter((w) => y.has(w)).length;
  return common / Math.max(1, new Set([...x, ...y]).size);
}

/**
 * Which app element renders each design element: greedy in document order, among the unmatched
 * visible elements inside the app match of the nearest matched design ancestor. Scored by the box
 * relative to the parents (so a shift above doesn't break everything below), the tag and the text.
 * Wrappers the app has in addition are skipped naturally (same box: the shallower one is taken for
 * containers, the deeper one for leaves).
 */
export function matchElements(design: readonly MeasuredElement[], app: readonly MeasuredElement[]): Map<number, number> {
  const match = new Map<number, number>();
  const used = new Set<number>();
  for (let di = 0; di < design.length; di++) {
    const d = design[di]!;
    if (!d.vis) continue;
    // nearest matched design ancestor → scope in the app
    let anc = d.p;
    while (anc >= 0 && !match.has(anc)) anc = design[anc]!.p;
    const scope = anc >= 0 ? match.get(anc)! : -1;
    const from = scope + 1;
    const to = scope >= 0 ? app[scope]!.end : app.length - 1;
    const dRect = relative(d.r, anc >= 0 ? design[anc]!.r : undefined);
    const leaf = d.end === di;
    let best: { index: number; score: number } | undefined;
    let top = 0;
    for (let ai = from; ai <= to; ai++) {
      const a = app[ai]!;
      if (!a.vis || used.has(ai)) continue;
      const geo = iou(dRect, relative(a.r, scope >= 0 ? app[scope]!.r : undefined));
      // a direct child of the parent's match keeps wrapper chains aligned level by level
      const score = 0.45 * geo + 0.2 * tagScore(d.tag, a.tag) + 0.25 * textScore(d, a) + (a.p === scope ? 0.1 : 0);
      // ties: the first (shallowest) for containers, the last (deepest) for leaves
      if (!best || score > best.score + TIE || (leaf && score >= top - TIE)) best = { index: ai, score };
      top = Math.max(top, score);
    }
    if (best && top >= MIN_SCORE && best.score >= MIN_SCORE - TIE) {
      match.set(di, best.index);
      used.add(best.index);
    }
  }
  return match;
}

export interface CompareContext {
  /** Route of a screen (for links with a target screen). */
  routeOf?: (frameId: string) => string | undefined;
  /** Design elements whose content was redacted on import: their text, links and size can't match. */
  redacted?: ReadonlySet<string>;
  /** Allowed difference in px for sizes and positions (default 3). */
  tolerance?: number;
  /** An icon's shapes (lucide svg markup), to recognize icons the app draws without lucide classes. */
  iconShapes?: (name: string) => string | undefined;
}

/** Sizes and positions may differ by text rounding (wrapped lines): 3 px (or the setting) or 3 %. */
const allowed = (v: number, min: number) => Math.max(min, Math.abs(v) * 0.03);
const px = (v: number) => `${Math.round(v)}px`;

function samePath(a: string, b: string): boolean {
  const path = (href: string) => {
    try {
      const url = new URL(href, "http://x");
      return url.origin === "http://x" ? url.pathname.replace(/\/+$/, "") || "/" : url.href;
    } catch {
      return href;
    }
  };
  return path(a) === path(b);
}

/** Image identity: the file name (Next's `/_next/image?url=` unwrapped, queries ignored). */
export function imageName(src: string): string {
  try {
    const url = new URL(src, "http://x");
    const inner = url.pathname.endsWith("/_next/image") ? url.searchParams.get("url") : null;
    const path = inner ? new URL(inner, "http://x").pathname : url.pathname;
    return decodeURIComponent(path.split("/").pop() ?? "");
  } catch {
    return src;
  }
}

const shapes = (svg: string) => (svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g) ?? []).map((s) => s.replace(/\s*\/?>$/, "").replace(/\s+/g, " ").replace(/ (class|stroke-width|fill|stroke)="[^"]*"/g, "")).sort().join("|");

function sameStyle(prop: string, a: string, b: string): boolean {
  if (a === b) return true;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  // "full" radii: 9999px vs calc(infinity * 1px)
  if (prop.endsWith("radius") && na >= 1000 && nb >= 1000) return true;
  if (/^-?[\d.]+(px)?$/.test(a) && /^-?[\d.]+(px)?$/.test(b)) return Math.abs(na - nb) <= (prop === "opacity" ? 0.02 : 0.5);
  if (prop === "font-weight") return na === nb;
  return false;
}

/** Where an app element differs from the design element it renders. Empty = the same. */
export function compareElement(
  design: readonly MeasuredElement[],
  app: readonly MeasuredElement[],
  match: ReadonlyMap<number, number>,
  di: number,
  ctx: CompareContext = {},
): string[] {
  const d = design[di]!;
  const ai = match.get(di);
  if (ai === undefined) return ["missing"];
  const a = app[ai]!;
  const problems: string[] = [];
  const min = ctx.tolerance ?? 3;
  const tolerance = (v: number) => allowed(v, min);

  // size, and position inside the parent (both parents matched)
  const redacted = d.key !== undefined && ctx.redacted?.has(d.key) === true;
  if (!redacted && Math.abs(d.r[2] - a.r[2]) > tolerance(d.r[2])) problems.push(`width ${px(d.r[2])} (found ${px(a.r[2])})`);
  if (!redacted && Math.abs(d.r[3] - a.r[3]) > tolerance(d.r[3])) problems.push(`height ${px(d.r[3])} (found ${px(a.r[3])})`);
  const dp = d.p >= 0 ? d.p : undefined;
  const ap = dp !== undefined ? match.get(dp) : undefined;
  if (dp !== undefined && ap !== undefined) {
    const dx = d.r[0] - design[dp]!.r[0];
    const dy = d.r[1] - design[dp]!.r[1];
    const ax = a.r[0] - app[ap]!.r[0];
    const ay = a.r[1] - app[ap]!.r[1];
    if (Math.abs(dx - ax) > tolerance(design[dp]!.r[2]) || Math.abs(dy - ay) > tolerance(design[dp]!.r[3])) {
      problems.push(`position ${px(dx)}, ${px(dy)} in its parent (found ${px(ax)}, ${px(ay)})`);
    }
  }

  // text
  const dt = textOf(d);
  const at = textOf(a);
  // (a select's text is all its options in the app, the chosen one on the board)
  if (!redacted && d.tag !== "select" && dt && dt !== at && d.end === di) problems.push(`text "${dt.slice(0, 80)}" (found "${(at ?? "").slice(0, 80)}")`);

  // styles: text properties only where there is text (or an icon, for color)
  const hasText = Boolean(d.own || a.own || d.icon);
  for (const [prop, value] of Object.entries(d.s)) {
    if (TEXT_PROPS.has(prop) && !hasText) continue;
    if (prop.endsWith("-color") && prop.startsWith("border-")) {
      const side = prop.slice("border-".length, -"-color".length);
      if (parseFloat(d.s[`border-${side}-width`] ?? "0") === 0 && parseFloat(a.s[`border-${side}-width`] ?? "0") === 0) continue;
    }
    if (prop === "object-fit" && d.tag !== "img") continue;
    // the board paints icons as a mask over their background; the app strokes an svg (color counts)
    if (d.icon && (prop === "background-color" || prop === "background-image")) continue;
    const found = a.s[prop] ?? "";
    if (!sameStyle(prop, value, found)) problems.push(`${prop} ${value} (found ${found || "none"})`);
  }

  // link, image, icon
  const target = d.target ? ctx.routeOf?.(d.target) : undefined;
  const href = target ?? d.href;
  // "#": a link without a target yet (routers resolve it to the current page)
  if (href && href !== "#" && d.tag === "a" && !redacted) {
    if (!a.href) problems.push(`links to ${href} (found no link)`);
    else if (!samePath(href, a.href)) problems.push(`links to ${href} (found ${a.href})`);
  }
  if (d.tag === "img" && d.src && !d.src.startsWith("data:") && a.src !== undefined && imageName(d.src) !== imageName(a.src)) {
    problems.push(`image ${imageName(d.src)} (found ${imageName(a.src) || "none"})`);
  }
  if (d.icon && a.icon !== d.icon) {
    const expected = ctx.iconShapes?.(d.icon);
    const same = expected !== undefined && a.svg !== undefined && shapes(expected) === shapes(`${a.svg}`);
    if (!same) problems.push(`icon ${d.icon} (found ${a.icon ?? (a.tag === "svg" ? "another icon" : a.tag)})`);
  }
  return problems;
}

/**
 * App elements with text that no design element accounts for, inside `scope` (an app index):
 * unmatched, visible, with own text, and under a matched element whose design element has children
 * (text inside a matched design leaf is part of that leaf).
 */
export function extraTexts(design: readonly MeasuredElement[], app: readonly MeasuredElement[], match: ReadonlyMap<number, number>, scope: number, free?: ReadonlySet<number>): string[] {
  const appToDesign = new Map([...match].map(([d, a]) => [a, d]));
  const out: string[] = [];
  for (let ai = scope + 1; ai <= app[scope]!.end; ai++) {
    const a = app[ai]!;
    if (!a.vis || !a.own || appToDesign.has(ai)) continue;
    let anc = a.p;
    while (anc >= 0 && !appToDesign.has(anc)) anc = app[anc]!.p;
    const di = anc >= 0 ? appToDesign.get(anc) : undefined;
    // inside a leaf of the design (its text), or inside an element that isn't held to the design
    if (di !== undefined && (design[di]!.end === di || free?.has(di))) continue;
    out.push(a.own);
  }
  return out;
}
