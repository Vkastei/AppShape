import {
  type AnyOp,
  componentSources,
  createId,
  type DesignNode,
  type Edges,
  expandInstance,
  type Frame,
  isContainer,
  type Layout,
  parseTokenRef,
  type Project,
  type Scheme,
  type Style,
  type StyleValue,
  themedTokens,
  type TokenGroup,
  type Tokens,
  tokenValue,
} from "@appshape/ir";
import { composite, contrast, parseColor, type Rgb, rgbToOklch } from "./color";
import { withTextStyle } from "./styles";
import { isPlaceholderImage } from "./placeholders";

/**
 * Design checks: what a careful designer would point out on a screen, each with a fix where one is
 * clear. Computed from the design itself (no rendering): contrast in light and dark mode, values
 * outside the design system, too many sizes, missing alt texts, heading order, tap targets on
 * phones and line length.
 */

export type CheckRule = "contrast" | "off-system" | "font-sizes" | "spacing-values" | "alt-text" | "placeholder" | "headings" | "tap-target" | "line-length";

export const CHECK_RULES: Record<CheckRule, string> = {
  contrast: "Text contrast",
  "off-system": "Outside the design system",
  "font-sizes": "Too many font sizes",
  "spacing-values": "Too many spacing values",
  "alt-text": "Missing alt text",
  placeholder: "Placeholder picture",
  headings: "Heading order",
  "tap-target": "Small tap target",
  "line-length": "Long lines",
};

export interface Finding {
  /** Stable key (for ignoring it): rule, screen and element. */
  key: string;
  rule: CheckRule;
  severity: "error" | "warning" | "info";
  frameId: string;
  /** The screen's own element to select (absent for findings about the whole screen). */
  nodeId?: string;
  message: string;
  fix?: { label: string; ops: AnyOp[] };
}

const MAX_FONT_SIZES = 6;
const MAX_SPACING_VALUES = 12;
const MIN_TAP = 44;
const MAX_CHARS = 90;
const opId = () => createId("op");

// ---------- values

/** A length in px (numbers are px; rem = 16px), or undefined for anything relative. */
function px(value: StyleValue | undefined, tokens: Tokens): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const ref = parseTokenRef(value);
  const raw = ref ? tokenValue(tokens, ref.group, ref.name) : value;
  if (typeof raw === "number") return raw;
  if (raw === undefined) return undefined;
  if (raw === "0") return 0;
  const m = /^(-?[0-9.]+)(px|rem)$/.exec(raw.trim());
  return m ? Number(m[1]) * (m[2] === "rem" ? 16 : 1) : undefined;
}

function colorOf(value: StyleValue | undefined, tokens: Tokens, scheme: Scheme): Rgb | undefined {
  if (typeof value !== "string") return undefined;
  const ref = parseTokenRef(value);
  if (!ref) return parseColor(value);
  const raw = tokenValue(tokens, ref.group, ref.name, scheme);
  const color = raw === undefined ? undefined : parseColor(String(raw));
  return color && ref.alpha !== undefined ? { ...color, alpha: color.alpha * (ref.alpha / 100) } : color;
}

/** A font size's line height in px (its token's paired line height, the element's, or 1.5). */
function lineHeightPx(style: Style | undefined, fontSize: number, tokens: Tokens): number {
  const ratio = (value: string | number | undefined): number | undefined => {
    if (typeof value === "number") return value;
    if (!value) return undefined;
    const calc = /^calc\(\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*\)$/.exec(value);
    if (calc) return Number(calc[1]) / Number(calc[2]);
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
    const length = px(value, tokens);
    return length === undefined ? undefined : length / fontSize;
  };
  const own = typeof style?.lineHeight === "string" && parseTokenRef(style.lineHeight) ? tokenValue(tokens, "lineHeight", parseTokenRef(style.lineHeight)!.name) : style?.lineHeight;
  const paired = typeof style?.fontSize === "string" && parseTokenRef(style.fontSize) ? tokens.groups.lineHeight?.[parseTokenRef(style.fontSize)!.name] : undefined;
  return fontSize * (ratio(own) ?? ratio(paired) ?? 1.5);
}

