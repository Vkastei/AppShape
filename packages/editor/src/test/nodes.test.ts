import { applyCommandToProject, type DesignNode, findNode, type Project } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import {
  cloneWithNewIds,
  deleteOps,
  duplicateOps,
  insertOps,
  moveSiblingOps,
  moveToOps,
  nodeContext,
  unwrapOps,
  wrapOps,
} from "../lib/nodes";
import { newScreen, primitive } from "../lib/templates";
import { emptyProjectFixture } from "./fixtures";

const text = (id: string, value: string): DesignNode => ({ id, type: "text", origin: "added", text: value });

function project(): Project {
  const base = emptyProjectFixture([]);
  const frame = base.frames[0]!;
  frame.current = {
    id: "root",
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column" },
    children: [text("a", "A"), { id: "row", type: "box", origin: "added", children: [text("b", "B"), text("c", "C")] }],
  };
  return base;
}

const ids = (p: Project, id = "root") => {
  const node = findNode(p.frames[0]!.current, id)!.node as { children: DesignNode[] };
  return node.children.map((c) => c.id);
};
const run = (p: Project, ops: Parameters<typeof applyCommandToProject>[1]) => applyCommandToProject(p, ops);
const ctx = (p: Project, nodeId: string) => nodeContext(p, { frameId: "f", nodeId })!;

describe("element structure ops", () => {
  it("inserts into containers, or after leaves", () => {
    const p = project();
    expect(ids(run(p, insertOps(ctx(p, "row"), text("n", "N"))), "row")).toEqual(["b", "c", "n"]);
    expect(ids(run(p, insertOps(ctx(p, "a"), text("n", "N"))))).toEqual(["a", "n", "row"]);
  });

  it("deletes, but never the root", () => {
    const p = project();
    expect(ids(run(p, deleteOps(ctx(p, "a"))))).toEqual(["row"]);
    expect(deleteOps(ctx(p, "root"))).toEqual([]);
  });

  it("duplicates with fresh ids", () => {
    const p = project();
    const { ops, newId } = duplicateOps(ctx(p, "row"));
    const next = run(p, ops);
    expect(ids(next)).toEqual(["a", "row", newId]);
    expect(ids(next, newId!)).toHaveLength(2);
    expect(ids(next, newId!)).not.toContain("b");
  });

  it("wraps and unwraps", () => {
    const p = project();
    const { ops, newId } = wrapOps(ctx(p, "a"));
    const wrapped = run(p, ops);
    expect(ids(wrapped)).toEqual([newId, "row"]);
    expect(ids(wrapped, newId!)).toEqual(["a"]);
    expect(ids(run(p, unwrapOps(ctx(p, "row"))))).toEqual(["a", "b", "c"]);
  });

  it("moves among siblings and into other containers", () => {
    const p = project();
    expect(ids(run(p, moveSiblingOps(ctx(p, "a"), 1)))).toEqual(["row", "a"]);
    expect(moveSiblingOps(ctx(p, "a"), -1)).toEqual([]);
    expect(ids(run(p, moveToOps(p, { frameId: "f", nodeId: "a" }, "row", 1)), "row")).toEqual(["b", "a", "c"]);
    expect(moveToOps(p, { frameId: "f", nodeId: "row" }, "row", 0)).toEqual([]);
  });

  it("clones drop capture metadata", () => {
    const copy = cloneWithNewIds({ ...text("x", "X"), origin: "imported", source: { file: "a.tsx", line: 1, col: 1 }, platformRaw: { tag: "h1", classes: ["text-xl"] } });
    expect(copy).toMatchObject({ origin: "added", platformRaw: { tag: "h1" } });
    expect(copy.id).not.toBe("x");
    expect("source" in copy).toBe(false);
  });
});

describe("templates", () => {
  const tokens = { source: "manual" as const, groups: { color: { "indigo-600": "#4f46e5" }, spacing: { "4": "1rem" } } };

  it("uses design-system tokens when available, raw values otherwise", () => {
    const button = primitive("button", tokens);
    expect(button.style?.background).toBe("$color.indigo-600");
    expect(button.style?.radius).toBe("0.375rem");
  });

  it("creates screens per preset", () => {
    expect(newScreen("Home", "/", "desktop", tokens).viewports.map((v) => v.width)).toEqual([1280, 390]);
    const phone = newScreen("Settings", "/settings", "phone", tokens);
    expect(phone.platform).toBe("mobile");
    expect(phone.current.box?.minHeight).toBe("852px");
  });
});
