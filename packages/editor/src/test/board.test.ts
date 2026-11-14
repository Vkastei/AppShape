import { applyBoardOps, type BoardItem, emptyProjectFixture } from "./fixtures";
import { describe, expect, it } from "vitest";
import { attachOps, deleteOps, dragSet, duplicateOps, moveOps, reorderOps } from "../lib/board";
import { clipToRect, fitRect, screenToWorld, worldToScreen, zoomAt } from "../lib/geometry";

const items: BoardItem[] = [
  { type: "section", id: "s", name: "S", x: 0, y: 0, w: 2000, h: 2000 },
  { type: "frame", id: "p", frameId: "f", x: 100, y: 100 },
  { type: "note", id: "n", x: 150, y: 150, text: "on frame", attachedTo: { frameId: "f" } },
  { type: "note", id: "far", x: 5000, y: 5000, text: "far away" },
  { type: "arrow", id: "a", kind: "flow", from: { itemId: "p" }, to: { itemId: "far" } },
];
const project = emptyProjectFixture(items);
const ids = (ops: { op: string; itemId?: string }[]) => ops.map((o) => o.itemId);

describe("camera math", () => {
  it("round-trips screen and world coordinates", () => {
    const camera = { x: 120, y: -40, zoom: 0.5 };
    expect(screenToWorld(camera, worldToScreen(camera, { x: 10, y: 20 }))).toEqual({ x: 10, y: 20 });
  });

  it("zooms around the cursor", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(camera, cursor);
    const after = zoomAt(camera, cursor, 2);
    expect(screenToWorld(after, cursor)).toEqual(before);
    expect(zoomAt(camera, cursor, 100).zoom).toBe(4);
  });

  it("fits a rect into the viewport", () => {
    const camera = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1128, h: 628 }, 64);
    expect(camera.zoom).toBe(1);
    expect(worldToScreen(camera, { x: 500, y: 250 })).toEqual({ x: 564, y: 314 });
  });

  it("clips arrow ends to the rect border", () => {
    expect(clipToRect({ x: 0, y: 0, w: 100, h: 100 }, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  });
});

describe("board helpers", () => {
  it("moves section contents and attached notes along", () => {
    expect(dragSet(project, ["s"], {}).sort()).toEqual(["n", "p", "s"]);
    expect(dragSet(project, ["p"], {}).sort()).toEqual(["n", "p"]);
    expect(dragSet(project, ["a"], {})).toEqual([]);
  });

  it("moves items by a delta", () => {
    const next = applyBoardOps(project.board, moveOps(project, ["p", "n"], 10.4, -5));
    expect(next.items.find((i) => i.id === "p")).toMatchObject({ x: 110, y: 95 });
  });

  it("attaches dropped notes to the frame under them", () => {
    const moved = emptyProjectFixture(items.map((i) => (i.id === "far" ? { ...i, x: 300, y: 300 } : i)));
    expect(attachOps(moved, ["far"], {})).toEqual([expect.objectContaining({ itemId: "far", patch: { attachedTo: { frameId: "f" } } })]);
    expect(attachOps(project, ["n"], {})).toEqual([]);
  });

  it("deletes connected arrows too", () => {
    expect(ids(deleteOps(project, ["far"]))).toEqual(["far", "a"]);
  });

  it("duplicates without arrows", () => {
    const { ops, newIds } = duplicateOps(project, ["n", "a"]);
    expect(ops).toHaveLength(1);
    expect(newIds).toHaveLength(1);
    expect(applyBoardOps(project.board, ops).items.at(-1)).toMatchObject({ type: "note", x: 174, y: 174 });
  });

  it("reorders in z-order", () => {
    const order = (direction: Parameters<typeof reorderOps>[2], selection: string[]) =>
      applyBoardOps(project.board, reorderOps(project, selection, direction)).items.map((i) => i.id);
    expect(order("front", ["s"])).toEqual(["p", "n", "far", "a", "s"]);
    expect(order("back", ["a"])).toEqual(["a", "s", "p", "n", "far"]);
    expect(order("forward", ["s", "p"])).toEqual(["n", "s", "p", "far", "a"]);
    expect(order("backward", ["n"])).toEqual(["s", "n", "p", "far", "a"]);
  });
});

describe("click targets", () => {
  const root = {
    id: "r", type: "box", origin: "added", children: [
      { id: "btn", type: "button", origin: "added", children: [{ id: "label", type: "text", origin: "added", text: "Go" }] },
      { id: "t", type: "text", origin: "added", text: "Plain" },
    ],
  } as const;

  it("selects buttons first, then drills in", async () => {
    const { clickTarget } = await import("../lib/nodes");
    expect(clickTarget(root as never, "label", undefined)).toBe("btn");
    expect(clickTarget(root as never, "label", "btn")).toBe("label");
    expect(clickTarget(root as never, "t", "btn")).toBe("t");
  });
});
