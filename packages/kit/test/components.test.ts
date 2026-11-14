import { componentSources, findComponentProblems, FrameSchema, type InstanceNode, type Tokens } from "@appshape/ir";
import { renderFrame } from "@appshape/render";
import { describe, expect, it } from "vitest";
import { isPlaceholderImage, placeholderImage, STARTER_COMPONENTS, starterComponentFrame, themePreview, withTheme } from "../src";

/** Tailwind's tokens the components use, plus the default theme. */
const base: Tokens = {
  source: "tailwind-v4",
  groups: {
    spacing: Object.fromEntries(["0", "0.5", "1", "1.5", "2", "2.5", "3", "4", "6", "8", "10", "14", "24"].map((s) => [s, `${Number(s) * 0.25}rem`])),
    fontSize: { xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem" },
    fontWeight: { medium: 500, semibold: 600 },
    shadow: { sm: "0 1px 3px 0 rgb(0 0 0 / 0.1)" },
    radius: { full: "9999px" },
  },
};
const tokens = withTheme(base);

describe("starter components", () => {
  const frames = STARTER_COMPONENTS.map((c) => starterComponentFrame(c.key, { adapter: "react-vite" }));
  const sources = componentSources(frames);

  it("are valid components marked with their kit key", () => {
    for (const frame of frames) {
      expect(FrameSchema.safeParse(frame).success, frame.name).toBe(true);
      expect(frame.component?.kit).toBeTruthy();
    }
    expect(findComponentProblems(frames)).toEqual([]);
    expect(new Set(frames.map((f) => f.component?.kit)).size).toBe(frames.length);
  });

  it("render every variant with the theme's tokens only", () => {
    for (const frame of frames) {
      const variants: Record<string, string | boolean>[] = [{}];
      for (const prop of frame.component!.props) {
        if (prop.type === "enum") for (const option of prop.options!) variants.push({ [prop.name]: option });
        if (prop.type === "boolean") variants.push({ [prop.name]: true }, { [prop.name]: false });
      }
      for (const props of variants) {
        const instance: InstanceNode = { id: "i", type: "instance", origin: "added", componentId: frame.id, props, children: [] };
        for (const scheme of ["light", "dark"]) {
          const result = renderFrame(instance, { tokens, sources, ...(scheme === "dark" && { rootClassName: "aps-dark" }) });
          expect(result.warnings, `${frame.name} ${JSON.stringify(props)}`).toEqual([]);
        }
      }
    }
  });

  it("show the accordion's answer only when open", () => {
    const frame = frames.find((f) => f.component?.kit === "accordion")!;
    const html = (open: boolean) => {
      const result = renderFrame({ id: "i", type: "instance", origin: "added", componentId: frame.id, props: { open }, children: [] }, { tokens, sources });
      return { css: result.css };
    };
    const hiddenRules = (css: string) => css.split("\n").filter((l) => l.includes("display: none")).length;
    expect(hiddenRules(html(false).css)).toBe(2);
    expect(hiddenRules(html(true).css)).toBe(1);
  });
});

describe("placeholder pictures", () => {
  it("are tinted SVGs that checks can recognize", () => {
    const image = placeholderImage("photo", "#4f46e5");
    expect(image.src.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(image.src)).toContain('fill="#4f46e5"');
    expect(isPlaceholderImage(image.src)).toBe(true);
    expect(isPlaceholderImage("asset:uploads/team.png")).toBe(false);
  });
});

describe("theme preview", () => {
  it("renders with Tailwind's tokens and a theme, without unknown tokens", async () => {
    const { defaultTokens } = await import("@appshape/dialect-tailwind");
    const full = withTheme(await defaultTokens());
    const { root, frames } = themePreview("#4f46e5");
    expect(findComponentProblems(frames)).toEqual([]);
    const result = renderFrame(root, { tokens: full, sources: componentSources(frames) });
    expect(result.warnings).toEqual([]);
  });
});
