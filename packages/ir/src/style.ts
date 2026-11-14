import { z } from "zod";
import { TOKEN_REF_PATTERN } from "./tokens";

/**
 * A style value is a token reference (`$spacing.4`), a raw CSS-like string (`13px`, `#fff`, `50%`)
 * or a number (px on web, dp on mobile). Strings starting with `$` must be valid token refs.
 */
export const StyleValueSchema = z.union([
  z
    .string()
    .min(1)
    .refine((v) => !v.startsWith("$") || TOKEN_REF_PATTERN.test(v), "invalid token reference"),
  z.number(),
]);
export type StyleValue = z.infer<typeof StyleValueSchema>;

export const EdgesSchema = z.strictObject({
  top: StyleValueSchema.optional(),
  right: StyleValueSchema.optional(),
  bottom: StyleValueSchema.optional(),
  left: StyleValueSchema.optional(),
});
export type Edges = z.infer<typeof EdgesSchema>;

export const CornersSchema = z.strictObject({
  topLeft: StyleValueSchema.optional(),
  topRight: StyleValueSchema.optional(),
  bottomRight: StyleValueSchema.optional(),
  bottomLeft: StyleValueSchema.optional(),
});
export type Corners = z.infer<typeof CornersSchema>;

/** fixed = explicit size, hug = fit content, fill = take the available space. */
export const SizingSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("fixed"), value: StyleValueSchema }),
  z.strictObject({ mode: z.literal("hug") }),
  z.strictObject({ mode: z.literal("fill") }),
]);
export type Sizing = z.infer<typeof SizingSchema>;

const AlignSchema = z.enum(["start", "center", "end", "stretch", "baseline"]);

