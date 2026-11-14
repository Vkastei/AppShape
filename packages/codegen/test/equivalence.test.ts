/**
 * The generated classes must look like the board. Renders designs twice in Edge: with AppShape's
 * renderer, and as plain HTML with the generated Tailwind classes compiled by Tailwind v4. Then
 * compares every element's box, colors and type.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { applyTokenOps, type ComponentSources, componentSources, createId, type DesignNode, expandInstance, isContainer, type Layout, type Project, resolveProps, themedTokens, type Tokens } from "@appshape/ir";
import { generateTheme, SECTIONS, sectionUses, STARTER_COMPONENTS, starterComponentFrame, themeOps, withTheme } from "@appshape/kit";
import { renderFrame } from "@appshape/render";
import { ProjectFiles } from "@appshape/store";
import { type Browser, chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseClasses } from "@appshape/dialect-tailwind";
import { type ClassContext, nodeClasses } from "../src/classes";
import { stable } from "../src/imported";
import { appBaseCss, themeBlock, themeClass } from "../src/theme";

const require = createRequire(import.meta.url);
const demoDir = fileURLToPath(new URL("../../../examples/m0-validation/generated/demo-project", import.meta.url));
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
/** Classes the generated code puts on labelled inputs (the renderer's `[data-aps-field]`). */
const FIELD_CLASSES = ["flex", "flex-col", "gap-1.5", "text-sm", "font-medium"];

let browser: Browser;
let project: Project;
let defaults: Tokens;

beforeAll(async () => {
  browser = await chromium.launch({ channel: process.env.APPSHAPE_BROWSER ?? "msedge" });
  ({ project } = await new ProjectFiles({ appRoot: "", dataDir: demoDir, mode: "in-repo" }).load());
  defaults = await defaultTokens();
}, 60_000);
afterAll(() => browser?.close());

/** Element id (`data-aps`) → classes, as code generation assigns them. */
function classMap(root: DesignNode, tokens: Tokens): { map: Record<string, string[]>; warnings: string[] } {
  const ctx: ClassContext = { tokens, warnings: [] };
  const map: Record<string, string[]> = {};
  const visit = (node: DesignNode, parent: Partial<Layout> | undefined, extra: string[]) => {
    if (node.type === "instance" && node.children.length > 0) {
      // Captured instance: its classes go on the component's root (via className).
      const own = nodeClasses(node, parent, ctx).base;
      for (const child of node.children) visit(child, parent, [...extra, ...own]);
      return;
    }
    // icons are sized like the generated code does (`size-[1em]` unless the design sizes them)
    const iconSize = node.type === "icon" && !node.box?.width && !node.box?.height ? ["size-[1em]"] : [];
    map[node.id] = [...iconSize, ...nodeClasses(node, parent, ctx).base, ...extra];
    if (isContainer(node)) for (const child of node.children) visit(child, node.layout, []);
  };
  visit(root, undefined, []);
  return { map, warnings: ctx.warnings };
}

async function tailwindCss(tokens: Tokens, candidates: string[]): Promise<string> {
  const loadStylesheet = async (id: string, base: string) => {
    const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : require.resolve(id, { paths: [base] });
    return { path, base: dirname(path), content: await readFile(path, "utf8") };
  };
  const input = `@import "tailwindcss";\n${themeBlock(tokens, defaults)}\n${appBaseCss(tokens)}`;
  const compiler = await compile(input, { base: dirname(require.resolve("tailwindcss/index.css")), loadStylesheet });
  return compiler.build(candidates);
}

const PROPS = [
  "display", "flexDirection", "alignItems", "justifyContent", "backgroundColor", "color", "fontSize", "fontWeight",
  "lineHeight", "letterSpacing", "textAlign", "textTransform", "borderTopWidth", "borderTopColor", "borderTopLeftRadius",
  "opacity", "gridTemplateColumns", "backgroundImage", "backgroundClip", "filter", "backdropFilter", "rotate", "scale", "translate",
  "transform", "borderBottomRightRadius", "borderBottomWidth", "borderLeftWidth", "mixBlendMode", "backgroundBlendMode",
] as const;

interface Measured {
  id: string;
  rect: [number, number, number, number];
  style: Record<string, string>;
  shadow: string;
}

