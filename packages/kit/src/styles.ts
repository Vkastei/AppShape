import { createId, type EffectStyle, parseTokenRef, type Style, type TextStyle, type TokenOp, type Tokens } from "@appshape/ir";

/**
 * The default named styles every theme brings: text styles (Display, H1–H4, Body, Small, Caption)
 * with larger sizes from tablets up, and effect styles (Card, Raised, Overlay, Glass). Sections use
 * them for their headings, so changing H2 changes every H2 on every screen.
 */

export const DEFAULT_TEXT_STYLES: Record<string, TextStyle> = {
  display: { name: "Display", fontFamily: "$fontFamily.heading", fontSize: "$fontSize.5xl", fontWeight: "$fontWeight.bold", lineHeight: "$lineHeight.tight", letterSpacing: "$letterSpacing.tight", sizes: { md: { fontSize: "$fontSize.7xl" } } },
  h1: { name: "H1", fontFamily: "$fontFamily.heading", fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", lineHeight: "$lineHeight.tight", letterSpacing: "$letterSpacing.tight", sizes: { md: { fontSize: "$fontSize.6xl" } } },
  h2: { name: "H2", fontFamily: "$fontFamily.heading", fontSize: "$fontSize.3xl", fontWeight: "$fontWeight.bold", lineHeight: "$lineHeight.tight", letterSpacing: "$letterSpacing.tight", sizes: { md: { fontSize: "$fontSize.4xl" } } },
  h3: { name: "H3", fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" },
  h4: { name: "H4", fontFamily: "$fontFamily.heading", fontSize: "$fontSize.base", fontWeight: "$fontWeight.semibold" },
  body: { name: "Body", fontSize: "$fontSize.base" },
  small: { name: "Small", fontSize: "$fontSize.sm" },
  caption: { name: "Caption", fontSize: "$fontSize.xs", fontWeight: "$fontWeight.medium" },
};

export const DEFAULT_EFFECT_STYLES: Record<string, EffectStyle> = {
  card: { name: "Card", shadow: "$shadow.sm" },
  raised: { name: "Raised", shadow: "$shadow.lg" },
  overlay: { name: "Overlay", shadow: "$shadow.2xl", shadowColor: "$color.black/25" },
  glass: { name: "Glass", shadow: "$shadow.xl", shadowColor: "$color.black/10", backdropBlur: "$blur.md" },
};

/** A style without the values whose tokens the project doesn't have (so nothing renders as unknown). */
function usable<T extends object>(tokens: Tokens, style: T): T {
  const ok = (v: unknown) => {
    if (typeof v !== "string") return true;
    const ref = parseTokenRef(v);
    return !ref || tokens.groups[ref.group]?.[ref.name] !== undefined;
  };
  const out = Object.fromEntries(Object.entries(style).filter(([k, v]) => k === "name" || k === "sizes" || ok(v))) as Record<string, unknown>;
  if ("sizes" in out && out.sizes) {
    const sizes = Object.fromEntries(
      Object.entries(out.sizes as Record<string, Record<string, unknown>>)
        .map(([bp, part]) => [bp, Object.fromEntries(Object.entries(part).filter(([, v]) => ok(v)))])
        .filter(([, part]) => Object.keys(part as object).length > 0),
    );
    if (Object.keys(sizes).length) out.sizes = sizes;
    else delete out.sizes;
  }
  return out as T;
}

/** The default styles with the project's tokens. */
export function defaultStyles(tokens: Tokens): Pick<Tokens, "textStyles" | "effectStyles"> {
  return {
    textStyles: Object.fromEntries(Object.entries(DEFAULT_TEXT_STYLES).map(([id, s]) => [id, usable(tokens, s)])),
    effectStyles: Object.fromEntries(Object.entries(DEFAULT_EFFECT_STYLES).map(([id, s]) => [id, usable(tokens, s)])),
  };
}

/** Ops that add the default styles a project doesn't have yet (its own styles stay). */
export function missingStyleOps(tokens: Tokens): TokenOp[] {
  const defaults = defaultStyles(tokens);
  const ops: TokenOp[] = [];
  for (const [id, value] of Object.entries(defaults.textStyles!)) if (!tokens.textStyles?.[id]) ops.push({ id: createId("op"), op: "setTextStyle", style: id, value });
  for (const [id, value] of Object.entries(defaults.effectStyles!)) if (!tokens.effectStyles?.[id]) ops.push({ id: createId("op"), op: "setEffectStyle", style: id, value });
  return ops;
}

/**
 * An element's text values with its text style underneath (the style's sizes per screen size are
 * not included): what design checks measure.
 */
export function withTextStyle(tokens: Tokens, style: Partial<Style> | undefined): Partial<Style> {
  const named = style?.textStyle ? tokens.textStyles?.[style.textStyle] : undefined;
  if (!named) return style ?? {};
  const { name: _name, sizes: _sizes, ...base } = named;
  return { ...(base as Partial<Style>), ...style };
}
