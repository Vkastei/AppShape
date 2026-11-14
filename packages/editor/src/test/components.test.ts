import { type AnyOp, applyCommandToProject, type DesignNode, findNode, type Frame, type Project, resolveProps, walk } from "@appshape/ir";
import { describe, expect, it } from "vitest";
import {
  addVariantOps,
  autoProps,
  deleteComponentOps,
  detachOps,
  exposeDef,
  makeComponentOps,
  placementError,
  removePropOps,
  renamePropOps,
  sourcesOf,
} from "../lib/components";
import { insertOps, nodeContext } from "../lib/nodes";
import { primitive } from "../lib/templates";
import { emptyProjectFixture } from "./fixtures";

const tokens = { source: "manual" as const, groups: {} };

/** A screen with a button and a card, placed on the board. */
function project(): Project {
  const base = emptyProjectFixture([{ type: "frame", id: "b_screen", frameId: "f", x: 0, y: 0 }]);
  const button = { ...primitive("button", tokens), id: "btn" } as Extract<DesignNode, { type: "button" }>;
  button.targetFrameId = "f_other";
  const card = { ...primitive("card", tokens), id: "card" };
  base.frames[0]!.current = { id: "root", type: "box", origin: "added", layout: { mode: "flex", direction: "column" }, children: [button, card] };
  return base;
}

const apply = (p: Project, ops: AnyOp[]) => applyCommandToProject(p, ops);
const screen = (p: Project) => p.frames.find((f) => f.id === "f")!;

function withComponent(nodeId = "btn") {
  const p = project();
  const made = makeComponentOps(p, nodeContext(p, { frameId: "f", nodeId })!, 133.4, { x: 0, y: 900 });
  if ("error" in made) throw new Error(made.error);
  return { before: p, made, after: apply(p, made.ops) };
}

describe("make component", () => {
  it("creates a component frame, replaces the element by an instance and places the component", () => {
    const { made, after } = withComponent();
    const component = after.frames.find((f) => f.id === made.componentId)!;
    expect(component.kind).toBe("component");
    expect(component.name).toBe("Button");
    expect(component.viewports).toEqual([{ id: "component", width: 134 }]);
    expect(component.current.type).toBe("button");
    expect(component.current.id).not.toBe("btn");
    expect(component.component!.props.map((p) => [p.name, p.bindings![0]!.field])).toEqual([
      ["label", "text"],
      ["opens", "target"],
    ]);
    const root = screen(after).current as Extract<DesignNode, { type: "box" }>;
    expect(root.children[0]).toMatchObject({ id: made.instanceId, type: "instance", componentId: made.componentId, props: {} });
    expect(after.board.items.find((i) => i.id === made.placementId)).toMatchObject({ type: "frame", frameId: made.componentId, y: 900 });
  });

  it("refuses roots and instances, and names uniquely", () => {
    const p = project();
    expect(makeComponentOps(p, nodeContext(p, { frameId: "f", nodeId: "root" })!, 100, { x: 0, y: 0 })).toEqual({ error: expect.any(String) });
    const { made, after } = withComponent();
    expect(makeComponentOps(after, nodeContext(after, { frameId: "f", nodeId: made.instanceId })!, 100, { x: 0, y: 0 })).toEqual({ error: expect.any(String) });
    const card = makeComponentOps(after, nodeContext(after, { frameId: "f", nodeId: "card" })!, 100, { x: 0, y: 0 });
    expect("name" in card && card.name).toBe("Card");
  });

  it("exposes texts by name, heading or position", () => {
    const tree: DesignNode = {
      id: "r", type: "box", origin: "added",
      children: [
        { id: "h", type: "text", origin: "added", text: "T", semantic: { role: "heading", level: 3 } },
        { id: "p", type: "text", origin: "added", text: "B" },
        { id: "q", type: "text", origin: "added", text: "C", name: "Price label" },
        { id: "i", type: "instance", origin: "added", componentId: "x", props: {}, children: [{ id: "s", type: "slot", origin: "added", slotName: "a", children: [{ id: "deep", type: "text", origin: "added", text: "no" }] }] },
      ],
    };
    expect(autoProps(tree).map((p) => p.name)).toEqual(["title", "text", "priceLabel"]);
  });

  it("guards against components containing themselves", () => {
    const { made, after } = withComponent();
    expect(placementError(after, made.componentId, made.componentId)).toBeDefined();
    expect(placementError(after, "f", made.componentId)).toBeUndefined();
  });
});

