import { describe, expect, it } from "vitest";
import { applyOps, type Frame, type Op, OpError } from "../src";
import { box, frame, text } from "./helpers";

function run(f: Frame, ...ops: Op[]): Frame {
  return applyOps(new Map([[f.id, f]]), ops).get(f.id)!;
}

const page = () => frame("f1", box("root", [box("a", [text("a1", "Hello")]), box("b"), text("c", "World")]));

describe("applyOps", () => {
  it("never mutates its input", () => {
    const f = page();
    const before = structuredClone(f);
    run(f, { id: "o1", frameId: "f1", op: "delete", nodeId: "b" });
    expect(f).toEqual(before);
  });

  it("inserts, moves and deletes", () => {
    const f = run(
      page(),
      { id: "o1", frameId: "f1", op: "insert", parentId: "b", index: 0, node: text("new", "New", { origin: "added" }) },
      { id: "o2", frameId: "f1", op: "move", nodeId: "c", parentId: "a", index: 0 },
      { id: "o3", frameId: "f1", op: "delete", nodeId: "a1" },
    );
    expect(f.current).toEqual(
      box("root", [box("a", [text("c", "World")]), box("b", [text("new", "New", { origin: "added" })])]),
    );
  });

  it("interprets move indexes after removal", () => {
    const f = run(page(), { id: "o1", frameId: "f1", op: "move", nodeId: "a", parentId: "root", index: 2 });
    expect((f.current as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("rejects invalid structure edits", () => {
    expect(() => run(page(), { id: "o1", frameId: "f1", op: "delete", nodeId: "root" })).toThrow(OpError);
    expect(() => run(page(), { id: "o1", frameId: "f1", op: "move", nodeId: "a", parentId: "a1", index: 0 })).toThrow(/cannot have children|into itself/);
    expect(() => run(page(), { id: "o1", frameId: "f1", op: "move", nodeId: "root", parentId: "a", index: 0 })).toThrow(/root/);
    expect(() =>
      run(page(), { id: "o1", frameId: "f1", op: "insert", parentId: "root", index: 9, node: box("x") }),
    ).toThrow(/out of range/);
    expect(() =>
      run(page(), { id: "o1", frameId: "f1", op: "insert", parentId: "root", index: 0, node: box("a") }),
    ).toThrow(/already exists/);
  });

  it("patches style and maintains overrides", () => {
    let f = run(
      page(),
      { id: "o1", frameId: "f1", op: "restyle", nodeId: "a", style: { radius: "$radius.xl", shadow: "$shadow.md" } },
      { id: "o2", frameId: "f1", op: "relayout", nodeId: "a", layout: { mode: "grid", gap: "$spacing.8" } },
      { id: "o3", frameId: "f1", op: "relayout", nodeId: "a", layout: { gap: "$spacing.10" }, when: { viewport: "lg" } },
    );
    const a = (f.current as { children: Frame["current"][] }).children[0]!;
    expect(a.style).toEqual({ radius: "$radius.xl", shadow: "$shadow.md" });
    expect(a.overrides).toEqual([{ when: { viewport: "lg" }, layout: { gap: "$spacing.10" } }]);

    f = run(
      f,
      { id: "o4", frameId: "f1", op: "relayout", nodeId: "a", layout: { gap: null }, when: { viewport: "lg" } },
      { id: "o5", frameId: "f1", op: "restyle", nodeId: "a", style: { radius: null, shadow: null } },
    );
    const a2 = (f.current as { children: Frame["current"][] }).children[0]!;
    expect(a2.overrides).toBeUndefined();
    expect(a2.style).toBeUndefined();
  });

  it("validates nodes after edits", () => {
    expect(() =>
      run(page(), { id: "o1", frameId: "f1", op: "restyle", nodeId: "a", style: { color: "$colour.red" } }),
    ).toThrow(/token/);
    expect(() =>
      run(page(), { id: "o1", frameId: "f1", op: "relayout", nodeId: "a", layout: { mode: "grid", columns: 0 } }),
    ).toThrow(/columns/);
    expect(() =>
      run(page(), { id: "o1", frameId: "f1", op: "setAttrs", nodeId: "a", attrs: { placeholder: "x" } }),
    ).toThrow(/not editable/);
    expect(() => run(page(), { id: "o1", frameId: "f1", op: "retext", nodeId: "a", text: "x" })).toThrow(/expected text/);
  });

  it("handles frame-level ops", () => {
    const created = frame("f2", box("r2"), "new");
    const frames = applyOps(new Map(), [
      { id: "o1", frameId: "f2", op: "createFrame", frame: created },
      { id: "o2", frameId: "f2", op: "updateFrame", patch: { name: "Contact" } },
      { id: "o3", frameId: "f2", op: "annotate", annotation: { id: "a1", kind: "data", text: "Posts to /api/contact" } },
    ]);
    expect(frames.get("f2")?.name).toBe("Contact");
    expect(frames.get("f2")?.annotations).toHaveLength(1);
    expect(applyOps(frames, [{ id: "o4", frameId: "f2", op: "deleteFrame" }]).has("f2")).toBe(false);
  });
});
