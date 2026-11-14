import { describe, expect, it } from "vitest";
import { snapMove, snapResize } from "../lib/snap";

const guides = { threshold: 6, guides: true };

describe("snapping a moved box", () => {
  it("snaps to edges and centers of others, horizontally and vertically at once", () => {
    const other = { x: 100, y: 100, w: 200, h: 100 };
    // left edge 4 off the other's left edge; top 3 below its middle (and bottom 3 below its bottom)
    const r = snapMove({ x: 104, y: 153, w: 50, h: 50 }, [other], guides);
    expect([r.dx, r.dy]).toEqual([-4, -3]);
    expect(r.lines.filter((l) => l.axis === "x").map((l) => l.at)).toEqual([100]);
    expect(r.lines.filter((l) => l.axis === "y").map((l) => l.at).sort()).toEqual([150, 200]);
    // the vertical line spans both boxes
    const vertical = r.lines.find((l) => l.axis === "x")!;
    expect([vertical.from, vertical.to]).toEqual([100, 200]);
  });

  it("leaves boxes alone that are out of reach, and snaps to the container's center", () => {
    expect(snapMove({ x: 400, y: 400, w: 10, h: 10 }, [{ x: 0, y: 0, w: 50, h: 50 }], guides)).toMatchObject({ dx: 0, dy: 0, lines: [] });
    const r = snapMove({ x: 178, y: 10, w: 40, h: 20 }, [], { ...guides, container: { x: 0, y: 0, w: 400, h: 300 } });
    expect([r.dx, r.dy]).toEqual([2, 0]);
  });

  it("falls back to the grid on each axis without a guide", () => {
    expect(snapMove({ x: 13, y: 50, w: 10, h: 10 }, [], { threshold: 6, guides: true, grid: 24 })).toMatchObject({ dx: 11, dy: -2 });
    // grid relative to an origin (a container's corner)
    expect(snapMove({ x: 13, y: 50, w: 10, h: 10 }, [], { threshold: 6, guides: false, grid: 8, origin: { x: 4, y: 4 } })).toMatchObject({ dx: -1, dy: 2 });
  });

  it("snaps to equal spacing and shows the matching gaps", () => {
    const a = { x: 0, y: 0, w: 100, h: 50 };
    const b = { x: 120, y: 0, w: 100, h: 50 };
    const r = snapMove({ x: 243, y: 0, w: 100, h: 50 }, [a, b], guides);
    expect(r.dx).toBe(-3);
    const gaps = r.measures.filter((m) => m.kind === "gap");
    expect(gaps.map((m) => m.value)).toEqual([20, 20]);
    expect(gaps.map((m) => [m.from, m.to]).sort((p, q) => p[0]! - q[0]!)).toEqual([
      [100, 120],
      [220, 240],
    ]);
  });

  it("only snaps the locked axis", () => {
    const r = snapMove({ x: 104, y: 153, w: 50, h: 50 }, [{ x: 100, y: 100, w: 200, h: 100 }], guides, "x");
    expect([r.dx, r.dy]).toEqual([-4, 0]);
  });
});

describe("snapping a resize", () => {
  it("moves the dragged edge to other edges, or to an equal size", () => {
    const others = [{ x: 0, y: 100, w: 100, h: 40 }];
    expect(snapResize({ x: 0, y: 0, w: 96, h: 50 }, { x: 1, y: 0 }, others, guides).dx).toBe(4);
    // from the left edge: the box grows to the left
    expect(snapResize({ x: 5, y: 0, w: 95, h: 50 }, { x: -1, y: 0 }, others, guides).dx).toBe(5);
    // equal size to a box elsewhere (no edge in reach)
    const equal = snapResize({ x: 300, y: 0, w: 97, h: 50 }, { x: 1, y: 0 }, others, guides);
    expect(equal.dx).toBe(3);
    expect(equal.measures.filter((m) => m.kind === "size").map((m) => m.value)).toEqual([100, 100]);
  });
});
