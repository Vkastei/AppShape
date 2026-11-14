import { describe, expect, it } from "vitest";
import {
  applyCommand,
  canPlaceInstance,
  componentSources,
  conditionKey,
  type DesignNode,
  diffFrame,
  expandInstance,
  findComponentProblems,
  type Frame,
  FrameSchema,
  type InstanceNode,
  invertCommand,
  navTargets,
  normalizeNode,
  propValues,
  resolveProps,
  walkRendered,
} from "../src";
import { box, text } from "./helpers";

function component(id: string, root: DesignNode, props: NonNullable<Frame["component"]>["props"] = []): Frame {
  return {
    id,
    name: id,
    kind: "component",
    platform: "web",
    target: { adapter: "react-vite" },
    viewports: [{ id: "component", width: 200 }],
    current: root,
    component: { props },
  };
}

function screen(id: string, root: DesignNode): Frame {
  return { id, name: id, kind: "new", platform: "web", target: { adapter: "react-vite", route: "/" }, viewports: [{ id: "desktop", width: 1280 }], current: root };
}

const instance = (id: string, componentId: string, props: InstanceNode["props"] = {}, extra: Partial<InstanceNode> = {}): InstanceNode => ({
  id,
  type: "instance",
  origin: "added",
  componentId,
  props,
  children: [],
  ...extra,
});

const buttonRoot = (): DesignNode => ({
  id: "b_root",
  type: "button",
  origin: "added",
  layout: { mode: "flex", padding: { top: 8 } },
  style: { background: "$color.indigo-600", color: "#fff" },
  overrides: [
    { when: { prop: { name: "variant", value: "secondary" } }, style: { background: "$color.white", color: "#111" } },
    { when: { prop: { name: "variant", value: "secondary" }, viewport: "md" }, style: { background: "$color.gray-100" } },
    { when: { viewport: "md" }, layout: { gap: 4 } },
  ],
  children: [text("b_label", "Click me"), { id: "b_icon", type: "icon", origin: "added", icon: "arrow-right" }],
});

const button = component("f_button", buttonRoot(), [
  { name: "label", type: "string", bindings: [{ nodeId: "b_label", field: "text" }] },
  { name: "showIcon", type: "boolean", bindings: [{ nodeId: "b_icon", field: "visible" }] },
  { name: "variant", type: "enum", options: ["primary", "secondary"] },
  { name: "opens", type: "string", bindings: [{ nodeId: "b_root", field: "target" }] },
]);

describe("component frames", () => {
  it("require a component definition, and only they have one", () => {
    expect(FrameSchema.safeParse(button).success).toBe(true);
    const { component: _, ...noDef } = button;
    expect(FrameSchema.safeParse(noDef).success).toBe(false);
    expect(FrameSchema.safeParse({ ...screen("s", box("r")), component: { props: [] } }).success).toBe(false);
  });

  it("reject duplicate property names and enums without options", () => {
    const dup = { ...button, component: { props: [{ name: "a", type: "string" as const }, { name: "a", type: "string" as const }] } };
    expect(FrameSchema.safeParse(dup).success).toBe(false);
    const enumless = { ...button, component: { props: [{ name: "v", type: "enum" as const }] } };
    expect(FrameSchema.safeParse(enumless).success).toBe(false);
  });

  it("key property conditions", () => {
    expect(conditionKey({ prop: { name: "variant", value: "secondary" }, viewport: "md" })).toBe("prop=variant:secondary&viewport=md");
  });
});

