import {
  type Box,
  type Edges,
  type Layout,
  parseTokenRef,
  withAlpha,
  type Sizing,
  type Style,
  type StyleValue,
  type Tokens,
  type Transition,
  gradientCss,
  shadowListCss,
} from "@appshape/ir";

/** CSS declarations, property name → value (kebab-case properties). */
export type Decls = Record<string, string>;

export const DEFAULT_BREAKPOINTS: Record<string, string> = {
  sm: "40rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "96rem",
};

/** What a node needs to know about its parent to size itself. */
export interface ParentContext {
  layout: Layout | undefined;
}

type Kind = "length" | "color" | "number" | "raw";

/** The custom property a token with a dark-mode value renders through (`--aps-tk-color-background`). */
export function tokenVariable(group: string, name: string): string {
  return `--aps-tk-${group}-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export class ValueResolver {
  readonly warnings: string[] = [];
  private warned = new Set<string>();
  /** Tokens used that change with the color scheme: variable → [light, dark]. */
  readonly schemeTokens = new Map<string, [string, string]>();

  constructor(
    private readonly tokens: Tokens,
    /** Height of the screen being designed; `vh` units resolve against it instead of the browser window. */
    private readonly viewportHeight?: number,
    /** Turns an image source (`asset:` path, app path, URL) into a URL the page can load. */
    private readonly imageUrl: (src: string) => string = (src) => src,
  ) {}

  image(src: string): string {
    return this.imageUrl(src);
  }

  /** Tailwind v4 (the default) or v3: gradients interpolate in oklab, transforms are separate properties. */
  get v4(): boolean {
    return this.tokens.source !== "tailwind-v3";
  }

  value(value: StyleValue | undefined, kind: Kind): string | undefined {
    const resolved = this.resolve(value, kind);
    if (resolved === undefined || this.viewportHeight === undefined || !resolved.includes("vh")) return resolved;
    return resolved.replace(/(-?[0-9.]+)vh\b/g, (_, n: string) => `${+((Number(n) * this.viewportHeight!) / 100).toFixed(2)}px`);
  }

  private resolve(value: StyleValue | undefined, kind: Kind): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "number") return kind === "length" ? (value === 0 ? "0" : `${value}px`) : String(value);
    const ref = parseTokenRef(value);
    if (!ref) return value;
    const resolved = this.tokens.groups[ref.group]?.[ref.name];
    if (resolved === undefined) {
      if (!this.warned.has(value)) this.warnings.push(`unknown token ${value}`);
      this.warned.add(value);
      return kind === "color" ? "magenta" : kind === "length" ? "0" : undefined;
    }
    const format = (v: string | number) => (typeof v === "number" ? (kind === "length" && ref.group !== "fontWeight" ? `${v}px` : String(v)) : v);
    let css = format(resolved);
    const dark = this.tokens.dark?.[ref.group]?.[ref.name];
    if (dark !== undefined && dark !== resolved) {
      // Follows the board's scheme (see `schemeTokenCss`), like the app's CSS variables do.
      const variable = tokenVariable(ref.group, ref.name);
      this.schemeTokens.set(variable, [css, format(dark)]);
      css = `var(${variable})`;
    }
    return ref.alpha !== undefined ? withAlpha(css, ref.alpha) : css;
  }

  /** The page defaults a theme sets: body font, text and background color (from `sans`, `foreground`, `background`). */
  themeBase(): Decls {
    const decls: Decls = {};
    const usable = (group: "fontFamily" | "color", name: string) => {
      const value = this.tokens.groups[group]?.[name];
      // imported themes may point at the app's own variables; those don't resolve here
      return typeof value === "string" && !value.includes("var(") ? this.value(`$${group}.${name}`, group === "color" ? "color" : "raw") : undefined;
    };
    set(decls, "font-family", usable("fontFamily", "sans"));
    set(decls, "color", usable("color", "foreground"));
    set(decls, "background", usable("color", "background"));
    return decls;
  }

  /** Declarations of the scheme-dependent tokens used: light values, and dark ones under `.aps-dark`. */
  schemeTokenCss(frameClass: string): string {
    if (this.schemeTokens.size === 0) return "";
    const light = [...this.schemeTokens].map(([v, [l]]) => `${v}: ${l};`).join(" ");
    const dark = [...this.schemeTokens].map(([v, [, d]]) => `${v}: ${d};`).join(" ");
    return `.${frameClass} { ${light} }\n.${frameClass}.aps-dark { ${dark} }`;
  }

  /** A `$fontSize.<name>` token implies the `$lineHeight.<name>` token as default line height. */
  defaultLineHeight(fontSize: StyleValue | undefined): string | undefined {
    if (typeof fontSize !== "string") return undefined;
    const ref = parseTokenRef(fontSize);
    if (ref?.group !== "fontSize") return undefined;
    const value = this.tokens.groups.lineHeight?.[ref.name];
    return value === undefined ? undefined : String(value);
  }

  breakpoint(name: string): string {
    const value = this.tokens.groups.breakpoint?.[name] ?? DEFAULT_BREAKPOINTS[name];
    if (value === undefined) {
      if (!this.warned.has(`bp:${name}`)) this.warnings.push(`unknown breakpoint ${name}`);
      this.warned.add(`bp:${name}`);
      return "0px";
    }
    return typeof value === "number" ? `${value}px` : value;
  }
}

const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};
const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

function set(decls: Decls, property: string, value: string | undefined): void {
  if (value !== undefined) decls[property] = value;
}

function edges(decls: Decls, prefix: string, suffix: string, value: Edges | undefined, r: ValueResolver): void {
  if (!value) return;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    set(decls, `${prefix}-${side}${suffix}`, r.value(value[side], "length"));
  }
}

function tracks(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `repeat(${value}, minmax(0, 1fr))` : value;
}

/**
 * Declarations for exactly the keys present in `layout`. Overrides rely on this: an `lg:` override
 * that only changes the gap must not re-emit columns set by the base or by `md:`.
 */
export function layoutDecls(layout: Partial<Layout> | undefined, r: ValueResolver): Decls {
  const decls: Decls = {};
  if (!layout) return decls;
  const inline = layout.inline ? "inline-" : "";
  switch (layout.mode) {
    case "flex":
      decls.display = `${inline}flex`;
      decls["flex-direction"] = layout.direction ?? "row";
      break;
    case "grid":
      decls.display = `${inline}grid`;
      break;
    case "block":
      decls.display = `${inline}block`;
      break;
    case "absolute":
      decls.position = "relative";
      break;
    case undefined:
      if (layout.direction) decls["flex-direction"] = layout.direction;
      if (layout.inline) decls.display = "inline-block";
  }
  if (layout.wrap !== undefined) decls["flex-wrap"] = layout.wrap ? "wrap" : "nowrap";
  set(decls, "grid-template-columns", tracks(layout.columns));
  set(decls, "grid-template-rows", tracks(layout.rows));
  set(decls, "gap", r.value(layout.gap, "length"));
  set(decls, "row-gap", r.value(layout.rowGap, "length"));
  set(decls, "column-gap", r.value(layout.columnGap, "length"));
  if (layout.align) decls["align-items"] = ALIGN[layout.align]!;
  if (layout.justify) decls["justify-content"] = JUSTIFY[layout.justify]!;
  edges(decls, "padding", "", layout.padding, r);
  return decls;
}

function sizing(decls: Decls, dimension: "width" | "height", value: Sizing | undefined, parent: ParentContext, r: ValueResolver) {
  if (!value) return;
  const parentFlex = parent.layout?.mode === "flex";
  const mainAxis = (parent.layout?.direction ?? "row") === "row" ? "width" : "height";
  switch (value.mode) {
    case "fixed":
      set(decls, dimension, r.value(value.value, "length"));
      break;
    case "hug":
      if (!parentFlex) decls[dimension] = "fit-content";
      break;
    case "fill":
      if (parentFlex && mainAxis === dimension) {
        decls.flex = "1 1 0%";
        decls[`min-${dimension}`] = "0";
      } else if (parentFlex && dimension === "height") {
        decls["align-self"] = "stretch";
      } else {
        decls[dimension] = "100%";
      }
      break;
  }
}

export function boxDecls(box: Partial<Box> | undefined, parent: ParentContext, r: ValueResolver): Decls {
  const decls: Decls = {};
  if (!box) return decls;
  sizing(decls, "width", box.width, parent, r);
  sizing(decls, "height", box.height, parent, r);
  set(decls, "min-width", r.value(box.minWidth, "length"));
  set(decls, "max-width", r.value(box.maxWidth, "length"));
  set(decls, "min-height", r.value(box.minHeight, "length"));
  set(decls, "max-height", r.value(box.maxHeight, "length"));
  edges(decls, "margin", "", box.margin, r);
  if (box.alignSelf) decls["align-self"] = ALIGN[box.alignSelf]!;
  if (box.grow !== undefined) decls["flex-grow"] = String(box.grow);
  if (box.shrink !== undefined) decls["flex-shrink"] = String(box.shrink);
  set(decls, "flex-basis", r.value(box.basis, "length"));
  if (box.colSpan !== undefined) decls["grid-column"] = box.colSpan === "full" ? "1 / -1" : `span ${box.colSpan} / span ${box.colSpan}`;
  if (box.rowSpan !== undefined) decls["grid-row"] = `span ${box.rowSpan} / span ${box.rowSpan}`;
  set(decls, "position", box.position);
  if (box.inset) {
    for (const side of ["top", "right", "bottom", "left"] as const) set(decls, side, r.value(box.inset[side], "length"));
  }
  set(decls, "z-index", r.value(box.zIndex, "number"));
  set(decls, "aspect-ratio", box.aspectRatio);
  if (box.order !== undefined) decls.order = String(box.order);
  if (parent.layout?.mode === "absolute" && (box.x !== undefined || box.y !== undefined)) {
    decls.position = "absolute";
    decls.left = `${box.x ?? 0}px`;
    decls.top = `${box.y ?? 0}px`;
  }
  return decls;
}

export function styleDecls(style: Partial<Style> | undefined, r: ValueResolver): Decls {
  const decls: Decls = {};
  if (!style) return decls;
  const background = r.value(style.background, "color");
  // Colors only set the color, so background images from passthrough classes (gradients) survive.
  if (background !== undefined) decls[/(gradient|url)\(/.test(background) ? "background" : "background-color"] = background;
  // a gradient is drawn over the picture (an overlay), both over the fill color
  const layers: string[] = [];
  if (style.gradient) layers.push(gradientCss(style.gradient, (v) => r.value(v, "color") ?? "transparent", r.v4));
  if (style.backgroundImage) layers.push(`url(${JSON.stringify(r.image(style.backgroundImage.src))})`);
  if (layers.length) decls["background-image"] = layers.join(", ");
  if (style.backgroundClip === "text") {
    decls["-webkit-background-clip"] = "text";
    decls["background-clip"] = "text";
  }
  if (style.backgroundImage) {
    const image = style.backgroundImage;
    set(decls, "background-size", image.size);
    set(decls, "background-position", image.position?.replace("-", " "));
    if (image.repeat !== undefined) decls["background-repeat"] = image.repeat ? "repeat" : "no-repeat";
  }
  set(decls, "color", r.value(style.color, "color"));
  set(decls, "opacity", r.value(style.opacity, "number"));
  if (typeof style.borderWidth === "object") edges(decls, "border", "-width", style.borderWidth, r);
  else set(decls, "border-width", r.value(style.borderWidth, "length"));
  set(decls, "border-color", r.value(style.borderColor, "color"));
  set(decls, "border-style", style.borderStyle);
  if (typeof style.radius === "object") {
    set(decls, "border-top-left-radius", r.value(style.radius.topLeft, "length"));
    set(decls, "border-top-right-radius", r.value(style.radius.topRight, "length"));
    set(decls, "border-bottom-right-radius", r.value(style.radius.bottomRight, "length"));
    set(decls, "border-bottom-left-radius", r.value(style.radius.bottomLeft, "length"));
  } else {
    set(decls, "border-radius", r.value(style.radius, "length"));
  }
  const shadows: string[] = [];
  if (style.ring) {
    const width = r.value(style.ring.width ?? 3, "length")!;
    const color = r.value(style.ring.color, "color") ?? "currentColor";
    const offset = r.value(style.ring.offset, "length");
    if (offset && offset !== "0") shadows.push(`0 0 0 ${offset} #fff`, `0 0 0 calc(${width} + ${offset}) ${color}`);
    else shadows.push(`0 0 0 ${width} ${color}`);
  }
  const shadow = shadowValue(style, r);
  if (shadow) shadows.push(shadow);
  if (shadows.length > 0) decls["box-shadow"] = shadows.join(", ");
  set(decls, "font-family", r.value(style.fontFamily, "raw"));
  set(decls, "font-size", r.value(style.fontSize, "length"));
  set(decls, "font-weight", r.value(style.fontWeight, "number"));
  set(decls, "font-style", style.fontStyle);
  set(decls, "line-height", r.value(style.lineHeight, "raw") ?? r.defaultLineHeight(style.fontSize));
  set(decls, "letter-spacing", r.value(style.letterSpacing, "length"));
  set(decls, "text-align", style.textAlign);
  set(decls, "text-transform", style.textTransform);
  set(decls, "text-decoration-line", style.textDecoration);
  set(decls, "overflow", style.overflow);
  set(decls, "cursor", style.cursor);
  set(decls, "mix-blend-mode", style.blendMode);
  set(decls, "background-blend-mode", style.backgroundBlendMode);
  const blur = r.value(style.blur, "length");
  if (blur !== undefined) decls.filter = `blur(${blur})`;
  const backdrop = r.value(style.backdropBlur, "length");
  if (backdrop !== undefined) {
    decls["-webkit-backdrop-filter"] = `blur(${backdrop})`;
    decls["backdrop-filter"] = `blur(${backdrop})`;
  }
  Object.assign(decls, transformDecls(style, r));
  if (typeof style.transition === "string") set(decls, "transition", style.transition);
  else if (style.transition) Object.assign(decls, transitionDecls(style.transition));
  return decls;
}

