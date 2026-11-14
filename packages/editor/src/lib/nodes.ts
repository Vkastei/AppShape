import {
  type ContainerNode,
  createId,
  type DesignNode,
  findNode,
  type Frame,
  isContainer,
  type Op,
  type Project,
  walk,
} from "@appshape/ir";
import { newOpId } from "./board";

/** Pure helpers that turn element edits into frame ops. */

export interface NodeRef {
  frameId: string;
  nodeId: string;
}

export interface NodeContext {
  frame: Frame;
  node: DesignNode;
  parent: ContainerNode | undefined;
  index: number;
}

export function nodeContext(project: Project, ref: NodeRef): NodeContext | undefined {
  const frame = project.frames.find((f) => f.id === ref.frameId);
  const loc = frame && findNode(frame.current, ref.nodeId);
  return frame && loc ? { frame, node: loc.node, parent: loc.parent, index: loc.index } : undefined;
}

/** Deep copy with fresh ids; the copy is new design, so it drops capture metadata. */
export function cloneWithNewIds(node: DesignNode): DesignNode {
  const copy = structuredClone(node);
  walk(copy, (n) => {
    n.id = createId("n");
    n.origin = "added";
    delete n.source;
    delete n.redacted;
    if (n.platformRaw?.tag) n.platformRaw = { tag: n.platformRaw.tag };
    else delete n.platformRaw;
    if (n.annotations) n.annotations = n.annotations.map((a) => ({ ...a, id: createId("a") }));
  });
  return copy;
}

const op = <T extends Omit<Op, "id">>(o: T) => ({ id: newOpId(), ...o }) as unknown as Op;

/**
 * Whether new elements can go into a node. Instances can't: their children are slot fills, and
 * their content comes from the component.
 */
export function acceptsChildren(node: DesignNode): node is ContainerNode {
  return isContainer(node) && node.type !== "instance";
}

/** Where a new element goes: into the selected container, or after the selected element. */
export function insertTarget(ctx: NodeContext): { parentId: string; index: number } | undefined {
  if (acceptsChildren(ctx.node)) return { parentId: ctx.node.id, index: ctx.node.children.length };
  return ctx.parent ? { parentId: ctx.parent.id, index: ctx.index + 1 } : undefined;
}

export function insertOps(ctx: NodeContext, node: DesignNode): Op[] {
  const target = insertTarget(ctx);
  return target ? [op({ frameId: ctx.frame.id, op: "insert", parentId: target.parentId, index: target.index, node })] : [];
}

export function deleteOps(ctx: NodeContext): Op[] {
  return ctx.parent ? [op({ frameId: ctx.frame.id, op: "delete", nodeId: ctx.node.id })] : [];
}

export function duplicateOps(ctx: NodeContext): { ops: Op[]; newId?: string } {
  if (!ctx.parent) return { ops: [] };
  const copy = cloneWithNewIds(ctx.node);
  return { ops: [op({ frameId: ctx.frame.id, op: "insert", parentId: ctx.parent.id, index: ctx.index + 1, node: copy })], newId: copy.id };
}

/** Wraps the element in a new vertical stack at its position. */
export function wrapOps(ctx: NodeContext): { ops: Op[]; newId?: string } {
  if (!ctx.parent) return { ops: [] };
  const wrapper: DesignNode = { id: createId("n"), type: "box", origin: "added", layout: { mode: "flex", direction: "column" }, children: [] };
  return {
    ops: [
      op({ frameId: ctx.frame.id, op: "insert", parentId: ctx.parent.id, index: ctx.index, node: wrapper }),
      op({ frameId: ctx.frame.id, op: "move", nodeId: ctx.node.id, parentId: wrapper.id, index: 0 }),
    ],
    newId: wrapper.id,
  };
}

/** Replaces a container by its children. */
export function unwrapOps(ctx: NodeContext): Op[] {
  if (!ctx.parent || !acceptsChildren(ctx.node)) return [];
  const moves = ctx.node.children.map((child, i) =>
    op({ frameId: ctx.frame.id, op: "move", nodeId: child.id, parentId: ctx.parent!.id, index: ctx.index + 1 + i }),
  );
  return [...moves, op({ frameId: ctx.frame.id, op: "delete", nodeId: ctx.node.id })];
}

