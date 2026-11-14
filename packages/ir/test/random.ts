import {
  type Annotation,
  collectIds,
  type DesignNode,
  type Frame,
  isContainer,
  type TreeOp,
  walk,
} from "../src";
import type { Rng } from "./helpers";

const COLORS = ["$color.gray-900", "$color.primary-600", "#ff0000", "$color.white"];
const SPACES = ["$spacing.2", "$spacing.4", "$spacing.6", 12];
const RADII = ["$radius.md", "$radius.xl", 4];
const CONDITIONS = [{ viewport: "md" }, { viewport: "lg" }, { state: "hover" as const }, { scheme: "dark" as const }];

export function randomTree(r: Rng, nextId: () => string, depth = 0): DesignNode {
  const id = nextId();
  const leaf = depth >= 3 || r.chance(0.35);
  if (leaf) {
    const kind = r.pick(["text", "image", "icon", "input"] as const);
    switch (kind) {
      case "text":
        return { id, type: "text", origin: "imported", text: `text ${id}`, ...(r.chance(0.5) && { style: { color: r.pick(COLORS) } }) };
      case "image":
        return { id, type: "image", origin: "imported", src: `https://example.com/${id}.png`, alt: id };
      case "icon":
        return { id, type: "icon", origin: "imported", icon: "check", set: "lucide" };
      case "input":
        return { id, type: "input", origin: "imported", inputType: "text", placeholder: "Type…" };
    }
  }
  const kind = r.pick(["box", "box", "link", "list", "instance", "button"] as const);
  const children = Array.from({ length: r.int(4) }, () => randomTree(r, nextId, depth + 1));
  const common = {
    id,
    origin: "imported" as const,
    children,
    ...(r.chance(0.6) && { layout: { mode: "flex" as const, direction: r.pick(["row", "column"] as const), gap: r.pick(SPACES) } }),
    ...(r.chance(0.5) && { style: { background: r.pick(COLORS), radius: r.pick(RADII) } }),
    ...(r.chance(0.2) && { overrides: [{ when: r.pick(CONDITIONS), style: { background: r.pick(COLORS) } }] }),
  };
  switch (kind) {
    case "box":
    case "button":
    case "list":
      return { ...common, type: kind };
    case "link":
      return { ...common, type: "link", href: "/somewhere" };
    case "instance":
      return { ...common, type: "instance", componentId: "cmp_card", props: { title: "Hello", count: 1 } };
  }
}

/** Generates a random op that is likely (not guaranteed) to be valid for `frame`. */
export function randomOp(r: Rng, frame: Frame, nextNodeId: () => string, nextOpId: () => string): TreeOp {
  const nodes: DesignNode[] = [];
  walk(frame.current, (n) => {
    nodes.push(n);
  });
  const containers = nodes.filter(isContainer);
  const root = frame.current;
  const nonRoot = nodes.filter((n) => n !== root);
  const any = () => r.pick(nodes);
  const base = { id: nextOpId(), frameId: frame.id };
  const scope = r.chance(0.3) ? { scope: r.pick(["instance", "component"] as const) } : {};

  switch (r.int(14)) {
    case 0:
    case 1: {
      const parent = r.pick(containers.length ? containers : [root]);
      const length = isContainer(parent) ? parent.children.length : 0;
      const node = randomTree(r, nextNodeId, 2);
      walk(node, (n) => {
        n.origin = "added";
      });
      return { ...base, op: "insert", parentId: parent.id, index: r.int(length + 1), node, ...scope };
    }
    case 2:
      return { ...base, op: "delete", nodeId: (nonRoot.length ? r.pick(nonRoot) : root).id, ...scope };
    case 3:
    case 4: {
      const node = nonRoot.length ? r.pick(nonRoot) : root;
      const forbidden = new Set(collectIds(node));
      const targets = containers.filter((c) => !forbidden.has(c.id));
      const parent = targets.length ? r.pick(targets) : root;
      const length = isContainer(parent) ? parent.children.length : 0;
      return { ...base, op: "move", nodeId: node.id, parentId: parent.id, index: r.int(length + 1), ...scope };
    }
    case 5:
    case 6:
      return {
        ...base,
        op: "restyle",
        nodeId: any().id,
        style: r.chance(0.3) ? { background: null } : { background: r.pick(COLORS), shadow: r.chance(0.5) ? "$shadow.md" : null },
        ...(r.chance(0.3) && { when: r.pick(CONDITIONS) }),
        ...scope,
      };
    case 7:
      return {
        ...base,
        op: "relayout",
        nodeId: any().id,
        ...(r.chance(0.7) ? { layout: { mode: "flex", gap: r.pick(SPACES) } } : {}),
        box: { width: r.chance(0.5) ? { mode: "fill" } : null },
        ...(r.chance(0.3) && { when: r.pick(CONDITIONS) }),
        ...scope,
      };
    case 8: {
      const texts = nodes.filter((n) => n.type === "text");
      return { ...base, op: "retext", nodeId: (texts.length ? r.pick(texts) : any()).id, text: `changed ${r.int(100)}`, ...scope };
    }
    case 9:
      return {
        ...base,
        op: "setVisibility",
        nodeId: any().id,
        hidden: r.chance(0.15) ? null : r.chance(0.6),
        ...(r.chance(0.3) && { when: r.pick(CONDITIONS) }),
        ...scope,
      };
    case 10:
      return { ...base, op: "rename", nodeId: any().id, name: r.chance(0.8) ? `Name ${r.int(10)}` : null };
    case 11: {
      const node = any();
      if (node.annotations?.length && r.chance(0.5)) {
        return { ...base, op: "unannotate", nodeId: node.id, annotationId: r.pick(node.annotations).id };
      }
      const annotation: Annotation = { id: `a_${base.id}`, kind: "intent", text: "Opens a modal" };
      return { ...base, op: "annotate", nodeId: node.id, annotation };
    }
    case 12: {
      const instances = nodes.filter((n) => n.type === "instance");
      const node = instances.length ? r.pick(instances) : any();
      return r.chance(0.5)
        ? { ...base, op: "setProps", nodeId: node.id, props: { title: r.chance(0.5) ? "New title" : null, variant: "primary" }, ...scope }
        : { ...base, op: "swapComponent", nodeId: node.id, componentId: r.pick(["cmp_card", "cmp_tile"]), props: { size: "lg" }, ...scope };
    }
    default: {
      const node = any();
      return {
        ...base,
        op: "setAttrs",
        nodeId: node.id,
        attrs: node.type === "image" ? { fit: r.pick(["cover", "contain"]) } : { semantic: r.chance(0.5) ? { role: "section" } : null },
        ...scope,
      };
    }
  }
}
