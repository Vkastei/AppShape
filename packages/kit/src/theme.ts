import { defaultStyles, missingStyleOps } from "./styles";
import { applyTokenOps, createId, type TokenGroup, type TokenGroups, type TokenOp, type Tokens } from "@appshape/ir";
import { contrast, type Oklch, parseColor, rgbToOklch, toHex } from "./color";

/**
 * The theme starter: from a few choices (brand color, neutral tint, font pair, shape, density) to a
 * complete design system. Colors come as scales (50–950, built in OKLCH so steps look even) plus
 * semantic colors with a light and a dark value (`background`, `foreground`, `primary`, … as in
 * shadcn/ui), so everything built from them works in both color schemes.
 */

export const SCALE_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
type Step = (typeof SCALE_STEPS)[number];

/** Lightness and relative chroma per step (like Tailwind's own palette). */
const BRAND_L = [0.971, 0.936, 0.885, 0.808, 0.707, 0.623, 0.546, 0.488, 0.424, 0.379, 0.282];
const BRAND_C = [0.06, 0.13, 0.24, 0.43, 0.67, 0.87, 1, 0.99, 0.81, 0.6, 0.37];
const NEUTRAL_L = [0.985, 0.967, 0.92, 0.871, 0.705, 0.552, 0.442, 0.37, 0.274, 0.21, 0.141];
const NEUTRAL_C = [0.002, 0.003, 0.004, 0.006, 0.012, 0.014, 0.014, 0.013, 0.01, 0.008, 0.006];

export type NeutralTint = "none" | "subtle" | "strong";
export type Shape = "sharp" | "soft" | "round";
export type Density = "compact" | "regular" | "airy";

export interface FontPair {
  id: string;
  label: string;
  /** Google Fonts families; absent: the system's own font (nothing to download). */
  heading?: string;
  body?: string;
  /** Google Fonts category of each, for the fallback fonts. */
  headingCategory?: string;
  bodyCategory?: string;
}

/** Curated pairs: a heading font and a body font that work together. */
export const FONT_PAIRS: FontPair[] = [
  { id: "system", label: "System" },
  { id: "clean", label: "Clean", heading: "Inter", body: "Inter" },
  { id: "modern", label: "Modern", heading: "Plus Jakarta Sans", body: "Plus Jakarta Sans" },
  { id: "friendly", label: "Friendly", heading: "Figtree", body: "Figtree" },
  { id: "geometric", label: "Geometric", heading: "Outfit", body: "Outfit" },
  { id: "technical", label: "Technical", heading: "Space Grotesk", body: "Inter" },
  { id: "expressive", label: "Expressive", heading: "Bricolage Grotesque", body: "Inter" },
  { id: "editorial", label: "Editorial", heading: "Fraunces", body: "Inter", headingCategory: "Serif" },
  { id: "classic", label: "Classic", heading: "Playfair Display", body: "Source Sans 3", headingCategory: "Serif" },
  { id: "warm", label: "Warm", heading: "DM Serif Display", body: "DM Sans", headingCategory: "Serif" },
  { id: "literary", label: "Literary", heading: "Lora", body: "Nunito Sans", headingCategory: "Serif" },
];

