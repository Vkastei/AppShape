import type { DesignRequest, Frame, Project } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import { acceptOps, backToReviewOps, type Box, dragShape, finishShape, fixFindingOps, otherVariants, phonesRequestOps, pickVariantOps, reopenOps, reviewRequestOps, sectionRequestOps, shapeAt, shapeTargets, simplify, skipFindingOps, variantsPlacement, variantsRequestOps } from "../lib/markup";

// a page: header with a link, a hero with a title and a button, an empty gap, a footer
const boxes: Box[] = [
  { id: "root", depth: 0, x: 0, y: 0, w: 1280, h: 1200 },
  { id: "header", depth: 1, x: 0, y: 0, w: 1280, h: 80 },
  { id: "link", depth: 2, x: 1000, y: 30, w: 160, h: 20 },
  { id: "hero", depth: 1, x: 0, y: 80, w: 1280, h: 600 },
  { id: "title", depth: 2, x: 100, y: 200, w: 600, h: 60 },
  { id: "button", depth: 2, x: 100, y: 300, w: 180, h: 48 },
  { id: "label", depth: 3, x: 120, y: 312, w: 140, h: 24 },
  { id: "footer", depth: 1, x: 0, y: 1000, w: 1280, h: 200 },
];

describe("what a shape touches", () => {
  it("a line through an element: the element", () => {
    expect(shapeTargets({ id: "s", kind: "pen", color: "remove", points: [[995, 40], [1080, 41], [1165, 39]] }, boxes)).toEqual(["link"]);
  });

  it("a cross over an element: the element it covers best", () => {
    const cross = { id: "s", kind: "pen" as const, color: "remove", points: [[98, 298], [282, 350], [190, 324], [98, 350], [282, 298]] as [number, number][] };
    expect(shapeTargets(cross, boxes)).toEqual(["button"]);
  });

  it("a rectangle or a loop: what it encloses (outermost only)", () => {
    expect(shapeTargets({ id: "s", kind: "rect", color: "change", x: 90, y: 190, w: 620, h: 170 }, boxes)).toEqual(["title", "button"]);
    const loop = { id: "s", kind: "pen" as const, color: "change", points: [[90, 290], [290, 290], [290, 356], [90, 356], [92, 292]] as [number, number][] };
    expect(shapeTargets(loop, boxes)).toEqual(["button"]);
  });

  it("an empty spot: the element around it", () => {
    expect(shapeTargets({ id: "s", kind: "rect", color: "add", x: 100, y: 400, w: 600, h: 100 }, boxes)).toEqual(["hero"]);
    expect(shapeTargets({ id: "s", kind: "rect", color: "add", x: 100, y: 800, w: 600, h: 100 }, boxes)).toEqual(["root"]);
  });

  it("an arrow: what it points at; a label: where it is", () => {
    expect(shapeTargets({ id: "s", kind: "arrow", color: "change", from: [600, 600], to: [130, 320] }, boxes)).toEqual(["label"]);
    expect(shapeTargets({ id: "s", kind: "label", color: "add", x: 1010, y: 46, text: "search" }, boxes)).toEqual(["link"]);
  });
});

