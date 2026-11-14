import type { DesignNode, Tokens } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import { parseClasses } from "@appshape/dialect-tailwind";
import { type ClassContext, nodeClasses } from "../src/classes";

const tokens: Tokens = {
  source: "tailwind-v4",
  groups: {
    color: { "indigo-600": "#4f46e5", white: "#fff", "gray-200": "#e5e7eb" },
    spacing: { "2": "0.5rem", "4": "1rem", "6": "1.5rem" },
    size: { md: "28rem" },
    radius: { xl: "0.75rem" },
    shadow: { sm: "0 1px 2px" },
    fontSize: { lg: "1.125rem" },
    fontWeight: { semibold: 600 },
    breakpoint: { sm: "40rem", md: "48rem", lg: "64rem" },
  },
};
const ctx = (): ClassContext => ({ tokens, warnings: [] });
const classes = (node: Partial<DesignNode>, parent?: DesignNode["layout"]) =>
  nodeClasses({ id: "n", type: "box", origin: "added", children: [], ...node } as DesignNode, parent, ctx());

describe("nodeClasses", () => {
  it("writes a free move as a relative offset from its screen size up", () => {
    const { base } = classes({ overrides: [{ when: { viewport: "lg" }, box: { position: "relative", inset: { left: 120, top: 80 } } }] });
    // nothing for phones; from lg up it moves without leaving its place
    expect(base).toEqual(["lg:relative", "lg:top-[80px]", "lg:left-[120px]"]);
  });

  it("maps tokens to utilities and raw values to arbitrary values", () => {
    const { base } = classes({
      layout: { mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } },
      box: { maxWidth: "$size.md", minHeight: "100vh" },
      style: { background: "$color.indigo-600", color: "#0f766e", radius: "$radius.xl", shadow: "$shadow.sm", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold", borderWidth: 1, borderColor: "$color.gray-200" },
    });
    expect(base).toEqual([
      "flex", "flex-col", "gap-4", "p-6", "max-w-md", "min-h-screen",
      "bg-indigo-600", "text-[#0f766e]", "border", "border-gray-200", "rounded-xl", "shadow-sm", "text-lg", "font-semibold",
    ]);
  });

  it("compresses edges and keeps only the sides that are set", () => {
    expect(classes({ layout: { padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.4", right: "$spacing.4" } } }).base).toEqual(["px-4", "py-2"]);
    expect(classes({ box: { margin: { top: 12 } } }).base).toEqual(["mt-[12px]"]);
    expect(classes({ box: { margin: { left: "auto", right: "auto" } } }).base).toEqual(["mx-auto"]);
  });

  it("sizes fill and hug like the renderer, depending on the parent", () => {
    const fill = { width: { mode: "fill" as const }, height: { mode: "fill" as const } };
    expect(classes({ box: fill }, { mode: "flex", direction: "row" }).base).toEqual(["flex-1", "min-w-0", "self-stretch"]);
    expect(classes({ box: fill }, { mode: "flex", direction: "column" }).base).toEqual(["w-full", "flex-1", "min-h-0"]);
    expect(classes({ box: fill }).base).toEqual(["w-full", "h-full"]);
    expect(classes({ box: { width: { mode: "hug" } } }).base).toEqual(["w-fit"]);
    expect(classes({ box: { width: { mode: "hug" } } }, { mode: "flex" }).base).toEqual([]);
    expect(classes({ box: { width: { mode: "fixed", value: "$spacing.4" } } }).base).toEqual(["w-4"]);
  });

  it("prefixes overrides and shows hidden nodes from a breakpoint", () => {
    const { base } = classes({
      hidden: true,
      layout: { mode: "flex", direction: "column" },
      overrides: [
        { when: { viewport: "lg" }, layout: { gap: "$spacing.6" } },
        { when: { viewport: "md" }, hidden: false, layout: { direction: "row" } },
        { when: { state: "hover" }, style: { background: "$color.white" } },
        { when: { scheme: "dark", viewport: "md" }, style: { color: "$color.white" } },
      ],
    });
    expect(base).toEqual(["flex-col", "hidden", "hover:bg-white", "md:flex-row", "md:flex", "dark:md:text-white", "lg:gap-6"]);
  });

  it("collects variant classes per property value", () => {
    const { base, variants } = classes({
      style: { background: "$color.indigo-600" },
      overrides: [
        { when: { prop: { name: "variant", value: "secondary" } }, style: { background: "$color.white" } },
        { when: { prop: { name: "variant", value: "secondary" }, state: "hover" }, style: { background: "$color.gray-200" } },
        { when: { prop: { name: "size", value: "lg" } }, layout: { padding: { top: "$spacing.4", bottom: "$spacing.4", left: "$spacing.6", right: "$spacing.6" } } },
      ],
    });
    expect(base).toEqual(["bg-indigo-600"]);
    expect(variants).toEqual({ variant: { secondary: ["bg-white", "hover:bg-gray-200"] }, size: { lg: ["px-6", "py-4"] } });
  });

  it("escapes arbitrary values and warns about unknown tokens", () => {
    const c = ctx();
    const { base } = nodeClasses({ id: "n", type: "box", origin: "added", style: { shadow: "0 1px 3px rgb(0 0 0 / 0.1)", background: "$color.nope" }, children: [] }, undefined, c);
    expect(base).toEqual(["bg-nope", "shadow-[0_1px_3px_rgb(0_0_0_/_0.1)]"]);
    expect(c.warnings).toEqual(["unknown token $color.nope"]);
    expect(classes({ style: { color: "currentColor" } }).base).toEqual(["text-current"]);
  });

  it("writes background images with their size, position and repeat", () => {
    const c: ClassContext = { ...ctx(), image: (src) => (src.startsWith("asset:") ? "/images/hero 1.jpg" : src) };
    const node = { id: "n", type: "box", origin: "added", children: [], style: { backgroundImage: { src: "asset:uploads/hero 1.jpg", size: "cover", position: "top-left", repeat: false } } } as DesignNode;
    expect(nodeClasses(node, undefined, c).base).toEqual(["bg-[url('/images/hero%201.jpg')]", "bg-cover", "bg-left-top", "bg-no-repeat"]);
  });

  it("writes box controls, states and transitions, and reads them back the same", () => {
    const node: Partial<DesignNode> = {
      box: { position: "sticky", inset: { top: 0 }, zIndex: 40, aspectRatio: "4 / 3", order: -9999, colSpan: 2, minHeight: "100vh" },
      style: { shadow: "$shadow.sm", transition: { property: "shadow", duration: 200, easing: "out" } },
      overrides: [
        { when: { state: "hover" }, style: { shadow: "$shadow.lg" } },
        { when: { viewport: "md" }, box: { order: 2 } },
      ],
    };
    const { base } = classes(node);
    expect(base).toEqual([
      "min-h-screen", "col-span-2", "sticky", "top-0", "z-40", "aspect-[4/3]", "order-first", "shadow-sm", "transition-shadow", "duration-200", "ease-out",
      "hover:shadow-lg", "md:order-2",
    ]);
    const parsed = parseClasses(base, { tokens: { ...tokens, groups: { ...tokens.groups, spacing: { ...tokens.groups.spacing, "0": "0px" }, shadow: { sm: "0 1px 2px", lg: "0 10px 15px" } } } });
    expect(parsed.box).toMatchObject({ position: "sticky", zIndex: 40, aspectRatio: "4/3", order: -9999, colSpan: 2, minHeight: "100vh" });
    expect(parsed.box?.inset).toEqual({ top: "$spacing.0" });
    expect(parsed.style?.transition).toEqual({ property: "shadow", duration: 200, easing: "out" });
    expect(parsed.overrides).toContainEqual({ when: { viewport: "md" }, box: { order: 2 } });
    // durations without a named step in Tailwind v3 are arbitrary values (both versions read them)
    expect(classes({ style: { transition: { property: "all", duration: 250, delay: 50 } } }).base).toEqual(["transition-all", "duration-[250ms]", "delay-[50ms]"]);
    expect(parseClasses(["transition", "duration-[250ms]", "-order-2"], { tokens }).style?.transition).toEqual({ property: "default", duration: 250 });
  });

  it("writes gradients, shadows, blur and transforms for Tailwind v4 and v3, and v3 reads them back", () => {
    const style = {
      gradient: { type: "linear" as const, angle: 30, stops: [{ color: "$color.white" }, { color: "$color.indigo-600", at: 80 }] },
      shadow: "$shadow.sm",
      shadowColor: "$color.indigo-600/30",
      rotate: 7,
      scale: 107,
      skew: { x: -3 },
      translate: { y: "-0.25rem" },
    };
    expect(classes({ style }).base).toEqual(["bg-linear-30", "from-white", "to-indigo-600", "to-80%", "shadow-sm", "shadow-indigo-600/30", "rotate-7", "scale-107", "-translate-y-[0.25rem]", "-skew-x-3"]);
    const v3: Tokens = { ...tokens, source: "tailwind-v3" };
    const base = nodeClasses({ id: "n", type: "box", origin: "added", children: [], style } as DesignNode, undefined, { tokens: v3, warnings: [] }).base;
    expect(base).toEqual(["bg-[linear-gradient(30deg,var(--tw-gradient-stops))]", "from-white", "to-indigo-600", "to-80%", "shadow-sm", "shadow-indigo-600/30", "rotate-[7deg]", "scale-[1.07]", "-translate-y-[0.25rem]", "-skew-x-3"]);
    expect(parseClasses(base, { tokens: v3 }).style).toEqual(style);
  });

  it("writes entrances as animation classes and reads them back the same", () => {
    const fade = { preset: "fade" as const, trigger: "load" as const };
    expect(classes({ style: { motion: fade } }).base).toEqual(["motion-safe:animate-[aps-fade_600ms_ease-out_both]"]);
    const slide = { preset: "slide-up" as const, trigger: "scroll" as const, duration: 800, delay: 150, easing: "in-out" as const };
    expect(classes({ style: { motion: slide } }).base).toEqual(["aps-reveal", "motion-safe:animate-[aps-slide-up_800ms_ease-in-out_150ms_both]"]);
    // staggered: the children animate, one step apart (the delay moves into a variable)
    const grid = { preset: "scale" as const, trigger: "scroll-repeat" as const, stagger: 80, delay: 100 };
    const base = classes({ layout: { mode: "grid", columns: 3 }, style: { motion: grid } }).base;
    expect(base).toEqual(["grid", "grid-cols-3", "aps-reveal-repeat", "aps-stagger", "[--aps-stagger:80ms]", "[--aps-delay:100ms]", "*:motion-safe:animate-[aps-scale_600ms_ease-out_both]"]);
    for (const [motion, list] of [[fade, ["motion-safe:animate-[aps-fade_600ms_ease-out_both]"]], [slide, classes({ style: { motion: slide } }).base], [grid, base]] as const) {
      const parsed = parseClasses(list, { tokens });
      expect(parsed.style?.motion).toEqual(motion);
      expect(parsed.unmapped).toEqual([]);
    }
    // a stagger without its animation is not an entrance: the classes stay
    expect(parseClasses(["aps-stagger", "[--aps-stagger:80ms]"], { tokens }).style?.motion).toBeUndefined();
  });
});