const MEASURE = `(() => [...document.querySelectorAll("[data-aps]")]
  .filter((el) => !el.closest("[data-aps-icon], [data-aps-placeholder]"))
  .map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of ${JSON.stringify(PROPS)}) style[p] = cs[p];
    // Same rendering, different spelling: start = left (LTR), Tailwind's rounded-full is calc(infinity * 1px).
    if (style.textAlign === "start") style.textAlign = "left";
    for (const corner of ["borderTopLeftRadius", "borderBottomRightRadius"]) if (parseFloat(style[corner]) >= 9999) style[corner] = "full";
    // Tailwind layers empty shadows (transparent 0 0 0 0); keep the visible ones.
    const shadow = cs.boxShadow === "none" ? "" : cs.boxShadow.split(/,(?![^(]*\\))/).map((s) => s.trim()).filter((s) => !/^(rgba\\(0, 0, 0, 0\\)|transparent) 0px 0px 0px 0px$/.test(s) && !s.startsWith("rgba(0, 0, 0, 0) 0px 0px 0px 0px")).join(", ");
    return { id: el.getAttribute("data-aps"), rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n)), style, shadow };
  }))()`;

async function measure(html: string, width: number, colorScheme: "light" | "dark" = "light", hover?: string): Promise<Measured[]> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
  await page.setContent(html);
  if (hover) {
    // the pointer over the element, and its transition finished
    await page.hover(`[data-aps="${hover}"]`);
    await page.waitForTimeout(500);
  }
  const result = (await page.evaluate(MEASURE)) as Measured[];
  await page.close();
  return result;
}

/** Differences between the board rendering and the Tailwind rendering of a tree. */
async function compare(root: DesignNode, tokens: Tokens, width: number, scheme: "light" | "dark" = "light", theme?: string, hover?: string, hoverBoardToo = false): Promise<string[]> {
  // icons draw as 24px SVGs, as on the board and with lucide-react in the app; a state is shown with the board's state toggle
  const board = renderFrame(root, {
    tokens: themedTokens(tokens, theme),
    viewportHeight: 900,
    iconUrl: () => ICON,
    ...(scheme === "dark" && { rootClassName: "aps-dark" }),
    ...(hover && !hoverBoardToo && { forceState: { id: hover, state: "hover" as const } }),
  });
  const markup = renderToStaticMarkup(board.element);
  const boardHtml = `<!doctype html><style>body{margin:0}${board.css}</style>${markup}`;

  const { map } = classMap(root, tokens);
  if (theme) map[root.id] = [themeClass(theme), ...(map[root.id] ?? [])];
  const candidates = [...new Set([...Object.values(map).flat(), ...FIELD_CLASSES])];
  const css = await tailwindCss(tokens, candidates);
  const assign = `<script>
    const map = ${JSON.stringify(map)};
    document.querySelector(".aps-frame").removeAttribute("class");
    for (const el of document.querySelectorAll("[data-aps]")) el.setAttribute("class", (map[el.getAttribute("data-aps")] || []).join(" "));
    // a list's other items (\`list~2/node\`): the same classes as the item design's
    for (const el of document.querySelectorAll("[data-aps-i*='~']")) el.setAttribute("class", (map[el.getAttribute("data-aps-i").split("/").pop()] || []).join(" "));
    for (const el of document.querySelectorAll("[data-aps-field]")) el.className = ${JSON.stringify(FIELD_CLASSES.join(" "))};
  </script>`;
  // Components from the app's code render as placeholders on the board; the app has the real thing.
  const placeholder = "[data-aps-placeholder]{display:flex;min-height:2.5rem;padding:.75rem;border:1.5px dashed;font:500 .75rem/1.2 sans-serif}";
  const appHtml = `<!doctype html><style>${css}${placeholder}</style>${markup}${assign}`;

  const [a, b] = await Promise.all([measure(boardHtml, width, "light", hoverBoardToo ? hover : undefined), measure(appHtml, width, scheme, hover)]);
  const byId = new Map(b.map((m) => [m.id, m]));
  const problems: string[] = [];
  for (const expected of a) {
    const actual = byId.get(expected.id);
    if (!actual) {
      problems.push(`${expected.id}: missing`);
      continue;
    }
    const off = expected.rect.some((v, i) => Math.abs(v - actual.rect[i]!) > 1);
    if (off) problems.push(`${expected.id}: box ${expected.rect.join(",")} vs ${actual.rect.join(",")} (${map[expected.id]?.join(" ")})`);
    for (const p of PROPS) {
      if (expected.style[p] !== actual.style[p]) problems.push(`${expected.id}: ${p} ${expected.style[p]} vs ${actual.style[p]} (${map[expected.id]?.join(" ")})`);
    }
    if (expected.shadow !== actual.shadow) problems.push(`${expected.id}: shadow ${expected.shadow} vs ${actual.shadow}`);
  }
  return problems;
}

