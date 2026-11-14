import { describe, expect, it } from "vitest";
import {
  applyOps,
  clone,
  type DesignNode,
  diffTree,
  type Frame,
  normalizeNode,
  OpError,
  type Op,
  squash,
  type TreeOp,
} from "../src";
import { box, counter, frame, rng, text } from "./helpers";
import { randomOp, randomTree } from "./random";

function applyTree(root: DesignNode, ops: TreeOp[]): DesignNode {
  const f = frame("f", root);
  return applyOps(new Map([["f", f]]), ops).get("f")!.current;
}

/** Raise with APPSHAPE_SEEDS=5000 for a longer randomized run. */
const SEEDS = Number(process.env.APPSHAPE_SEEDS ?? 300);

const ids = (root: DesignNode) => (root as { children: DesignNode[] }).children.map((c) => c.id);

describe("diffTree", () => {
  it("returns no ops for equal trees", () => {
    const root = box("r", [text("a", "A"), box("b")]);
    expect(diffTree("f", root, clone(root))).toEqual([]);
  });

  it("uses a single move for a rotation", () => {
    const before = box("r", [box("a"), box("b"), box("c")]);
    for (const order of [["c", "a", "b"], ["b", "c", "a"]]) {
      const after = box("r", order.map((id) => box(id)));
      const ops = diffTree("f", before, after);
      expect(ops.map((o) => o.op)).toEqual(["move"]);
      expect(ids(applyTree(before, ops))).toEqual(order);
    }
  });

  it("moves survivors out of a deleted container before deleting it", () => {
    const before = box("r", [box("wrapper", [text("keep", "Keep"), text("drop", "Drop")]), box("target")]);
    const after = box("r", [box("target", [text("keep", "Keep")])]);
    const ops = diffTree("f", before, after);
    expect(ops.map((o) => o.op)).toEqual(["move", "delete"]);
    expect(normalizeNode(applyTree(before, ops))).toEqual(normalizeNode(after));
  });

  it("wraps existing nodes in a new container", () => {
    const before = box("r", [text("a", "A"), text("b", "B")]);
    const after = box("r", [box("wrap", [text("a", "A"), text("b", "B")], { origin: "added" })]);
    const ops = diffTree("f", before, after);
    expect(ops.map((o) => o.op)).toEqual(["insert", "move", "move"]);
    expect(ops[0]).toMatchObject({ op: "insert", node: { id: "wrap", children: [] } });
  });

  it("emits property ops including overrides", () => {
    const before = box("r", [text("t", "Pricing", { style: { fontSize: "$fontSize.4xl" } })]);
    const after = box("r", [
      text("t", "Simple pricing", {
        style: { fontSize: "$fontSize.5xl" },
        overrides: [{ when: { viewport: "md" }, style: { fontSize: "$fontSize.6xl" } }],
      }),
    ]);
    const ops = diffTree("f", before, after, { createOpId: counter("op") });
    expect(ops).toEqual([
      { id: "op_1", frameId: "f", nodeId: "t", op: "restyle", style: { fontSize: "$fontSize.5xl" } },
      { id: "op_2", frameId: "f", nodeId: "t", op: "restyle", style: { fontSize: "$fontSize.6xl" }, when: { viewport: "md" } },
      { id: "op_3", frameId: "f", nodeId: "t", op: "retext", text: "Simple pricing" },
    ]);
  });

  it("carries order, transitions and states through diff, apply and squash", () => {
    const before = box("r", [box("card")]);
    const after = box("r", [
      box("card", [], {
        box: { order: -9999, position: "sticky", inset: { top: 0 } },
        style: { transition: { property: "shadow", duration: 200, easing: "out" } },
        overrides: [{ when: { state: "hover" }, style: { shadow: "$shadow.lg" } }, { when: { viewport: "md" }, box: { order: 2 } }],
      }),
    ]);
    const ops = diffTree("f", before, after);
    expect(normalizeNode(applyTree(before, ops))).toEqual(normalizeNode(after));
    expect(normalizeNode(applyTree(before, squash(ops, new Map([["f", frame("f", before)]])) as TreeOp[]))).toEqual(normalizeNode(after));
  });

  it("carries kept classes, text links and italics through diff and apply", () => {
    const before = box("r", [text("t", "Read the docs")]);
    const after = box("r", [
      text("t", "Read the docs", {
        platformRaw: { unmapped: ["backdrop-blur-md"] },
        spans: [{ text: "Read the " }, { text: "docs", href: "/docs", style: { fontStyle: "italic" } }],
      }),
    ]);
    const ops = diffTree("f", before, after);
    expect(ops.map((o) => o.op).sort()).toEqual(["retext", "setClasses"]);
    expect(normalizeNode(applyTree(before, ops))).toEqual(normalizeNode(after));
    // and away again
    expect(normalizeNode(applyTree(after, diffTree("f", after, before)))).toEqual(normalizeNode(before));
  });

  it("changes an element's captured tag (a heading that became a paragraph with a link)", () => {
    const before = box("r", [text("t", "Frequently asked questions", { platformRaw: { tag: "h2" }, semantic: { role: "heading", level: 2 } })]);
    const after = box("r", [text("t", "Questions? Contact us", { spans: [{ text: "Questions? " }, { text: "Contact us", href: "/contact" }] })]);
    const ops = diffTree("f", before, after);
    expect(ops.find((o) => o.op === "setClasses")).toMatchObject({ tag: null, unmapped: null });
    expect(normalizeNode(applyTree(before, ops))).toEqual(normalizeNode(after));
    expect(normalizeNode(applyTree(after, diffTree("f", after, before)))).toEqual(normalizeNode(before));
  });

  it("carries gradients, shadow lists, blur and transforms through diff and apply", () => {
    const before = box("r", [box("card", [], { style: { shadow: "$shadow.sm" } })]);
    const after = box("r", [
      box("card", [], {
        style: {
          gradient: { type: "linear", angle: "to-br", stops: [{ color: "$color.white" }, { color: "#000", at: 80 }] },
          shadow: [{ x: 0, y: 8, blur: 24, spread: -4, color: "$color.black/20" }],
          backdropBlur: "$blur.md",
          rotate: -6,
          translate: { y: "-0.25rem" },
        },
        overrides: [{ when: { state: "hover" }, style: { scale: 105 } }],
      }),
    ]);
    const ops = diffTree("f", before, after);
    expect(normalizeNode(applyTree(before, ops))).toEqual(normalizeNode(after));
  });

  it("carries entrance animations through diff, apply and squash", () => {
    const before = box("r", [box("grid", [box("a"), box("b")])]);
    const after = box("r", [
      box("grid", [box("a"), box("b")], { style: { motion: { preset: "slide-up", trigger: "scroll", stagger: 80, delay: 100 } } }),
    ]);
    const ops = diffTree("f", before, after);
    expect(ops).toEqual([expect.objectContaining({ op: "restyle", nodeId: "grid", style: { motion: { preset: "slide-up", trigger: "scroll", stagger: 80, delay: 100 } } })]);
    expect(normalizeNode(applyTree(before, squash(ops, new Map([["f", frame("f", before)]])) as TreeOp[]))).toEqual(normalizeNode(after));
    // a changed setting replaces the whole animation
    const faster = box("r", [box("grid", [box("a"), box("b")], { style: { motion: { preset: "fade", trigger: "load" } } })]);
    expect(normalizeNode(applyTree(after, diffTree("f", after, faster)))).toEqual(normalizeNode(faster));
  });

  it("rejects type changes", () => {
    expect(() => diffTree("f", box("r", [box("x")]), box("r", [text("x", "X")]))).toThrow(/changed type/);
  });

  it("reproduces random edits (property test)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const baseline = randomTree(r, counter(`s${seed}n`));
      let current = frame("f", clone(baseline));
      const nextNode = counter(`s${seed}new`);
      const nextOp = counter("op");
      for (let i = 0; i < 25; i++) {
        try {
          current = applyOps(new Map([["f", current]]), [randomOp(r, current, nextNode, nextOp)]).get("f")!;
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
        }
      }
      const ops = diffTree("f", baseline, current.current);
      expect(normalizeNode(applyTree(baseline, ops)), `seed ${seed}`).toEqual(normalizeNode(current.current));
    }
  });
});

