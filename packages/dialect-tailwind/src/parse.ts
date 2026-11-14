import {
  type BackgroundImage,
  type Box,
  type Condition,
  conditionKey,
  type Corners,
  type Edges,
  type Layout,
  type Override,
  type Sizing,
  type Style,
  type StyleValue,
  type Tokens,
  type Transition,
  type Gradient,
  type GradientStop,
  type Shadow,
  BLEND_MODES,
  MOTION_PRESETS,
  type Motion,
} from "@appshape/ir";

/**
 * Tailwind classes → design IR. The inverse of the class compiler in `@appshape/codegen`: what it
 * emits parses back to the same IR. Values become token refs when the theme has them (so both
 * Tailwind v3 and v4 work: names come from the app's own theme), raw values otherwise. Classes the
 * IR can't express (gradients, transforms, `group-hover:` …) are returned as `unmapped` and stay
 * on the element as they are.
 */

export interface ParseContext {
  tokens: Tokens;
  /** The parent's layout: some sizing classes mean different things in a flex parent. */
  parent?: Partial<Layout>;
}

export interface ParsedClasses {
  layout?: Layout;
  box?: Box;
  style?: Style;
  hidden?: boolean;
  overrides?: Override[];
  /** Classes kept as they are (rendered with the app's own CSS). */
  unmapped: string[];
}

interface Piece {
  layout?: Partial<Layout>;
  box?: Partial<Box>;
  style?: Partial<Style>;
  hidden?: boolean;
  /** 0 = all sides, 1 = an axis, 2 = one side: more specific classes win, like in Tailwind. */
  rank?: number;
}

const DEFAULT_BREAKPOINTS = ["sm", "md", "lg", "xl", "2xl"];
const STATES: Record<string, Condition["state"]> = {
  hover: "hover",
  focus: "focus",
  "focus-visible": "focus-visible",
  active: "active",
  disabled: "disabled",
  "group-hover": "group-hover",
};

/** Splits `dark:md:hover:bg-x` into variants and the utility, respecting brackets. */
export function splitVariants(cls: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of cls) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  return { variants: parts, utility: current };
}

function conditionOf(variants: string[], breakpoints: readonly string[]): Condition | undefined | null {
  if (variants.length === 0) return undefined;
  const when: Condition = {};
  for (const v of variants) {
    if (v === "dark" && !when.scheme) when.scheme = "dark";
    else if (breakpoints.includes(v) && !when.viewport) when.viewport = v;
    else if (STATES[v] && !when.state) when.state = STATES[v];
    else return null;
  }
  return when;
}

// ── values ──────────────────────────────────────────────────────────────────

/** `[13px]` → 13px, `[length:var(--x)]` → var(--x) (hint length), `(--x)` → var(--x). */
function arbitrary(token: string): { value: string; hint?: string } | undefined {
  if (token.startsWith("(") && token.endsWith(")")) {
    const inner = token.slice(1, -1);
    const typed = /^([a-z-]+):(--.+)$/.exec(inner);
    if (typed) return { value: `var(${typed[2]})`, hint: typed[1] };
    return inner.startsWith("--") ? { value: `var(${inner})` } : undefined;
  }
  if (!token.startsWith("[") || !token.endsWith("]")) return undefined;
  let inner = token.slice(1, -1);
  let hint: string | undefined;
  const typed = /^([a-z-]+):(.+)$/.exec(inner);
  if (typed && !/^(url|var|calc|rgb|rgba|hsl|hsla|oklch|oklab|color-mix|min|max|clamp)$/.test(typed[1]!)) {
    hint = typed[1];
    inner = typed[2]!;
  }
  const value = inner.replace(/\\_/g, "\u0000").replace(/_/g, " ").replace(/\u0000/g, "_");
  return { value, ...(hint && { hint }) };
}

const LENGTH = /^-?(\d*\.?\d+)(px|rem|em|%|vh|vw|dvh|svh|lvh|ch|ex|vmin|vmax)$|^0$|^(calc|min|max|clamp)\(/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color|color-mix)\(.*\)|transparent|currentColor|var\(--color-.*\))$/;

class Values {
  private readonly spacingBase: { amount: number; unit: string } | undefined;

  constructor(readonly tokens: Tokens) {
    const one = tokens.groups.spacing?.["1"];
    const m = typeof one === "string" ? /^([0-9.]+)(rem|px|em)$/.exec(one) : undefined;
    this.spacingBase = m ? { amount: Number(m[1]), unit: m[2]! } : undefined;
  }

  get v4(): boolean {
    return this.tokens.source !== "tailwind-v3";
  }

  has(group: keyof Tokens["groups"], name: string): boolean {
    return this.tokens.groups[group]?.[name] !== undefined;
  }

  /** Spacing scale value (`4`, `px`, `0.5`); v4 accepts any multiple of the spacing unit. */
  spacing(name: string, negative = false): StyleValue | undefined {
    let value: StyleValue | undefined;
    if (this.has("spacing", name)) value = `$spacing.${name}`;
    else if (this.v4 && /^\d+(\.(25|5|75))?$/.test(name) && this.spacingBase) {
      value = `${+(Number(name) * this.spacingBase.amount).toFixed(4)}${this.spacingBase.unit}`;
    } else {
      const a = arbitrary(name);
      if (a && (!a.hint || a.hint === "length")) value = a.value;
    }
    if (value === undefined || !negative) return value;
    if (value === "$spacing.0" || value === "0") return value;
    const resolved = typeof value === "string" && value.startsWith("$") ? this.tokens.groups.spacing?.[value.slice("$spacing.".length)] : value;
    return resolved === undefined ? undefined : `-${String(resolved)}`;
  }

