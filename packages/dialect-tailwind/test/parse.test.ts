import type { Tokens } from "@appshape/ir";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultTokens, parseClasses, splitVariants } from "../src";

let tokens: Tokens;
beforeAll(async () => {
  tokens = await defaultTokens();
});

const parse = (classes: string, parent?: Parameters<typeof parseClasses>[1]["parent"]) =>
  parseClasses(classes.split(/\s+/).filter(Boolean), { tokens, ...(parent && { parent }) });

describe("Tailwind classes → IR", () => {
  it("splits variants outside brackets", () => {
    expect(splitVariants("dark:md:hover:bg-[url(a:b)]")).toEqual({ variants: ["dark", "md", "hover"], utility: "bg-[url(a:b)]" });
  });

  it("maps layout, spacing and type to tokens", () => {
    const parsed = parse("relative max-w-7xl mx-auto px-6 text-center flex flex-col gap-8 items-center");
    expect(parsed.unmapped).toEqual([]);
    expect(parsed.layout).toEqual({ mode: "flex", direction: "column", gap: "$spacing.8", align: "center", padding: { left: "$spacing.6", right: "$spacing.6" } });
    expect(parsed.box).toEqual({ position: "relative", maxWidth: "$size.7xl", margin: { left: "auto", right: "auto" } });
    expect(parsed.style).toEqual({ textAlign: "center" });
  });

  it("keeps what the IR can't express and maps variants to overrides", () => {
    const parsed = parse("text-5xl md:text-6xl lg:text-7xl font-extrabold text-slate-900 dark:text-white leading-tight bg-gradient-to-r from-teal-600 group-hover:translate-x-2 hover:scale-105");
    expect(parsed.style).toEqual({ fontSize: "$fontSize.5xl", fontWeight: "$fontWeight.extrabold", color: "$color.slate-900", lineHeight: "$lineHeight.tight" });
    expect(parsed.overrides).toEqual([
      { when: { viewport: "md" }, style: { fontSize: "$fontSize.6xl" } },
      { when: { viewport: "lg" }, style: { fontSize: "$fontSize.7xl" } },
      { when: { scheme: "dark" }, style: { color: "$color.white" } },
      { when: { state: "group-hover" }, style: { translate: { x: "$spacing.2" } } },
      { when: { state: "hover" }, style: { scale: 105 } },
    ]);
    // a gradient without its end color stays as it is
    expect(parsed.unmapped).toEqual(["bg-gradient-to-r", "from-teal-600"]);
  });

  it("reads color opacity as an alpha token ref", () => {
    expect(parse("bg-white/80 border border-white/20").style).toEqual({ background: "$color.white/80", borderWidth: 1, borderColor: "$color.white/20" });
  });

  it("sizes depend on the parent", () => {
    expect(parse("w-full").box).toEqual({ width: { mode: "fill" } });
    expect(parse("w-full", { mode: "flex" }).box).toEqual({ width: { mode: "fixed", value: "100%" } });
    expect(parse("flex-1 min-w-0", { mode: "flex" }).box).toEqual({ width: { mode: "fill" }, minWidth: "$spacing.0" });
    expect(parse("flex-1", { mode: "flex", direction: "column" }).box).toEqual({ height: { mode: "fill" } });
    expect(parse("w-5 h-5").box).toEqual({ width: { mode: "fixed", value: "$spacing.5" }, height: { mode: "fixed", value: "$spacing.5" } });
    expect(parse("min-h-screen").box).toEqual({ minHeight: "100vh" });
  });

  it("puts the display of hidden elements on the element", () => {
    const parsed = parse("hidden md:flex items-center gap-5");
    expect(parsed.hidden).toBe(true);
    expect(parsed.layout).toEqual({ mode: "flex", align: "center", gap: "$spacing.5" });
    expect(parsed.overrides).toEqual([{ when: { viewport: "md" }, hidden: false }]);
  });

  it("merges sides by specificity", () => {
    expect(parse("pt-2 p-4 px-1").layout).toEqual({ padding: { top: "$spacing.2", right: "$spacing.1", bottom: "$spacing.4", left: "$spacing.1" } });
    expect(parse("rounded-xl rounded-t-none").style).toEqual({ radius: { topLeft: "$radius.none", topRight: "$radius.none", bottomRight: "$radius.xl", bottomLeft: "$radius.xl" } });
    expect(parse("border border-b-2").style).toEqual({ borderWidth: { top: 1, right: 1, bottom: 2, left: 1 } });
  });

  it("handles arbitrary values, negatives and fractions", () => {
    expect(parse("w-[320px] text-[13px] bg-[#0f766e] -mt-4 top-1/2").box).toEqual({ width: { mode: "fixed", value: "320px" }, margin: { top: "-1rem" }, inset: { top: "50%" } });
    expect(parse("text-[13px] text-[#333]").style).toEqual({ fontSize: "13px", color: "#333" });
    expect(parse("p-13").layout).toEqual({ padding: { top: "3.25rem", right: "3.25rem", bottom: "3.25rem", left: "3.25rem" } });
    expect(parse("-translate-x-1/2 !p-4").unmapped).toEqual(["!p-4"]);
    expect(parse("-translate-x-1/2").style).toEqual({ translate: { x: "-50%" } });
  });

  it("reads a background image with its size, position and repeat", () => {
    expect(parse("bg-[url('/hero.jpg')] bg-cover bg-left-top bg-no-repeat bg-gray-900").style).toEqual({
      backgroundImage: { src: "/hero.jpg", size: "cover", position: "top-left", repeat: false },
      background: "$color.gray-900",
    });
    expect(parse("md:bg-[url(/a.png)] md:bg-top-right").overrides).toEqual([{ when: { viewport: "md" }, style: { backgroundImage: { src: "/a.png", position: "top-right" } } }]);
    // without an image, bg-cover & co. stay as they are (an inline style may set the image)
    const plain = parse("bg-cover bg-center");
    expect(plain.style).toBeUndefined();
    expect(plain.unmapped).toEqual(["bg-cover", "bg-center"]);
  });

  it("reads italics, transitions and order", () => {
    expect(parse("italic md:not-italic").style).toEqual({ fontStyle: "italic" });
    expect(parse("italic md:not-italic").overrides).toEqual([{ when: { viewport: "md" }, style: { fontStyle: "normal" } }]);
    expect(parse("transition-colors duration-300 ease-in-out delay-75").style).toEqual({ transition: { property: "colors", duration: 300, easing: "in-out", delay: 75 } });
    expect(parse("order-last -order-1").box).toEqual({ order: -1 });
  });

  it("reads gradients, shadows, blur and transforms", () => {
    expect(parse("bg-linear-to-r from-teal-600 via-sky-500/50 to-indigo-600 to-90%").style).toEqual({
      gradient: { type: "linear", angle: 90, stops: [{ color: "$color.teal-600" }, { color: "$color.sky-500/50" }, { color: "$color.indigo-600", at: 90 }] },
    });
    expect(parse("bg-gradient-to-br from-white to-black").style?.gradient).toEqual({ type: "linear", angle: "to-br", stops: [{ color: "$color.white" }, { color: "$color.black" }] });
    expect(parse("-bg-linear-45 from-white to-black").style?.gradient?.angle).toBe(315);
    expect(parse("bg-radial from-white to-black bg-clip-text text-transparent").style).toMatchObject({ gradient: { type: "radial" }, backgroundClip: "text", color: "transparent" });
    expect(parse("bg-[image:linear-gradient(to_bottom_in_oklab,color-mix(in_oklab,var(--color-black)_60%,transparent)_0%,transparent_100%),url('/images/hero.jpg')]").style).toEqual({
      gradient: { type: "linear", stops: [{ color: "$color.black/60" }, { color: "transparent" }] },
      backgroundImage: { src: "/images/hero.jpg" },
    });
    expect(parse("shadow-[0_8px_24px_-4px_var(--color-black),inset_0_1px_0_#fff]").style?.shadow).toEqual([
      { x: 0, y: 8, blur: 24, spread: -4, color: "$color.black" },
      { x: 0, y: 1, blur: 0, color: "#fff", inset: true },
    ]);
    expect(parse("rotate-3 -skew-x-6 scale-[1.07] translate-y-1/2 hover:-translate-y-1").style).toEqual({ rotate: 3, skew: { x: -6 }, scale: 107, translate: { y: "50%" } });
  });

  it("reads gradient colors that change per state or scheme, hover groups, and the no-op transform", () => {
    const parsed = parse("bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 dark:from-slate-900 group transform");
    expect(parsed.style).toEqual({ gradient: { type: "linear", angle: 90, stops: [{ color: "$color.teal-600" }, { color: "$color.cyan-600" }] }, hoverGroup: true });
    expect(parsed.overrides).toEqual([
      { when: { state: "hover" }, style: { gradient: { type: "linear", angle: 90, stops: [{ color: "$color.teal-500" }, { color: "$color.cyan-500" }] } } },
      { when: { scheme: "dark" }, style: { gradient: { type: "linear", angle: 90, stops: [{ color: "$color.slate-900" }, { color: "$color.cyan-600" }] } } },
    ]);
    expect(parsed.unmapped).toEqual([]);
    expect(parse("group-hover:translate-x-1 group-hover:text-teal-500").overrides).toEqual([{ when: { state: "group-hover" }, style: { translate: { x: "$spacing.1" }, color: "$color.teal-500" } }]);
  });
});