describe("instances", () => {
  it("get new elements after them, never inside", () => {
    const { made, after } = withComponent();
    const ops = insertOps(nodeContext(after, { frameId: "f", nodeId: made.instanceId })!, { id: "new", type: "text", origin: "added", text: "x" });
    const root = screen(apply(after, ops)).current as Extract<DesignNode, { type: "box" }>;
    expect(root.children.map((c) => c.id)).toEqual([made.instanceId, "new", "card"]);
  });

  it("detach into plain elements with the instance's values", () => {
    const { made, after } = withComponent();
    const withLabel = apply(after, [{ id: "o", frameId: "f", op: "setProps", nodeId: made.instanceId, props: { label: "Buy" } }]);
    const { ops, newId } = detachOps(withLabel, "f", made.instanceId);
    const detached = apply(withLabel, ops);
    const node = findNode(screen(detached).current, newId!)!.node as Extract<DesignNode, { type: "button" }>;
    expect(node.type).toBe("button");
    expect((node.children[0] as Extract<DesignNode, { type: "text" }>).text).toBe("Buy");
    expect(node.targetFrameId).toBe("f_other");
  });

  it("are detached when their component is deleted", () => {
    const { made, after } = withComponent();
    const second = apply(after, [{ id: "o", frameId: "f", op: "insert", parentId: "root", index: 0, node: { id: "i2", type: "instance", origin: "added", componentId: made.componentId, props: { label: "Two" }, children: [] } }]);
    const deleted = apply(second, deleteComponentOps(second, made.componentId));
    expect(deleted.frames.some((f) => f.id === made.componentId)).toBe(false);
    expect(deleted.board.items.some((i) => i.type === "frame" && i.frameId === made.componentId)).toBe(false);
    const texts: string[] = [];
    walk(screen(deleted).current, (n) => {
      expect(n.type).not.toBe("instance");
      if (n.type === "text") texts.push(n.text);
    });
    expect(texts).toContain("Two");
    expect(texts).toContain("Button");
  });
});

describe("properties and variants", () => {
  it("renames a property together with instance values and variant overrides", () => {
    const { made, after } = withComponent();
    let p = apply(after, addVariantOps(after, made.componentId, {}, ["primary", "ghost"]));
    const component = () => p.frames.find((f) => f.id === made.componentId)!;
    const rootId = component().current.id;
    p = apply(p, [
      { id: "o1", frameId: made.componentId, op: "restyle", nodeId: rootId, style: { background: "transparent" }, when: { prop: { name: "variant", value: "ghost" } } },
      { id: "o2", frameId: "f", op: "setProps", nodeId: made.instanceId, props: { variant: "ghost" } },
    ]);
    // a preview placement per non-default option
    expect(p.board.items.filter((i) => i.type === "frame" && i.frameId === made.componentId).map((i) => (i as { props?: unknown }).props)).toEqual([undefined, { variant: "ghost" }]);

    p = apply(p, renamePropOps(p, made.componentId, "variant", "look"));
    expect(component().component!.props.map((x) => x.name)).toEqual(["label", "opens", "look"]);
    const instance = findNode(screen(p).current, made.instanceId)!.node as Extract<DesignNode, { type: "instance" }>;
    expect(instance.props).toEqual({ look: "ghost" });
    expect(resolveProps(component().current, component().component!, { look: "ghost" }).style?.background).toBe("transparent");

    p = apply(p, removePropOps(p, made.componentId, "look"));
    expect(component().current.overrides).toBeUndefined();
    expect((findNode(screen(p).current, made.instanceId)!.node as Extract<DesignNode, { type: "instance" }>).props).toEqual({});
  });

  it("exposes fields with readable names", () => {
    const { made, after } = withComponent("card");
    const component = after.frames.find((f) => f.id === made.componentId)! as Frame & { component: NonNullable<Frame["component"]> };
    const card = component.current as Extract<DesignNode, { type: "box" }>;
    const def = exposeDef(component.component, card.children[1]!, "visible");
    expect(def.props.at(-1)).toMatchObject({ name: "show", type: "boolean", bindings: [{ nodeId: card.children[1]!.id, field: "visible" }] });
    expect(sourcesOf(after).get(made.componentId)?.name).toBe("Card");
  });
});