/** A tree with every instance replaced by its component's elements (fresh ids), as plain markup. */
function flatten(root: DesignNode, sources: ComponentSources): DesignNode {
  let next = 0;
  const go = (node: DesignNode): DesignNode => {
    let current = node;
    if (current.type === "instance") {
      const source = sources.get(current.componentId);
      if (source) current = expandInstance(current, source).root;
    }
    const copy = { ...current, id: `e${next++}` } as DesignNode;
    if (copy.type === "slot") (copy as { type: string }).type = "box";
    if ("children" in copy) (copy as { children: DesignNode[] }).children = copy.children.map(go);
    return copy;
  };
  return go(root);
}

/** Whether a rendered page is wider than the screen (horizontal scrolling). */
async function overflows(html: string, width: number): Promise<number> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(html);
  const scroll = (await page.evaluate("document.documentElement.scrollWidth")) as number;
  await page.close();
  return scroll - width;
}

describe("sections look right at every size, on the board and in the app", () => {
  for (const width of [390, 768, 1280]) {
    it(`every section at ${width}px`, async () => {
      const tokens = withTheme(defaults);
      const frames = sectionUses(SECTIONS.map((s) => s.key)).map((key) => starterComponentFrame(key, { adapter: "react-vite" }));
      const ids = new Map(frames.map((f) => [f.component!.kit!, f.id]));
      const sources = componentSources(frames);
      const ctx = { tint: "#4f46e5", use: (key: string, props = {}, fill: DesignNode[] = []) => ({ id: createId("n"), type: "instance", origin: "added", componentId: ids.get(key)!, props, children: fill }) as DesignNode };
      for (const section of SECTIONS) {
        const tree = flatten(section.build(ctx), sources);
        const board = renderFrame(tree, { tokens, viewportHeight: 900, iconUrl: () => ICON });
        expect(await overflows(`<!doctype html><style>body{margin:0}${board.css}</style>${renderToStaticMarkup(board.element)}`, width), `${section.key} overflows at ${width}px`).toBeLessThanOrEqual(0);
        expect(await compare(tree, tokens, width), section.key).toEqual([]);
      }
    }, 300_000);
  }
});

