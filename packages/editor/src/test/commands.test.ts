import { applyCommandToProject, type DesignNode, findNode, type Project } from "@appshape/ir";
import { beforeEach, describe, expect, it } from "vitest";
import { classesOf, classesOps } from "../components/ClassesSection";
import { commands, registerInsert, sameAs, searchCommands } from "../lib/commands";
import { selectNode, useEditor } from "../store";
import { emptyProjectFixture } from "./fixtures";

function project(): Project {
  const p = emptyProjectFixture([{ type: "frame", id: "item", frameId: "f", x: 0, y: 0 }]);
  p.tokens = { source: "tailwind-v4", groups: { radius: { md: "0.375rem", xl: "0.75rem" }, spacing: { "4": "1rem" }, color: { white: "#fff" } } };
  const button = (id: string, radius: string): DesignNode => ({ id, type: "button", origin: "added", style: { radius }, children: [{ id: `${id}-t`, type: "text", origin: "added", text: id }] });
  p.frames[0]!.current = { id: "root", type: "box", origin: "added", children: [button("b1", "$radius.md"), button("b2", "$radius.md"), button("b3", "$radius.xl")] };
  return p;
}

describe("command palette", () => {
  beforeEach(() => {
    useEditor.setState({ project: project(), node: undefined, extraNodes: [], selection: [] });
    registerInsert(() => {});
  });

  it("reaches every toolbar action, the insert menu and every screen", () => {
    const ids = new Set(commands().map((c) => c.id));
    for (const id of ["undo", "redo", "zoom.in", "zoom.out", "zoom.100", "zoom.fit", "scheme", "flows", "snap.grid", "snap.guides", "panel.sidebar", "panel.inspector", "settings", "checks", "activity", "import", "apply", "theme", "freeMove", "tool.select", "tool.hand", "tool.note", "tool.arrow", "tool.section", "tool.text", "screen.new", "library", "goto.screen.f"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("reaches the inspector's actions for a selected element", () => {
    selectNode({ itemId: "item", frameId: "f", nodeId: "b1" });
    const ids = new Set(commands().map((c) => c.id));
    for (const id of ["el.delete", "el.duplicate", "el.wrap", "el.parent", "el.component", "el.detach", "el.copyStyle", "el.pasteStyle", "el.rename", "sel.sameStyle", "editFor.md", "state.hover", "insert.button"]) expect(ids, id).toContain(id);
  });

  it("finds commands by every word, titles starting with the words first", () => {
    const found = searchCommands(commands(), "zoom fit");
    expect(found[0]?.id).toBe("zoom.fit");
    expect(searchCommands(commands(), "dark").map((c) => c.id)).toContain("scheme");
  });

  it("selects elements with the same style on every screen", () => {
    const same = sameAs(project(), { itemId: "item", frameId: "f", nodeId: "b1" }, "style");
    expect(same.map((s) => s.nodeId)).toEqual(["b1", "b2"]);
  });
});

describe("advanced classes", () => {
  it("turns known classes into settings and keeps the others as they are", () => {
    const p = project();
    const frame = p.frames[0]!;
    const node = findNode(frame.current, "b1")!.node;
    expect(classesOf(p, node, frame.current)).toEqual(["rounded-md"]);
    const next = applyCommandToProject(p, classesOps(p, frame, "b1", ["rounded-xl", "p-4", "backdrop-blur-md", "hover:bg-white"]));
    const b1 = findNode(next.frames[0]!.current, "b1")!.node;
    expect(b1.style).toEqual({ radius: "$radius.xl" });
    expect(b1.layout?.padding).toEqual({ top: "$spacing.4", right: "$spacing.4", bottom: "$spacing.4", left: "$spacing.4" });
    expect(b1.overrides).toEqual([{ when: { state: "hover" }, style: { background: "$color.white" } }]);
    expect(b1.platformRaw?.unmapped).toEqual(["backdrop-blur-md"]);
    // and back: the classes field shows them again
    expect(classesOf(next, b1, next.frames[0]!.current)).toEqual(["p-4", "rounded-xl", "hover:bg-white", "backdrop-blur-md"]);
  });
});
