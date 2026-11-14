import { applyCommandToProject, type DesignNode, findNode, type Project } from "@appshape/ir";
import { beforeEach, describe, expect, it } from "vitest";
import { alignDeltas, arrangeBoardOps, arrangeNodesOps, distributeDeltas, layoutActionHint, nodeArrangement } from "../lib/arrange";
import { selectedNodes, selectNode, toggleNodeSelection, useEditor } from "../store";
import { emptyProjectFixture } from "./fixtures";

const rects = [
  { x: 0, y: 0, w: 10, h: 10 },
  { x: 40, y: 20, w: 20, h: 10 },
  { x: 100, y: 5, w: 10, h: 30 },
];

describe("align and distribute", () => {
  it("lines rects up on the outer edges or the middle of all", () => {
    expect(alignDeltas(rects, "left").map((d) => d.dx)).toEqual([0, -40, -100]);
    expect(alignDeltas(rects, "right").map((d) => d.dx)).toEqual([100, 50, 0]);
    expect(alignDeltas(rects, "vcenter").map((d) => d.dy)).toEqual([12.5, -7.5, -2.5]);
  });

  it("spreads rects with equal gaps, the outer ones stay", () => {
    // widths 10 + 20 + 10 over 110: two gaps of 35
    expect(distributeDeltas(rects, "x").map((d) => d.dx)).toEqual([0, 5, 0]);
  });

  it("aligns screens and notes on the board", () => {
    const p = emptyProjectFixture([
      { type: "note", id: "a", x: 0, y: 0, w: 100, h: 100, text: "", color: "yellow" },
      { type: "note", id: "b", x: 300, y: 80, w: 100, h: 100, text: "", color: "yellow" },
    ]);
    const next = applyCommandToProject(p, arrangeBoardOps(p, ["a", "b"], {}, { kind: "align", how: "top" }));
    expect(next.board.items.map((i) => (i as { y: number }).y)).toEqual([0, 0]);
  });
});

function project(): Project {
  const p = emptyProjectFixture([{ type: "frame", id: "item", frameId: "f", x: 0, y: 0 }]);
  const button = (id: string): DesignNode => ({ id, type: "button", origin: "added", style: { radius: "$radius.md" }, children: [] });
  p.frames[0]!.current = {
    id: "root",
    type: "box",
    origin: "added",
    children: [
      { id: "row", type: "box", origin: "added", layout: { mode: "flex", direction: "row" }, children: [button("b1"), button("b2"), button("b3")] },
      { id: "flow", type: "box", origin: "added", children: [button("b4"), button("b5")] },
    ],
  };
  return p;
}
const sel = (nodeId: string) => ({ itemId: "item", frameId: "f", nodeId });

describe("arranging elements in an auto layout", () => {
  it("aligns across a row with align self, along it with the row's distribution", () => {
    let p = project();
    const sels = ["b1", "b2"].map(sel);
    const arrangement = nodeArrangement(p, sels);
    expect(arrangement).toMatchObject({ mode: "layout", direction: "row" });
    expect(layoutActionHint("row", { kind: "distribute", axis: "y" })).toBeUndefined();
    p = applyCommandToProject(p, arrangeNodesOps(p, sels, { kind: "align", how: "bottom" }));
    expect(findNode(p.frames[0]!.current, "b1")!.node.box?.alignSelf).toBe("end");
    expect(findNode(p.frames[0]!.current, "b3")!.node.box?.alignSelf).toBeUndefined();
    p = applyCommandToProject(p, arrangeNodesOps(p, sels, { kind: "distribute", axis: "x" }));
    expect(findNode(p.frames[0]!.current, "row")!.node.layout?.justify).toBe("between");
  });

  it("says why elements in normal flow or in different containers can't be aligned", () => {
    const p = project();
    expect(nodeArrangement(p, ["b4", "b5"].map(sel))).toMatchObject({ mode: "none", reason: expect.stringContaining("stack or a row") });
    expect(nodeArrangement(p, ["b1", "b4"].map(sel))).toMatchObject({ mode: "none", reason: expect.stringContaining("same container") });
  });
});

describe("selecting several elements", () => {
  beforeEach(() => useEditor.setState({ project: project(), node: undefined, extraNodes: [] }));

  it("adds and removes with Shift-click; a plain selection ends it", () => {
    selectNode(sel("b1"));
    toggleNodeSelection(sel("b2"));
    toggleNodeSelection(sel("b4"));
    expect(selectedNodes().map((s) => s.nodeId)).toEqual(["b1", "b2", "b4"]);
    toggleNodeSelection(sel("b1"));
    expect(selectedNodes().map((s) => s.nodeId)).toEqual(["b2", "b4"]);
    selectNode(sel("b3"));
    expect(selectedNodes().map((s) => s.nodeId)).toEqual(["b3"]);
  });

  it("never holds an element together with one inside it", () => {
    selectNode(sel("b1"));
    toggleNodeSelection(sel("row"));
    expect(selectedNodes().map((s) => s.nodeId)).toEqual(["row"]);
  });
});