  /** Length for inset/translate-like utilities: spacing, fractions, full, auto, px. */
  insetValue(name: string, negative: boolean): StyleValue | undefined {
    if (name === "auto") return negative ? undefined : "auto";
    if (name === "full") return negative ? "-100%" : "100%";
    const fraction = /^(\d+)\/(\d+)$/.exec(name);
    if (fraction) return `${negative ? "-" : ""}${+((Number(fraction[1]) / Number(fraction[2])) * 100).toFixed(4)}%`;
    return this.spacing(name, negative);
  }

  color(name: string): StyleValue | undefined {
    if (name === "transparent") return "transparent";
    if (name === "current") return "currentColor";
    if (name === "inherit") return "inherit";
    const a = arbitrary(name);
    if (a) {
      if (a.hint && a.hint !== "color") return undefined;
      return a.hint === "color" || COLOR.test(a.value) || a.value.startsWith("var(") ? a.value : undefined;
    }
    const alpha = /^(.+)\/(\d{1,3}(?:\.\d+)?)$/.exec(name);
    const base = alpha ? alpha[1]! : name;
    if (!this.has("color", base)) {
      if (base === "transparent" || base === "current") return undefined;
      return undefined;
    }
    return alpha ? `$color.${base}/${alpha[2]}` : `$color.${base}`;
  }

  /** A token of `group` by name, or an arbitrary value. */
  token(group: keyof Tokens["groups"], name: string, accept: (value: string, hint?: string) => boolean = () => true): StyleValue | undefined {
    if (this.has(group, name)) return `$${group}.${name}`;
    const a = arbitrary(name);
    if (a && accept(a.value, a.hint)) return a.value;
    return undefined;
  }
}

// ── utilities ───────────────────────────────────────────────────────────────

type Handler = (m: RegExpExecArray, v: Values, ctx: ParseContext, negative: boolean) => Piece | undefined;

const SIDES: Record<string, (keyof Edges)[]> = {
  "": ["top", "right", "bottom", "left"],
  x: ["left", "right"],
  y: ["top", "bottom"],
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
};
const rankOf = (side: string) => (side === "" ? 0 : side === "x" || side === "y" ? 1 : 2);

function edges(side: string, value: StyleValue): Partial<Edges> {
  return Object.fromEntries(SIDES[side]!.map((s) => [s, value]));
}

const CORNERS: Record<string, (keyof Corners)[]> = {
  "": ["topLeft", "topRight", "bottomRight", "bottomLeft"],
  t: ["topLeft", "topRight"],
  r: ["topRight", "bottomRight"],
  b: ["bottomRight", "bottomLeft"],
  l: ["topLeft", "bottomLeft"],
  tl: ["topLeft"],
  tr: ["topRight"],
  br: ["bottomRight"],
  bl: ["bottomLeft"],
};

const ALIGN = new Set(["start", "center", "end", "stretch", "baseline"]);
const JUSTIFY = new Set(["start", "center", "end", "between", "around", "evenly"]);

function sizing(dimension: "w" | "h", name: string, v: Values, ctx: ParseContext): Sizing | undefined {
  const parentFlex = ctx.parent?.mode === "flex";
  const mainAxis = (ctx.parent?.direction ?? "row") === "row" ? "w" : "h";
  if (name === "full") {
    // Fill means flex: 1 on a flex parent's main axis and align-self: stretch on its cross axis.
    const fill = dimension === "w" ? !(parentFlex && mainAxis === "w") : !parentFlex;
    return fill ? { mode: "fill" } : { mode: "fixed", value: "100%" };
  }
  if (name === "fit") return parentFlex ? { mode: "fixed", value: "fit-content" } : { mode: "hug" };
  if (name === "auto") return { mode: "fixed", value: "auto" };
  if (name === "screen") return { mode: "fixed", value: dimension === "w" ? "100vw" : "100vh" };
  if (/^(dvh|svh|lvh|dvw|svw|lvw)$/.test(name)) return { mode: "fixed", value: `100${name}` };
  if (name === "min") return { mode: "fixed", value: "min-content" };
  if (name === "max") return { mode: "fixed", value: "max-content" };
  const fraction = /^(\d+)\/(\d+)$/.exec(name);
  if (fraction) return { mode: "fixed", value: `${+((Number(fraction[1]) / Number(fraction[2])) * 100).toFixed(4)}%` };
  if (v.has("size", name) && !v.has("spacing", name)) return { mode: "fixed", value: `$size.${name}` };
  const value = v.spacing(name);
  return value === undefined ? undefined : { mode: "fixed", value };
}

