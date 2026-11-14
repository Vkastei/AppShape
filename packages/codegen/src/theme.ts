import { OVERLAYS_END, OVERLAYS_START, overlaysPart } from "./interactions";
import { motionKeyframesCss, parseTokenRef, STAGGER_STEPS, type TokenGroup, type TokenGroups, type Tokens } from "@appshape/ir";

/** Tailwind v4 theme namespaces per token group (`--color-brand` → `bg-brand`). */
const NAMESPACE: Partial<Record<TokenGroup, string>> = {
  color: "--color-",
  size: "--container-",
  radius: "--radius-",
  shadow: "--shadow-",
  blur: "--blur-",
  fontFamily: "--font-",
  fontSize: "--text-",
  fontWeight: "--font-weight-",
  letterSpacing: "--tracking-",
  breakpoint: "--breakpoint-",
  spacing: "--spacing-",
};

/**
 * Base styles of a generated app, the same as the board's frame reset (so both look alike). With a
 * theme, the page takes its font and colors from it (`sans`, `foreground`, `background`).
 */
export function appBaseCss(tokens?: Tokens): string {
  const color = tokens?.groups.color ?? {};
  return `@layer base {
  body {
    font-family: var(--font-sans);
    line-height: 1.5;
    color: ${color.foreground !== undefined ? "var(--color-foreground)" : "#111827"};${color.background !== undefined ? "\n    background-color: var(--color-background);" : ""}
    -webkit-font-smoothing: antialiased;
  }
}`;
}

/** Start/end markers of the theme block AppShape owns in the app's CSS. */
export const THEME_START = "/* appshape:theme (generated from the design system) */";

/** The CSS variable of a token (`$color.primary` → `--color-primary`), if Tailwind has a namespace for it. */
export function tokenVariable(tokens: Tokens, group: TokenGroup, name: string): string | undefined {
  if (group === "lineHeight") return tokens.groups.fontSize?.[name] !== undefined ? `--text-${name}--line-height` : `--leading-${name}`;
  return NAMESPACE[group] ? `${NAMESPACE[group]}${name}` : undefined;
}

const byName = ([a]: [string, unknown], [b]: [string, unknown]) => a.localeCompare(b, "en", { numeric: true });

/**
 * CSS variable declarations for every token that differs from Tailwind's defaults (`defaults`).
 * Line heights pair with font sizes (`--text-lg--line-height`) or stand alone (`--leading-tight`).
 */
export function themeDeclarations(tokens: Tokens, defaults: Tokens): string[] {
  const lines: string[] = [];
  const groups = Object.keys(tokens.groups).sort() as TokenGroup[];
  for (const group of groups) {
    for (const [name, value] of Object.entries(tokens.groups[group] ?? {}).sort(byName)) {
      if (defaults.groups[group]?.[name] === value) continue;
      const variable = tokenVariable(tokens, group, name);
      if (variable) lines.push(`${variable}: ${value};`);
    }
  }
  return lines;
}

/** Tailwind v3's names for the token groups in `theme` of tailwind.config. */
const V3_THEME: Partial<Record<TokenGroup, string>> = {
  color: "colors",
  spacing: "spacing",
  size: "maxWidth",
  radius: "borderRadius",
  shadow: "boxShadow",
  blur: "blur",
  fontFamily: "fontFamily",
  fontSize: "fontSize",
  fontWeight: "fontWeight",
  lineHeight: "lineHeight",
  letterSpacing: "letterSpacing",
  opacity: "opacity",
  breakpoint: "screens",
  zIndex: "zIndex",
};

/**
 * Tailwind v3: the tokens that differ from `defaults` as `theme.extend` of tailwind.config (colors
 * with a shade nest: `brand-600` → `brand: { 600 }`); undefined when nothing differs. Dark values
 * have no place there and are listed in a comment.
 */
export function tailwind3Extend(tokens: Tokens, defaults: Tokens): string | undefined {
  const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const sections: string[] = [];
  for (const group of Object.keys(tokens.groups).sort() as TokenGroup[]) {
    const name = V3_THEME[group];
    if (!name) continue;
    const changed = Object.entries(tokens.groups[group] ?? {})
      .filter(([n, v]) => defaults.groups[group]?.[n] !== v)
      .sort(byName);
    if (!changed.length) continue;
    const entries = new Map<string, string>();
    const nested = new Map<string, string[]>();
    for (const [n, v] of changed) {
      const shade = group === "color" ? /^(.+)-(\d{2,3})$/.exec(n) : null;
      const value = JSON.stringify(v);
      if (shade) nested.set(shade[1]!, [...(nested.get(shade[1]!) ?? []), `${shade[2]}: ${value}`]);
      else entries.set(n, value);
    }
    const lines = [...[...entries].map(([n, v]) => `${key(n)}: ${v}`), ...[...nested].map(([n, shades]) => `${key(n)}: { ${shades.join(", ")} }`)];
    sections.push(`      ${name}: {\n${lines.map((l) => `        ${l},`).join("\n")}\n      },`);
  }
  const dark = darkDeclarations(tokens);
  if (!sections.length && !dark.length) return undefined;
  return [
    "  theme: {",
    "    extend: {",
    ...sections,
    "    },",
    "  },",
    ...(dark.length ? ["  // dark mode (Tailwind v3 has no theme variables for it; use dark: classes or CSS variables):", ...dark.map((d) => `  //   ${d.variable}: ${d.light} → ${d.dark}`)] : []),
  ].join("\n");
}