/** The token of a group closest to a raw value (by px for lengths, by OKLab distance for colors). */
function nearestToken(tokens: Tokens, group: TokenGroup, value: StyleValue): string | undefined {
  const entries = Object.entries(tokens.groups[group] ?? {});
  if (group === "color") {
    const target = typeof value === "string" ? parseColor(value) : undefined;
    if (!target) return undefined;
    const lab = (c: Rgb) => {
      const o = rgbToOklch(c);
      return [o.l, o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
    };
    const t = lab(target);
    let best: [string, number] | undefined;
    for (const [name, raw] of entries) {
      const c = parseColor(String(raw));
      if (!c || c.alpha < 1) continue;
      const d = lab(c).reduce((sum, v, i) => sum + (v - t[i]!) ** 2, 0);
      if (!best || d < best[1]) best = [name, d];
    }
    return best && `$color.${best[0]}`;
  }
  const target = px(value, tokens);
  if (target === undefined) return undefined;
  let best: [string, number] | undefined;
  for (const [name] of entries) {
    const v = px(`$${group}.${name}`, tokens);
    if (v === undefined) continue;
    const d = Math.abs(v - target);
    if (!best || d < best[1]) best = [name, d];
  }
  return best && `$${group}.${best[0]}`;
}

const isRaw = (value: StyleValue | undefined): value is StyleValue => value !== undefined && !(typeof value === "string" && value.startsWith("$"));
const lengthy = (value: StyleValue) => typeof value === "number" ? value !== 0 : /^-?[0-9.]+(px|rem)$/.test(value) && Number.parseFloat(value) !== 0;
const sides = ["top", "right", "bottom", "left"] as const;

// ---------- the walk

interface Context {
  /** Background behind the element, per scheme (undefined: unknown, e.g. a picture). */
  bg: Record<Scheme, Rgb | undefined>;
  color: Record<Scheme, Rgb | undefined>;
  fontSize: number;
  bold: boolean;
  /** Width available to the element on desktop (px). */
  width: number;
  /** Hidden on phones (the base layout is the phone's). */
  phoneHidden: boolean;
}

function layoutAt(node: DesignNode, viewports: readonly string[]): Partial<Layout> {
  let layout: Partial<Layout> = { ...node.layout };
  for (const o of node.overrides ?? []) if (o.when.viewport && viewports.includes(o.when.viewport) && !o.when.state && !o.when.scheme && !o.when.prop) layout = { ...layout, ...o.layout };
  return layout;
}

/** Checks one screen (or component). */
export function checkFrame(frame: Frame, project: Pick<Project, "tokens" | "frames">): Finding[] {
  const tokens = themedTokens(project.tokens, frame.theme);
  const sources = componentSources(project.frames);
  const schemes: Scheme[] = tokens.dark ? ["light", "dark"] : ["light"];
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "key" | "frameId">, detail = "") => findings.push({ ...f, frameId: frame.id, key: `${f.rule}:${frame.id}:${f.nodeId ?? ""}${detail}` });
  const name = (node: DesignNode) => node.name ?? (node.type === "text" ? `“${node.text.slice(0, 32)}${node.text.length > 32 ? "…" : ""}”` : node.type);
  const fontSizes = new Set<number>();
  const spacing = new Set<number>();
  const headings: { node: DesignNode; level: number }[] = [];

  const rootColor = (scheme: Scheme, token: string, fallback: string) => colorOf(`$color.${token}`, tokens, scheme) ?? parseColor(fallback);
  const desktop = Math.max(...frame.viewports.map((v) => v.width));
  const start: Context = {
    bg: { light: rootColor("light", "background", "#ffffff"), dark: rootColor("dark", "background", "#ffffff") },
    color: { light: rootColor("light", "foreground", "#111827"), dark: rootColor("dark", "foreground", "#111827") },
    fontSize: 16,
    bold: false,
    width: desktop,
    phoneHidden: false,
  };

  /** The colors and type inside an element: its own values on top of its parent's. */
  const paint = (look: DesignNode, parent: Context): Context => {
    // text styles count as the element's own values (their phone sizes)
    const style = look.style?.textStyle ? withTextStyle(tokens, look.style) : look.style;
    const ctx: Context = { ...parent, bg: { ...parent.bg }, color: { ...parent.color } };
    if (look.hidden) ctx.phoneHidden = true;
    for (const scheme of schemes) {
      if (style?.backgroundImage) ctx.bg[scheme] = undefined;
      const bg = colorOf(style?.background, tokens, scheme);
      if (bg && ctx.bg[scheme]) ctx.bg[scheme] = bg.alpha < 1 ? composite(bg, ctx.bg[scheme]!) : bg;
      else if (bg && bg.alpha >= 1) ctx.bg[scheme] = bg;
      const color = colorOf(style?.color, tokens, scheme);
      if (color) ctx.color[scheme] = color;
    }
    const size = px(style?.fontSize, tokens);
    if (size !== undefined) ctx.fontSize = size;
    const weight = typeof style?.fontWeight === "string" && parseTokenRef(style.fontWeight) ? tokenValue(tokens, "fontWeight", parseTokenRef(style.fontWeight)!.name) : style?.fontWeight;
    if (weight !== undefined) ctx.bold = Number(weight) >= 700;
    return ctx;
  };

  /** Text too faint on its background, per scheme: the ratio and what it needs. */
  const faint = (ctx: Context): { scheme: Scheme; ratio: number; needed: number }[] => {
    const large = ctx.fontSize >= 24 || (ctx.fontSize >= 18.66 && ctx.bold);
    const needed = large ? 3 : 4.5;
    return schemes.flatMap((scheme) => {
      const fg = ctx.color[scheme];
      const bg = ctx.bg[scheme];
      const ratio = fg && bg ? contrast(fg, bg) : undefined;
      return ratio === undefined || ratio >= needed ? [] : [{ scheme, ratio, needed }];
    });
  };

  /**
   * The component's own text in an instance (a button's label), in the variant it uses, on the
   * background it sits on here. Slot fills are the screen's own and checked as such.
   */
  const checkInstanceText = (instance: DesignNode, look: DesignNode, fills: ReadonlySet<DesignNode>, ctx: Context) => {
    const component = instance.type === "instance" ? sources.get(instance.componentId)?.name : undefined;
    const inside = (n: DesignNode, parent: Context) => {
      if (fills.has(n) || n.hidden) return;
      const here = paint(n, parent);
      if (n.type === "text" && n.text.trim() && n.style?.backgroundClip !== "text") {
        for (const { scheme, ratio, needed } of faint(here)) {
          add(
            {
              rule: "contrast",
              severity: "error",
              nodeId: instance.id,
              message: `${name(instance)}${component ? ` (${component})` : ""}: its text “${n.text.trim().slice(0, 32)}” is hard to read here${scheme === "dark" ? " in dark mode" : ""}: contrast ${ratio.toFixed(1)}:1, needs ${needed}:1. Use a variant made for this background.`,
            },
            `:${n.id}:${scheme}`,
          );
        }
      }
      if (isContainer(n) && n.type !== "instance") n.children.forEach((c) => inside(c, here));
    };
    if (isContainer(look)) look.children.forEach((c) => inside(c, ctx));
  };

  const visit = (node: DesignNode, parent: Context, own: boolean) => {
    // instances: their component's look applies to what's inside (their slot fills); the component itself is checked on its own
    const expansion = node.type === "instance" && sources.get(node.componentId) ? expandInstance(node, sources.get(node.componentId)!) : undefined;
    const look = expansion?.root ?? node;
    const ctx = paint(look, parent);
    // width on desktop: padding and max width of the element
    const desktopLayout = layoutAt(look, ["sm", "md", "lg", "xl"]);
    const maxWidth = px(look.box?.maxWidth, tokens);
    if (maxWidth !== undefined) ctx.width = Math.min(ctx.width, maxWidth);
    const padX = (px(desktopLayout.padding?.left, tokens) ?? 0) + (px(desktopLayout.padding?.right, tokens) ?? 0);

    if (own) checkOwn(node, ctx);
    if (node.type === "instance") {
      checkInstance(node, look, ctx);
      if (own && expansion) checkInstanceText(node, look, expansion.fills, ctx);
      for (const fill of node.children) if (fill.type === "slot") fill.children.forEach((c) => visit(c, { ...ctx, width: ctx.width - padX }, true));
      return;
    }
    if (!isContainer(node)) return;
    // children's width: a grid splits it into its desktop columns
    const columns = desktopLayout.mode === "grid" && typeof desktopLayout.columns === "number" ? desktopLayout.columns : 1;
    const childWidth = (ctx.width - padX) / columns;
    for (const child of node.children) visit(child, { ...ctx, width: childWidth }, own);
  };

  const checkOwn = (node: DesignNode, ctx: Context) => {
    // values outside the design system
    const style = node.style ?? {};
    const off: { label: string; fix?: AnyOp }[] = [];
    const restyle: Record<string, StyleValue> = {};
    for (const key of ["color", "background", "borderColor"] as const) {
      const value = style[key];
      if (!isRaw(value) || !parseColor(String(value)) || value === "transparent") continue;
      const token = nearestToken(tokens, "color", value);
      off.push({ label: `${key === "background" ? "fill" : key === "borderColor" ? "border color" : "color"} ${value}` });
      if (token) restyle[key] = token;
    }
    for (const [key, group] of [["fontSize", "fontSize"], ["radius", "radius"]] as const) {
      const raw = style[key];
      const value = typeof raw === "object" ? undefined : raw;
      if (!isRaw(value) || !lengthy(value)) continue;
      const token = nearestToken(tokens, group, value);
      off.push({ label: `${key === "fontSize" ? "font size" : "radius"} ${value}` });
      if (token) restyle[key] = token;
    }
    const relayout: Record<string, unknown> = {};
    const layout = node.layout ?? {};
    if (isRaw(layout.gap) && lengthy(layout.gap)) {
      off.push({ label: `gap ${layout.gap}` });
      const token = nearestToken(tokens, "spacing", layout.gap);
      if (token) relayout.gap = token;
    }
    if (layout.padding && sides.some((s) => isRaw(layout.padding![s]) && lengthy(layout.padding![s]!))) {
      off.push({ label: "padding" });
      const padding: Edges = {};
      for (const s of sides) {
        const v = layout.padding[s];
        padding[s] = v !== undefined && isRaw(v) && lengthy(v) ? (nearestToken(tokens, "spacing", v) ?? v) : v;
      }
      relayout.padding = padding;
    }
    if (off.length > 0) {
      const ops: AnyOp[] = [];
      if (Object.keys(restyle).length) ops.push({ id: opId(), frameId: frame.id, nodeId: node.id, op: "restyle", style: restyle });
      if (Object.keys(relayout).length) ops.push({ id: opId(), frameId: frame.id, nodeId: node.id, op: "relayout", layout: relayout });
      add({ rule: "off-system", severity: "info", nodeId: node.id, message: `${name(node)} uses values outside the design system: ${off.map((o) => o.label).join(", ")}.`, ...(ops.length && { fix: { label: "Use the nearest tokens", ops } }) });
    }
    for (const value of [layout.gap, ...sides.map((s) => layout.padding?.[s])]) {
      const v = px(value, tokens);
      if (v) spacing.add(v);
    }

    // gradient text: its colors are the gradient's (not checked here)
    if (node.type === "text" && node.text.trim() && node.style?.backgroundClip === "text") fontSizes.add(Math.round(ctx.fontSize));
    else if (node.type === "text" && node.text.trim()) {
      fontSizes.add(Math.round(ctx.fontSize));
      // contrast, in each scheme
      for (const { scheme, ratio, needed } of faint(ctx)) {
        const fix = contrastFix(node, ctx, needed);
        add(
          {
            rule: "contrast",
            severity: "error",
            nodeId: node.id,
            message: `${name(node)} is hard to read${scheme === "dark" ? " in dark mode" : ""}: contrast ${ratio.toFixed(1)}:1, needs ${needed}:1.`,
            ...(fix && { fix }),
          },
          `:${scheme}`,
        );
      }
      // line length on wide screens
      const chars = ctx.width / (ctx.fontSize * 0.5);
      if (node.text.length > 120 && chars > MAX_CHARS) {
        add({
          rule: "line-length",
          severity: "info",
          nodeId: node.id,
          message: `${name(node)} runs about ${Math.round(chars)} characters per line on wide screens; 60–80 read best.`,
          fix: { label: "Limit its width", ops: [{ id: opId(), frameId: frame.id, nodeId: node.id, op: "relayout", box: { maxWidth: ctx.fontSize > 18 ? "$size.3xl" : "$size.2xl" } }] },
        });
      }
      if (node.semantic?.role === "heading") headings.push({ node, level: node.semantic.level ?? 2 });
    }

    if (node.type === "image") {
      if (!node.alt?.trim() && !isPlaceholderImage(node.src)) add({ rule: "alt-text", severity: "warning", nodeId: node.id, message: `${name(node)} has no alt text: screen readers and search engines can't tell what it shows.` });
      if (isPlaceholderImage(node.src)) add({ rule: "placeholder", severity: "info", nodeId: node.id, message: `${name(node)} still shows a placeholder picture. Drop a photo onto it.` });
    }
    if (style.backgroundImage && isPlaceholderImage(style.backgroundImage.src)) add({ rule: "placeholder", severity: "info", nodeId: node.id, message: `${name(node)} still has a placeholder background picture.` }, ":bg");

    // checkboxes and the like are tapped together with their label
    const toggle = node.type === "input" && ["checkbox", "radio", "switch"].includes(node.inputType);
    if ((node.type === "button" || node.type === "input") && !toggle && !ctx.phoneHidden) {
      const height = tapHeight(node, ctx);
      if (height !== undefined && height < MIN_TAP) {
        const extra = Math.ceil((MIN_TAP - height) / 2);
        const pad = node.layout?.padding ?? {};
        const top = nearestUp(tokens, (px(pad.top, tokens) ?? 0) + extra);
        const bottom = nearestUp(tokens, (px(pad.bottom, tokens) ?? 0) + extra);
        add({
          rule: "tap-target",
          severity: "warning",
          nodeId: node.id,
          message: `${name(node)} is ${Math.round(height)}px tall on phones; fingers need ${MIN_TAP}px.`,
          ...(top && bottom && { fix: { label: "Make it taller", ops: [{ id: opId(), frameId: frame.id, nodeId: node.id, op: "relayout", layout: { padding: { ...pad, top, bottom } } }] } }),
        });
      }
    }
  };

  const tapHeight = (node: DesignNode, ctx: Context): number | undefined => {
    const pad = node.layout?.padding;
    const top = px(pad?.top, tokens) ?? 0;
    const bottom = px(pad?.bottom, tokens) ?? 0;
    const border = typeof node.style?.borderWidth === "number" ? node.style.borderWidth * 2 : 0;
    const fixed = node.box?.height?.mode === "fixed" ? px(node.box.height.value, tokens) : undefined;
    return fixed ?? lineHeightPx(withTextStyle(tokens, node.style) as Style, ctx.fontSize, tokens) + top + bottom + border;
  };

  const checkInstance = (node: DesignNode, look: DesignNode, ctx: Context) => {
    const source = node.type === "instance" ? sources.get(node.componentId) : undefined;
    if (!source) return;
    if ((look.type === "button" || look.type === "link") && !ctx.phoneHidden && look.layout?.padding) {
      const height = tapHeight(look, ctx);
      if (height !== undefined && height < MIN_TAP) add({ rule: "tap-target", severity: "warning", nodeId: node.id, message: `${name(node)} (${source.name}) is ${Math.round(height)}px tall on phones; fingers need ${MIN_TAP}px. Use a larger size, or make the ${source.name} component taller on phones.` });
    }
    let placeholder = false;
    const scan = (n: DesignNode) => {
      if (n.type === "image" && isPlaceholderImage(n.src)) placeholder = true;
      if (isContainer(n) && n.type !== "instance") n.children.forEach(scan);
    };
    scan(look);
    if (placeholder) add({ rule: "placeholder", severity: "info", nodeId: node.id, message: `${name(node)} (${source.name}) still shows a placeholder picture.` });
  };

  const contrastFix = (node: DesignNode, ctx: Context, needed: number): Finding["fix"] => {
    // the color token closest to the current one that is readable in every scheme
    const candidates = Object.keys(tokens.groups.color ?? {})
      .map((n) => `$color.${n}`)
      .filter((ref) => schemes.every((scheme) => {
        const fg = colorOf(ref, tokens, scheme);
        const bg = ctx.bg[scheme];
        return fg && bg && fg.alpha >= 1 && (contrast(fg, bg) ?? 0) >= needed;
      }));
    const current = ctx.color.light;
    if (!current || candidates.length === 0) return undefined;
    const lightness = (ref: string) => rgbToOklch(colorOf(ref, tokens, "light")!).l;
    const target = rgbToOklch(current).l;
    const preferred = ["$color.foreground", "$color.muted-foreground", "$color.primary-foreground"].filter((r) => candidates.includes(r));
    const pool = preferred.length ? preferred : candidates;
    const best = pool.reduce((a, b) => (Math.abs(lightness(a) - target) <= Math.abs(lightness(b) - target) ? a : b));
    return { label: `Use ${best.slice("$color.".length)}`, ops: [{ id: opId(), frameId: frame.id, nodeId: node.id, op: "restyle", style: { color: best } }] };
  };

  visit(frame.current, start, true);

  // whole-screen findings
  if (fontSizes.size > MAX_FONT_SIZES) add({ rule: "font-sizes", severity: "info", message: `${fontSizes.size} different font sizes on this screen (${[...fontSizes].sort((a, b) => a - b).join(", ")} px). Fewer sizes look calmer; ${MAX_FONT_SIZES} are plenty.` });
  if (spacing.size > MAX_SPACING_VALUES) add({ rule: "spacing-values", severity: "info", message: `${spacing.size} different spacing values on this screen. A few steps of the spacing scale make it look orderly.` });
  if (frame.kind !== "component") {
    const ones = headings.filter((h) => h.level === 1);
    if (headings.length > 0 && ones.length === 0) {
      const first = headings[0]!;
      add({ rule: "headings", severity: "warning", nodeId: first.node.id, message: "This screen has no main heading (H1). Search engines and screen readers look for one.", fix: { label: "Make the first heading the H1", ops: [{ id: opId(), frameId: frame.id, nodeId: first.node.id, op: "setAttrs", attrs: { semantic: { role: "heading", level: 1 } } }] } });
    }
    for (const extra of ones.slice(1)) add({ rule: "headings", severity: "warning", nodeId: extra.node.id, message: `${name(extra.node)} is a second H1; a screen has one.`, fix: { label: "Make it an H2", ops: [{ id: opId(), frameId: frame.id, nodeId: extra.node.id, op: "setAttrs", attrs: { semantic: { role: "heading", level: 2 } } }] } });
    let previous = 0;
    for (const h of headings) {
      if (previous && h.level > previous + 1) add({ rule: "headings", severity: "warning", nodeId: h.node.id, message: `${name(h.node)} jumps from H${previous} to H${h.level}.`, fix: { label: `Make it an H${previous + 1}`, ops: [{ id: opId(), frameId: frame.id, nodeId: h.node.id, op: "setAttrs", attrs: { semantic: { role: "heading", level: previous + 1 } } }] } });
      previous = h.level;
    }
  }
  return findings;
}

/** The smallest spacing token at least `value` px. */
function nearestUp(tokens: Tokens, value: number): string | undefined {
  let best: [string, number] | undefined;
  for (const name of Object.keys(tokens.groups.spacing ?? {})) {
    const v = px(`$spacing.${name}`, tokens);
    if (v === undefined || v < value) continue;
    if (!best || v < best[1]) best = [name, v];
  }
  return best && `$spacing.${best[0]}`;
}

/** Checks every screen and component of a project. */
export function checkProject(project: Pick<Project, "tokens" | "frames">): Finding[] {
  return project.frames.filter((f) => f.kind !== "sketch").flatMap((f) => checkFrame(f, project));
}