/** How a node arranges its children. Flexbox is the shared model across web, RN, Flutter, SwiftUI. */
export const LayoutSchema = z.strictObject({
  /**
   * Absent = natural flow (the element's own display). `absolute` = children placed by `box.x/y`
   * (sketch frames only).
   */
  mode: z.enum(["flex", "grid", "block", "absolute"]).optional(),
  /** inline-flex / inline-grid / inline-block. */
  inline: z.boolean().optional(),
  direction: z.enum(["row", "column"]).optional(),
  wrap: z.boolean().optional(),
  gap: StyleValueSchema.optional(),
  rowGap: StyleValueSchema.optional(),
  columnGap: StyleValueSchema.optional(),
  align: AlignSchema.optional(),
  justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional(),
  /** Grid: number of equal columns, or a raw template. */
  columns: z.union([z.int().positive(), z.string()]).optional(),
  rows: z.union([z.int().positive(), z.string()]).optional(),
  padding: EdgesSchema.optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

/** How a node sits inside its parent. */
export const BoxSchema = z.strictObject({
  width: SizingSchema.optional(),
  height: SizingSchema.optional(),
  minWidth: StyleValueSchema.optional(),
  maxWidth: StyleValueSchema.optional(),
  minHeight: StyleValueSchema.optional(),
  maxHeight: StyleValueSchema.optional(),
  margin: EdgesSchema.optional(),
  alignSelf: AlignSchema.optional(),
  grow: z.number().min(0).optional(),
  /** flex-basis, e.g. `0%` for `flex-1`. */
  basis: StyleValueSchema.optional(),
  shrink: z.number().min(0).optional(),
  colSpan: z.union([z.int().positive(), z.literal("full")]).optional(),
  rowSpan: z.int().positive().optional(),
  position: z.enum(["static", "relative", "absolute", "fixed", "sticky"]).optional(),
  inset: EdgesSchema.optional(),
  zIndex: StyleValueSchema.optional(),
  aspectRatio: z.string().optional(),
  /** Order among the siblings of a flex or grid container (`order-first` = -9999, `order-last` = 9999). */
  order: z.int().optional(),
  /** Absolute coordinates inside a parent with `layout.mode = "absolute"` (sketch frames). */
  x: z.number().optional(),
  y: z.number().optional(),
});
export type Box = z.infer<typeof BoxSchema>;

/** Visual styling. Nested values (radius corners, ring) are replaced as a whole by patches. */
export const BACKGROUND_POSITIONS = ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** A picture behind the element's content (`asset:` path, app URL or https URL). */
export const BackgroundImageSchema = z.strictObject({
  src: z.string().min(1),
  /** cover: fills, may crop; contain: shows it all; auto: natural size. */
  size: z.enum(["cover", "contain", "auto"]).optional(),
  position: z.enum(BACKGROUND_POSITIONS).optional(),
  /** Unset: the browser default (repeats). */
  repeat: z.boolean().optional(),
});
export type BackgroundImage = z.infer<typeof BackgroundImageSchema>;

/** Tailwind's transition groups: which properties animate. */
export const TRANSITION_PROPERTIES = ["default", "all", "colors", "opacity", "shadow", "transform"] as const;
export const EASINGS = ["linear", "in", "out", "in-out"] as const;

/** How changes (hover, focus, …) animate. Unset parts use the defaults (150 ms, ease-in-out curve). */
export const TransitionSchema = z.strictObject({
  property: z.enum(TRANSITION_PROPERTIES).optional(),
  /** Milliseconds. */
  duration: z.int().min(0).optional(),
  easing: z.enum(EASINGS).optional(),
  /** Milliseconds. */
  delay: z.int().min(0).optional(),
});
export type Transition = z.infer<typeof TransitionSchema>;

/** How an element appears: fades in, slides into place (moving up, down, left, right), grows or sharpens. */
export const MOTION_PRESETS = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "scale", "blur"] as const;
/** When it plays: when the page opens, when it scrolls into view (once), or every time it does. */
export const MOTION_TRIGGERS = ["load", "scroll", "scroll-repeat"] as const;

/**
 * An entrance animation: from the preset's start (e.g. transparent and 24 px lower) to the element's
 * own style. With `stagger`, the element's children play it one after another instead.
 */
export const MotionSchema = z.strictObject({
  preset: z.enum(MOTION_PRESETS),
  trigger: z.enum(MOTION_TRIGGERS),
  /** Milliseconds (default 600). */
  duration: z.int().min(0).max(10_000).optional(),
  /** Milliseconds before it starts. */
  delay: z.int().min(0).max(10_000).optional(),
  /** Default: out (fast start, gentle end). */
  easing: z.enum(EASINGS).optional(),
  /** Milliseconds between the children (set: the children play it, not the element itself). */
  stagger: z.int().min(1).max(2_000).optional(),
});
export type Motion = z.infer<typeof MotionSchema>;

/** A color stop of a gradient: a color (token or raw) and, optionally, where it sits (0–100 %). */
export const GradientStopSchema = z.strictObject({
  color: StyleValueSchema,
  at: z.number().min(0).max(100).optional(),
});
export type GradientStop = z.infer<typeof GradientStopSchema>;

/** Gradient corner directions (`to top right` depends on the box's proportions, unlike 45deg). */
export const GRADIENT_CORNERS = ["to-tr", "to-br", "to-bl", "to-tl"] as const;

/** A background gradient: drawn over the fill color and over a background image (an overlay). */
export const GradientSchema = z.strictObject({
  type: z.enum(["linear", "radial"]),
  /** Linear: degrees (0 = up, 90 = right, 180 = down) or a corner. Default: down. */
  angle: z.union([z.number(), z.enum(GRADIENT_CORNERS)]).optional(),
  stops: z.array(GradientStopSchema).min(2).max(3),
});
export type Gradient = z.infer<typeof GradientSchema>;

/** One shadow of a custom list (px). */
export const ShadowSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().optional(),
  color: StyleValueSchema,
  inset: z.boolean().optional(),
});
export type Shadow = z.infer<typeof ShadowSchema>;

/** CSS blend modes (Tailwind's `mix-blend-*` and `bg-blend-*`). */
export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-darker", "plus-lighter"] as const;