function minMax(dimension: "w" | "h", name: string, v: Values): StyleValue | undefined {
  if (name === "full") return "100%";
  if (name === "screen") return dimension === "w" ? "100vw" : "100vh";
  if (/^(dvh|svh|lvh)$/.test(name)) return `100${name}`;
  if (name === "none") return "none";
  if (name === "fit") return "fit-content";
  if (name === "min") return "min-content";
  if (name === "max") return "max-content";
  if (name === "prose") return "65ch";
  const screen = /^screen-(.+)$/.exec(name);
  if (screen) {
    const bp = v.tokens.groups.breakpoint?.[screen[1]!];
    return bp === undefined ? undefined : String(bp);
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(name);
  if (fraction) return `${+((Number(fraction[1]) / Number(fraction[2])) * 100).toFixed(4)}%`;
  if (v.has("size", name) && !v.has("spacing", name)) return `$size.${name}`;
  return v.spacing(name);
}

const isLength = (value: string, hint?: string) => hint === "length" || (!hint && LENGTH.test(value));

const BG_POSITION = /^bg-(center|top|bottom|left|right|left-top|right-top|left-bottom|right-bottom|top-left|top-right|bottom-left|bottom-right)$/;
const BG_IMAGE_PART = /^bg-(cover|contain|auto|no-repeat|repeat|center|top|bottom|left|right|left-top|right-top|left-bottom|right-bottom|top-left|top-right|bottom-left|bottom-right)$/;

/** `left-top` (Tailwind v3) and `top-left` (v4) → `top-left`. */
function bgPosition(value: string): BackgroundImage["position"] {
  const [a, b] = value.split("-");
  if (!b) return a as BackgroundImage["position"];
  const vertical = a === "top" || a === "bottom" ? a : b;
  const horizontal = a === "left" || a === "right" ? a : b;
  return `${vertical}-${horizontal}` as BackgroundImage["position"];
}

const UTILITIES: Array<[RegExp, Handler]> = [
  // display
  [/^(inline-)?(flex|grid|block)$/, (m) => ({ layout: { mode: m[2] as Layout["mode"], ...(m[1] && { inline: true }) } })],
  [/^inline-block$/, () => ({ layout: { mode: "block", inline: true } })],
  [/^hidden$/, () => ({ hidden: true })],
  // flex
  [/^flex-(row|col)$/, (m) => ({ layout: { direction: m[1] === "col" ? "column" : "row" } })],
  [/^flex-(wrap|nowrap)$/, (m) => ({ layout: { wrap: m[1] === "wrap" } })],
  [/^items-(.+)$/, (m) => (ALIGN.has(m[1]!) ? { layout: { align: m[1] as Layout["align"] } } : undefined)],
  [/^justify-(.+)$/, (m) => (JUSTIFY.has(m[1]!) ? { layout: { justify: m[1] as Layout["justify"] } } : undefined)],
  [/^self-(.+)$/, (m) => (ALIGN.has(m[1]!) ? { box: { alignSelf: m[1] as Box["alignSelf"] } } : undefined)],
  [/^gap-(x-|y-)?(.+)$/, (m, v) => {
    const value = v.spacing(m[2]!);
    if (value === undefined) return undefined;
    const key = m[1] === "x-" ? "columnGap" : m[1] === "y-" ? "rowGap" : "gap";
    return { layout: { [key]: value } };
  }],
  [/^flex-1$/, (_m, _v, ctx) => {
    if (ctx.parent?.mode === "flex") {
      const dimension = (ctx.parent.direction ?? "row") === "row" ? "width" : "height";
      return { box: { [dimension]: { mode: "fill" } } };
    }
    return { box: { grow: 1, shrink: 1, basis: "0%" } };
  }],
  [/^flex-auto$/, () => ({ box: { grow: 1, shrink: 1, basis: "auto" } })],
  [/^flex-none$/, () => ({ box: { grow: 0, shrink: 0, basis: "auto" } })],
  [/^flex-initial$/, () => ({ box: { grow: 0, shrink: 1, basis: "auto" } })],
  [/^(?:flex-)?(grow|shrink)(-0)?$/, (m) => ({ box: { [m[1]!]: m[2] ? 0 : 1 } })],
  [/^basis-(.+)$/, (m, v) => {
    if (m[1] === "0") return { box: { basis: "0%" } };
    const value = m[1] === "full" ? "100%" : m[1] === "auto" ? "auto" : (v.insetValue(m[1]!, false) ?? minMax("w", m[1]!, v));
    return value === undefined ? undefined : { box: { basis: value } };
  }],
  // grid
  [/^grid-(cols|rows)-(.+)$/, (m) => {
    const key = m[1] === "cols" ? "columns" : "rows";
    if (/^\d+$/.test(m[2]!)) return { layout: { [key]: Number(m[2]) } };
    const a = arbitrary(m[2]!);
    return a ? { layout: { [key]: a.value } } : undefined;
  }],
  [/^col-span-(\d+|full)$/, (m) => ({ box: { colSpan: m[1] === "full" ? "full" : Number(m[1]) } })],
  [/^row-span-(\d+)$/, (m) => ({ box: { rowSpan: Number(m[1]) } })],
  // spacing
  [/^p([xytrbl]?)-(.+)$/, (m, v) => {
    const value = v.spacing(m[2]!);
    return value === undefined ? undefined : { layout: { padding: edges(m[1]!, value) as Edges }, rank: rankOf(m[1]!) };
  }],
  [/^m([xytrbl]?)-(.+)$/, (m, v, _ctx, negative) => {
    const value = m[2] === "auto" ? (negative ? undefined : "auto") : v.spacing(m[2]!, negative);
    return value === undefined ? undefined : { box: { margin: edges(m[1]!, value) as Edges }, rank: rankOf(m[1]!) };
  }],
  // sizing
  [/^(w|h)-(.+)$/, (m, v, ctx) => {
    const value = sizing(m[1] as "w" | "h", m[2]!, v, ctx);
    return value ? { box: { [m[1] === "w" ? "width" : "height"]: value } } : undefined;
  }],
  [/^size-(.+)$/, (m, v, ctx) => {
    const w = sizing("w", m[1]!, v, ctx);
    const h = sizing("h", m[1]!, v, ctx);
    return w && h ? { box: { width: w, height: h } } : undefined;
  }],
  [/^(min|max)-(w|h)-(.+)$/, (m, v) => {
    const value = minMax(m[2] as "w" | "h", m[3]!, v);
    const key = `${m[1]}${m[2] === "w" ? "Width" : "Height"}` as "minWidth";
    return value === undefined ? undefined : { box: { [key]: value } };
  }],
  // position
  [/^(static|relative|absolute|fixed|sticky)$/, (m) => ({ box: { position: m[1] as Box["position"] } })],
  [/^inset(-[xy])?-(.+)$/, (m, v, _ctx, negative) => {
    const value = v.insetValue(m[2]!, negative);
    const side = m[1] ? m[1].slice(1) : "";
    return value === undefined ? undefined : { box: { inset: edges(side, value) as Edges }, rank: rankOf(side) };
  }],
  [/^(top|right|bottom|left)-(.+)$/, (m, v, _ctx, negative) => {
    const value = v.insetValue(m[2]!, negative);
    return value === undefined ? undefined : { box: { inset: { [m[1]!]: value } }, rank: 2 };
  }],
  [/^z-(.+)$/, (m) => {
    if (/^\d+$/.test(m[1]!)) return { box: { zIndex: Number(m[1]) } };
    const a = arbitrary(m[1]!);
    return a && /^-?\d+$/.test(a.value) ? { box: { zIndex: Number(a.value) } } : undefined;
  }],
  [/^order-(first|last|none|\d+)$/, (m, _v, _ctx, negative) => {
    const n = m[1] === "first" ? -9999 : m[1] === "last" ? 9999 : m[1] === "none" ? 0 : Number(m[1]);
    return { box: { order: negative ? -n : n } };
  }],
  [/^aspect-(.+)$/, (m) => {
    if (m[1] === "square") return { box: { aspectRatio: "1 / 1" } };
    if (m[1] === "video") return { box: { aspectRatio: "16 / 9" } };
    const a = arbitrary(m[1]!);
    return a ? { box: { aspectRatio: a.value } } : undefined;
  }],
  // gradients: a direction or shape, plus from / via / to colors and positions (assembled in parseClasses)
  [/^bg-(?:linear|gradient)-to-(t|tr|r|br|b|bl|l|tl)$/, (m) => ({ style: { gradient: { type: "linear", angle: SIDE_ANGLE[m[1]!] } } as never })],
  [/^bg-linear-(\d+)$/, (m, _v, _ctx, negative) => ({ style: { gradient: { type: "linear", angle: ((negative ? -1 : 1) * Number(m[1]) + 360) % 360 } } as never })],
  [/^bg-radial$/, () => ({ style: { gradient: { type: "radial" } } as never })],
  [/^bg-\[(linear|radial)-gradient\((.*),?var\(--tw-gradient-stops\)\)\]$/, (m) => {
    if (m[1] === "radial") return { style: { gradient: { type: "radial" } } as never };
    const angle = directionAngle(m[2]!.replace(/_/g, " ").replace(/,$/, "").trim());
    return angle === undefined ? undefined : { style: { gradient: { type: "linear", angle } } as never };
  }],
  [/^(from|via|to)-(\d+(?:\.\d+)?)%$/, (m) => ({ style: { gradient: { [`${m[1]}At`]: Number(m[2]) } } as never })],
  [/^(from|via|to)-(.+)$/, (m, v) => {
    const color = v.color(m[2]!);
    return color === undefined ? undefined : { style: { gradient: { [m[1]!]: color } } as never };
  }],
  [/^bg-\[image:(.+)\]$/, (m, v) => {
    // a gradient over a picture, as code generation writes it
    const layers = splitTop(arbitrary(`[${m[1]}]`)!.value, ",");
    const url = layers.length === 2 ? /^url\((['"]?)(.+)\1\)$/.exec(layers[1]!.trim()) : undefined;
    const gradient = url && parseGradientCss(layers[0]!.trim(), v);
    return gradient ? { style: { gradient, backgroundImage: { src: url[2]! } } } : undefined;
  }],
  [/^bg-clip-text$/, () => ({ style: { backgroundClip: "text" } })],
  // the design system's named styles (classes from AppShape's CSS block)
  [/^type-([a-z0-9][a-z0-9-]*)$/, (m, v) => (v.tokens.textStyles?.[m[1]!] ? { style: { textStyle: m[1]! } } : undefined)],
  [/^effect-([a-z0-9][a-z0-9-]*)$/, (m, v) => (v.tokens.effectStyles?.[m[1]!] ? { style: { effectStyle: m[1]! } } : undefined)],
  [/^(mix-blend|bg-blend)-(.+)$/, (m) => ((BLEND_MODES as readonly string[]).includes(m[2]!) ? { style: { [m[1] === "mix-blend" ? "blendMode" : "backgroundBlendMode"]: m[2] } as Partial<Style> } : undefined)],
  // a hover group (children style themselves with group-hover:); `transform` is a no-op in Tailwind v4 (and v3.0+)
  [/^group$/, () => ({ style: { hoverGroup: true } })],
  [/^transform(-gpu|-cpu)?$/, () => ({})],
  // blur
  [/^(backdrop-)?blur(?:-(.+))?$/, (m, v) => {
    const name = m[2] ?? "DEFAULT";
    const value = v.token("blur", name, (x) => LENGTH.test(x));
    return value === undefined ? undefined : { style: { [m[1] ? "backdropBlur" : "blur"]: value } };
  }],
  // transforms
  [/^rotate-(\d+|\[-?[\d.]+deg\])$/, (m, _v, _ctx, negative) => ({ style: { rotate: (negative ? -1 : 1) * parseFloat(m[1]!.replace(/[[\]]|deg/g, "")) } })],
  [/^scale-(\d+|\[[\d.]+%?\])$/, (m) => {
    const raw = m[1]!.replace(/[[\]]/g, "");
    return { style: { scale: m[1]!.startsWith("[") ? (raw.endsWith("%") ? parseFloat(raw) : +(parseFloat(raw) * 100).toFixed(2)) : Number(raw) } };
  }],
  [/^translate-(x|y)-(.+)$/, (m, v, _ctx, negative) => {
    const value = v.insetValue(m[2]!, negative);
    return value === undefined ? undefined : { style: { translate: { [m[1]!]: value } } };
  }],
  [/^skew-(x|y)-(\d+|\[-?[\d.]+deg\])$/, (m, _v, _ctx, negative) => ({ style: { skew: { [m[1]!]: (negative ? -1 : 1) * parseFloat(m[2]!.replace(/[[\]]|deg/g, "")) } } })],
  // background images: bg-[url(...)] plus its size, position and repeat (only with a url, see parseClasses)
  [/^bg-\[url\((.+)\)\]$/, (m) => ({ style: { backgroundImage: { src: m[1]!.replace(/^(['"])(.*)\1$/, "$2") } } })],
  [/^bg-(cover|contain|auto)$/, (m) => ({ style: { backgroundImage: { size: m[1] as "cover" } } as Partial<Style> })],
  [/^bg-(no-repeat|repeat)$/, (m) => ({ style: { backgroundImage: { repeat: m[1] === "repeat" } } as Partial<Style> })],
  [BG_POSITION, (m) => ({ style: { backgroundImage: { position: bgPosition(m[1]!) } } as Partial<Style> })],
  // colors and type
  [/^bg-(.+)$/, (m, v) => {
    const value = v.color(m[1]!);
    return value === undefined ? undefined : { style: { background: value } };
  }],
  [/^text-(left|center|right|justify)$/, (m) => ({ style: { textAlign: m[1] as Style["textAlign"] } })],
  [/^text-(.+)$/, (m, v) => {
    const [size, leading] = splitModifier(m[1]!);
    if (v.has("fontSize", size)) {
      const piece: Piece = { style: { fontSize: `$fontSize.${size}` } };
      if (leading) {
        const lh = leadingValue(leading, v);
        if (lh === undefined) return undefined;
        piece.style!.lineHeight = lh;
      }
      return piece;
    }
    const a = arbitrary(m[1]!);
    if (a && isLength(a.value, a.hint)) return { style: { fontSize: a.value } };
    const color = v.color(m[1]!);
    return color === undefined ? undefined : { style: { color } };
  }],
  [/^font-(.+)$/, (m, v) => {
    if (v.has("fontWeight", m[1]!)) return { style: { fontWeight: `$fontWeight.${m[1]}` } };
    if (v.has("fontFamily", m[1]!)) return { style: { fontFamily: `$fontFamily.${m[1]}` } };
    const a = arbitrary(m[1]!);
    if (!a) return undefined;
    if (/^\d{3}$/.test(a.value)) return { style: { fontWeight: Number(a.value) } };
    return a.hint === "family-name" || /^['"]/.test(a.value) ? { style: { fontFamily: a.value } } : undefined;
  }],
  [/^leading-(.+)$/, (m, v) => {
    const value = leadingValue(m[1]!, v);
    return value === undefined ? undefined : { style: { lineHeight: value } };
  }],
  [/^tracking-(.+)$/, (m, v, _ctx, negative) => {
    const value = v.token("letterSpacing", m[1]!, isLength);
    if (value === undefined) return undefined;
    if (!negative) return { style: { letterSpacing: value } };
    const resolved = typeof value === "string" && value.startsWith("$") ? v.tokens.groups.letterSpacing?.[m[1]!] : value;
    return resolved === undefined ? undefined : { style: { letterSpacing: `calc(${String(resolved)} * -1)` } };
  }],
  [/^(uppercase|lowercase|capitalize|normal-case)$/, (m) => ({ style: { textTransform: m[1] === "normal-case" ? "none" : (m[1] as Style["textTransform"]) } })],
  [/^(underline|line-through|no-underline)$/, (m) => ({ style: { textDecoration: m[1] === "no-underline" ? "none" : (m[1] as Style["textDecoration"]) } })],
  [/^opacity-(.+)$/, (m) => {
    if (/^\d+(\.\d+)?$/.test(m[1]!)) return { style: { opacity: +(Number(m[1]) / 100).toFixed(4) } };
    const a = arbitrary(m[1]!);
    return a && /^(0|1|0?\.\d+)$/.test(a.value) ? { style: { opacity: Number(a.value) } } : undefined;
  }],
  // borders
  [/^border(?:-([xytrbl]))?(?:-(\d+|\[.+\]))?$/, (m) => {
    const side = m[1] ?? "";
    let width: StyleValue;
    if (m[2] === undefined) width = 1;
    else if (/^\d+$/.test(m[2])) width = Number(m[2]);
    else {
      const a = arbitrary(m[2]);
      if (!a || !isLength(a.value, a.hint)) return undefined;
      width = a.value;
    }
    return { style: { borderWidth: edges(side, width) as Edges }, rank: rankOf(side) };
  }],
  [/^border-(solid|dashed|dotted|none)$/, (m) => ({ style: { borderStyle: m[1] as Style["borderStyle"] } })],
  [/^border-(.+)$/, (m, v) => {
    const value = v.color(m[1]!);
    return value === undefined ? undefined : { style: { borderColor: value } };
  }],
  [/^rounded(?:-(tl|tr|br|bl|t|r|b|l))?(?:-(.+))?$/, (m, v) => {
    const side = m[1] ?? "";
    const name = m[2];
    let value: StyleValue | undefined;
    if (name === undefined) value = v.has("radius", "DEFAULT") ? "$radius.DEFAULT" : "0.25rem";
    else value = v.token("radius", name, isLength);
    if (value === undefined) return undefined;
    return { style: { radius: Object.fromEntries(CORNERS[side]!.map((c) => [c, value])) as Corners }, rank: side === "" ? 0 : side.length === 1 ? 1 : 2 };
  }],
  [/^shadow(?:-(.+))?$/, (m, v) => {
    if (m[1] === undefined) return v.has("shadow", "DEFAULT") ? { style: { shadow: "$shadow.DEFAULT" } } : undefined;
    if (m[1] === "none") return { style: { shadow: "none" } };
    if (!v.has("shadow", m[1]!)) {
      const color = v.color(m[1]!);
      if (color !== undefined) return { style: { shadowColor: color } };
      const a = arbitrary(m[1]!);
      const list = a && !a.hint ? parseShadowList(a.value, v) : undefined;
      if (list) return { style: { shadow: list } };
    }
    const value = v.token("shadow", m[1], (value, hint) => !hint && !COLOR.test(value) && /\d/.test(value));
    return value === undefined ? undefined : { style: { shadow: value } };
  }],
  [/^ring(?:-(\d+))?$/, (m, v) => ({ style: { ring: { width: m[1] !== undefined ? Number(m[1]) : v.v4 ? 1 : 3 } } })],
  [/^ring-offset-(\d+)$/, (m) => ({ style: { ring: { offset: Number(m[1]) } } })],
  [/^ring-(.+)$/, (m, v) => {
    const value = v.color(m[1]!);
    return value === undefined ? undefined : { style: { ring: { color: value } } };
  }],
  [/^overflow-(hidden|auto|scroll|visible)$/, (m) => ({ style: { overflow: m[1] as Style["overflow"] } })],
  [/^(italic|not-italic)$/, (m) => ({ style: { fontStyle: m[1] === "italic" ? "italic" : "normal" } })],
  // transitions
  [/^transition(?:-(all|colors|opacity|shadow|transform))?$/, (m) => ({ style: { transition: { property: (m[1] ?? "default") as Transition["property"] } } })],
  [/^(duration|delay)-(\d+|\[\d+ms\])$/, (m) => ({ style: { transition: { [m[1]!]: Number(m[2]!.replace(/\D/g, "")) } } })],
  [/^ease-(linear|in|out|in-out)$/, (m) => ({ style: { transition: { easing: m[1] as Transition["easing"] } } })],
  [/^cursor-([a-z-]+)$/, (m) => ({ style: { cursor: m[1]! } })],
];

/** `xl/7` → [xl, 7]; brackets keep their slashes. */
function splitModifier(value: string): [string, string | undefined] {
  if (value.startsWith("[") || value.startsWith("(")) return [value, undefined];
  const slash = value.lastIndexOf("/");
  if (slash < 0) return [value, undefined];
  return [value.slice(0, slash), value.slice(slash + 1)];
}

function leadingValue(name: string, v: Values): StyleValue | undefined {
  if (v.has("lineHeight", name) && !/^\d/.test(name)) return `$lineHeight.${name}`;
  if (name === "none") return "1";
  if (/^\d+(\.\d+)?$/.test(name)) {
    if (!v.v4) return v.has("lineHeight", name) ? `$lineHeight.${name}` : undefined;
    const spacing = v.spacing(name);
    if (spacing === undefined) return undefined;
    const resolved = typeof spacing === "string" && spacing.startsWith("$") ? v.tokens.groups.spacing?.[name] : spacing;
    return resolved === undefined ? undefined : String(resolved);
  }
  const a = arbitrary(name);
  return a ? a.value : undefined;
}

// ── merging ─────────────────────────────────────────────────────────────────

interface Bundle {
  layout: Partial<Layout>;
  box: Partial<Box>;
  style: Partial<Style>;
  hidden?: boolean;
}

const EDGE_KEYS = new Set(["padding", "margin", "inset"]);

function mergeInto(target: Bundle, piece: Piece): void {
  if (piece.hidden !== undefined) target.hidden = piece.hidden;
  for (const key of ["layout", "box", "style"] as const) {
    const source = piece[key] as Record<string, unknown> | undefined;
    if (!source) continue;
    const into = target[key] as Record<string, unknown>;
    for (const [k, value] of Object.entries(source)) {
      if (EDGE_KEYS.has(k) || k === "borderWidth" || k === "radius" || k === "ring" || k === "backgroundImage" || k === "transition" || k === "gradient" || k === "translate" || k === "skew") {
        into[k] = { ...(typeof into[k] === "object" ? (into[k] as object) : {}), ...(value as object) };
      } else into[k] = value;
    }
  }
}

function finish(bundle: Bundle): { layout?: Layout; box?: Box; style?: Style; hidden?: boolean } {
  const style = { ...bundle.style } as Record<string, unknown>;
  // borderWidth and radius are collected per side; collapse when all sides agree.
  for (const [key, sides] of [
    ["borderWidth", ["top", "right", "bottom", "left"]],
    ["radius", ["topLeft", "topRight", "bottomRight", "bottomLeft"]],
  ] as const) {
    const value = style[key] as Record<string, StyleValue> | undefined;
    if (!value) continue;
    const first = value[sides[0]];
    if (sides.every((s) => value[s] !== undefined && value[s] === first)) style[key] = first;
  }
  const out: { layout?: Layout; box?: Box; style?: Style; hidden?: boolean } = {};
  if (Object.keys(bundle.layout).length) out.layout = bundle.layout as Layout;
  if (Object.keys(bundle.box).length) out.box = bundle.box as Box;
  if (Object.keys(style).length) out.style = style as Style;
  if (bundle.hidden !== undefined) out.hidden = bundle.hidden;
  return out;
}

const empty = (): Bundle => ({ layout: {}, box: {}, style: {} });

// ── entrances ───────────────────────────────────────────────────────────────

const MOTION_EASING: Record<string, Motion["easing"]> = { linear: "linear", "ease-in": "in", "ease-out": "out", "ease-in-out": "in-out" };
const MOTION_ANIMATION = /^(\*:)?motion-safe:animate-\[aps-([a-z-]+)_(\d+)ms_([a-z-]+)(?:_(\d+)ms)?_both\]$/;

/**
 * The entrance animation code generation writes (`motion-safe:animate-[aps-slide-up_600ms_ease-out_both]`,
 * `aps-reveal`, `aps-stagger [--aps-stagger:80ms] *:motion-safe:animate-[…]`), back into `style.motion`.
 * Incomplete sets stay as classes.
 */
function extractMotion(classes: readonly string[]): { motion?: Motion; rest: string[] } {
  let animation: RegExpExecArray | undefined;
  let trigger: Motion["trigger"] = "load";
  let stagger: number | undefined;
  let staggerDelay: number | undefined;
  let staggered = false;
  const used: string[] = [];
  for (const cls of classes) {
    const m = MOTION_ANIMATION.exec(cls);
    if (m && (MOTION_PRESETS as readonly string[]).includes(m[2]!) && MOTION_EASING[m[4]!] && !animation) animation = m;
    else if (cls === "aps-reveal" || cls === "aps-reveal-repeat") trigger = cls === "aps-reveal" ? "scroll" : "scroll-repeat";
    else if (cls === "aps-stagger") staggered = true;
    else if (/^\[--aps-stagger:\d+ms\]$/.test(cls)) stagger = Number(cls.replace(/\D/g, ""));
    else if (/^\[--aps-delay:\d+ms\]$/.test(cls)) staggerDelay = Number(cls.replace(/\D/g, ""));
    else continue;
    used.push(cls);
  }
  if (!animation || Boolean(animation[1]) !== staggered || (staggered && !stagger)) return { rest: [...classes] };
  const duration = Number(animation[3]);
  const easing = MOTION_EASING[animation[4]!]!;
  const delay = staggered ? staggerDelay : animation[5] !== undefined ? Number(animation[5]) : undefined;
  const motion: Motion = {
    preset: animation[2] as Motion["preset"],
    trigger,
    ...(duration !== 600 && { duration }),
    ...(delay && { delay }),
    ...(easing !== "out" && { easing }),
    ...(staggered && { stagger }),
  };
  return { motion, rest: classes.filter((c) => !used.includes(c)) };
}

/** A carousel's snapping as code generation writes it (`snap-x snap-mandatory *:snap-start`). */
function extractSnap(classes: readonly string[]): { snap?: Style["snap"]; rest: string[] } {
  const axis = classes.find((c) => c === "snap-x" || c === "snap-y");
  const align = classes.find((c) => c === "*:snap-start" || c === "*:snap-center");
  if (!axis || !align || !classes.includes("snap-mandatory")) return { rest: [...classes] };
  return { snap: align.endsWith("center") ? "center" : "start", rest: classes.filter((c) => c !== axis && c !== align && c !== "snap-mandatory") };
}

/** Classes → IR style. */
export function parseClasses(all: readonly string[], ctx: ParseContext): ParsedClasses {
  const { snap, rest: unsnapped } = extractSnap(all);
  const { motion, rest: classes } = extractMotion(unsnapped);
  const values = new Values(ctx.tokens);
  const breakpoints = Object.keys(ctx.tokens.groups.breakpoint ?? {}).length ? Object.keys(ctx.tokens.groups.breakpoint!) : DEFAULT_BREAKPOINTS;
  const unmapped: string[] = [];
  const groups = new Map<string, { when?: Condition; pieces: Piece[]; gradientClasses: string[] }>();
  // bg-cover, bg-center … describe a background image only when the classes set one (else they stay as they are)
  const hasImage = classes.some((c) => c.includes("bg-[url(") || (c.includes("bg-[image:") && c.includes("url(")));

  for (const cls of classes) {
    if (!cls || cls.startsWith("!") || cls.endsWith("!")) {
      if (cls) unmapped.push(cls);
      continue;
    }
    const { variants, utility } = splitVariants(cls);
    const when = conditionOf(variants, breakpoints);
    if (when === null) {
      unmapped.push(cls);
      continue;
    }
    const negative = utility.startsWith("-");
    const name = negative ? utility.slice(1) : utility;
    if (!hasImage && BG_IMAGE_PART.test(name)) {
      unmapped.push(cls);
      continue;
    }
    let piece: Piece | undefined;
    for (const [pattern, handler] of UTILITIES) {
      const m = pattern.exec(name);
      if (!m) continue;
      piece = handler(m, values, ctx, negative);
      if (piece) break;
    }
    if (!piece || (negative && !isNegatable(name))) {
      unmapped.push(cls);
      continue;
    }
    const key = when ? conditionKey(when) : "";
    const group = groups.get(key) ?? { ...(when && { when }), pieces: [], gradientClasses: [] };
    group.pieces.push(piece);
    if (piece.style && "gradient" in piece.style) group.gradientClasses.push(cls);
    groups.set(key, group);
  }

  const bundles = new Map<string, { when?: Condition; bundle: Bundle }>();
  for (const [key, group] of groups) {
    const bundle = empty();
    const ordered = group.pieces.map((p, i) => ({ p, i })).sort((a, b) => (a.p.rank ?? 0) - (b.p.rank ?? 0) || a.i - b.i);
    for (const { p } of ordered) mergeInto(bundle, p);
    bundles.set(key, { ...(group.when && { when: group.when }), bundle });
  }
  // Gradients: `dark:from-x` or `hover:to-y` change stops of the element's own gradient (Tailwind's
  // variables), so an override's parts complete the base's. Incomplete ones stay as classes.
  const baseParts = bundles.get("")?.bundle.style.gradient as GradientParts | undefined;
  for (const [key, { bundle }] of bundles) {
    if (!bundle.style.gradient) continue;
    const own = bundle.style.gradient as GradientParts;
    const parts = key !== "" && baseParts && !baseParts.stops && !own.stops ? { ...baseParts, ...own } : own;
    const gradient = assembleGradient(parts);
    if (gradient) bundle.style.gradient = gradient;
    else {
      delete bundle.style.gradient;
      unmapped.push(...groups.get(key)!.gradientClasses);
    }
  }

  const base = bundles.get("")?.bundle ?? empty();
  bundles.delete("");
  // `hidden md:flex`: the display mode belongs to the element (shown from md on).
  if (base.hidden && base.layout.mode === undefined) {
    for (const { bundle } of bundles.values()) {
      if (bundle.layout.mode !== undefined && bundle.hidden === undefined) {
        base.layout.mode = bundle.layout.mode;
        if (bundle.layout.inline) base.layout.inline = true;
        break;
      }
    }
  }
  const overrides: Override[] = [];
  for (const { when, bundle } of bundles.values()) {
    if (base.hidden && bundle.layout.mode !== undefined && bundle.hidden === undefined) {
      bundle.hidden = false;
      if (bundle.layout.mode === base.layout.mode && !!bundle.layout.inline === !!base.layout.inline) {
        delete bundle.layout.mode;
        delete bundle.layout.inline;
      }
    }
    const done = finish(bundle);
    if (Object.keys(done).length === 0) continue;
    overrides.push({ when: when!, ...done });
  }
  const result: ParsedClasses = { ...finish(base), unmapped };
  if (motion) result.style = { ...result.style, motion };
  if (snap) result.style = { ...result.style, snap };
  if (overrides.length) result.overrides = overrides;
  return result;
}

const NEGATABLE = /^(m[xytrbl]?|inset(-[xy])?|top|right|bottom|left|tracking|order|rotate|translate-[xy]|skew-[xy]|bg-linear)-/;

// ── gradients and shadows ───────────────────────────────────────────────────

const SIDE_ANGLE: Record<string, Gradient["angle"]> = { t: 0, r: 90, b: 180, l: 270, tr: "to-tr", br: "to-br", bl: "to-bl", tl: "to-tl" };
const DIRECTION_ANGLE: Record<string, Gradient["angle"]> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": "to-tr", "to right top": "to-tr", "to bottom right": "to-br", "to right bottom": "to-br", "to bottom left": "to-bl", "to left bottom": "to-bl", "to top left": "to-tl", "to left top": "to-tl" };

function directionAngle(direction: string): Gradient["angle"] | undefined {
  const d = direction.replace(/\s+in\s+\w+$/, "").trim();
  if (d in DIRECTION_ANGLE) return DIRECTION_ANGLE[d];
  const deg = /^(-?[\d.]+)deg$/.exec(d);
  return deg ? ((Number(deg[1]) % 360) + 360) % 360 : undefined;
}

/** Splits at `sep` outside parentheses. */
function splitTop(value: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/** A color written by code generation (`var(--color-x)`, its `color-mix` with alpha) or a raw color. */
function cssColor(value: string, v: Values): StyleValue | undefined {
  const plain = /^var\(--color-([\w.-]+)\)$/.exec(value);
  if (plain) return v.has("color", plain[1]!) ? `$color.${plain[1]}` : value;
  const mixed = /^color-mix\(in oklab,\s*var\(--color-([\w.-]+)\)\s+([\d.]+)%,\s*transparent\)$/.exec(value);
  if (mixed) return v.has("color", mixed[1]!) ? `$color.${mixed[1]}/${mixed[2]}` : value;
  return COLOR.test(value) ? value : undefined;
}

/** `linear-gradient(to right in oklab, var(--color-a) 0%, …)` back into a design gradient. */
function parseGradientCss(css: string, v: Values): Gradient | undefined {
  const m = /^(linear|radial)-gradient\((.*)\)$/.exec(css);
  if (!m) return undefined;
  const args = splitTop(m[2]!, ",");
  let angle: Gradient["angle"];
  if (m[1] === "linear") {
    angle = directionAngle(args[0]!);
    if (angle === undefined) return undefined;
    args.shift();
  } else if (/^in\s+\w+$/.test(args[0]!)) args.shift();
  if (args.length < 2 || args.length > 3) return undefined;
  const stops: GradientStop[] = [];
  for (const arg of args) {
    const parts = splitTop(arg, " ");
    const at = parts.length > 1 && /^[\d.]+%$/.test(parts.at(-1)!) ? parseFloat(parts.pop()!) : undefined;
    const color = cssColor(parts.join(" "), v);
    if (color === undefined) return undefined;
    stops.push({ color, ...(at !== undefined && { at }) });
  }
  // the default positions say nothing
  const defaults = stops.map((_, i) => (i === 0 ? 0 : i === stops.length - 1 ? 100 : 50));
  stops.forEach((s, i) => {
    if (s.at === defaults[i]) delete s.at;
  });
  return { type: m[1] as Gradient["type"], ...(angle !== undefined && angle !== 180 && { angle }), stops };
}

/** `0 8px 24px -4px var(--color-x)` (comma-separated) back into shadows. */
function parseShadowList(css: string, v: Values): Shadow[] | undefined {
  const list: Shadow[] = [];
  for (const part of splitTop(css, ",")) {
    const words = splitTop(part, " ");
    const inset = words[0] === "inset";
    if (inset) words.shift();
    const lengths: number[] = [];
    while (words.length && /^-?[\d.]+(px)?$/.test(words[0]!)) lengths.push(parseFloat(words.shift()!));
    if (lengths.length < 2 || lengths.length > 4 || words.length === 0) return undefined;
    const color = cssColor(words.join(" "), v);
    if (color === undefined) return undefined;
    list.push({ x: lengths[0]!, y: lengths[1]!, blur: lengths[2] ?? 0, ...(lengths[3] !== undefined && { spread: lengths[3] }), color, ...(inset && { inset: true }) });
  }
  return list.length ? list : undefined;
}

interface GradientParts {
  type?: Gradient["type"];
  angle?: Gradient["angle"];
  stops?: GradientStop[];
  from?: StyleValue;
  via?: StyleValue;
  to?: StyleValue;
  fromAt?: number;
  viaAt?: number;
  toAt?: number;
}

/** The gradient the classes describe, or undefined when they don't make a whole one. */
function assembleGradient(parts: GradientParts): Gradient | undefined {
  if (parts.stops) return parts as Gradient;
  if (!parts.type || parts.from === undefined || parts.to === undefined) return undefined;
  const stop = (color: StyleValue, at: number | undefined): GradientStop => ({ color, ...(at !== undefined && { at }) });
  const stops = [stop(parts.from, parts.fromAt), ...(parts.via !== undefined ? [stop(parts.via, parts.viaAt)] : []), stop(parts.to, parts.toAt)];
  return { type: parts.type, ...(parts.angle !== undefined && parts.angle !== 180 && { angle: parts.angle }), stops };
}
function isNegatable(utility: string): boolean {
  return NEGATABLE.test(utility);
}