/** Tokens whose value changes in dark mode: variable, light value, dark value. */
export function darkDeclarations(tokens: Tokens): { variable: string; light: string | number; dark: string | number }[] {
  const out: { variable: string; light: string | number; dark: string | number }[] = [];
  for (const group of Object.keys(tokens.dark ?? {}).sort() as TokenGroup[]) {
    for (const [name, dark] of Object.entries(tokens.dark?.[group] ?? {}).sort(byName)) {
      const light = tokens.groups[group]?.[name];
      const variable = tokenVariable(tokens, group, name);
      if (light !== undefined && variable && light !== dark) out.push({ variable, light, dark });
    }
  }
  return out;
}

/**
 * The dark-mode part of the block: the variables again, with their dark values under Tailwind's
 * `dark` variant (whatever the app made it: the system setting by default, or a class). The light
 * values are repeated so the variables exist even where no utility uses them.
 */
export const DARK_START = "/* appshape:dark (design system values in dark mode) */";
export const DARK_END = "/* appshape:dark end */";

function darkPart(tokens: Tokens): string | undefined {
  const decls = darkDeclarations(tokens);
  if (decls.length === 0) return undefined;
  const light = decls.map((d) => `  ${d.variable}: ${d.light};`).join("\n");
  const dark = decls.map((d) => `    ${d.variable}: ${d.dark};`).join("\n");
  return `${DARK_START}\n:root {\n${light}\n  @variant dark {\n${dark}\n  }\n}\n${DARK_END}`;
}

/** The CSS class of a named theme. */
export const themeClass = (id: string) => `theme-${id}`;

/**
 * The themes part of the block: a class per named theme that redefines the variables it changes
 * (light, and dark under Tailwind's `dark` variant). A screen with a theme has the class on its root.
 */
export const THEMES_START = "/* appshape:themes (screens with their own theme) */";
export const THEMES_END = "/* appshape:themes end */";

function themesPart(tokens: Tokens): string | undefined {
  const rules: string[] = [];
  for (const [id, theme] of Object.entries(tokens.themes ?? {}).sort(byName)) {
    const decls = (groups: TokenGroups | undefined, indent: string) =>
      (Object.keys(groups ?? {}).sort() as TokenGroup[]).flatMap((group) =>
        Object.entries(groups?.[group] ?? {})
          .sort(byName)
          .flatMap(([name, value]) => {
            const variable = tokenVariable(tokens, group, name);
            return variable ? [`${indent}${variable}: ${value};`] : [];
          }),
      );
    const light = decls(theme.groups, "  ");
    const dark = decls(theme.dark, "    ");
    // the page's font and text color follow the theme's (the body has the project's)
    const base = [
      ...(theme.groups.fontFamily?.sans !== undefined ? ["  font-family: var(--font-sans);"] : []),
      ...(tokens.groups.color?.foreground !== undefined && (theme.groups.color?.foreground !== undefined || theme.dark?.color?.foreground !== undefined) ? ["  color: var(--color-foreground);"] : []),
    ];
    const body = [...light, ...base, ...(dark.length ? ["  @variant dark {", ...dark, "  }"] : [])];
    rules.push(`/* ${theme.name.replace(/\*\//g, "")} */\n.${themeClass(id)} {\n${body.join("\n")}\n}`);
  }
  return rules.length ? `${THEMES_START}\n${rules.join("\n")}\n${THEMES_END}` : undefined;
}

/**
 * The styles part of the block: a class per named text style (`type-h2`, its sizes per screen size
 * inside) and effect style (`effect-card`), in the components layer so an element's own utilities win.
 */
export const STYLES_START = "/* appshape:styles (text and effect styles) */";
export const STYLES_END = "/* appshape:styles end */";

