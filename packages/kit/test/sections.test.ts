import { defaultTokens } from "@appshape/dialect-tailwind";
import { componentSources, type DesignNode, DesignNodeSchema, type Frame, walk } from "@appshape/ir";
import { renderFrame } from "@appshape/render";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPage, isSection, PAGE_TEMPLATES, SECTION_CATEGORIES, type SectionContext, SECTIONS, sectionUses, starterComponentFrame, withTheme } from "../src";

let frames: Frame[];
let ctx: SectionContext;
let tokens: Awaited<ReturnType<typeof defaultTokens>>;
beforeAll(async () => {
  tokens = withTheme(await defaultTokens());
  const keys = sectionUses(SECTIONS.map((s) => s.key));
  frames = keys.map((key) => starterComponentFrame(key, { adapter: "react-vite" }));
  const ids = new Map(frames.map((f) => [f.component!.kit!, f.id]));
  ctx = {
    tint: "#4f46e5",
    use: (key, props = {}, fill = []) => ({ id: `i${Math.random().toString(36).slice(2)}`, type: "instance", origin: "added", componentId: ids.get(key)!, props, children: fill }),
  };
});

describe("sections", () => {
  it("cover every category, with unique keys", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    for (const category of SECTION_CATEGORIES) expect(SECTIONS.some((s) => s.category === category), category).toBe(true);
  });

  it.each(SECTIONS.map((s) => [s.key, s]))("%s is a valid section that uses only theme tokens", (_, section) => {
    const node = section.build(ctx);
    expect(DesignNodeSchema.safeParse(node).success).toBe(true);
    expect(isSection(node)).toBe(true);
    const ids = new Set<string>();
    walk(node, (n) => {
      expect(ids.has(n.id), `duplicate id ${n.id}`).toBe(false);
      ids.add(n.id);
    });
    for (const scheme of ["light", "dark"]) {
      const result = renderFrame(node, { tokens, sources: componentSources(frames), ...(scheme === "dark" && { rootClassName: "aps-dark" }) });
      expect(result.warnings).toEqual([]);
    }
  });

  it("know the starter components they need", () => {
    expect(sectionUses(["pricing-tiers"]).sort()).toEqual(["badge", "button", "card"]);
    expect(sectionUses(["logos"])).toEqual([]);
  });
});

describe("page templates", () => {
  it.each(PAGE_TEMPLATES.map((t) => [t.key, t]))("%s builds a whole screen from sections", (_, template) => {
    const root: DesignNode = buildPage(template, ctx);
    expect(DesignNodeSchema.safeParse(root).success).toBe(true);
    expect(root.type === "box" && root.children.every(isSection)).toBe(true);
    expect(renderFrame(root, { tokens, sources: componentSources(frames) }).warnings).toEqual([]);
  });
});