describe("resolveProps", () => {
  const def = button.component!;

  it("uses the component's own values as defaults", () => {
    expect(propValues(button.current, def, {})).toEqual({ label: "Click me", showIcon: true, variant: "primary", opens: null });
    expect(propValues(button.current, def, { label: "Buy" }).label).toBe("Buy");
  });

  it("applies bound values", () => {
    const tree = resolveProps(button.current, def, { label: "Buy now", showIcon: false, opens: "f_checkout" }) as Extract<DesignNode, { type: "button" }>;
    expect((tree.children[0] as Extract<DesignNode, { type: "text" }>).text).toBe("Buy now");
    expect(tree.children[1]!.hidden).toBe(true);
    expect(tree.targetFrameId).toBe("f_checkout");
    // the component itself is untouched
    const original = button.current as Extract<DesignNode, { type: "button" }>;
    expect((original.children[0] as Extract<DesignNode, { type: "text" }>).text).toBe("Click me");
    expect(original.targetFrameId).toBeUndefined();
  });

  it("drops overrides of other variants and keeps shared ones", () => {
    const tree = resolveProps(button.current, def, {});
    expect(tree.style?.background).toBe("$color.indigo-600");
    expect(tree.overrides).toEqual([{ when: { viewport: "md" }, layout: { gap: 4 } }]);
  });

  it("merges the matching variant into the base and narrows combined conditions", () => {
    const tree = resolveProps(button.current, def, { variant: "secondary" });
    expect(tree.style).toEqual({ background: "$color.white", color: "#111" });
    expect(tree.overrides).toEqual([
      { when: { viewport: "md" }, layout: { gap: 4 } },
      { when: { viewport: "md" }, style: { background: "$color.gray-100" } },
    ]);
  });
});

describe("expandInstance", () => {
  const sources = componentSources([button]);

  it("puts the instance's identity and placement on the component root", () => {
    const inst = instance("i1", "f_button", { label: "Go" }, { name: "Primary CTA", box: { width: { mode: "fill" } }, style: { radius: 8 } });
    const { root } = expandInstance(inst, sources.get("f_button")!);
    expect(root.id).toBe("i1");
    expect(root.type).toBe("button");
    expect(root.name).toBe("Primary CTA");
    expect(root.box).toEqual({ width: { mode: "fill" } });
    expect(root.style).toEqual({ background: "$color.indigo-600", color: "#fff", radius: 8 });
    expect(((root as Extract<DesignNode, { type: "button" }>).children[0] as Extract<DesignNode, { type: "text" }>).text).toBe("Go");
  });

  it("fills slots with the instance's own nodes", () => {
    const card = component("f_card", box("c_root", [text("c_title", "Title"), { id: "c_body", type: "slot", origin: "added", slotName: "body", layout: { mode: "flex", gap: 8 }, children: [text("c_default", "Default")] }]));
    const fill: DesignNode = { id: "s_fill", type: "slot", origin: "added", slotName: "body", style: { color: "red" }, children: [text("s_text", "Mine")] };
    const inst = instance("i2", "f_card", {}, { children: [fill] });
    const { root, fills } = expandInstance(inst, componentSources([card]).get("f_card")!);
    const slot = (root as Extract<DesignNode, { type: "box" }>).children[1]!;
    expect(fills.has(slot)).toBe(true);
    expect(slot.id).toBe("s_fill");
    expect(slot.layout).toEqual({ mode: "flex", gap: 8 });
    expect(slot.style).toEqual({ color: "red" });
    expect((slot as Extract<DesignNode, { type: "slot" }>).children).toBe((fill as Extract<DesignNode, { type: "slot" }>).children);

    const unfilled = expandInstance(instance("i3", "f_card"), componentSources([card]).get("f_card")!);
    expect(unfilled.fills.size).toBe(0);
    const unfilledSlot = (unfilled.root as Extract<DesignNode, { type: "box" }>).children[1] as Extract<DesignNode, { type: "slot" }>;
    expect(unfilledSlot.children[0]!.id).toBe("c_default");
  });
});