export const SHAPES: { id: Shape; label: string; radius: Record<string, string> }[] = [
  { id: "sharp", label: "Sharp", radius: { xs: "0.0625rem", sm: "0.125rem", md: "0.1875rem", lg: "0.25rem", xl: "0.375rem", "2xl": "0.5rem", "3xl": "0.75rem", "4xl": "1rem" } },
  { id: "soft", label: "Soft", radius: { xs: "0.125rem", sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", "4xl": "2rem" } },
  { id: "round", label: "Round", radius: { xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "2rem", "4xl": "2.5rem" } },
];

/** Space around sections (`section` on phones, `section-lg` from tablets) and at the page's sides (`gutter`). */
export const DENSITIES: { id: Density; label: string; spacing: Record<string, string> }[] = [
  { id: "compact", label: "Compact", spacing: { section: "3rem", "section-lg": "4rem", gutter: "1rem" } },
  { id: "regular", label: "Regular", spacing: { section: "4rem", "section-lg": "6rem", gutter: "1.5rem" } },
  { id: "airy", label: "Airy", spacing: { section: "5rem", "section-lg": "8rem", gutter: "2rem" } },
];

export const BRAND_PRESETS = ["#4f46e5", "#2563eb", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#e11d48", "#9333ea", "#18181b"];

export interface ThemeOptions {
  /** Any CSS color (hex, rgb(), oklch()). */
  brand: string;
  tint: NeutralTint;
  /** A `FONT_PAIRS` id. */
  fonts: string;
  shape: Shape;
  density: Density;
}

/** What a new project starts with: no font downloads, so it works offline. */
export const DEFAULT_THEME: ThemeOptions = { brand: "#4f46e5", tint: "subtle", fonts: "system", shape: "soft", density: "regular" };

/** Tailwind's default `sans` stack: the system font. */
export const SYSTEM_SANS = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
const FALLBACK: Record<string, string> = { Serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' };

/** A font token value for a Google font (`family` as the page knows it, e.g. "Inter Variable" once installed). */
export function fontStackFor(family: string, category = "Sans Serif"): string {
  return `"${family}", ${FALLBACK[category] ?? "ui-sans-serif, system-ui, sans-serif"}`;
}

export const fontPair = (id: string): FontPair => FONT_PAIRS.find((p) => p.id === id) ?? FONT_PAIRS[0]!;

const hex = (c: Oklch) => toHex(c);

/** A brand scale: the brand color itself sits at the step closest to its lightness. */
export function brandScale(brand: string): Record<Step, string> {
  const rgb = parseColor(brand) ?? parseColor(DEFAULT_THEME.brand)!;
  const base = rgbToOklch(rgb);
  let at = 0;
  BRAND_L.forEach((l, i) => {
    if (Math.abs(l - base.l) < Math.abs(BRAND_L[at]! - base.l)) at = i;
  });
  const peak = base.c / BRAND_C[at]!;
  const scale = {} as Record<Step, string>;
  SCALE_STEPS.forEach((step, i) => {
    scale[step] = i === at ? hex(base) : hex({ l: BRAND_L[i]!, c: peak * BRAND_C[i]!, h: base.h });
  });
  return scale;
}

/** A neutral (gray) scale, tinted toward the brand's hue. */
export function neutralScale(brand: string, tint: NeutralTint): Record<Step, string> {
  const hue = rgbToOklch(parseColor(brand) ?? parseColor(DEFAULT_THEME.brand)!).h;
  const factor = tint === "none" ? 0 : tint === "subtle" ? 1 : 2.5;
  const scale = {} as Record<Step, string>;
  SCALE_STEPS.forEach((step, i) => {
    scale[step] = hex({ l: NEUTRAL_L[i]!, c: NEUTRAL_C[i]! * factor, h: hue });
  });
  return scale;
}

/** The first color that reaches `ratio` against `background`, else the one with the most contrast. */
function firstReaching(candidates: string[], background: string, ratio: number): string {
  const found = candidates.find((c) => (contrast(c, background) ?? 0) >= ratio);
  if (found) return found;
  return candidates.reduce((best, c) => ((contrast(c, background) ?? 0) > (contrast(best, background) ?? 0) ? c : best));
}

const readableOn = (background: string, options: string[]) => options.reduce((best, c) => ((contrast(c, background) ?? 0) > (contrast(best, background) ?? 0) ? c : best));

export interface GeneratedTheme {
  /** Token values (light). */
  groups: TokenGroups;
  /** Dark-mode values of the semantic colors. */
  dark: TokenGroups;
  /** Google fonts the theme uses (to install), with the token they go into. */
  fonts: { token: "heading" | "sans"; family: string; category: string }[];
}

/**
 * The tokens of a theme. `fontStacks` replaces the font tokens' values (e.g. with the installed
 * fonts' names); by default they name the Google fonts as the font picker's previews load them.
 */
export function generateTheme(options: ThemeOptions, fontStacks?: Partial<Record<"heading" | "sans", string>>): GeneratedTheme {
  const brand = brandScale(options.brand);
  const neutral = neutralScale(options.brand, options.tint);
  const brandHex = hex(rgbToOklch(parseColor(options.brand) ?? parseColor(DEFAULT_THEME.brand)!));
  const steps = (scale: Record<Step, string>, from: Step, direction: 1 | -1) => {
    const i = SCALE_STEPS.indexOf(from);
    const list: string[] = [];
    for (let j = i; j >= 0 && j < SCALE_STEPS.length; j += direction) list.push(scale[SCALE_STEPS[j]!]);
    return list;
  };
  const brandStep = SCALE_STEPS.find((s) => brand[s] === brandHex) ?? "600";

  const light = { background: "#ffffff", foreground: neutral["950"] };
  const dark = { background: neutral["950"], foreground: neutral["50"] };
  // the brand color itself for buttons and links, else the nearest step that stands out enough
  const primary = firstReaching([brandHex, ...steps(brand, brandStep, 1).slice(1)], light.background, 3);
  const primaryDark = firstReaching([brandHex, ...steps(brand, brandStep, -1).slice(1)], dark.background, 3);
  const onColor = [light.background, neutral["950"]];

  const lightColors: Record<string, string> = {
    background: light.background,
    foreground: light.foreground,
    card: light.background,
    "card-foreground": light.foreground,
    muted: neutral["50"],
    "muted-foreground": firstReaching([neutral["500"], neutral["600"], neutral["700"]], neutral["50"], 4.5),
    primary,
    "primary-foreground": readableOn(primary, onColor),
    secondary: neutral["100"],
    "secondary-foreground": neutral["900"],
    accent: brand["50"],
    "accent-foreground": firstReaching([brand["700"], brand["800"], brand["900"]], brand["50"], 4.5),
    border: neutral["200"],
    input: neutral["300"],
    ring: primary,
  };
  const darkColors: Record<string, string> = {
    background: dark.background,
    foreground: dark.foreground,
    card: neutral["900"],
    "card-foreground": dark.foreground,
    muted: neutral["900"],
    "muted-foreground": firstReaching([neutral["400"], neutral["300"], neutral["200"]], neutral["900"], 4.5),
    primary: primaryDark,
    "primary-foreground": readableOn(primaryDark, [neutral["950"], "#ffffff"]),
    secondary: neutral["800"],
    "secondary-foreground": neutral["50"],
    accent: brand["950"],
    "accent-foreground": firstReaching([brand["200"], brand["100"], brand["50"]], brand["950"], 4.5),
    border: neutral["800"],
    input: neutral["700"],
    ring: primaryDark,
  };

  // `brand` keeps the color as picked (the theme starter reads it back)
  const color: Record<string, string> = { brand: brandHex, ...lightColors };
  for (const step of SCALE_STEPS) {
    color[`primary-${step}`] = brand[step];
    color[`neutral-${step}`] = neutral[step];
  }

  const pair = fontPair(options.fonts);
  const fonts: GeneratedTheme["fonts"] = [];
  if (pair.heading) fonts.push({ token: "heading", family: pair.heading, category: pair.headingCategory ?? "Sans Serif" });
  if (pair.body) fonts.push({ token: "sans", family: pair.body, category: pair.bodyCategory ?? "Sans Serif" });
  const stack = (token: "heading" | "sans", family: string | undefined, category: string | undefined) => fontStacks?.[token] ?? (family ? fontStackFor(family, category) : SYSTEM_SANS);

  return {
    groups: {
      color,
      fontFamily: { heading: stack("heading", pair.heading, pair.headingCategory), sans: stack("sans", pair.body, pair.bodyCategory) },
      radius: { ...SHAPES.find((s) => s.id === options.shape)!.radius },
      spacing: { ...DENSITIES.find((d) => d.id === options.density)!.spacing },
      size: { content: "72rem" },
    },
    dark: { color: Object.fromEntries(Object.entries(darkColors).filter(([name, value]) => value !== lightColors[name])) },
    fonts,
  };
}

const opId = () => createId("op");

/** Where a theme goes: the project's tokens, or a named theme for screens (`id`, `name`). */
export interface ThemeTarget {
  id: string;
  name: string;
}

/**
 * Ops that give a project a generated theme (one undoable command; other tokens stay), or, with a
 * `target`, that make it a named theme for screens. A named theme keeps all of its values (so the
 * screens keep their look when the project's theme changes); tokens it needs that the project
 * lacks are added to the project first.
 */
export function themeOps(tokens: Tokens, theme: GeneratedTheme, target?: ThemeTarget): TokenOp[] {
  const ops: TokenOp[] = [];
  const entries = Object.entries(theme.groups) as [TokenGroup, Record<string, string | number>][];
  if (!target) {
    for (const [group, values] of entries) {
      for (const [name, value] of Object.entries(values)) {
        if (tokens.groups[group]?.[name] !== value) ops.push({ id: opId(), op: "setToken", group, name, value });
      }
    }
    for (const [group, values] of entries) {
      for (const name of Object.keys(values)) {
        const value = theme.dark[group]?.[name];
        if (tokens.dark?.[group]?.[name] === value) continue;
        ops.push({ id: opId(), op: "setToken", group, name, value: value ?? null, scheme: "dark" });
      }
    }
    // the default text and effect styles, where the project has none of that name yet
    return [...ops, ...missingStyleOps(applyTokenOps(tokens, ops))];
  }
  // the project needs every token the theme sets (the code's classes come from the project)
  for (const [group, values] of entries) {
    for (const [name, value] of Object.entries(values)) {
      if (tokens.groups[group]?.[name] === undefined) ops.push({ id: opId(), op: "setToken", group, name, value });
    }
  }
  const existing = tokens.themes?.[target.id];
  if (existing?.name !== target.name) ops.push({ id: opId(), op: "setTheme", theme: target.id, name: target.name });
  for (const [group, values] of entries) {
    for (const [name, value] of Object.entries(values)) {
      if (existing?.groups[group]?.[name] !== value) ops.push({ id: opId(), op: "setToken", theme: target.id, group, name, value });
    }
  }
  for (const [group, values] of entries) {
    for (const name of Object.keys(values)) {
      const value = theme.dark[group]?.[name];
      if (existing?.dark?.[group]?.[name] === value) continue;
      ops.push({ id: opId(), op: "setToken", theme: target.id, group, name, value: value ?? null, scheme: "dark" });
    }
  }
  return ops;
}

/**
 * Ops that add the theme tokens a project doesn't have yet (from the default theme), so starter
 * components and sections work in any project. Existing tokens, an imported app's included, stay.
 */
export function missingThemeOps(tokens: Tokens): TokenOp[] {
  const theme = generateTheme(DEFAULT_THEME, { heading: String(tokens.groups.fontFamily?.sans ?? SYSTEM_SANS) });
  const ops: TokenOp[] = [];
  for (const [group, values] of Object.entries(theme.groups) as [TokenGroup, Record<string, string | number>][]) {
    // radius steps are Tailwind's own; a project without them keeps its look
    if (group === "radius") continue;
    for (const [name, value] of Object.entries(values)) {
      if (tokens.groups[group]?.[name] !== undefined) continue;
      ops.push({ id: opId(), op: "setToken", group, name, value });
      const dark = theme.dark[group]?.[name];
      if (dark !== undefined) ops.push({ id: opId(), op: "setToken", group, name, value: dark, scheme: "dark" });
    }
  }
  return [...ops, ...missingStyleOps(applyTokenOps(tokens, ops))];
}

/** A project's tokens with a theme applied (for new projects). */
export function withTheme(tokens: Tokens, options: ThemeOptions = DEFAULT_THEME): Tokens {
  const theme = generateTheme(options);
  const groups: TokenGroups = structuredClone(tokens.groups);
  for (const [group, values] of Object.entries(theme.groups) as [TokenGroup, Record<string, string | number>][]) groups[group] = { ...groups[group], ...values };
  const themed: Tokens = { ...tokens, groups, dark: theme.dark };
  const defaults = defaultStyles(themed);
  return { ...themed, textStyles: { ...defaults.textStyles, ...tokens.textStyles }, effectStyles: { ...defaults.effectStyles, ...tokens.effectStyles } };
}

const unquote = (value: string) => value.split(",")[0]!.trim().replace(/^(['"])(.*)\1$/, "$2").replace(/ Variable$/, "");

/** The theme starter's choices that produce (about) these tokens, for opening it on an existing project. */
export function inferThemeOptions(tokens: Tokens): ThemeOptions {
  const color = tokens.groups.color ?? {};
  const brand = [color.brand, color.primary].find((c): c is string => typeof c === "string" && parseColor(c) !== undefined);
  const neutral500 = typeof color["neutral-500"] === "string" ? parseColor(color["neutral-500"]) : undefined;
  const chroma = neutral500 ? rgbToOklch(neutral500).c : 0;
  const families = [tokens.groups.fontFamily?.heading, tokens.groups.fontFamily?.sans].map((v) => (typeof v === "string" ? unquote(v) : undefined));
  const pair = FONT_PAIRS.find((p) => (p.heading ?? unquote(SYSTEM_SANS)) === families[0] && (p.body ?? unquote(SYSTEM_SANS)) === families[1]);
  const shape = SHAPES.find((s) => s.radius.md === tokens.groups.radius?.md)?.id ?? DEFAULT_THEME.shape;
  const density = DENSITIES.find((d) => d.spacing.section === tokens.groups.spacing?.section)?.id ?? DEFAULT_THEME.density;
  return {
    brand: brand ?? DEFAULT_THEME.brand,
    tint: chroma < 0.004 ? "none" : chroma < 0.025 ? "subtle" : "strong",
    fonts: pair?.id ?? DEFAULT_THEME.fonts,
    shape,
    density,
  };
}
