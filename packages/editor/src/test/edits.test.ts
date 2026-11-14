import type { DesignNode } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import { resizeBox, resizedSize } from "../lib/edits";

const free = { maxWidth: Infinity, minWidth: 0, maxHeight: Infinity, minHeight: 0, absolute: false, left: 0, top: 0 };
const box = (extra: Partial<DesignNode> = {}): DesignNode => ({ id: "n_a", type: "box", origin: "added", children: [], ...extra }) as DesignNode;

describe("resize handles", () => {
  it("keeps proportions at corners, changes one side at edges", () => {
    expect(resizedSize("e", { w: 200, h: 100 }, 40, 30)).toEqual({ w: 240, h: 100 });
    expect(resizedSize("n", { w: 200, h: 100 }, 40, -30)).toEqual({ w: 200, h: 130 });
    expect(resizedSize("se", { w: 200, h: 100 }, 100, 0)).toEqual({ w: 300, h: 150 });
    expect(resizedSize("nw", { w: 200, h: 100 }, 20, -40)).toEqual({ w: 280, h: 140 });
    // shrinking from a corner along one axis shrinks both (the axis that changed most leads)
    expect(resizedSize("se", { w: 200, h: 100 }, -50, 0)).toEqual({ w: 150, h: 75 });
    expect(resizedSize("sw", { w: 200, h: 100 }, 50, 5)).toEqual({ w: 150, h: 75 });
    expect(resizedSize("w", { w: 200, h: 100 }, 500, 0)).toEqual({ w: 1, h: 100 });
  });

  it("writes fixed sizes and drops what would override them", () => {
    const row = box({ layout: { mode: "flex", direction: "row" } });
    expect(resizeBox(box(), row, "e", { w: 200, h: 100 }, { w: 240, h: 100 }, { ...free, maxWidth: 220 })).toEqual({
      width: { mode: "fixed", value: 240 },
      grow: null,
      basis: null,
      maxWidth: null,
    });
    expect(resizeBox(box(), row, "s", { w: 200, h: 100 }, { w: 200, h: 120 }, free)).toEqual({ height: { mode: "fixed", value: 120 } });
  });

  it("keeps the opposite edge of absolutely placed elements", () => {
    const node = box({ box: { position: "absolute", inset: { left: 50, top: 20, right: 0 } } });
    expect(resizeBox(node, box(), "nw", { w: 100, h: 50 }, { w: 120, h: 60 }, { ...free, absolute: true, left: 50, top: 20 })).toEqual({
      width: { mode: "fixed", value: 120 },
      height: { mode: "fixed", value: 60 },
      inset: { left: 30, top: 10 },
    });
  });
});
