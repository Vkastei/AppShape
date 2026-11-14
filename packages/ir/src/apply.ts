import { z } from "zod";
import { applyPatch, clone } from "./deep";
import type { Frame } from "./frame";
import { type Annotation, ATTR_KEYS, COMMON_ATTR_KEYS, type ContainerNode, type DesignNode, DesignNodeSchema } from "./node";
import type { Op, TreeOp } from "./ops";
import { type Condition, conditionKey, type Override } from "./style";
import { collectIds, containsId, findNode, isContainer, type NodeLocation } from "./tree";

export class OpError extends Error {
  readonly op: Op;
  constructor(op: Op, message: string) {
    super(`${op.op} ${op.id}: ${message}`);
    this.name = "OpError";
    this.op = op;
  }
}

/** The part of a frame that tree ops touch. */
export interface TreeHolder {
  current: DesignNode;
  annotations?: Annotation[];
}

/**
 * Applies ops in order and returns a new frame map. Input frames are never mutated.
 * Throws `OpError` on the first invalid op.
 */
export function applyOps(frames: ReadonlyMap<string, Frame>, ops: readonly Op[]): Map<string, Frame> {
  const result = new Map(frames);
  const owned = new Set<string>();
  for (const op of ops) {
    if (op.op === "createFrame") {
      if (op.frame.id !== op.frameId) throw new OpError(op, "frame.id must equal frameId");
      if (result.has(op.frameId)) throw new OpError(op, `frame ${op.frameId} already exists`);
      result.set(op.frameId, clone(op.frame));
      owned.add(op.frameId);
      continue;
    }
    const existing = result.get(op.frameId);
    if (!existing) throw new OpError(op, `unknown frame ${op.frameId}`);
    if (op.op === "deleteFrame") {
      result.delete(op.frameId);
      owned.delete(op.frameId);
      continue;
    }
    let frame = existing;
    if (!owned.has(op.frameId)) {
      frame = clone(existing);
      result.set(op.frameId, frame);
      owned.add(op.frameId);
    }
    if (op.op === "updateFrame") {
      if (op.patch.name !== undefined) frame.name = op.patch.name;
      if (op.patch.target !== undefined) frame.target = clone(op.patch.target);
      if (op.patch.viewports !== undefined) frame.viewports = clone(op.patch.viewports);
      if (op.patch.component !== undefined) {
        if (frame.kind !== "component") throw new OpError(op, "only component frames have a component definition");
        frame.component = clone(op.patch.component);
      }
      if (op.patch.theme === null) delete frame.theme;
      else if (op.patch.theme !== undefined) frame.theme = op.patch.theme;
      if (op.patch.meta === null) delete frame.meta;
      else if (op.patch.meta !== undefined) frame.meta = clone(op.patch.meta);
      if (op.patch.overlay === null) delete frame.overlay;
      else if (op.patch.overlay !== undefined) frame.overlay = true;
      if (op.patch.transition === null) delete frame.transition;
      else if (op.patch.transition !== undefined) frame.transition = op.patch.transition;
      continue;
    }
    applyTreeOpInPlace(frame, op);
  }
  return result;
}

