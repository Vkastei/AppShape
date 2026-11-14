import {
  type Box,
  type Condition,
  type DesignNode,
  type Edges,
  type Layout,
  conditionKey,
  type Override,
  parseTokenRef,
  type Sizing,
  type Style,
  type StyleValue,
  type TokenGroup,
  type Tokens,
  type Transition,
  type Gradient,
  gradientCss,
  gradientDirection,
  type Motion,
  motionAnimation,
  shadowListCss,
} from "@appshape/ir";

/**
 * Design IR → Tailwind classes. Mirrors the renderer's CSS (`@appshape/render` css.ts) so the
 * generated app looks like the board: same sizing rules, overrides only emit what they set.
 */

export interface ClassContext {
  tokens: Tokens;
  /** Problems worth telling the user (unknown tokens, values without a utility). */
  warnings: string[];
  /** The URL the app uses for an image source (`asset:` paths become files in `public/`). */
  image?: (src: string) => string;
  /** Elements whose entrance is generated as Motion code (no animation classes for them). */
  skipMotion?: (node: DesignNode) => boolean;
}

const BG_POSITION: Record<string, string> = {
  center: "bg-center",
  top: "bg-top",
  bottom: "bg-bottom",
  left: "bg-left",
  right: "bg-right",
  "top-left": "bg-left-top",
  "top-right": "bg-right-top",
  "bottom-left": "bg-left-bottom",
  "bottom-right": "bg-right-bottom",
};

/** Variant classes: property name → value → classes (from overrides with a `prop` condition). */
export type VariantClasses = Record<string, Record<string, string[]>>;

export interface NodeClasses {
  base: string[];
  variants: VariantClasses;
}

/** Escapes a raw value for an arbitrary-value class (`p-[13px]`, `bg-[rgb(0_0_0_/_0.1)]`). */
export function arbitrary(value: string): string {
  return `[${value.trim().replace(/_/g, "\\_").replace(/\s+/g, "_")}]`;
}

type Slot = "length" | "color" | "raw";

/**
 * The class for `prefix` + value: a token name when the token's group fits the utility, else an
 * arbitrary value. `groups` are the token groups the utility understands by name.
 */
function utility(prefix: string, value: StyleValue | undefined, groups: readonly TokenGroup[], slot: Slot, ctx: ClassContext): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (slot === "length") return value === 0 ? `${prefix}-0` : `${prefix}-[${value}px]`;
    return `${prefix}-[${value}]`;
  }
  const ref = parseTokenRef(value);
  if (ref) {
    if (ctx.tokens.groups[ref.group]?.[ref.name] === undefined) ctx.warnings.push(`unknown token ${value}`);
    if (groups.includes(ref.group)) return ref.name === "DEFAULT" ? prefix : `${prefix}-${ref.name}${ref.alpha !== undefined ? `/${ref.alpha}` : ""}`;
    const resolved = ctx.tokens.groups[ref.group]?.[ref.name];
    if (resolved === undefined) return `${prefix}-${ref.name}`;
    return utility(prefix, typeof resolved === "number" && slot === "length" ? resolved : String(resolved), [], slot, ctx);
  }
  if (value === "0" && slot === "length") return `${prefix}-0`;
  if (slot === "color" && Object.hasOwn(KEYWORD_COLORS, value)) return `${prefix}-${KEYWORD_COLORS[value]}`;
  if (value === "auto" && slot === "length") return `${prefix}-auto`;
  // Ambiguous utilities (text-, border-) need a type hint for some raw values.
  const hint = slot === "color" && !/^(#|rgb|hsl|oklch|oklab|lab|lch|color\(|var\()/.test(value) ? "color:" : "";
  return `${prefix}-${arbitrary(hint + value)}`;
}

const KEYWORD_COLORS: Record<string, string> = { transparent: "transparent", currentColor: "current", currentcolor: "current", inherit: "inherit" };