describe("rendered walk", () => {
  const card = component(
    "f_card",
    box("c_root", [
      instance("c_btn", "f_button", { opens: "f_pricing" }),
      { id: "c_slot", type: "slot", origin: "added", slotName: "body", children: [] },
    ]),
  );
  const page = screen(
    "f_home",
    box("h_root", [
      instance("h_card", "f_card", {}, { children: [{ id: "h_fill", type: "slot", origin: "added", slotName: "body", children: [{ id: "h_link", type: "link", origin: "added", targetFrameId: "f_about", children: [text("h_t", "About")] }] }] }),
      instance("h_btn", "f_button", { opens: "f_contact" }),
    ]),
  );
  const sources = componentSources([button, card, page]);

  it("scopes ids inside instances and keeps slot fills real", () => {
    const ids: string[] = [];
    walkRendered(page.current, sources, (_node, id) => {
      ids.push(id);
    });
    expect(ids).toEqual(["h_root", "h_card", "h_card/c_btn", "h_card/c_btn/b_label", "h_card/c_btn/b_icon", "h_fill", "h_link", "h_t", "h_btn", "h_btn/b_label", "h_btn/b_icon"]);
  });

  it("finds navigation through instances and slots", () => {
    expect(navTargets(page.current, sources)).toEqual([
      { elementId: "h_card/c_btn", targetFrameId: "f_pricing", sharedKey: "cmp:c_btn" },
      { elementId: "h_link", targetFrameId: "f_about" },
      { elementId: "h_btn", targetFrameId: "f_contact" },
    ]);
  });

  it("detects cycles", () => {
    expect(canPlaceInstance(sources, "f_home", "f_card")).toBe(true);
    expect(canPlaceInstance(sources, "f_button", "f_card")).toBe(false);
    expect(canPlaceInstance(sources, "f_card", "f_card")).toBe(false);
    const loop = component("f_loop", box("l_root", [instance("l_self", "f_loop")]));
    const looped = componentSources([loop]);
    const ids: string[] = [];
    walkRendered(loop.current, looped, (_n, id) => {
      ids.push(id);
    }, "f_loop");
    expect(ids).toEqual(["l_root", "l_self"]); // not expanded again
    expect(findComponentProblems([loop]).map((p) => p.message)).toEqual(["component f_loop contains itself"]);
  });

  it("reports unknown components and dangling bindings", () => {
    const broken = component("f_broken", text("x_root", "Hi"), [{ name: "missing", type: "string", bindings: [{ nodeId: "nope", field: "text" }] }]);
    const user = screen("f_user", box("u_root", [instance("u_1", "f_gone"), instance("u_2", "c_catalog")]));
    expect(findComponentProblems([broken, user], new Set(["c_catalog"])).map((p) => p.message)).toEqual([
      "property missing is bound to missing node nope",
      "instance u_1 uses unknown component f_gone",
    ]);
  });
});

describe("component definition edits", () => {
  it("are diffed and undone through updateFrame", () => {
    const before = { board: { items: [] }, frames: new Map([[button.id, button]]) };
    const ops = [{ id: "o1", frameId: button.id, op: "updateFrame" as const, patch: { component: { description: "CTA", props: [] } } }];
    const after = applyCommand(before, ops);
    expect(after.frames.get(button.id)!.component).toEqual({ description: "CTA", props: [] });
    const inverse = invertCommand(before, ops);
    const restored = applyCommand(after, inverse);
    expect(restored.frames.get(button.id)!.component).toEqual(button.component);
    expect(diffFrame(button.id, button, after.frames.get(button.id))).toHaveLength(1);
  });

  it("are refused on screens", () => {
    const s = screen("s", box("r"));
    expect(() => applyCommand({ board: { items: [] }, frames: new Map([["s", s]]) }, [{ id: "o", frameId: "s", op: "updateFrame", patch: { component: { props: [] } } }])).toThrow(/only component frames/);
  });

  it("keep variant overrides through op application", () => {
    const frames = new Map([[button.id, button]]);
    const when = { prop: { name: "variant", value: "secondary" } };
    const next = applyCommand({ board: { items: [] }, frames }, [{ id: "o", frameId: button.id, op: "restyle", nodeId: "b_root", style: { radius: 99 }, when }]);
    const root = normalizeNode(next.frames.get(button.id)!.current);
    expect(root.overrides?.find((o) => conditionKey(o.when) === conditionKey(when))?.style).toEqual({ background: "$color.white", color: "#111", radius: 99 });
  });
});
