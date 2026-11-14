import { describe, expect, it } from "vitest";
import { defaultTokens, themeVariables, tokensFromThemeVariables } from "../src";

describe("Tailwind v4 tokens", () => {
  it("maps theme variables to token groups", () => {
    const vars = themeVariables(`
      @import "tailwindcss";
      @theme default { --color-red-500: oklch(0.6 0.2 25); --spacing: 0.25rem; --text-sm: 0.875rem;
        --text-sm--line-height: calc(1.25 / 0.875); --font-weight-bold: 700; --radius-lg: 0.5rem;
        --container-6xl: 72rem; --breakpoint-md: 48rem; --font-sans: ui-sans-serif; }
      @theme { --color-primary-600: oklch(0.51 0.21 275); --color-red-500: initial; }
    `);
    const tokens = tokensFromThemeVariables(vars);
    expect(tokens.groups.color).toEqual({ "primary-600": "oklch(0.51 0.21 275)" });
    expect(tokens.groups.fontSize).toEqual({ sm: "0.875rem" });
    expect(tokens.groups.lineHeight).toEqual({ sm: "calc(1.25 / 0.875)" });
    expect(tokens.groups.fontWeight).toEqual({ bold: 700 });
    expect(tokens.groups.size).toEqual({ "6xl": "72rem" });
    expect(tokens.groups.breakpoint).toEqual({ md: "48rem" });
    expect(tokens.groups.fontFamily).toEqual({ sans: "ui-sans-serif" });
    expect(tokens.groups.spacing?.["4"]).toBe("1rem");
    expect(tokens.groups.spacing?.["0.5"]).toBe("0.125rem");
    expect(tokens.groups.radius).toMatchObject({ lg: "0.5rem", full: "9999px" });
  });

  it("provides Tailwind's full default system", async () => {
    const tokens = await defaultTokens();
    expect(tokens.groups.color?.["indigo-600"]).toMatch(/^oklch/);
    expect(Object.keys(tokens.groups.color ?? {}).length).toBeGreaterThan(200);
    expect(tokens.groups.shadow?.md).toContain("rgb(0 0 0");
    expect(tokens.groups.breakpoint).toMatchObject({ sm: "40rem", lg: "64rem" });
  });
});
