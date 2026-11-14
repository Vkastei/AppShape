import { applyCommandToProject, type DesignNode, findNode, type Project } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import { canStackOnPhones, isStackedOnPhones, resetToAllSizesOps, setVisibilityBySizeOps, showAllSizesOps, sizeDifferences, stackOnPhonesOps, visibilityBySize } from "../lib/responsive";
import { emptyProjectFixture } from "./fixtures";

function project(child: DesignNode): Project {
  const p = emptyProjectFixture([{ type: "frame", id: "item", frameId: "f", x: 0, y: 0 }]);
  p.frames[0]!.viewports = [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }];
  p.frames[0]!.current = { id: "root", type: "box", origin: "added", children: [child] };
  return p;
}
const node = (p: Project, id: string) => findNode(p.frames[0]!.current, id)!.node;

describe("responsive help", () => {
  it("stacks a row of three cards on phones with one action, and says so", () => {
    const row: DesignNode = { id: "row", type: "box", origin: "added", layout: { mode: "flex", direction: "row", gap: "$spacing.4" }, children: [] };
    let p = project(row);
    expect(canStackOnPhones(node(p, "row"))).toBe(true);
    p = applyCommandToProject(p, stackOnPhonesOps("f", node(p, "row")));
    const stacked = node(p, "row");
    expect(stacked.layout?.direction).toBe("column");
    expect(stacked.overrides).toEqual([{ when: { viewport: "md" }, layout: { direction: "row" } }]);
    expect(isStackedOnPhones(stacked)).toBe(true);
    expect(canStackOnPhones(stacked)).toBe(false);
    // the inspector lists what differs, and puts it back to all sizes
    expect(sizeDifferences(stacked)).toEqual([{ viewport: "md", area: "layout", key: "direction", value: "row" }]);
    p = applyCommandToProject(p, resetToAllSizesOps("f", stacked, "layout", "direction"));
    expect(sizeDifferences(node(p, "row"))).toEqual([]);
  });

  it("stacks a grid's columns on phones", () => {
    let p = project({ id: "grid", type: "box", origin: "added", layout: { mode: "grid", columns: 3 }, children: [] });
    p = applyCommandToProject(p, stackOnPhonesOps("f", node(p, "grid")));
    expect(node(p, "grid").layout?.columns).toBe(1);
    expect(isStackedOnPhones(node(p, "grid"))).toBe(true);
  });

  it("shows and hides elements per screen size", () => {
    let p = project({ id: "menu", type: "box", origin: "added", children: [] });
    expect(visibilityBySize(node(p, "menu"))).toEqual([true, true, true]);
    p = applyCommandToProject(p, setVisibilityBySizeOps("f", node(p, "menu"), [false, true, true]));
    expect(node(p, "menu").hidden).toBe(true);
    expect(visibilityBySize(node(p, "menu"))).toEqual([false, true, true]);
    p = applyCommandToProject(p, setVisibilityBySizeOps("f", node(p, "menu"), [true, true, false]));
    expect(visibilityBySize(node(p, "menu"))).toEqual([true, true, false]);
    expect(node(p, "menu").overrides).toEqual([{ when: { viewport: "lg" }, hidden: true }]);
  });

  it("shows a screen at phone, tablet and desktop width side by side", () => {
    let p = project({ id: "x", type: "box", origin: "added", children: [] });
    p = applyCommandToProject(p, showAllSizesOps(p, p.frames[0]!, {}));
    expect(p.frames[0]!.viewports.map((v) => v.width)).toEqual([1280, 390, 768]);
    const placements = p.board.items.filter((i) => i.type === "frame");
    expect(placements.map((i) => (i as { viewportId?: string }).viewportId)).toEqual([undefined, "mobile", "tablet"]);
    expect(showAllSizesOps(p, p.frames[0]!, {})).toEqual([]);
  });
});