/** Moves the element one step among its siblings. */
export function moveSiblingOps(ctx: NodeContext, delta: -1 | 1): Op[] {
  if (!ctx.parent) return [];
  const index = ctx.index + delta;
  if (index < 0 || index >= ctx.parent.children.length) return [];
  return [op({ frameId: ctx.frame.id, op: "move", nodeId: ctx.node.id, parentId: ctx.parent.id, index })];
}

/** Moves a node to `index` in `parentId` (index counted after removing the node). */
export function moveToOps(project: Project, ref: NodeRef, parentId: string, index: number): Op[] {
  const ctx = nodeContext(project, ref);
  if (!ctx?.parent) return [];
  const parent = findNode(ctx.frame.current, parentId)?.node;
  if (!parent || !acceptsChildren(parent) || findNode(ctx.node, parentId)) return [];
  if (ctx.parent.id === parentId && ctx.index === index) return [];
  return [op({ frameId: ctx.frame.id, op: "move", nodeId: ref.nodeId, parentId, index })];
}

/**
 * "Place beside": the dragged element goes next to `targetId` (in a vertical layout). Both end up in a
 * new row where the target was, spaced like the layout around them.
 */
export function besideOps(project: Project, ref: NodeRef, targetId: string, side: "before" | "after"): Op[] {
  const ctx = nodeContext(project, ref);
  const target = ctx && findNode(ctx.frame.current, targetId);
  if (!ctx?.parent || !target?.parent || targetId === ref.nodeId || findNode(ctx.node, targetId)) return [];
  const gap = target.parent.layout?.gap ?? target.parent.layout?.rowGap ?? "1rem";
  const row: DesignNode = { id: createId("n"), type: "box", origin: "added", name: "Row", layout: { mode: "flex", direction: "row", gap, align: "start" }, children: [] };
  const index = target.parent.children.findIndex((c) => c.id === targetId);
  return [
    op({ frameId: ctx.frame.id, op: "insert", parentId: target.parent.id, index, node: row }),
    op({ frameId: ctx.frame.id, op: "move", nodeId: targetId, parentId: row.id, index: 0 }),
    op({ frameId: ctx.frame.id, op: "move", nodeId: ref.nodeId, parentId: row.id, index: side === "before" ? 0 : 1 }),
  ];
}

/** A short human label for an element. */
export function nodeLabel(node: DesignNode, componentName?: (id: string) => string | undefined): string {
  if (node.name) return node.name;
  if (node.type === "instance") return componentName?.(node.componentId) ?? "Component";
  if (node.type === "text") {
    const text = node.text.trim();
    return text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : "Text";
  }
  const tag = node.platformRaw?.tag;
  const names: Record<string, string> = { box: "Stack", button: "Button", link: "Link", image: "Image", icon: "Icon", input: "Input", list: "List", scroll: "Scroll", slot: "Slot", element: "Element" };
  return tag && tag !== "div" ? `${names[node.type] ?? node.type} <${tag}>` : (names[node.type] ?? node.type);
}

/** Nodes from the root down to `id` (inclusive), or [] if not found. */
export function pathTo(root: DesignNode, id: string): DesignNode[] {
  if (root.id === id) return [root];
  if (!isContainer(root)) return [];
  for (const child of root.children) {
    const path = pathTo(child, id);
    if (path.length > 0) return [root, ...path];
  }
  return [];
}

const ATOMIC = new Set(["button", "link", "instance"]);

/**
 * What a click selects: the outermost button/link/component around the hit element, unless the
 * selection is already inside it, then the hit element itself (click again to drill in).
 */
export function clickTarget(root: DesignNode, hitId: string, selectedId: string | undefined): string {
  const path = pathTo(root, hitId);
  const atomic = path.find((n) => ATOMIC.has(n.type));
  if (!atomic) return hitId;
  const selectedInside = selectedId !== undefined && Boolean(findNode(atomic, selectedId));
  return selectedInside ? hitId : atomic.id;
}