/** Applies a single tree op, mutating `holder`. On error the holder may be partially modified. */
export function applyTreeOpInPlace(holder: TreeHolder, op: TreeOp): void {
  const locate = (id: string): NodeLocation => {
    const loc = findNode(holder.current, id);
    if (!loc) throw new OpError(op, `unknown node ${id}`);
    return loc;
  };
  const container = (id: string): ContainerNode => {
    const { node } = locate(id);
    if (!isContainer(node)) throw new OpError(op, `node ${id} (${node.type}) cannot have children`);
    return node;
  };
  const ofType = <T extends DesignNode["type"]>(id: string, type: T): Extract<DesignNode, { type: T }> => {
    const { node } = locate(id);
    if (node.type !== type) throw new OpError(op, `node ${id} is ${node.type}, expected ${type}`);
    return node as Extract<DesignNode, { type: T }>;
  };
  const checkIndex = (index: number, length: number) => {
    if (index > length) throw new OpError(op, `index ${index} out of range (0..${length})`);
  };
  const validate = (node: DesignNode) => {
    const parsed = DesignNodeSchema.safeParse(node);
    if (!parsed.success) throw new OpError(op, `invalid node ${node.id}: ${z.prettifyError(parsed.error)}`);
  };

  switch (op.op) {
    case "insert": {
      const parent = container(op.parentId);
      checkIndex(op.index, parent.children.length);
      validate(op.node);
      const existing = new Set(collectIds(holder.current));
      const incoming = collectIds(op.node);
      if (new Set(incoming).size !== incoming.length) throw new OpError(op, "inserted subtree has duplicate ids");
      const clash = incoming.find((id) => existing.has(id));
      if (clash) throw new OpError(op, `node id ${clash} already exists`);
      parent.children.splice(op.index, 0, clone(op.node));
      return;
    }
    case "delete": {
      const loc = locate(op.nodeId);
      if (!loc.parent) throw new OpError(op, "cannot delete the root node");
      loc.parent.children.splice(loc.index, 1);
      return;
    }
    case "move": {
      const loc = locate(op.nodeId);
      if (!loc.parent) throw new OpError(op, "cannot move the root node");
      if (containsId(loc.node, op.parentId)) throw new OpError(op, "cannot move a node into itself");
      const parent = container(op.parentId);
      loc.parent.children.splice(loc.index, 1);
      checkIndex(op.index, parent.children.length);
      parent.children.splice(op.index, 0, loc.node);
      return;
    }
    case "restyle": {
      const { node } = locate(op.nodeId);
      if (op.when) {
        editOverride(node, op.when, (o) => {
          o.style = applyPatch(o.style, op.style);
        });
      } else {
        setOrDelete(node, "style", applyPatch(node.style, op.style));
      }
      validate(node);
      return;
    }
    case "relayout": {
      const { node } = locate(op.nodeId);
      if (op.when) {
        editOverride(node, op.when, (o) => {
          if (op.layout) o.layout = applyPatch(o.layout, op.layout);
          if (op.box) o.box = applyPatch(o.box, op.box);
        });
      } else {
        if (op.layout) setOrDelete(node, "layout", applyPatch(node.layout, op.layout));
        if (op.box) setOrDelete(node, "box", applyPatch(node.box, op.box));
      }
      validate(node);
      return;
    }
    case "retext": {
      const node = ofType(op.nodeId, "text");
      node.text = op.text;
      setOrDelete(node, "spans", op.spans ? clone(op.spans) : undefined);
      validate(node);
      return;
    }
    case "replaceImage": {
      const node = ofType(op.nodeId, "image");
      node.src = op.src;
      if (op.alt === null) delete node.alt;
      else if (op.alt !== undefined) node.alt = op.alt;
      return;
    }
    case "setVisibility": {
      const { node } = locate(op.nodeId);
      if (op.when) {
        editOverride(node, op.when, (o) => {
          if (op.hidden === null) delete o.hidden;
          else o.hidden = op.hidden;
        });
      } else if (op.hidden) {
        node.hidden = true;
      } else {
        delete node.hidden;
      }
      return;
    }
    case "setLink": {
      const { node } = locate(op.nodeId);
      if (node.type !== "link" && node.type !== "button") throw new OpError(op, `node ${op.nodeId} is ${node.type}, expected link or button`);
      if (node.type === "button" && typeof op.href === "string") throw new OpError(op, "buttons link to screens, not URLs");
      if (node.type === "link") {
        if (op.href === null) delete node.href;
        else if (op.href !== undefined) node.href = op.href;
      }
      if (op.targetFrameId === null) delete node.targetFrameId;
      else if (op.targetFrameId !== undefined) node.targetFrameId = op.targetFrameId;
      return;
    }
    case "setProps": {
      const node = ofType(op.nodeId, "instance");
      node.props = applyPatch(node.props, op.props) ?? {};
      return;
    }
    case "swapComponent": {
      const node = ofType(op.nodeId, "instance");
      node.componentId = op.componentId;
      if (op.props) node.props = clone(op.props);
      return;
    }
    case "setAttrs": {
      const { node } = locate(op.nodeId);
      const allowed = new Set<string>([...ATTR_KEYS[node.type], ...COMMON_ATTR_KEYS]);
      const target = node as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.attrs)) {
        if (!allowed.has(key)) throw new OpError(op, `attribute ${key} is not editable on ${node.type} nodes`);
        if (value === null) delete target[key];
        else target[key] = clone(value);
      }
      validate(node);
      return;
    }
    case "setClasses": {
      const { node } = locate(op.nodeId);
      const raw = { ...node.platformRaw };
      if (op.unmapped?.length) raw.unmapped = [...op.unmapped];
      else delete raw.unmapped;
      if (op.tag) raw.tag = op.tag;
      else if (op.tag === null) delete raw.tag;
      if (Object.keys(raw).length > 0) node.platformRaw = raw;
      else delete node.platformRaw;
      return;
    }
    case "rename": {
      const { node } = locate(op.nodeId);
      if (op.name === null) delete node.name;
      else node.name = op.name;
      return;
    }
    case "annotate": {
      const owner = op.nodeId ? locate(op.nodeId).node : holder;
      const list = (owner.annotations ??= []);
      if (list.some((a) => a.id === op.annotation.id)) {
        throw new OpError(op, `annotation ${op.annotation.id} already exists`);
      }
      list.push(clone(op.annotation));
      return;
    }
    case "unannotate": {
      const owner = op.nodeId ? locate(op.nodeId).node : holder;
      const index = owner.annotations?.findIndex((a) => a.id === op.annotationId) ?? -1;
      if (index < 0) throw new OpError(op, `unknown annotation ${op.annotationId}`);
      owner.annotations!.splice(index, 1);
      if (owner.annotations!.length === 0) delete owner.annotations;
      return;
    }
  }
}

function setOrDelete<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function editOverride(node: DesignNode, when: Condition, edit: (override: Override) => void): void {
  const key = conditionKey(when);
  const overrides = (node.overrides ??= []);
  let override = overrides.find((o) => conditionKey(o.when) === key);
  if (!override) {
    override = { when: clone(when) };
    overrides.push(override);
  }
  edit(override);
  for (const field of ["layout", "box", "style"] as const) {
    if (override[field] === undefined) delete override[field];
  }
  const isEmpty = !override.layout && !override.box && !override.style && override.hidden === undefined;
  if (isEmpty) overrides.splice(overrides.indexOf(override), 1);
  if (overrides.length === 0) delete node.overrides;
}
