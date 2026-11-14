/** Tailwind v3 apps: the design system as theme.extend of tailwind.config (v4's @theme does nothing there). */
import { defaultTokens } from "@appshape/dialect-tailwind";
import type { Tokens } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import { tailwind3Extend } from "../src";

describe("Tailwind v3 theme", () => {
  it("lists what differs from the app's theme, colors with shades nested", async () => {
    const base = await defaultTokens();
    const app: Tokens = { ...base, groups: { ...base.groups, color: { ...base.groups.color, "brand-50": "#eef2ff", "brand-600": "#4f46e5" } } };
    const design: Tokens = {
      ...app,
      groups: { ...app.groups, color: { ...app.groups.color, "brand-600": "#0d9488", "primary-foreground": "#ffffff" }, radius: { ...app.groups.radius, md: "0.75rem" } },
      dark: { color: { "primary-foreground": "#111111" } },
    };
    const extend = tailwind3Extend(design, app)!;
    expect(extend).toContain(`      colors: {\n        "primary-foreground": "#ffffff",\n        brand: { 600: "#0d9488" },\n      },`);
    expect(extend).toContain(`      borderRadius: {\n        md: "0.75rem",\n      },`);
    expect(extend).not.toContain("brand-50");
    expect(extend).toContain("//   --color-primary-foreground: #ffffff → #111111");
    expect(tailwind3Extend(app, app)).toBeUndefined();
  });
});
