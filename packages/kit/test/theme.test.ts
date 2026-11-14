import { applyTokenOps, themedTokens, type Tokens } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import {
  BRAND_PRESETS,
  brandScale,
  contrast,
  DEFAULT_THEME,
  DENSITIES,
  FONT_PAIRS,
  generateTheme,
  inferThemeOptions,
  missingThemeOps,
  parseColor,
  rgbToOklch,
  SCALE_STEPS,
  SHAPES,
  type ThemeOptions,
  themeOps,
  toHex,
  withTheme,
  missingStyleOps,
} from "../src";

const empty: Tokens = { source: "tailwind-v4", groups: { color: { white: "#fff" }, radius: { md: "0.375rem" } } };

describe("color math", () => {
  it("converts between hex and OKLCH and measures contrast like WCAG", () => {
    expect(toHex(rgbToOklch(parseColor("#4f46e5")!))).toBe("#4f46e5");
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    // Tailwind's own oklch values parse too
    expect(toHex(rgbToOklch(parseColor("oklch(62.3% 0.214 259.815)")!))).toBe("#2b7fff");
    // translucent text is put over its background first
    expect(contrast("rgb(0 0 0 / 0.5)", "#ffffff")).toBeLessThan(contrast("#000", "#fff")!);
    expect(parseColor("var(--x)")).toBeUndefined();
  });

  it("builds a scale around the brand color, light to dark", () => {
    const scale = brandScale("#4f46e5");
    expect(Object.values(scale)).toContain("#4f46e5");
    const lightness = SCALE_STEPS.map((s) => rgbToOklch(parseColor(scale[s])!).l);
    for (let i = 1; i < lightness.length; i++) expect(lightness[i]).toBeLessThan(lightness[i - 1]!);
  });
});