describe("drawing shapes", () => {
  const draw = { tool: "rect" as const, color: "add", width: 4 };
  it("drags rectangles in any direction, Shift makes them square", () => {
    expect(dragShape(draw, "s", [[100, 100], [40, 160]], false)).toMatchObject({ kind: "rect", x: 40, y: 100, w: 60, h: 60 });
    expect(dragShape(draw, "s", [[0, 0], [100, 30]], true)).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("straightens strokes and arrows with Shift", () => {
    expect(dragShape({ ...draw, tool: "pen" }, "s", [[0, 0], [5, 9], [50, 3]], true)).toMatchObject({ points: [[0, 0], [50, 3]] });
    const arrow = dragShape({ ...draw, tool: "arrow" }, "s", [[0, 0], [100, 8]], true);
    expect(arrow?.kind === "arrow" && arrow.to[1]).toBeCloseTo(0);
  });

  it("drops shapes too small to mean anything and thins out strokes", () => {
    expect(finishShape({ id: "s", kind: "rect", color: "add", x: 0, y: 0, w: 2, h: 3 })).toBeUndefined();
    expect(simplify([[0, 0], [1, 0.1], [2, 0], [3, 0.1], [10, 0]])).toEqual([[0, 0], [10, 0]]);
  });

  it("finds the shape under the eraser, newest first", () => {
    const shapes = [
      { id: "a", kind: "rect" as const, color: "add", x: 0, y: 0, w: 100, h: 100 },
      { id: "b", kind: "pen" as const, color: "remove", points: [[0, 50], [100, 50]] as [number, number][] },
    ];
    expect(shapeAt(shapes, 50, 52)?.id).toBe("b");
    expect(shapeAt(shapes, 100, 20)?.id).toBe("a");
    expect(shapeAt(shapes, 50, 20)).toBeUndefined();
  });
});

describe("AI shortcuts for a screen", () => {
  const at = "2026-10-19T10:00:00.000Z";
  const frame = {
    id: "f_home",
    name: "Home",
    kind: "new",
    platform: "web",
    target: { adapter: "react-vite", route: "/" },
    viewports: [
      { id: "desktop", width: 1280 },
      { id: "mobile", width: 390 },
    ],
    current: { id: "n_root", type: "box", origin: "added", children: [] },
  } as unknown as Frame;
  const project = (requests: DesignRequest[] = []) => ({ frames: [frame], requests }) as unknown as Project;
  const drawn: DesignRequest = { id: "rq_1", frameId: "f_home", viewportId: "mobile", message: "", status: "draft", shapes: [{ id: "s_1", kind: "rect", color: "add", x: 0, y: 0, w: 10, h: 10 }], createdAt: at, updatedAt: at };

  it("make it work on phones: a request on the phone size with the job, reused when asked again", () => {
    const made = phonesRequestOps(project(), frame, at);
    if ("problem" in made) throw new Error(made.problem);
    const request = (made.ops[0] as { request: DesignRequest }).request;
    expect(request).toMatchObject({ frameId: "f_home", viewportId: "mobile", intent: "phones", shapes: [], message: "" });
    expect(phonesRequestOps(project([request]), frame, at)).toEqual({ ops: [], requestId: request.id });
    // the phone size already has its own drawing, or the screen has no phone size
    expect(phonesRequestOps(project([drawn]), frame, at)).toMatchObject({ problem: expect.stringContaining("already has a drawing") });
    expect(phonesRequestOps(project(), { ...frame, viewports: [frame.viewports[0]!] }, at)).toMatchObject({ problem: expect.stringContaining("no phone size") });
  });

  it("3 variants of a section: a blue box around it, three designs asked for", () => {
    const made = variantsRequestOps(project(), frame, "desktop", { id: "n_hero", box: { x: 0, y: 64, w: 1280, h: 600 } }, at);
    if ("problem" in made) throw new Error(made.problem);
    expect((made.ops[0] as { request: DesignRequest }).request).toMatchObject({ variants: 3, shapes: [{ kind: "rect", color: "change", x: 0, y: 64, w: 1280, h: 600, targets: ["n_hero"] }] });
    expect(variantsRequestOps(project([{ ...drawn, viewportId: "desktop" }]), frame, "desktop", { id: "n_hero", box: { x: 0, y: 0, w: 1, h: 1 } }, at)).toMatchObject({ problem: expect.any(String) });
  });

  it("a review: fix a finding, accept or discard, and it's back to the review", () => {
    const made = reviewRequestOps(project(), frame, "desktop", at);
    if ("problem" in made) throw new Error(made.problem);
    const asked = (made.ops[0] as { request: DesignRequest }).request;
    expect(asked).toMatchObject({ intent: "review", shapes: [], message: "" });
    const reviewed: DesignRequest = {
      ...asked,
      status: "proposed",
      route: "ai",
      review: {
        by: "claude-sonnet-5-5",
        at,
        findings: [
          { id: "f1", title: "One main button", why: "Two buttons compete.", fix: "Make the second button a link.", severity: "important", targets: ["n_cta"] },
          { id: "f2", title: "Shorter heading", why: "It's long.", fix: "Shorten the heading.", severity: "nice" },
        ],
      },
    };
    // fixing f1: a change request with the fix as its message and a box around what it's about
    const fixing = (fixFindingOps(reviewed, "f1", { x: 10, y: 20, w: 100, h: 40 }, at)[0] as { request: DesignRequest }).request;
    expect(fixing).toMatchObject({ message: "Make the second button a link.", status: "draft", fixing: "f1", route: "ai", shapes: [{ kind: "rect", color: "change", targets: ["n_cta"] }] });
    expect(fixing).not.toHaveProperty("intent");
    // accepted: the design changes, and the review again with f1 done
    const proposed = { ...fixing, status: "proposed" as const, proposal: { baseVersion: "v", ops: [{ id: "op1", op: "rename", frameId: "f_home", nodeId: "n_root", name: "Home" }], summary: ["x"], by: "fake", at } } as unknown as DesignRequest;
    const accepted = acceptOps(proposed, at);
    expect(accepted).toHaveLength(2);
    const back = (accepted[1] as { request: DesignRequest }).request;
    expect(back).toMatchObject({ intent: "review", status: "proposed", shapes: [], message: "" });
    expect(back.review!.findings.map((f) => [f.id, Boolean(f.done)])).toEqual([["f1", true], ["f2", false]]);
    expect(back).not.toHaveProperty("fixing");
    expect(back).not.toHaveProperty("proposal");
    // discarded (or *Back to the review*): f1 still open
    const discarded = (reopenOps(proposed, undefined, at)[0] as { request: DesignRequest }).request;
    expect(discarded.review!.findings.every((f) => !f.done)).toBe(true);
    expect((backToReviewOps(fixing, at)[0] as { request: DesignRequest }).request).toMatchObject({ intent: "review", status: "proposed" });
    // skipped
    expect((skipFindingOps(reviewed, "f2", at)[0] as { request: DesignRequest }).request.review!.findings[1]!.done).toBe(true);
    // a plain drawing is accepted and gone, as before
    expect((acceptOps({ ...proposed, review: undefined, fixing: undefined } as DesignRequest, at).at(-1) as { request: unknown }).request).toBeNull();
  });

  it("variants: the others next to the screen where it was drawn, picking one, and back to the drawing", () => {
    const variant = (n: number) => ({ baseVersion: "v", ops: [], summary: [], by: "fake", at, variant: n });
    const proposed: DesignRequest = { ...drawn, status: "proposed", variants: 3, proposal: variant(1), alternatives: [variant(2), variant(3)] };
    const board = { items: [
      { id: "i_desktop", type: "frame", frameId: "f_home", x: 0, y: 0, viewportId: "desktop" },
      { id: "i_mobile", type: "frame", frameId: "f_home", x: 1400, y: 0, viewportId: "mobile" },
    ] };
    const withBoard = { ...project([proposed]), board } as unknown as Project;
    expect(variantsPlacement(withBoard, proposed)).toBe("i_mobile");
    expect(otherVariants(withBoard, proposed).map((v) => [v.proposal.variant, v.frame?.id])).toEqual([[2, "f_home"], [3, "f_home"]]);
    const picked = (pickVariantOps(proposed, 3)[0] as { request: DesignRequest }).request;
    expect([picked.proposal?.variant, picked.alternatives?.map((p) => p.variant)]).toEqual([3, [1, 2]]);
    expect(pickVariantOps(proposed, 1)).toEqual([]);
    const back = (reopenOps(proposed)[0] as { request: DesignRequest }).request;
    expect(back).not.toHaveProperty("alternatives");
    expect(back).toMatchObject({ status: "draft", variants: 3 });
  });

  it("a section from a sentence: a green box below the chosen section, waiting for the sentence", () => {
    const made = sectionRequestOps(project(), frame, "desktop", { id: "n_hero", bottom: 680, width: 1280 }, at);
    if ("problem" in made) throw new Error(made.problem);
    const request = (made.ops[0] as { request: DesignRequest }).request;
    expect(request).toMatchObject({ viewportId: "desktop", intent: "section", message: "", shapes: [{ kind: "rect", color: "add", x: 128, y: 656, w: 1024, h: 48, targets: ["n_hero"] }] });
    expect(sectionRequestOps(project([{ ...drawn, viewportId: "desktop" }]), frame, "desktop", { id: "n_hero", bottom: 680, width: 1280 }, at)).toMatchObject({ problem: expect.stringContaining("already has a drawing") });
  });
});