describe("squash", () => {
  const start = () => frame("f", box("r", [box("a"), text("t", "Hello")]));

  it("drops an insert that is deleted later", () => {
    const ops: Op[] = [
      { id: "o1", frameId: "f", op: "insert", parentId: "r", index: 0, node: box("x", [], { origin: "added" }) },
      { id: "o2", frameId: "f", op: "restyle", nodeId: "x", style: { background: "$color.white" } },
      { id: "o3", frameId: "f", op: "delete", nodeId: "x" },
    ];
    expect(squash(ops, new Map([["f", start()]]))).toEqual([]);
  });

  it("folds edits on a new frame into createFrame", () => {
    const created = frame("g", box("gr"), "new");
    const ops: Op[] = [
      { id: "o1", frameId: "g", op: "createFrame", frame: created },
      { id: "o2", frameId: "g", op: "insert", parentId: "gr", index: 0, node: text("h", "Contact", { origin: "added" }) },
      { id: "o3", frameId: "g", op: "retext", nodeId: "h", text: "Contact us" },
    ];
    const squashed = squash(ops, new Map());
    expect(squashed).toHaveLength(1);
    expect(squashed[0]).toMatchObject({ op: "createFrame", frame: { current: { children: [{ text: "Contact us" }] } } });
  });

  it("keeps the recorded scope", () => {
    const ops: Op[] = [
      { id: "o1", frameId: "f", op: "restyle", nodeId: "a", style: { radius: "$radius.md" }, scope: "component" },
      { id: "o2", frameId: "f", op: "restyle", nodeId: "a", style: { radius: "$radius.xl" } },
    ];
    expect(squash(ops, new Map([["f", start()]]))).toEqual([
      expect.objectContaining({ op: "restyle", nodeId: "a", style: { radius: "$radius.xl" }, scope: "component" }),
    ]);
  });

  it("has the same effect as the original log (property test)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 7919);
      const f: Frame = frame("f", randomTree(r, counter(`s${seed}n`)));
      const frames = new Map([["f", f]]);
      const nextNode = counter(`s${seed}new`);
      const nextOp = counter("op");
      const log: Op[] = [];
      let state = f;
      for (let i = 0; i < 30; i++) {
        const op = randomOp(r, state, nextNode, nextOp);
        try {
          state = applyOps(new Map([["f", state]]), [op]).get("f")!;
          log.push(op);
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
        }
      }
      const squashed = squash(log, frames);
      const result = applyOps(frames, squashed).get("f")!;
      expect(normalizeNode(result.current), `seed ${seed}`).toEqual(normalizeNode(state.current));
      expect(result.annotations ?? []).toEqual(state.annotations ?? []);
    }
  });
});