const COLOR_IN_SHADOW = /(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\([^()]*(\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}\b/g;

/** A token or raw shadow (its colors replaced by `shadowColor`, like `shadow-lg shadow-black/10`), or a list. */
function shadowValue(style: Partial<Style>, r: ValueResolver): string | undefined {
  if (Array.isArray(style.shadow)) return shadowListCss(style.shadow, (v) => r.value(v, "color") ?? "transparent");
  const shadow = r.value(style.shadow as StyleValue | undefined, "raw");
  if (!shadow || !style.shadowColor || shadow === "none") return shadow;
  const color = r.value(style.shadowColor, "color")!;
  return shadow.replace(COLOR_IN_SHADOW, color);
}

/** The transform parts of a style (an override's merged with the element's own, as in the app's CSS variables). */
export function transformParts(style: Partial<Style> | undefined): Pick<Style, "rotate" | "scale" | "translate" | "skew"> {
  const out: Pick<Style, "rotate" | "scale" | "translate" | "skew"> = {};
  if (style?.rotate !== undefined) out.rotate = style.rotate;
  if (style?.scale !== undefined) out.scale = style.scale;
  if (style?.translate) out.translate = style.translate;
  if (style?.skew) out.skew = style.skew;
  return out;
}

/**
 * Rotate, scale, move and skew like Tailwind: v4 sets the `rotate`, `scale` and `translate`
 * properties (skew goes into `transform`); v3 writes one `transform`.
 */
export function transformDecls(style: Partial<Style>, r: ValueResolver): Decls {
  const decls: Decls = {};
  const { rotate, scale, translate, skew } = style;
  if (rotate === undefined && scale === undefined && !translate && !skew) return decls;
  const tx = r.value(translate?.x ?? 0, "length") ?? "0";
  const ty = r.value(translate?.y ?? 0, "length") ?? "0";
  const skews = [skew?.x !== undefined && `skewX(${skew.x}deg)`, skew?.y !== undefined && `skewY(${skew.y}deg)`].filter(Boolean);
  if (r.v4) {
    if (rotate !== undefined) decls.rotate = `${rotate}deg`;
    if (scale !== undefined) decls.scale = `${scale}% ${scale}%`;
    if (translate) decls.translate = `${tx} ${ty}`;
    if (skews.length) decls.transform = skews.join(" ");
    return decls;
  }
  const s = (scale ?? 100) / 100;
  decls.transform = `translate(${tx}, ${ty}) rotate(${rotate ?? 0}deg) skewX(${skew?.x ?? 0}deg) skewY(${skew?.y ?? 0}deg) scaleX(${s}) scaleY(${s})`;
  return decls;
}

/** Tailwind's transition groups (v4's lists; v3's differ only in properties nothing here animates). */
const COLOR_PROPERTIES = "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to";
const TRANSITION_PROPERTY: Record<NonNullable<Transition["property"]>, string> = {
  default: `${COLOR_PROPERTIES}, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events`,
  all: "all",
  colors: COLOR_PROPERTIES,
  opacity: "opacity",
  shadow: "box-shadow",
  transform: "transform, translate, scale, rotate",
};
export const EASING_CURVE: Record<NonNullable<Transition["easing"]>, string> = {
  linear: "linear",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  out: "cubic-bezier(0, 0, 0.2, 1)",
  "in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
};

/** Like Tailwind's `transition-*` (with its default duration and curve), `duration-*`, `ease-*`, `delay-*`. */
export function transitionDecls(t: Transition): Decls {
  const decls: Decls = {};
  if (t.property) {
    decls["transition-property"] = TRANSITION_PROPERTY[t.property];
    decls["transition-timing-function"] = EASING_CURVE["in-out"];
    decls["transition-duration"] = "150ms";
  }
  if (t.duration !== undefined) decls["transition-duration"] = `${t.duration}ms`;
  if (t.easing) decls["transition-timing-function"] = EASING_CURVE[t.easing];
  if (t.delay !== undefined) decls["transition-delay"] = `${t.delay}ms`;
  return decls;
}

export function declsToCss(decls: Decls): string {
  return Object.entries(decls)
    .map(([property, value]) => `${property}: ${value};`)
    .join(" ");
}

/** For inline styles (text spans): kebab-case → camelCase. */
export function declsToReactStyle(decls: Decls): Record<string, string> {
  return Object.fromEntries(Object.entries(decls).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}