const SPACE: readonly TokenGroup[] = ["spacing"];
const SIZE: readonly TokenGroup[] = ["spacing", "size"];
const COLOR: readonly TokenGroup[] = ["color"];

const push = (list: string[], value: string | undefined) => {
  if (value) list.push(value);
};

/** p-4 / px-4 py-2 / pt-1 … for exactly the sides present. */
function edgeClasses(out: string[], prefix: string, value: Partial<Edges> | undefined, ctx: ClassContext): void {
  if (!value) return;
  const { top, right, bottom, left } = value;
  const all = [top, right, bottom, left];
  const same = (a: StyleValue | undefined, b: StyleValue | undefined) => a !== undefined && a === b;
  if (all.every((v) => same(v, top))) {
    push(out, utility(prefix, top, SPACE, "length", ctx));
    return;
  }
  if (same(left, right)) push(out, utility(`${prefix}x`, left, SPACE, "length", ctx));
  else {
    push(out, utility(`${prefix}r`, right, SPACE, "length", ctx));
    push(out, utility(`${prefix}l`, left, SPACE, "length", ctx));
  }
  if (same(top, bottom)) push(out, utility(`${prefix}y`, top, SPACE, "length", ctx));
  else {
    push(out, utility(`${prefix}t`, top, SPACE, "length", ctx));
    push(out, utility(`${prefix}b`, bottom, SPACE, "length", ctx));
  }
}

const ALIGN: Record<string, string> = { start: "start", center: "center", end: "end", stretch: "stretch", baseline: "baseline" };

/** `override`: classes for an override, where a row direction must be explicit (`md:flex-row`). */
export function layoutClasses(layout: Partial<Layout> | undefined, ctx: ClassContext, override = false): string[] {
  const out: string[] = [];
  if (!layout) return out;
  const inline = layout.inline ? "inline-" : "";
  switch (layout.mode) {
    case "flex":
      out.push(`${inline}flex`);
      if (layout.direction === "column") out.push("flex-col");
      if (layout.direction === "row" && override) out.push("flex-row");
      break;
    case "grid":
      out.push(`${inline}grid`);
      break;
    case "block":
      out.push(`${inline}block`);
      break;
    case "absolute":
      out.push("relative");
      break;
    case undefined:
      if (layout.direction) out.push(layout.direction === "column" ? "flex-col" : "flex-row");
      if (layout.inline) out.push("inline-block");
  }
  if (layout.wrap !== undefined) out.push(layout.wrap ? "flex-wrap" : "flex-nowrap");
  if (layout.columns !== undefined) out.push(typeof layout.columns === "number" ? `grid-cols-${layout.columns}` : `grid-cols-${arbitrary(layout.columns)}`);
  if (layout.rows !== undefined) out.push(typeof layout.rows === "number" ? `grid-rows-${layout.rows}` : `grid-rows-${arbitrary(layout.rows)}`);
  push(out, utility("gap", layout.gap, SPACE, "length", ctx));
  push(out, utility("gap-y", layout.rowGap, SPACE, "length", ctx));
  push(out, utility("gap-x", layout.columnGap, SPACE, "length", ctx));
  if (layout.align) out.push(`items-${ALIGN[layout.align]}`);
  if (layout.justify) out.push(`justify-${layout.justify}`);
  edgeClasses(out, "p", layout.padding, ctx);
  return out;
}

function sizingClasses(out: string[], dimension: "w" | "h", value: Sizing | undefined, parent: Partial<Layout> | undefined, ctx: ClassContext): void {
  if (!value) return;
  const parentFlex = parent?.mode === "flex";
  const mainAxis = (parent?.direction ?? "row") === "row" ? "w" : "h";
  switch (value.mode) {
    case "fixed":
      push(out, utility(dimension, value.value, SIZE, "length", ctx));
      break;
    case "hug":
      if (!parentFlex) out.push(`${dimension}-fit`);
      break;
    case "fill":
      if (parentFlex && mainAxis === dimension) out.push("flex-1", `min-${dimension}-0`);
      else if (parentFlex && dimension === "h") out.push("self-stretch");
      else out.push(`${dimension}-full`);
      break;
  }
}

