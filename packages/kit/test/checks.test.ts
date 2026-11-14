import { defaultTokens } from "@appshape/dialect-tailwind";
import { applyCommandToProject, type DesignNode, DEFAULT_REDACTION, type Frame, IR_VERSION, type Project } from "@appshape/ir";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPage, checkFrame, type CheckRule, PAGE_TEMPLATES, placeholderImage, sectionUses, SECTIONS, starterComponentFrame, withTheme } from "../src";

let project: Project;
beforeAll(async () => {
  project = { irVersion: IR_VERSION, name: "Test", adapters: [], tokens: withTheme(await defaultTokens()), components: [], board: { items: [] }, frames: [], changesets: [], redaction: DEFAULT_REDACTION };
});

const screen = (root: DesignNode): Frame => ({ id: "f_page", name: "Page", kind: "new", platform: "web", target: { adapter: "react-vite", route: "/" }, viewports: [{ id: "desktop", width: 1280 }, { id: "mobile", width: 390 }], current: root });
const text = (id: string, value: string, extra: Partial<DesignNode> = {}) => ({ id, type: "text", origin: "added", text: value, ...extra }) as DesignNode;

function broken(): DesignNode {
  const sizes = ["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem", "1.5rem", "1.875rem"];
  return {
    id: "root", type: "box", origin: "added", layout: { mode: "flex", direction: "column", gap: "$spacing.4" }, style: { background: "$color.background" },
    children: [
      text("t_faint", "Barely readable", { style: { color: "$color.neutral-300" } }),
      text("t_raw", "Raw values", { style: { color: "#333333", fontSize: "15px" }, layout: { padding: { top: 13, bottom: 13 } } }),
      ...sizes.map((size, i) => text(`t_size${i}`, `Size ${i}`, { style: { fontSize: size } })),
      ...Array.from({ length: 13 }, (_, i) => ({ id: `b_space${i}`, type: "box", origin: "added", layout: { mode: "flex", gap: `$spacing.${[0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10][i]}` }, children: [] }) as DesignNode),
      { id: "img_alt", type: "image", origin: "added", src: "https://example.com/a.png" },
      { id: "img_placeholder", type: "image", origin: "added", src: placeholderImage("photo").src, alt: "Team" },
      text("h_two", "Section", { semantic: { role: "heading", level: 2 } }),
      text("h_four", "Deep", { semantic: { role: "heading", level: 4 } }),
      { id: "btn", type: "button", origin: "added", layout: { padding: { top: "$spacing.1", bottom: "$spacing.1", left: "$spacing.3", right: "$spacing.3" } }, style: { fontSize: "$fontSize.sm" }, children: [text("btn_l", "Go")] },
      text("t_long", "A very long paragraph ".repeat(12), { style: { fontSize: "$fontSize.base" } }),
    ],
  } as DesignNode;
}

describe("design checks", () => {
  it("find every kind of problem on a broken page, and each fix resolves its finding", () => {
    const page = screen(broken());
    const work = { ...project, frames: [page] };
    const findings = checkFrame(page, work);
    const rules = new Set(findings.map((f) => f.rule));
    const all: CheckRule[] = ["contrast", "off-system", "font-sizes", "spacing-values", "alt-text", "placeholder", "headings", "tap-target", "line-length"];
    expect([...rules].sort()).toEqual(all.sort());
    expect(findings.find((f) => f.rule === "contrast")?.nodeId).toBe("t_faint");
    expect(findings.find((f) => f.rule === "off-system")?.nodeId).toBe("t_raw");

    for (const finding of findings.filter((f) => f.fix)) {
      const fixed = applyCommandToProject(work, finding.fix!.ops);
      const after = checkFrame(fixed.frames[0]!, fixed);
      expect(after.some((f) => f.key === finding.key), `${finding.rule}: ${finding.message} → ${finding.fix!.label}`).toBe(false);
    }
    // every kind that can be fixed automatically has a fix
    for (const rule of ["contrast", "off-system", "headings", "tap-target", "line-length"] as const) expect(findings.some((f) => f.rule === rule && f.fix), rule).toBe(true);
  });

  it("check the text inside a component in the variant it uses, on the background it sits on", () => {
    const button = starterComponentFrame("button", { adapter: "react-vite" });
    const band = (variant: string) =>
      screen({ id: "root", type: "box", origin: "added", style: { background: "$color.primary" }, children: [{ id: "cta", type: "instance", origin: "added", componentId: button.id, props: { variant }, children: [] }] } as DesignNode);
    const contrastOf = (variant: string) => {
      const page = band(variant);
      return checkFrame(page, { ...project, frames: [page, button] }).filter((f) => f.rule === "contrast");
    };
    // a ghost button's dark text on the primary color: found on the instance
    expect(contrastOf("ghost")).toEqual([expect.objectContaining({ nodeId: "cta", severity: "error", message: expect.stringContaining("Use a variant made for this background") })]);
    // the primary variant has its own fill: readable
    expect(contrastOf("primary")).toEqual([]);
  });

  it("check dark mode too", () => {
    // readable on white, too dark on the dark background
    const page = screen({ id: "root", type: "box", origin: "added", style: { background: "$color.background" }, children: [text("t", "Dark text", { style: { color: "$color.neutral-900" } })] } as DesignNode);
    const findings = checkFrame(page, { ...project, frames: [page] });
    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining("in dark mode")]);
  });

  it.each(PAGE_TEMPLATES.map((t) => [t.key, t]))("pass on the %s template (only placeholder pictures to replace)", (_, template) => {
    const frames = sectionUses(SECTIONS.map((s) => s.key)).map((key) => starterComponentFrame(key, { adapter: "react-vite" }));
    const ids = new Map(frames.map((f) => [f.component!.kit!, f.id]));
    const ctx = { tint: "#4f46e5", use: (key: string, props = {}, fill: DesignNode[] = []) => ({ id: `i${Math.random().toString(36).slice(2)}`, type: "instance", origin: "added", componentId: ids.get(key)!, props, children: fill }) as DesignNode };
    const page = screen(buildPage(template, ctx));
    const work = { ...project, frames: [page, ...frames] };
    const problems = [page, ...frames].flatMap((f) => checkFrame(f, work)).filter((f) => f.rule !== "placeholder");
    expect(problems.map((f) => `${f.rule}: ${f.message}`)).toEqual([]);
  });
});