export const StyleSchema = z.strictObject({
  background: StyleValueSchema.optional(),
  backgroundImage: BackgroundImageSchema.optional(),
  gradient: GradientSchema.optional(),
  /** `text`: the background (a gradient) shows through the text (with a transparent text color). */
  backgroundClip: z.enum(["text"]).optional(),
  color: StyleValueSchema.optional(),
  opacity: StyleValueSchema.optional(),
  borderWidth: z.union([StyleValueSchema, EdgesSchema]).optional(),
  borderColor: StyleValueSchema.optional(),
  borderStyle: z.enum(["solid", "dashed", "dotted", "none"]).optional(),
  radius: z.union([StyleValueSchema, CornersSchema]).optional(),
  /** A shadow token (`$shadow.lg`), raw CSS, or a list of custom shadows. */
  shadow: z.union([StyleValueSchema, z.array(ShadowSchema).min(1)]).optional(),
  /** A named text style of the design system (`tokens.textStyles`); the element's own values win. */
  textStyle: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  /** A named effect style (`tokens.effectStyles`); the element's own values win. */
  effectStyle: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  /** Its children can change while it is hovered (their `group-hover` state); Tailwind's `group`. */
  hoverGroup: z.boolean().optional(),
  /** Color of a token shadow (`shadow-indigo-500/30`). */
  shadowColor: StyleValueSchema.optional(),
  /** How the element blends with what is behind it. */
  blendMode: z.enum(BLEND_MODES).optional(),
  /** How the background image blends with the fill color and gradient. */
  backgroundBlendMode: z.enum(BLEND_MODES).optional(),
  /** Blur of the element itself (`$blur.md` or px). */
  blur: StyleValueSchema.optional(),
  /** Blur of what is behind the element (frosted glass). */
  backdropBlur: StyleValueSchema.optional(),
  /** Degrees. */
  rotate: z.number().optional(),
  /** Percent (100 = unchanged). */
  scale: z.number().min(0).optional(),
  translate: z.strictObject({ x: StyleValueSchema.optional(), y: StyleValueSchema.optional() }).optional(),
  /** Degrees. */
  skew: z.strictObject({ x: z.number().optional(), y: z.number().optional() }).optional(),
  ring: z
    .strictObject({
      width: StyleValueSchema.optional(),
      color: StyleValueSchema.optional(),
      offset: StyleValueSchema.optional(),
    })
    .optional(),
  fontFamily: StyleValueSchema.optional(),
  fontSize: StyleValueSchema.optional(),
  fontWeight: StyleValueSchema.optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  lineHeight: StyleValueSchema.optional(),
  letterSpacing: StyleValueSchema.optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
  overflow: z.enum(["visible", "hidden", "scroll", "auto"]).optional(),
  /** A scrolling row or column whose children snap into place (a carousel): where they line up. */
  snap: z.enum(["start", "center"]).optional(),
  cursor: z.string().optional(),
  /** Structured, or raw CSS (`transition` shorthand) from older projects. */
  transition: z.union([TransitionSchema, z.string()]).optional(),
  /** How the element appears (an entrance animation). The board shows the end; Play and the prototype run it. */
  motion: MotionSchema.optional(),
});
export type Style = z.infer<typeof StyleSchema>;

/** A condition under which an override applies. Maps to dialect variants (`md:`, `hover:`, `dark:`). */
export const ConditionSchema = z
  .strictObject({
    /** Breakpoint name (min-width, mobile-first), e.g. `md`. */
    viewport: z.string().min(1).optional(),
    /** `group-hover`: an ancestor with `style.hoverGroup` is hovered. */
    state: z.enum(["hover", "focus", "focus-visible", "active", "disabled", "pressed", "group-hover"]).optional(),
    scheme: z.enum(["light", "dark"]).optional(),
    /** Component property value (variants), e.g. `variant = secondary`. Booleans as "true"/"false". */
    prop: z.strictObject({ name: z.string().min(1), value: z.string() }).optional(),
  })
  .refine((c) => c.viewport !== undefined || c.state !== undefined || c.scheme !== undefined || c.prop !== undefined, {
    message: "a condition needs at least one of viewport, state, scheme or prop",
  });
export type Condition = z.infer<typeof ConditionSchema>;

export function conditionKey(condition: Condition): string {
  const parts: string[] = [];
  if (condition.prop) parts.push(`prop=${condition.prop.name}:${condition.prop.value}`);
  if (condition.scheme) parts.push(`scheme=${condition.scheme}`);
  if (condition.viewport) parts.push(`viewport=${condition.viewport}`);
  if (condition.state) parts.push(`state=${condition.state}`);
  return parts.join("&");
}

export const OverrideSchema = z.strictObject({
  when: ConditionSchema,
  layout: LayoutSchema.partial().optional(),
  box: BoxSchema.partial().optional(),
  style: StyleSchema.partial().optional(),
  hidden: z.boolean().optional(),
});
export type Override = z.infer<typeof OverrideSchema>;

/** A shallow patch: a key set to `null` removes it, a missing key leaves it untouched. */
export type Patch<T> = { [K in keyof T]?: Exclude<T[K], undefined> | null };

function patchSchema<T>(schema: z.ZodObject): z.ZodType<Patch<T>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const inner = value instanceof z.ZodOptional ? (value.unwrap() as z.ZodType) : (value as z.ZodType);
    shape[key] = inner.nullable().optional();
  }
  return z.strictObject(shape) as unknown as z.ZodType<Patch<T>>;
}

export const StylePatchSchema = patchSchema<Style>(StyleSchema);
export const LayoutPatchSchema = patchSchema<Layout>(LayoutSchema);
export const BoxPatchSchema = patchSchema<Box>(BoxSchema);
export type StylePatch = Patch<Style>;
export type LayoutPatch = Patch<Layout>;
export type BoxPatch = Patch<Box>;
