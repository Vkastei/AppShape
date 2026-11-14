import { describe, expect, it } from "vitest";
import { type AnyOp, applyCommand, contentHash, CommandSchema, type DesignRequest, DesignRequestSchema, type DesignState, describeMarkup, type Frame, invertCommand, pickVariant, type Proposal, proposalVariants, RequestOpError } from "../src";
import { box, text } from "./helpers";

const at = "2026-10-14T10:00:00.000Z";
const request = (patch: Partial<DesignRequest> = {}): DesignRequest => ({
  id: "rq_1",
  frameId: "f",
  viewportId: "desktop",
  shapes: [{ id: "s1", kind: "pen", color: "remove", points: [[10, 10], [80, 12]], targets: ["t"] }],
  message: "Remove the link",
  status: "draft",
  createdAt: at,
  updatedAt: at,
  ...patch,
});

const frame: Frame = {
  id: "f",
  name: "Home",
  kind: "new",
  platform: "web",
  target: { adapter: "react-vite", route: "/" },
  viewports: [{ id: "desktop", width: 1280 }],
  current: box("root", [text("t", "Compare all features")]),
};
const state = (requests?: DesignRequest[]): DesignState => ({ board: { items: [] }, frames: new Map([["f", frame]]), ...(requests && { requests }) });

describe("design requests", () => {
  it("variants: all of them by number, and picking one swaps it with the proposal", () => {
    const variant = (n: number): Proposal => ({ baseVersion: "v", ops: [], summary: [`Change ${n}`], by: "agent", at, variant: n, idea: `Idea ${n}` });
    const proposed = request({ status: "proposed", variants: 3, proposal: variant(1), alternatives: [variant(3), variant(2)] });
    expect(DesignRequestSchema.parse(proposed)).toEqual(proposed);
    expect(proposalVariants(proposed).map((p) => p.variant)).toEqual([1, 2, 3]);
    const picked = pickVariant(proposed, 3)!;
    expect(picked.proposal?.variant).toBe(3);
    expect(picked.alternatives!.map((p) => p.variant)).toEqual([1, 2]);
    expect(pickVariant(proposed, 1)).toBeUndefined();
    expect(proposalVariants(request())).toEqual([]);
    expect(DesignRequestSchema.safeParse({ ...proposed, variants: 4 }).success).toBe(false);
  });

  it("hashes a screen the same whatever order its keys are in", () => {
    expect(contentHash({ a: 1, b: { c: [1, { d: 2, e: 3 }] } })).toBe(contentHash({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 }));
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }));
  });

  it("validates shapes and colors", () => {
    expect(DesignRequestSchema.safeParse(request()).success).toBe(true);
    expect(DesignRequestSchema.safeParse(request({ shapes: [{ id: "s1", kind: "rect", color: "#12345", x: 0, y: 0, w: 4, h: 4 }] })).success).toBe(false);
    expect(DesignRequestSchema.safeParse(request({ shapes: [{ id: "s1", kind: "label", color: "add", x: 0, y: 0, text: "" }] })).success).toBe(false);
    expect(CommandSchema.safeParse({ id: "c1", ops: [{ id: "o1", op: "setRequest", requestId: "rq_1", request: request() }] }).success).toBe(true);
  });

  it("creates, changes and removes requests as commands, and undoes them", () => {
    const create: AnyOp[] = [{ id: "o1", op: "setRequest", requestId: "rq_1", request: request() }];
    const created = applyCommand(state(), create);
    expect(created.requests).toEqual([request()]);
    expect(applyCommand(created, invertCommand(state(), create)).requests).toEqual([]);

    const change: AnyOp[] = [{ id: "o2", op: "setRequest", requestId: "rq_1", request: request({ route: "note" }) }];
    const changed = applyCommand(created, change);
    expect(changed.requests![0]!.route).toBe("note");
    expect(applyCommand(changed, invertCommand(created, change)).requests).toEqual([request()]);

    const remove: AnyOp[] = [{ id: "o3", op: "setRequest", requestId: "rq_1", request: null }];
    expect(applyCommand(changed, remove).requests).toEqual([]);
    expect(applyCommand(applyCommand(changed, remove), invertCommand(changed, remove)).requests).toEqual([request({ route: "note" })]);
  });

  it("refuses removing an unknown request or a mismatched id", () => {
    expect(() => applyCommand(state(), [{ id: "o1", op: "setRequest", requestId: "rq_x", request: null }])).toThrow(RequestOpError);
    expect(() => applyCommand(state(), [{ id: "o1", op: "setRequest", requestId: "rq_x", request: request() }])).toThrow(RequestOpError);
  });

  it("describes the drawing with the elements it touches", () => {
    expect(describeMarkup(request(), frame)).toEqual(['red (remove) stroke at (10, 10), 70×2 — touches text "Compare all features" (`t`)']);
  });
});
