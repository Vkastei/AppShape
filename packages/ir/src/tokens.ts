import { z } from "zod";

export const TOKEN_GROUPS = [
  "color",
  "spacing",
  "size",
  "radius",
  "shadow",
  "blur",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "opacity",
  "breakpoint",
  "zIndex",
] as const;

export const TokenGroupSchema = z.enum(TOKEN_GROUPS);
export type TokenGroup = z.infer<typeof TokenGroupSchema>;

/**
 * A token reference: `$<group>.<name>`, e.g. `$color.primary-600`, `$spacing.4`, `$radius.lg`.
 * Names follow the style dialect's naming (for Tailwind: the class suffix).
 */
export const TOKEN_REF_PATTERN = new RegExp(`^\\$(${TOKEN_GROUPS.join("|")})\\.([A-Za-z0-9_./-]+)$`);

export const TokenRefSchema = z.string().regex(TOKEN_REF_PATTERN, "invalid token reference");

export function isTokenRef(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REF_PATTERN.test(value);
}

export interface TokenRef {
  group: TokenGroup;
  name: string;
  /** Opacity in percent for colors: `$color.white/80` (Tailwind's `bg-white/80`). */
  alpha?: number;
}

export function parseTokenRef(ref: string): TokenRef | undefined {
  const match = TOKEN_REF_PATTERN.exec(ref);
  if (!match) return undefined;
  const group = match[1] as TokenGroup;
  const name = match[2]!;
  if (group === "color") {
    const alpha = /^(.+)\/(\d{1,3}(?:\.\d+)?)$/.exec(name);
    if (alpha && Number(alpha[2]) <= 100) return { group, name: alpha[1]!, alpha: Number(alpha[2]) };
  }
  return { group, name };
}

/** A color with opacity, as Tailwind v4 writes it. */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in oklab, ${color} ${alpha}%, transparent)`;
}

export function tokenRef(group: TokenGroup, name: string): string {
  return `$${group}.${name}`;
}

export const TokenValueSchema = z.union([z.string(), z.number()]);

export const TokenGroupsSchema = z.partialRecord(TokenGroupSchema, z.record(z.string(), TokenValueSchema));
export type TokenGroups = z.infer<typeof TokenGroupsSchema>;

/** A named theme's id: also its CSS class in the code (`theme-<id>`). */
export const ThemeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "theme ids are lowercase letters, digits and dashes");

/** A named theme: values that differ from the project's tokens, for screens that use it. */
export const ThemeSchema = z.strictObject({
  name: z.string().min(1),
  groups: TokenGroupsSchema,
  dark: TokenGroupsSchema.optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

/** A value in a named style: a token reference or a raw value (like style values). */
const NamedStyleValueSchema = z.union([
  z
    .string()
    .min(1)
    .refine((v) => !v.startsWith("$") || TOKEN_REF_PATTERN.test(v), "invalid token reference"),
  z.number(),
]);

/** A named style's id: also its class in the code (`type-<id>`, `effect-<id>`). */
export const StyleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "style ids are lowercase letters, digits and dashes");

/** What a text style changes from a screen size up. */
export const TextStyleSizeSchema = z.strictObject({
  fontSize: NamedStyleValueSchema.optional(),
  lineHeight: NamedStyleValueSchema.optional(),
  letterSpacing: NamedStyleValueSchema.optional(),
  fontWeight: NamedStyleValueSchema.optional(),
});

/** A named text style (Display, H1–H4, Body, Small, Caption …), with its sizes per screen size. */
export const TextStyleSchema = z.strictObject({
  name: z.string().min(1),
  fontFamily: NamedStyleValueSchema.optional(),
  fontSize: NamedStyleValueSchema.optional(),
  fontWeight: NamedStyleValueSchema.optional(),
  lineHeight: NamedStyleValueSchema.optional(),
  letterSpacing: NamedStyleValueSchema.optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  /** Breakpoint name → what changes from there up (mobile-first). */
  sizes: z.record(z.string(), TextStyleSizeSchema).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/** A named effect style: shadows and blurs used together (a card, a raised panel, frosted glass). */
export const EffectStyleSchema = z.strictObject({
  name: z.string().min(1),
  /** A shadow token or raw CSS. */
  shadow: NamedStyleValueSchema.optional(),
  shadowColor: NamedStyleValueSchema.optional(),
  blur: NamedStyleValueSchema.optional(),
  backdropBlur: NamedStyleValueSchema.optional(),
});
export type EffectStyle = z.infer<typeof EffectStyleSchema>;

export const TokensSchema = z.strictObject({
  /** Where the tokens were extracted from. */
  source: z.enum(["tailwind-v3", "tailwind-v4", "nativewind", "manual"]),
  groups: TokenGroupsSchema,
  /**
   * Values in dark mode, for tokens whose value changes with the color scheme (`$color.background`).
   * Only names that exist in `groups`; elements using them follow the scheme without `dark:` styles.
   */
  dark: TokenGroupsSchema.optional(),
  /**
   * Named themes, by id: screens with `theme` use the project's tokens with these values on top.
   * Themes only change tokens the project has (so the code's classes exist everywhere).
   */
  themes: z.record(z.string(), ThemeSchema).optional(),
  /** Named text styles, by id: elements use one with `style.textStyle`. */
  textStyles: z.record(z.string(), TextStyleSchema).optional(),
  /** Named effect styles, by id: elements use one with `style.effectStyle`. */
  effectStyles: z.record(z.string(), EffectStyleSchema).optional(),
});
export type Tokens = z.infer<typeof TokensSchema>;

/**
 * The tokens a screen with a named theme sees: the theme's values on top of the project's. A value
 * the theme sets without a dark one applies in dark mode too (as the code's theme class does).
 */
export function themedTokens(tokens: Tokens, themeId: string | undefined): Tokens {
  const theme = themeId ? tokens.themes?.[themeId] : undefined;
  if (!theme) return tokens;
  const groups: TokenGroups = { ...tokens.groups };
  const dark: TokenGroups = { ...tokens.dark };
  for (const [group, values] of Object.entries(theme.groups) as [TokenGroup, Record<string, string | number>][]) {
    groups[group] = { ...groups[group], ...values };
    const own = { ...dark[group] };
    for (const name of Object.keys(values)) delete own[name];
    dark[group] = own;
  }
  for (const [group, values] of Object.entries(theme.dark ?? {}) as [TokenGroup, Record<string, string | number>][]) dark[group] = { ...dark[group], ...values };
  for (const group of Object.keys(dark) as TokenGroup[]) if (Object.keys(dark[group] ?? {}).length === 0) delete dark[group];
  const { dark: _dark, ...rest } = tokens;
  return { ...rest, groups, ...(Object.keys(dark).length > 0 && { dark }) };
}

export type Scheme = "light" | "dark";

/** A token's value in a color scheme (dark falls back to the light value). */
export function tokenValue(tokens: Tokens, group: TokenGroup, name: string, scheme: Scheme = "light"): string | number | undefined {
  return (scheme === "dark" ? tokens.dark?.[group]?.[name] : undefined) ?? tokens.groups[group]?.[name];
}

export function resolveToken(tokens: Tokens, ref: string, scheme: Scheme = "light"): string | number | undefined {
  const parsed = parseTokenRef(ref);
  if (!parsed) return undefined;
  const value = tokenValue(tokens, parsed.group, parsed.name, scheme);
  return parsed.alpha !== undefined && value !== undefined ? withAlpha(String(value), parsed.alpha) : value;
}