function minMax(prefix: string, value: StyleValue | undefined, ctx: ClassContext): string | undefined {
  if (value === "100vh") return `${prefix}-screen`;
  if (value === "100%") return `${prefix}-full`;
  return utility(prefix, value, SIZE, "length", ctx);
}

export function boxClasses(box: Partial<Box> | undefined, parent: Partial<Layout> | undefined, ctx: ClassContext): string[] {
  const out: string[] = [];
  if (!box) return out;
  sizingClasses(out, "w", box.width, parent, ctx);
  sizingClasses(out, "h", box.height, parent, ctx);
  push(out, minMax("min-w", box.minWidth, ctx));
  push(out, minMax("max-w", box.maxWidth, ctx));
  push(out, minMax("min-h", box.minHeight, ctx));
  push(out, minMax("max-h", box.maxHeight, ctx));
  edgeClasses(out, "m", box.margin, ctx);
  if (box.alignSelf) out.push(`self-${ALIGN[box.alignSelf]}`);
  if (box.grow !== undefined) out.push(box.grow === 1 ? "grow" : box.grow === 0 ? "grow-0" : `grow-[${box.grow}]`);
  if (box.shrink !== undefined) out.push(box.shrink === 1 ? "shrink" : box.shrink === 0 ? "shrink-0" : `shrink-[${box.shrink}]`);
  if (box.basis !== undefined) out.push(box.basis === "0%" || box.basis === 0 ? "basis-0" : utility("basis", box.basis, SIZE, "length", ctx)!);
  if (box.colSpan !== undefined) out.push(box.colSpan === "full" ? "col-span-full" : `col-span-${box.colSpan}`);
  if (box.rowSpan !== undefined) out.push(`row-span-${box.rowSpan}`);
  if (box.position) out.push(box.position);
  if (box.inset) {
    push(out, utility("top", box.inset.top, SPACE, "length", ctx));
    push(out, utility("right", box.inset.right, SPACE, "length", ctx));
    push(out, utility("bottom", box.inset.bottom, SPACE, "length", ctx));
    push(out, utility("left", box.inset.left, SPACE, "length", ctx));
  }
  if (box.zIndex !== undefined) out.push(typeof box.zIndex === "number" ? `z-${box.zIndex}` : utility("z", box.zIndex, ["zIndex"], "raw", ctx)!);
  if (box.aspectRatio) {
    const ratio = box.aspectRatio.replace(/\s+/g, "");
    out.push(ratio === "1/1" ? "aspect-square" : ratio === "16/9" ? "aspect-video" : `aspect-${arbitrary(ratio)}`);
  }
  if (box.order !== undefined) out.push(ORDER[box.order] ?? (box.order < 0 ? `-order-${-box.order}` : `order-${box.order}`));
  if (parent?.mode === "absolute" && (box.x !== undefined || box.y !== undefined)) {
    out.push("absolute", `left-[${box.x ?? 0}px]`, `top-[${box.y ?? 0}px]`);
  }
  return out;
}

function borderWidth(value: StyleValue | undefined, side: string): string | undefined {
  if (value === undefined) return undefined;
  const prefix = side ? `border-${side}` : "border";
  if (value === 1 || value === "1px") return prefix;
  if (typeof value === "number") return [0, 2, 4, 8].includes(value) ? `${prefix}-${value}` : `${prefix}-[${value}px]`;
  return `${prefix}-${arbitrary(`length:${value}`)}`;
}