const COLOR_IN_SHADOW = /(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\([^()]*(\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}\b/g;

/** A style value as the app's CSS writes it: theme variables for tokens, raw values as they are. */
function cssValue(tokens: Tokens, value: string | number, length = true): string {
  if (typeof value === "number") return length ? (value === 0 ? "0" : `${value}px`) : String(value);
  const ref = parseTokenRef(value);
  if (!ref) return value;
  const variable = tokenVariable(tokens, ref.group, ref.name);
  const css = variable ? `var(${variable})` : String(tokens.groups[ref.group]?.[ref.name] ?? value);
  return ref.alpha !== undefined ? `color-mix(in oklab, ${css} ${ref.alpha}%, transparent)` : css;
}

function stylesPart(tokens: Tokens): string | undefined {
  const rules: string[] = [];
  const breakpoint = (bp: string) => String(tokens.groups.breakpoint?.[bp] ?? DEFAULT_BREAKPOINT_VALUES[bp] ?? bp);
  const order = Object.keys(tokens.groups.breakpoint ?? DEFAULT_BREAKPOINT_VALUES);
  const fontSizeDecls = (size: string | number | undefined, lineHeight: string | number | undefined, styleLineHeight: string | number | undefined, indent: string) => {
    const out: string[] = [];
    if (size !== undefined) out.push(`${indent}font-size: ${cssValue(tokens, size)};`);
    if (lineHeight !== undefined) out.push(`${indent}line-height: ${cssValue(tokens, lineHeight, false)};`);
    else if (styleLineHeight === undefined && typeof size === "string") {
      // like Tailwind's text-* utilities: the size's own line height
      const ref = parseTokenRef(size);
      if (ref?.group === "fontSize" && tokens.groups.lineHeight?.[ref.name] !== undefined) out.push(`${indent}line-height: var(--text-${ref.name}--line-height);`);
    }
    return out;
  };
  for (const [id, s] of Object.entries(tokens.textStyles ?? {}).sort(byName)) {
    const decls = [
      ...(s.fontFamily !== undefined ? [`  font-family: ${cssValue(tokens, s.fontFamily, false)};`] : []),
      ...fontSizeDecls(s.fontSize, s.lineHeight, undefined, "  "),
      ...(s.fontWeight !== undefined ? [`  font-weight: ${cssValue(tokens, s.fontWeight, false)};`] : []),
      ...(s.letterSpacing !== undefined ? [`  letter-spacing: ${cssValue(tokens, s.letterSpacing)};`] : []),
      ...(s.textTransform !== undefined ? [`  text-transform: ${s.textTransform};`] : []),
    ];
    const sizes = Object.entries(s.sizes ?? {}).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
    const media = sizes.flatMap(([bp, part]) => {
      const inner = [
        ...fontSizeDecls(part.fontSize, part.lineHeight, s.lineHeight, "      "),
        ...(part.fontWeight !== undefined ? [`      font-weight: ${cssValue(tokens, part.fontWeight, false)};`] : []),
        ...(part.letterSpacing !== undefined ? [`      letter-spacing: ${cssValue(tokens, part.letterSpacing)};`] : []),
      ];
      return inner.length ? [`  @media (width >= ${breakpoint(bp)}) {`, `    .type-${id} {`, ...inner, "    }", "  }"] : [];
    });
    rules.push(`  /* ${s.name.replace(/\*\//g, "")} */`, `  .type-${id} {`, ...decls.map((d) => `  ${d}`), "  }", ...media);
  }
  for (const [id, e] of Object.entries(tokens.effectStyles ?? {}).sort(byName)) {
    const decls: string[] = [];
    if (e.shadow !== undefined) {
      let shadow = cssValue(tokens, e.shadow, false);
      if (e.shadowColor !== undefined && e.shadow !== "none") {
        const ref = typeof e.shadow === "string" ? parseTokenRef(e.shadow) : undefined;
        const raw = ref ? String(tokens.groups[ref.group]?.[ref.name] ?? "") : String(e.shadow);
        shadow = raw.replace(COLOR_IN_SHADOW, cssValue(tokens, e.shadowColor, false));
      }
      // composed like Tailwind's shadow utilities, so an element's own ring still adds to it
      decls.push(`--tw-shadow: ${shadow};`, "box-shadow: var(--tw-inset-shadow, 0 0 #0000), var(--tw-inset-ring-shadow, 0 0 #0000), var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);");
    }
    if (e.blur !== undefined) decls.push(`filter: blur(${cssValue(tokens, e.blur)});`);
    if (e.backdropBlur !== undefined) decls.push(`-webkit-backdrop-filter: blur(${cssValue(tokens, e.backdropBlur)});`, `backdrop-filter: blur(${cssValue(tokens, e.backdropBlur)});`);
    rules.push(`  /* ${e.name.replace(/\*\//g, "")} */`, `  .effect-${id} {`, ...decls.map((d) => `    ${d}`), "  }");
  }
  return rules.length ? `${STYLES_START}\n@layer components {\n${rules.join("\n")}\n}\n${STYLES_END}` : undefined;
}

const DEFAULT_BREAKPOINT_VALUES: Record<string, string> = { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem", "2xl": "96rem" };

/**
 * The motion part of the block (when the design has entrance animations): the presets' keyframes;
 * elements that play when scrolled into view wait hidden once `ScrollReveal` runs (`data-reveal` on
 * the root) until it marks them (`data-revealed`); a staggered element's children start one step
 * apart. Unlayered, so it wins over the animation utilities; with reduced motion nothing waits.
 */
export const MOTION_START = "/* appshape:motion (entrance animations; off with reduced motion) */";
export const MOTION_END = "/* appshape:motion end */";

function motionPart(): string {
  const steps = Array.from({ length: STAGGER_STEPS - 2 }, (_, i) => `.aps-stagger > :nth-child(${i + 2}) { --aps-step: ${i + 1}; }`);
  return [
    MOTION_START,
    motionKeyframesCss(),
    "@media (prefers-reduced-motion: no-preference) {",
    "  :root[data-reveal] :is(.aps-reveal, .aps-reveal-repeat):not(.aps-stagger, [data-revealed]),",
    "  :root[data-reveal] :is(.aps-reveal, .aps-reveal-repeat).aps-stagger:not([data-revealed]) > * {",
    "    animation: none;",
    "    opacity: 0;",
    "  }",
    "}",
    ".aps-stagger > * { --aps-step: 0; }",
    ".aps-stagger > :nth-child(n) { animation-delay: calc(var(--aps-delay, 0ms) + var(--aps-stagger) * var(--aps-step)); }",
    ...steps,
    `.aps-stagger > :nth-child(n + ${STAGGER_STEPS}) { --aps-step: ${STAGGER_STEPS - 1}; }`,
    MOTION_END,
  ].join("\n");
}

/** The fonts part of the block: `@font-face` rules of the project's own fonts (files in `public/fonts`). */
export const FONTS_START = "/* appshape:fonts (self-hosted, files in public/fonts) */";
export const FONTS_END = "/* appshape:fonts end */";

/** Where AppShape's block (theme, then dark values and fonts if any) is in the app's CSS: [start, end). */
export function themeBlockRange(css: string): [number, number] | undefined {
  const start = css.indexOf(THEME_START);
  if (start < 0) return undefined;
  const open = css.indexOf("{", css.indexOf("@theme", start));
  if (open < 0) return undefined;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      let end = i + 1;
      for (const [partStart, partEnd] of [[DARK_START, DARK_END], [THEMES_START, THEMES_END], [STYLES_START, STYLES_END], [MOTION_START, MOTION_END], [OVERLAYS_START, OVERLAYS_END], [FONTS_START, FONTS_END]] as const) {
        if (!css.slice(end).trimStart().startsWith(partStart)) continue;
        const close = css.indexOf(partEnd, end);
        if (close >= 0) end = close + partEnd.length;
      }
      return [start, end];
    }
  }
  return undefined;
}

/** The app's CSS without AppShape's theme block (to read the app's own theme). */
export function withoutThemeBlock(css: string): string {
  const range = themeBlockRange(css);
  return range ? css.slice(0, range[0]) + css.slice(range[1]) : css;
}

/** A font as the code needs it: its folder name and `font.css` (URLs `./files/…`). */
export interface FontCss {
  slug: string;
  css: string;
}

/**
 * The theme block for the app's CSS entry (empty `@theme {}` when nothing differs), then dark values,
 * themes, named styles, motion (when the design animates), overlays (when it opens any) and fonts.
 */
export function themeBlock(tokens: Tokens, defaults: Tokens, fonts: readonly FontCss[] = [], motion = false, overlays = false): string {
  const lines = themeDeclarations(tokens, defaults);
  const parts = [`${THEME_START}\n@theme {\n${lines.map((l) => `  ${l}`).join("\n")}${lines.length ? "\n" : ""}}`];
  const dark = darkPart(tokens);
  if (dark) parts.push(dark);
  const themes = themesPart(tokens);
  if (themes) parts.push(themes);
  const styles = stylesPart(tokens);
  if (styles) parts.push(styles);
  if (motion) parts.push(motionPart());
  if (overlays) parts.push(overlaysPart());
  if (fonts.length > 0) {
    const rules = fonts.map((f) => f.css.replace(/url\(\.\/files\/([^)]+)\)/g, `url(/fonts/${f.slug}/$1)`).trim()).join("\n");
    parts.push(`${FONTS_START}\n${rules}\n${FONTS_END}`);
  }
  return parts.join("\n\n");
}