describe("generateTheme", () => {
  const variants: ThemeOptions[] = BRAND_PRESETS.flatMap((brand) => (["none", "strong"] as const).map((tint) => ({ ...DEFAULT_THEME, brand, tint })));
  variants.push({ ...DEFAULT_THEME, brand: "#facc15" }, { ...DEFAULT_THEME, brand: "#a3e635" }, { ...DEFAULT_THEME, brand: "#1e1b4b" }, { ...DEFAULT_THEME, brand: "#ffffff" });

  it.each(variants)("has readable colors in both schemes for $brand ($tint)", (options) => {
    const theme = generateTheme(options);
    for (const scheme of ["light", "dark"] as const) {
      const c = (name: string) => String((scheme === "dark" ? theme.dark.color?.[name] : undefined) ?? theme.groups.color![name]);
      const check = (fg: string, bg: string, ratio: number) => expect(contrast(c(fg), c(bg)), `${scheme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(ratio);
      check("foreground", "background", 7);
      check("card-foreground", "card", 7);
      check("muted-foreground", "background", 4.5);
      check("muted-foreground", "muted", 4.5);
      check("primary-foreground", "primary", 4.5);
      check("secondary-foreground", "secondary", 4.5);
      check("accent-foreground", "accent", 4.5);
      check("primary", "background", 3);
    }
  });

  it("writes shape, density, fonts and a dark value for every semantic color that changes", () => {
    const theme = generateTheme({ brand: "#0d9488", tint: "subtle", fonts: "editorial", shape: "round", density: "airy" });
    expect(theme.groups.radius).toEqual(SHAPES.find((s) => s.id === "round")!.radius);
    expect(theme.groups.spacing).toEqual(DENSITIES.find((d) => d.id === "airy")!.spacing);
    expect(theme.groups.fontFamily).toEqual({ heading: '"Fraunces", ui-serif, Georgia, Cambria, "Times New Roman", serif', sans: '"Inter", ui-sans-serif, system-ui, sans-serif' });
    expect(theme.fonts).toEqual([
      { token: "heading", family: "Fraunces", category: "Serif" },
      { token: "sans", family: "Inter", category: "Sans Serif" },
    ]);
    expect(Object.keys(theme.dark.color!)).toEqual(expect.arrayContaining(["background", "foreground", "card", "muted", "border"]));
    for (const name of Object.keys(theme.dark.color!)) expect(theme.groups.color![name]).toBeDefined();
  });
});

describe("applying a theme", () => {
  it("writes it as one set of token ops, and reads the choices back", () => {
    for (const fonts of FONT_PAIRS.map((p) => p.id)) {
      const options: ThemeOptions = { brand: "#e11d48", tint: "strong", fonts, shape: "sharp", density: "compact" };
      const tokens = applyTokenOps(empty, themeOps(empty, generateTheme(options)));
      expect(tokens.dark?.color?.background).toBeDefined();
      expect(inferThemeOptions(tokens)).toEqual(options);
      // applying it again changes nothing
      expect(themeOps(tokens, generateTheme(options))).toEqual([]);
    }
  });

  it("makes a named theme for screens that keeps the project's own theme as it is", () => {
    const project = withTheme(empty);
    const options: ThemeOptions = { brand: "#e11d48", tint: "none", fonts: "classic", shape: "round", density: "airy" };
    const tokens = applyTokenOps(project, themeOps(project, generateTheme(options), { id: "landing", name: "Landing" }));
    expect(tokens.groups).toEqual(project.groups);
    expect(tokens.dark).toEqual(project.dark);
    expect(tokens.themes?.landing?.name).toBe("Landing");
    const screen = themedTokens(tokens, "landing");
    expect(inferThemeOptions(screen)).toEqual(options);
    expect(screen.dark?.color?.background).toBe(generateTheme(options).dark.color?.background);
    expect(themeOps(tokens, generateTheme(options), { id: "landing", name: "Landing" })).toEqual([]);
    // on a project without a theme, the tokens the screen theme needs are added to the project too
    const bare = applyTokenOps(empty, themeOps(empty, generateTheme(options), { id: "landing", name: "Landing" }));
    expect(bare.groups.color?.primary).toBeDefined();
    expect(inferThemeOptions(themedTokens(bare, "landing"))).toEqual(options);
  });

  it("only adds what is missing, so an existing design system stays", () => {
    const own: Tokens = { source: "tailwind-v4", groups: { color: { primary: "var(--primary)", background: "var(--background)" }, fontFamily: { sans: '"Geist", sans-serif' } } };
    const tokens = applyTokenOps(own, missingThemeOps(own));
    expect(tokens.groups.color?.primary).toBe("var(--primary)");
    expect(tokens.dark?.color?.background).toBeUndefined();
    expect(tokens.groups.color?.foreground).toBeDefined();
    expect(tokens.dark?.color?.foreground).toBeDefined();
    expect(tokens.groups.fontFamily?.heading).toBe('"Geist", sans-serif');
    expect(tokens.groups.radius).toBeUndefined();
    expect(missingThemeOps(tokens)).toEqual([]);
  });

  it("gives new projects the default theme", () => {
    const tokens = withTheme(empty);
    expect(inferThemeOptions(tokens)).toEqual(DEFAULT_THEME);
    expect(tokens.groups.color?.white).toBe("#fff");
  });
});

describe("named styles", () => {
  it("a theme brings the default text and effect styles, built from the project's tokens", () => {
    const tokens = withTheme(empty);
    expect(Object.keys(tokens.textStyles ?? {})).toEqual(["display", "h1", "h2", "h3", "h4", "body", "small", "caption"]);
    expect(tokens.effectStyles?.glass?.name).toBe("Glass");
    // tokens the project doesn't have are left out (nothing renders as unknown)
    expect(tokens.textStyles?.h2?.fontSize).toBeUndefined();
    expect(tokens.textStyles?.h2?.fontFamily).toBe("$fontFamily.heading");
    // a project's own styles stay
    const own = applyTokenOps(tokens, [{ id: "o", op: "setTextStyle", style: "h2", value: { name: "My H2", fontSize: 30 } }]);
    expect(missingStyleOps(own)).toEqual([]);
    expect(withTheme(own).textStyles?.h2?.name).toBe("My H2");
  });
});