const TEXT_TRANSFORM: Record<string, string> = { none: "normal-case", uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize" };
const DECORATION: Record<string, string> = { none: "no-underline", underline: "underline", "line-through": "line-through" };

export function styleClasses(style: Partial<Style> | undefined, ctx: ClassContext): string[] {
  const out: string[] = [];
  if (!style) return out;
  // named styles first: the element's own classes refine them
  if (style.textStyle) out.push(`type-${style.textStyle}`);
  if (style.effectStyle) out.push(`effect-${style.effectStyle}`);
  push(out, utility("bg", style.background, COLOR, "color", ctx));
  const v3 = ctx.tokens.source === "tailwind-v3";
  if (style.gradient && !style.backgroundImage) out.push(...gradientClasses(style.gradient, v3, ctx));
  if (style.backgroundImage) {
    const image = style.backgroundImage;
    const url = (ctx.image ?? ((src: string) => src))(image.src).replace(/'/g, "%27").replace(/ /g, "%20");
    // a gradient over the picture: both layers in one background-image
    if (style.gradient) out.push(`bg-${arbitrary(`image:${gradientCss(style.gradient, cssColor, !v3)},url('${url}')`)}`);
    else out.push(`bg-[url('${url}')]`);
    if (image.size) out.push(`bg-${image.size}`);
    if (image.position) out.push(BG_POSITION[image.position]!);
    if (image.repeat !== undefined) out.push(image.repeat ? "bg-repeat" : "bg-no-repeat");
  }
  push(out, utility("text", style.color, COLOR, "color", ctx));
  if (style.opacity !== undefined) {
    const n = Number(style.opacity);
    out.push(typeof style.opacity === "string" && style.opacity.startsWith("$") ? utility("opacity", style.opacity, ["opacity"], "raw", ctx)! : Number.isFinite(n) ? `opacity-${Math.round(n * 100)}` : `opacity-${arbitrary(String(style.opacity))}`);
  }
  if (typeof style.borderWidth === "object") {
    push(out, borderWidth(style.borderWidth.top, "t"));
    push(out, borderWidth(style.borderWidth.right, "r"));
    push(out, borderWidth(style.borderWidth.bottom, "b"));
    push(out, borderWidth(style.borderWidth.left, "l"));
  } else {
    push(out, borderWidth(style.borderWidth, ""));
  }
  push(out, utility("border", style.borderColor, COLOR, "color", ctx));
  if (style.borderStyle) out.push(`border-${style.borderStyle}`);
  if (typeof style.radius === "object") {
    push(out, utility("rounded-tl", style.radius.topLeft, ["radius"], "length", ctx));
    push(out, utility("rounded-tr", style.radius.topRight, ["radius"], "length", ctx));
    push(out, utility("rounded-br", style.radius.bottomRight, ["radius"], "length", ctx));
    push(out, utility("rounded-bl", style.radius.bottomLeft, ["radius"], "length", ctx));
  } else {
    push(out, utility("rounded", style.radius, ["radius"], "length", ctx));
  }
  if (style.backgroundClip === "text") out.push("bg-clip-text");
  if (style.hoverGroup) out.push("group");
  if (style.shadow === "none") out.push("shadow-none");
  else if (Array.isArray(style.shadow)) out.push(`shadow-${arbitrary(shadowListCss(style.shadow, cssColor))}`);
  else push(out, utility("shadow", style.shadow, ["shadow"], "raw", ctx));
  push(out, utility("shadow", style.shadowColor, COLOR, "color", ctx));
  if (style.blendMode) out.push(`mix-blend-${style.blendMode}`);
  if (style.backgroundBlendMode) out.push(`bg-blend-${style.backgroundBlendMode}`);
  push(out, utility("blur", style.blur, ["blur"], "length", ctx));
  push(out, utility("backdrop-blur", style.backdropBlur, ["blur"], "length", ctx));
  out.push(...transformClasses(style, v3, ctx));
  if (style.ring) {
    const width = style.ring.width ?? 3;
    out.push(typeof width === "number" ? (width === 3 ? "ring-3" : `ring-${width}`) : utility("ring", width, [], "length", ctx)!);
    push(out, utility("ring", style.ring.color, COLOR, "color", ctx));
    if (style.ring.offset !== undefined) out.push(typeof style.ring.offset === "number" ? `ring-offset-${style.ring.offset}` : utility("ring-offset", style.ring.offset, [], "length", ctx)!);
  }
  push(out, utility("font", style.fontFamily, ["fontFamily"], "raw", ctx));
  push(out, utility("text", style.fontSize, ["fontSize"], "length", ctx));
  if (style.fontWeight !== undefined) {
    out.push(typeof style.fontWeight === "number" ? `font-[${style.fontWeight}]` : utility("font", style.fontWeight, ["fontWeight"], "raw", ctx)!);
  }
  push(out, utility("leading", style.lineHeight, ["lineHeight"], "raw", ctx));
  push(out, utility("tracking", style.letterSpacing, ["letterSpacing"], "raw", ctx));
  if (style.fontStyle) out.push(style.fontStyle === "italic" ? "italic" : "not-italic");
  if (style.textAlign) out.push(`text-${style.textAlign}`);
  if (style.textTransform) out.push(TEXT_TRANSFORM[style.textTransform]!);
  if (style.textDecoration) out.push(DECORATION[style.textDecoration]!);
  if (style.overflow) out.push(`overflow-${style.overflow}`);
  if (style.cursor) out.push(/^[a-z-]+$/.test(style.cursor) ? `cursor-${style.cursor}` : `cursor-${arbitrary(style.cursor)}`);
  if (typeof style.transition === "string") out.push(arbitrary(`transition:${style.transition}`));
  else if (style.transition) out.push(...transitionClasses(style.transition));
  if (style.motion) out.push(...motionClasses(style.motion));
  return out;
}

/**
 * An entrance as classes: the animation (only without reduced motion, `motion-safe:`) with keyframes
 * from the theme block's motion part; `aps-reveal` waits for the element to scroll into view
 * (`ScrollReveal` marks it); a staggered element animates its children (`*:`), one step apart.
 */
export function motionClasses(motion: Motion): string[] {
  const out: string[] = [];
  if (motion.trigger !== "load") out.push(motion.trigger === "scroll" ? "aps-reveal" : "aps-reveal-repeat");
  if (motion.stagger) {
    out.push("aps-stagger", `[--aps-stagger:${motion.stagger}ms]`);
    if (motion.delay) out.push(`[--aps-delay:${motion.delay}ms]`);
    out.push(`*:motion-safe:animate-${arbitrary(motionAnimation(motion, false))}`);
  } else {
    out.push(`motion-safe:animate-${arbitrary(motionAnimation(motion))}`);
  }
  return out;
}

/** A color as the app's CSS writes it: theme variables (with alpha like Tailwind's `/50`), raw values as they are. */
function cssColor(value: StyleValue): string {
  if (typeof value === "number") return String(value);
  const ref = parseTokenRef(value);
  if (!ref) return value;
  const variable = `var(--${ref.group === "color" ? "color" : ref.group}-${ref.name})`;
  return ref.alpha !== undefined ? `color-mix(in oklab, ${variable} ${ref.alpha}%, transparent)` : variable;
}

const DIRECTION: Record<string, string> = { "to top": "t", "to right": "r", "to bottom": "b", "to left": "l", "to top right": "tr", "to bottom right": "br", "to bottom left": "bl", "to top left": "tl" };

/** `bg-linear-to-r from-x via-y to-z` (v3: `bg-gradient-to-r …`); angles and radial ones need v4 or an arbitrary value. */
function gradientClasses(gradient: Gradient, v3: boolean, ctx: ClassContext): string[] {
  const out: string[] = [];
  const direction = gradientDirection(gradient.angle);
  const keyword = DIRECTION[direction];
  if (gradient.type === "radial") out.push(v3 ? "bg-[radial-gradient(var(--tw-gradient-stops))]" : "bg-radial");
  else if (keyword) out.push(v3 ? `bg-gradient-to-${keyword}` : `bg-linear-to-${keyword}`);
  else out.push(v3 ? `bg-[linear-gradient(${direction},var(--tw-gradient-stops))]` : `bg-linear-${parseFloat(direction)}`);
  const names = gradient.stops.length === 2 ? ["from", "to"] : ["from", "via", "to"];
  gradient.stops.forEach((stop, i) => {
    push(out, utility(names[i]!, stop.color, COLOR, "color", ctx));
    if (stop.at !== undefined) out.push(`${names[i]}-${stop.at}%`);
  });
  return out;
}

const ROTATE_V3 = new Set([0, 1, 2, 3, 6, 12, 45, 90, 180]);
const SCALE_V3 = new Set([0, 50, 75, 90, 95, 100, 105, 110, 125, 150]);
const SKEW_V3 = new Set([0, 1, 2, 3, 6, 12]);

/** rotate-3, -rotate-6, scale-105, translate-x-2, -translate-y-1, skew-x-3 (arbitrary values off Tailwind v3's scale). */
function transformClasses(style: Partial<Style>, v3: boolean, ctx: ClassContext): string[] {
  const out: string[] = [];
  const degrees = (prefix: string, n: number, steps: Set<number>) => {
    const abs = Math.abs(n);
    const named = Number.isInteger(abs) && (!v3 || steps.has(abs));
    return named ? `${n < 0 ? "-" : ""}${prefix}-${abs}` : `${prefix}-[${n}deg]`;
  };
  if (style.rotate !== undefined) out.push(degrees("rotate", style.rotate, ROTATE_V3));
  if (style.scale !== undefined) out.push(Number.isInteger(style.scale) && (!v3 || SCALE_V3.has(style.scale)) ? `scale-${style.scale}` : `scale-[${+(style.scale / 100).toFixed(4)}]`);
  for (const axis of ["x", "y"] as const) {
    const value = style.translate?.[axis];
    if (value === undefined) continue;
    const negative = typeof value === "string" && value.startsWith("-") && value !== "-0";
    const cls = utility(`translate-${axis}`, negative ? (value as string).slice(1) : value, SPACE, "length", ctx)!;
    out.push(negative ? `-${cls}` : cls);
  }
  if (style.skew?.x !== undefined) out.push(degrees("skew-x", style.skew.x, SKEW_V3));
  if (style.skew?.y !== undefined) out.push(degrees("skew-y", style.skew.y, SKEW_V3));
  return out;
}

const ORDER: Record<number, string> = { [-9999]: "order-first", 9999: "order-last", 0: "order-none" };
/** Durations and delays both Tailwind versions have as named steps; others are arbitrary values. */
const TIME_STEPS = new Set([0, 75, 100, 150, 200, 300, 500, 700, 1000]);
const time = (prefix: string, ms: number) => (TIME_STEPS.has(ms) ? `${prefix}-${ms}` : `${prefix}-[${ms}ms]`);

function transitionClasses(t: Transition): string[] {
  const out: string[] = [];
  if (t.property) out.push(t.property === "default" ? "transition" : `transition-${t.property}`);
  if (t.duration !== undefined) out.push(time("duration", t.duration));
  if (t.easing) out.push(`ease-${t.easing}`);
  if (t.delay !== undefined) out.push(time("delay", t.delay));
  return out;
}

const STATE_PREFIX: Record<NonNullable<Condition["state"]>, string> = {
  hover: "hover",
  focus: "focus",
  "focus-visible": "focus-visible",
  active: "active",
  disabled: "disabled",
  pressed: "active",
  "group-hover": "group-hover",
};

/** `dark:md:hover:` for a condition (without its `prop` part). */
export function conditionPrefix(when: Omit<Condition, "prop">): string {
  let prefix = "";
  if (when.scheme === "dark") prefix += "dark:";
  if (when.scheme === "light") prefix += "not-dark:";
  if (when.viewport) prefix += `${when.viewport}:`;
  if (when.state) prefix += `${STATE_PREFIX[when.state]}:`;
  return prefix;
}

function overrideClasses(node: DesignNode, override: Override, parent: Partial<Layout> | undefined, ctx: ClassContext): string[] {
  const out = [...layoutClasses(override.layout, ctx, true), ...boxClasses(override.box, parent, ctx), ...styleClasses(override.style, ctx)];
  if (override.hidden === true) out.push("hidden");
  if (override.hidden === false) {
    const mode = override.layout?.mode ?? node.layout?.mode;
    const inline = override.layout?.inline ?? node.layout?.inline;
    out.push(mode === "flex" ? `${inline ? "inline-" : ""}flex` : mode === "grid" ? `${inline ? "inline-" : ""}grid` : inline ? "inline-block" : "block");
  }
  return out;
}

/** Classes for a node: base (with breakpoint/state/scheme prefixes) and per-variant classes. */
export function nodeClasses(node: DesignNode, parent: Partial<Layout> | undefined, ctx: ClassContext): NodeClasses {
  const display = new Set(["flex", "inline-flex", "grid", "inline-grid", "block", "inline-block"]);
  // Hidden by default: no display class in the base (it would compete with `hidden`).
  const layout = layoutClasses(node.layout, ctx).filter((c) => !(node.hidden && display.has(c)));
  const style = node.style?.motion && ctx.skipMotion?.(node) ? { ...node.style, motion: undefined } : node.style;
  const base = [...layout, ...boxClasses(node.box, parent, ctx), ...styleClasses(style, ctx)];
  // a carousel: the row (or column) snaps its children into place
  if (style?.snap) base.push(`snap-${node.layout?.direction === "column" ? "y" : "x"}`, "snap-mandatory", `*:snap-${style.snap}`);
  if (node.hidden) base.push("hidden");
  const variants: VariantClasses = {};
  const viewportOrder = Object.keys(ctx.tokens.groups.breakpoint ?? {});
  const overrides = [...mergeSameCondition(node.overrides ?? [])].sort(
    (a, b) => viewportOrder.indexOf(a.when.viewport ?? "") - viewportOrder.indexOf(b.when.viewport ?? ""),
  );
  for (const override of overrides) {
    const { prop, ...rest } = override.when;
    const prefix = conditionPrefix(rest);
    const classes = overrideClasses(node, override, parent, ctx).map((c) => prefix + c);
    if (!prop) base.push(...classes);
    else ((variants[prop.name] ??= {})[prop.value] ??= []).push(...classes);
  }
  // classes without a design equivalent (typed in "Classes", or kept from an import) stay as they are
  base.push(...(node.platformRaw?.unmapped ?? []));
  return { base: dedupe(base), variants };
}

/**
 * Overrides for the same condition as one (later values win, as on the board), so their classes
 * never compete (e.g. a detached component's `md:` padding and its size variant's `md:` padding).
 */
function mergeSameCondition(overrides: readonly Override[]): Override[] {
  const merged = new Map<string, Override>();
  for (const override of overrides) {
    const key = conditionKey(override.when);
    const before = merged.get(key);
    if (!before) {
      merged.set(key, override);
      continue;
    }
    const next: Override = { when: override.when };
    const layout = { ...before.layout, ...override.layout };
    const box = { ...before.box, ...override.box };
    const style = { ...before.style, ...override.style };
    if (Object.keys(layout).length) next.layout = layout;
    if (Object.keys(box).length) next.box = box;
    if (Object.keys(style).length) next.style = style;
    const hidden = override.hidden ?? before.hidden;
    if (hidden !== undefined) next.hidden = hidden;
    merged.set(key, next);
  }
  return [...merged.values()];
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