/** A screen using most layout and style features (no captured data). */
function kitchenSink(): DesignNode {
  const t = (id: string, text: string, extra: Partial<DesignNode> = {}): DesignNode => ({ id, type: "text", origin: "added", text, ...extra }) as DesignNode;
  return {
    id: "page", type: "box", origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
    box: { minHeight: "100vh" },
    style: { background: "$color.white" },
    children: [
      t("title", "Build better habits", { semantic: { role: "heading", level: 1 }, style: { fontSize: "$fontSize.5xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight" }, overrides: [{ when: { viewport: "md" }, style: { fontSize: "$fontSize.6xl" } }] }),
      {
        id: "row", type: "box", origin: "added",
        layout: { mode: "flex", direction: "column", gap: "$spacing.4", align: "stretch" },
        overrides: [{ when: { viewport: "md" }, layout: { direction: "row", align: "center", justify: "between" } }],
        children: [
          { id: "btn", type: "button", origin: "added", layout: { mode: "flex", direction: "row", align: "center", justify: "center", gap: "$spacing.2", padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.4", right: "$spacing.4" } }, box: { alignSelf: "start" }, style: { background: "$color.indigo-600", color: "$color.white", radius: "$radius.md", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", shadow: "$shadow.sm" }, children: [t("btn_label", "Start today")] },
          { id: "link", type: "link", origin: "added", href: "#", style: { color: "$color.indigo-600", fontWeight: "$fontWeight.medium", textDecoration: "underline" }, children: [t("link_label", "Learn more")] },
          { id: "filler", type: "box", origin: "added", box: { width: { mode: "fill" }, height: { mode: "fixed", value: "$spacing.8" } }, style: { background: "$color.gray-100", radius: "$radius.full" }, children: [] },
        ],
      },
      {
        id: "grid", type: "box", origin: "added",
        layout: { mode: "grid", columns: 1, gap: "$spacing.4" },
        overrides: [{ when: { viewport: "md" }, layout: { columns: 3 } }, { when: { viewport: "lg" }, layout: { gap: "$spacing.8" } }],
        children: [1, 2, 3].map((i) => ({
          id: `card${i}`, type: "box", origin: "added",
          layout: { mode: "flex", direction: "column", gap: "$spacing.2", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
          style: { background: "$color.white", borderWidth: 1, borderColor: "$color.gray-200", radius: "$radius.xl", shadow: "$shadow.sm", ...(i === 2 && { ring: { width: 2, color: "$color.indigo-600" } }) },
          ...(i === 3 && { box: { colSpan: "full" as const } }),
          children: [t(`card${i}_t`, `Card ${i}`, { semantic: { role: "heading", level: 3 }, style: { fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" } }), t(`card${i}_p`, "Some supporting text for this card.", { style: { fontSize: "$fontSize.sm", color: "$color.gray-600", lineHeight: "$lineHeight.relaxed" } })],
        })),
      },
      { id: "menu", type: "box", origin: "added", hidden: true, layout: { mode: "flex", gap: "$spacing.4" }, overrides: [{ when: { viewport: "md" }, hidden: false }], children: [t("m1", "Menu"), t("m2", "Items")] },
      { id: "input", type: "input", origin: "added", inputType: "email", label: "Email", placeholder: "you@example.com", layout: { padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.3", right: "$spacing.3" } }, style: { borderWidth: 1, borderColor: "$color.gray-300", radius: "$radius.md", fontSize: "$fontSize.sm" } },
      { id: "img", type: "image", origin: "added", src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'/>", alt: "", fit: "cover", box: { width: { mode: "fill" }, maxWidth: "$size.md", aspectRatio: "16 / 9" }, style: { radius: "$radius.lg" } },
      { id: "spaced", type: "box", origin: "added", box: { margin: { top: 13, left: "auto", right: "auto" }, width: { mode: "fixed", value: 240 } }, style: { background: "#0f766e", opacity: 0.5 }, children: [t("sp", "Raw values", { style: { color: "#fff", fontSize: "15px", textTransform: "uppercase", textAlign: "center" } })] },
      // Board handles: a resized element (fixed px sizes) and one moved freely (absolute in a relative parent).
      {
        id: "stage", type: "box", origin: "added", layout: { mode: "flex", direction: "row", gap: "$spacing.4" },
        box: { position: "relative", height: { mode: "fixed", value: 160 } }, style: { background: "$color.gray-100" },
        children: [
          { id: "resized", type: "box", origin: "added", box: { width: { mode: "fixed", value: 133 }, height: { mode: "fixed", value: 77 } }, style: { background: "$color.indigo-600" }, children: [] },
          { id: "free", type: "box", origin: "added", box: { position: "absolute", inset: { left: 212, top: 48 }, width: { mode: "fixed", value: 150 } }, style: { background: "$color.gray-600" }, children: [t("free_t", "Moved freely", { style: { color: "#fff" } })] },
        ],
      },
    ],
  } as DesignNode;
}

/** Colors that change with the scheme, like a theme from the theme starter. */
/** Min/max sizes, proportions, grid spans and rows, order (per size), overflow, z-index, sticky. */
function boxControls(): DesignNode {
  const tile = (id: string, extra: Partial<DesignNode> = {}): DesignNode =>
    ({ id, type: "box", origin: "added", style: { background: "$color.slate-200" }, box: { minHeight: 40 }, children: [{ id: `${id}-t`, type: "text", origin: "added", text: id }], ...extra }) as DesignNode;
  return {
    id: "root",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: 16, right: 16, bottom: 16, left: 16 } },
    children: [
      { id: "bar", type: "box", origin: "added", box: { position: "sticky", inset: { top: 0 }, zIndex: 40 }, style: { background: "$color.white" }, children: [{ id: "bar-t", type: "text", origin: "added", text: "Sticky" }] },
      {
        id: "row",
        type: "box",
        origin: "added",
        layout: { mode: "flex", direction: "row", gap: "$spacing.2" },
        children: [tile("a"), tile("b"), tile("c", { box: { order: -9999, minWidth: 80 }, overrides: [{ when: { viewport: "lg" }, box: { order: 9999 } }] })],
      },
      {
        id: "grid",
        type: "box",
        origin: "added",
        layout: { mode: "grid", columns: 3, rows: 2, gap: "$spacing.2" },
        children: [tile("g1", { box: { colSpan: 2, rowSpan: 2 } }), tile("g2"), tile("g3"), tile("g4", { box: { colSpan: "full" } })],
      },
      tile("ratio", { box: { aspectRatio: "16 / 9", maxWidth: 320 } }),
      tile("clip", { box: { maxHeight: 48 }, style: { overflow: "hidden" } }),
    ],
  };
}

/** A card with a shadow that grows on hover, animated. */
function hoverCard(): DesignNode {
  return {
    id: "page",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", padding: { top: 32, right: 32, bottom: 32, left: 32 } },
    children: [
      {
        id: "card",
        type: "box",
        origin: "added",
        layout: { mode: "flex", direction: "column", gap: "$spacing.2", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
        style: { background: "$color.card", radius: "$radius.xl", shadow: "$shadow.sm", transition: { property: "shadow", duration: 200, easing: "out" } },
        overrides: [{ when: { state: "hover" }, style: { shadow: "$shadow.xl", background: "$color.muted" } }],
        children: [{ id: "title", type: "text", origin: "added", text: "Lifts on hover", style: { fontWeight: "$fontWeight.semibold" } }],
      },
    ],
  };
}

/** A hero: a tinted photo (gradient over the picture) and a gradient headline. */
function hero(): DesignNode {
  return {
    id: "hero",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: 64, right: 32, bottom: 64, left: 32 } },
    style: {
      background: "$color.slate-900",
      backgroundImage: { src: "https://example.com/hero.jpg", size: "cover", position: "center", repeat: false },
      gradient: { type: "linear", stops: [{ color: "$color.slate-950/70" }, { color: "$color.slate-950/20", at: 60 }, { color: "transparent" }] },
    },
    children: [
      {
        id: "headline",
        type: "text",
        origin: "added",
        text: "Ship faster",
        semantic: { role: "heading", level: 1 },
        style: { fontSize: "$fontSize.5xl", fontWeight: "$fontWeight.bold", color: "transparent", backgroundClip: "text", gradient: { type: "linear", angle: 90, stops: [{ color: "$color.sky-400" }, { color: "$color.violet-500" }] } },
      },
      { id: "radial", type: "box", origin: "added", box: { width: { mode: "fixed", value: 120 }, height: { mode: "fixed", value: 60 } }, style: { gradient: { type: "radial", stops: [{ color: "$color.amber-300" }, { color: "$color.rose-500", at: 80 }] } }, children: [] },
      { id: "corner", type: "box", origin: "added", box: { width: { mode: "fixed", value: 120 }, height: { mode: "fixed", value: 60 } }, style: { gradient: { type: "linear", angle: "to-br", stops: [{ color: "$color.white" }, { color: "$color.emerald-500" }] } }, children: [] },
      { id: "angled", type: "box", origin: "added", box: { width: { mode: "fixed", value: 120 }, height: { mode: "fixed", value: 60 } }, style: { gradient: { type: "linear", angle: 30, stops: [{ color: "$color.white" }, { color: "$color.indigo-600" }] } }, children: [] },
    ],
  };
}

/** A glass card, a tilted badge that lifts on hover, and custom shadows. */
function effects(): DesignNode {
  return {
    id: "stage",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.8", padding: { top: 48, right: 48, bottom: 48, left: 48 } },
    style: { background: "$color.indigo-600" },
    children: [
      {
        id: "glass",
        type: "box",
        origin: "added",
        layout: { mode: "flex", direction: "column", padding: { top: 24, right: 24, bottom: 24, left: 24 } },
        style: { background: "$color.white/10", backdropBlur: "$blur.md", borderWidth: 1, borderColor: "$color.white/20", radius: "$radius.2xl", shadow: "$shadow.xl", shadowColor: "$color.black/10" },
        children: [{ id: "glass-t", type: "text", origin: "added", text: "Glass", style: { color: "$color.white" } }],
      },
      {
        id: "badge",
        type: "box",
        origin: "added",
        layout: { mode: "flex", padding: { top: 4, right: 12, bottom: 4, left: 12 } },
        box: { alignSelf: "start" },
        style: { background: "$color.amber-300", radius: "$radius.full", rotate: -6, scale: 110, translate: { x: "$spacing.2" }, skew: { x: 3 } },
        overrides: [{ when: { state: "hover" }, style: { translate: { y: "-0.25rem" }, rotate: 0 } }],
        children: [{ id: "badge-t", type: "text", origin: "added", text: "New" }],
      },
      {
        id: "lifted",
        type: "box",
        origin: "added",
        box: { width: { mode: "fixed", value: 160 }, height: { mode: "fixed", value: 80 } },
        style: { background: "$color.white", shadow: [{ x: 0, y: 1, blur: 2, color: "$color.black/10" }, { x: 0, y: 12, blur: 32, spread: -8, color: "$color.indigo-900/40" }, { x: 0, y: 1, blur: 0, color: "#ffffff", inset: true }] },
        children: [],
      },
      { id: "blurred", type: "box", origin: "added", box: { width: { mode: "fixed", value: 80 }, height: { mode: "fixed", value: 80 } }, style: { background: "$color.pink-400", blur: "$blur.lg" }, children: [] },
    ],
  };
}

/** A card that is a hover group (its arrow moves when the card is hovered), a gradient button with hover colors, a gradient with dark colors. */
function groups(): DesignNode {
  return {
    id: "stage",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: { top: 32, right: 32, bottom: 32, left: 32 } },
    children: [
      {
        id: "card",
        type: "box",
        origin: "added",
        layout: { mode: "flex", direction: "row", gap: "$spacing.2", padding: { top: 16, right: 16, bottom: 16, left: 16 } },
        style: { hoverGroup: true, background: "$color.slate-100" },
        children: [
          { id: "label", type: "text", origin: "added", text: "Read more", overrides: [{ when: { state: "group-hover" }, style: { color: "$color.teal-600" } }] },
          { id: "arrow", type: "text", origin: "added", text: "→", overrides: [{ when: { state: "group-hover" }, style: { translate: { x: "$spacing.1" } } }] },
        ],
      },
      {
        id: "cta",
        type: "box",
        origin: "added",
        layout: { mode: "flex", padding: { top: 12, right: 24, bottom: 12, left: 24 } },
        style: { gradient: { type: "linear", angle: 90, stops: [{ color: "$color.teal-600" }, { color: "$color.cyan-600" }] } },
        overrides: [{ when: { scheme: "dark" }, style: { gradient: { type: "linear", angle: 90, stops: [{ color: "$color.slate-900" }, { color: "$color.cyan-600" }] } } }],
        children: [{ id: "cta-t", type: "text", origin: "added", text: "Start", style: { color: "$color.white" } }],
      },
    ],
  };
}

/** Corners and sides set one by one, blend modes, see-through fills. */
function shapes(): DesignNode {
  const tile = (id: string, style: DesignNode["style"]): DesignNode => ({ id, type: "box", origin: "added", box: { width: { mode: "fixed", value: 120 }, height: { mode: "fixed", value: 60 } }, style, children: [] });
  return {
    id: "stage",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "row", wrap: true, gap: "$spacing.4", padding: { top: 24, right: 24, bottom: 24, left: 24 } },
    style: { background: "$color.sky-200" },
    children: [
      tile("tab", { background: "$color.white", radius: { topLeft: "$radius.xl", topRight: "$radius.xl" }, borderWidth: { bottom: 2 }, borderColor: "$color.indigo-600" }),
      tile("ticket", { background: "$color.white/60", radius: { topLeft: "$radius.lg", bottomRight: "$radius.3xl" }, borderWidth: { top: 1, left: 4 }, borderColor: "$color.slate-900/20" }),
      tile("multiply", { background: "$color.rose-500", blendMode: "multiply" }),
      tile("duotone", { background: "$color.indigo-600", backgroundImage: { src: "https://example.com/photo.jpg", size: "cover" }, backgroundBlendMode: "luminosity", gradient: { type: "linear", stops: [{ color: "$color.white/0" }, { color: "$color.black/50" }] } }),
    ],
  };
}

/** Text and effect styles: used as they are, refined by an element's own values, combined with a ring. */
function named(): DesignNode {
  const t = (id: string, style: DesignNode["style"], extra: Partial<DesignNode> = {}): DesignNode => ({ id, type: "text", origin: "added", text: id, style, ...extra }) as DesignNode;
  return {
    id: "stage",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: { top: 32, right: 32, bottom: 32, left: 32 } },
    children: [
      t("display", { textStyle: "display" }),
      t("h2", { textStyle: "h2" }),
      t("h2-own", { textStyle: "h2", fontSize: "$fontSize.2xl", color: "$color.primary" }, { overrides: [{ when: { viewport: "lg" }, style: { fontSize: "$fontSize.5xl" } }] }),
      t("h2-leading", { textStyle: "h2", lineHeight: "$lineHeight.loose" }),
      t("caption", { textStyle: "caption", textTransform: "uppercase" }),
      { id: "card", type: "box", origin: "added", layout: { mode: "flex", padding: { top: 24, right: 24, bottom: 24, left: 24 } }, style: { effectStyle: "raised", background: "$color.card", radius: "$radius.xl" }, children: [t("card-t", { textStyle: "body" })] },
      { id: "ringed", type: "box", origin: "added", layout: { mode: "flex", padding: { top: 24, right: 24, bottom: 24, left: 24 } }, style: { effectStyle: "glass", ring: { width: 1, color: "$color.white/20" }, background: "$color.white/10" }, children: [t("ringed-t", { textStyle: "small" })] },
    ],
  };
}

/** Every element's classes, read back by the importer, give the same design (layout, size, style, overrides). */
function roundTrip(root: DesignNode, tokens: Tokens): string[] {
  const { map } = classMap(root, tokens);
  const problems: string[] = [];
  const visit = (node: DesignNode, parent: Partial<Layout> | undefined) => {
    const parsed = parseClasses(map[node.id] ?? [], { tokens, ...(parent && { parent }) });
    for (const key of ["style", "overrides"] as const) {
      const want = stable(node[key] ?? null);
      const got = stable(parsed[key] ?? null);
      if (want !== got) problems.push(`${node.id}.${key}: ${want} vs ${got} (${map[node.id]?.join(" ")})`);
    }
    if (parsed.unmapped.length) problems.push(`${node.id}: unmapped ${parsed.unmapped.join(" ")}`);
    if (isContainer(node)) for (const child of node.children) visit(child, node.layout);
  };
  visit(root, undefined);
  return problems;
}

function themed(): Tokens {
  return {
    ...defaults,
    groups: { ...defaults.groups, color: { ...defaults.groups.color, background: "oklch(0.985 0.002 270)", foreground: "oklch(0.21 0.02 270)", primary: "oklch(0.51 0.23 277)", "primary-foreground": "#ffffff", border: "oklch(0.92 0.01 270)" } },
    dark: { color: { background: "oklch(0.15 0.01 270)", foreground: "oklch(0.97 0.005 270)", primary: "oklch(0.67 0.18 277)", border: "oklch(0.3 0.02 270)" } },
  };
}

function themedPage(): DesignNode {
  return {
    id: "tp", type: "box", origin: "added", layout: { mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
    style: { background: "$color.background", color: "$color.foreground" },
    children: [
      { id: "tp_card", type: "box", origin: "added", layout: { mode: "flex", direction: "column", gap: "$spacing.2", padding: { top: "$spacing.4", right: "$spacing.4", bottom: "$spacing.4", left: "$spacing.4" } }, style: { borderWidth: 1, borderColor: "$color.border", radius: "$radius.lg", background: "$color.foreground/5" }, children: [{ id: "tp_t", type: "text", origin: "added", text: "Themed", style: { fontWeight: "$fontWeight.semibold" } }] },
      { id: "tp_btn", type: "button", origin: "added", layout: { padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.4", right: "$spacing.4" } }, box: { alignSelf: "start" }, style: { background: "$color.primary", color: "$color.primary-foreground", radius: "$radius.md" }, children: [{ id: "tp_bl", type: "text", origin: "added", text: "Go" }] },
    ],
  } as DesignNode;
}

describe("generated classes look like the board", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`starter components in every variant, ${scheme} mode`, async () => {
      const tokens = withTheme(defaults);
      for (const starter of STARTER_COMPONENTS) {
        const frame = starterComponentFrame(starter.key, { adapter: "react-vite" });
        const values: Record<string, string | boolean>[] = [{}];
        for (const prop of frame.component!.props) {
          if (prop.type === "enum") values.push(...prop.options!.map((o) => ({ [prop.name]: o })));
          if (prop.type === "boolean") values.push({ [prop.name]: true });
        }
        for (const props of values) {
          const tree = resolveProps(frame.current, frame.component!, props);
          const page = { id: "stage", type: "box", origin: "added", layout: { mode: "flex", direction: "column", padding: { top: 16, left: 16, right: 16, bottom: 16 } }, children: [tree] } as DesignNode;
          expect(await compare(page, tokens, 480, scheme), `${starter.name} ${JSON.stringify(props)}`).toEqual([]);
        }
      }
    }, 120_000);

    it(`a screen with its own theme in ${scheme} mode`, async () => {
      const project = withTheme(defaults);
      const tokens = applyTokenOps(project, themeOps(project, generateTheme({ brand: "#e11d48", tint: "strong", fonts: "system", shape: "round", density: "airy" }), { id: "landing", name: "Landing" }));
      expect(await compare(themedPage(), tokens, 800, scheme, "landing")).toEqual([]);
    }, 60_000);

    it(`theme colors in ${scheme} mode`, async () => {
      expect(await compare(themedPage(), themed(), 800, scheme)).toEqual([]);
    }, 60_000);
  }

  it("a hero with a tinted photo and a gradient headline: board = app, and the code reads back the same", async () => {
    expect(await compare(hero(), defaults, 900)).toEqual([]);
    expect(roundTrip(hero(), defaults)).toEqual([]);
  }, 60_000);

  it("glass, shadows, blur and transforms: board = app, also hovered, and the code reads back the same", async () => {
    expect(await compare(effects(), defaults, 600)).toEqual([]);
    expect(await compare(effects(), defaults, 600, "light", undefined, "badge")).toEqual([]);
    expect(roundTrip(effects(), defaults)).toEqual([]);
  }, 60_000);

  it("corners and sides one by one, blend modes, see-through fills: board = app, and the code reads back the same", async () => {
    expect(await compare(shapes(), defaults, 700)).toEqual([]);
    expect(roundTrip(shapes(), defaults)).toEqual([]);
  }, 60_000);

  for (const width of [390, 800, 1280]) {
    it(`text and effect styles at ${width}px: an element's own values win, sizes per screen size, a ring adds to the style's shadow`, async () => {
      const tokens = withTheme(defaults);
      expect(await compare(named(), tokens, width)).toEqual([]);
      if (width === 1280) {
        expect(await compare(named(), tokens, width, "dark")).toEqual([]);
        expect(roundTrip(named(), tokens)).toEqual([]);
      }
    }, 60_000);
  }

  it("hover groups and gradients that change per scheme: board = app, hovered and in dark mode", async () => {
    expect(await compare(groups(), defaults, 600)).toEqual([]);
    expect(await compare(groups(), defaults, 600, "light", undefined, "card", true)).toEqual([]);
    expect(await compare(groups(), defaults, 600, "dark")).toEqual([]);
    expect(roundTrip(groups(), defaults)).toEqual([]);
  }, 60_000);

  for (const width of [390, 1280]) {
    it(`box controls at ${width}px`, async () => {
      expect(await compare(boxControls(), defaults, width)).toEqual([]);
    }, 60_000);
  }

  it("a card that lifts on hover: the board's state toggle shows what hovering shows in the app", async () => {
    const tokens = withTheme(defaults);
    expect(await compare(hoverCard(), tokens, 600, "light", undefined, "card")).toEqual([]);
    // and in the app it animates: box-shadow over 200 ms, easing out
    const { map } = classMap(hoverCard(), tokens);
    const css = await tailwindCss(tokens, Object.values(map).flat());
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style><div class="${map.card!.join(" ")}">Card</div>`);
    const t = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("div")!);
      return [cs.transitionProperty, cs.transitionDuration, cs.transitionTimingFunction];
    });
    await page.close();
    expect(t).toEqual(["box-shadow", "0.2s", "cubic-bezier(0, 0, 0.2, 1)"]);
  }, 60_000);

  for (const width of [390, 1280]) {
    it(`kitchen sink at ${width}px`, async () => {
      const tokens = { ...defaults };
      expect(await compare(kitchenSink(), tokens, width)).toEqual([]);
    }, 60_000);

    it(`demo screens at ${width}px`, async () => {
      for (const frame of project.frames) {
        expect(await compare(frame.current, project.tokens, width), frame.name).toEqual([]);
      }
    }, 60_000);
  }
});
