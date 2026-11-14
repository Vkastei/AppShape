import { applyTreeOpInPlace, type TreeHolder } from "./apply";
import { clone, deepEqual, diffObject } from "./deep";
import { createId } from "./ids";
import type { JsonValue } from "./json";
import { type Annotation, ATTR_KEYS, COMMON_ATTR_KEYS, type ContainerNode, type DesignNode } from "./node";
import type { TreeOp } from "./ops";
import { conditionKey, type Override } from "./style";
import { findNode, indexTree, isContainer, normalizeNode, walk } from "./tree";

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffError";
  }
}

export interface DiffOptions {
  createOpId?: () => string;
}

/**
 * Computes ops that turn `baseline` into `current` (both trees of one frame, same id space).
 * Applying the result to `baseline` in order yields a tree equal to `current` after normalization.
 *
 * Order: deletes → structure (inserts/moves, parents first) → deletes of emptied containers →
 * property edits. Moves are minimized with an LCS over each parent's surviving children.
 */
export function diffTree(
  frameId: string,
  baseline: DesignNode,
  current: DesignNode,
  options: DiffOptions = {},
): TreeOp[] {
  const newOpId = options.createOpId ?? (() => createId("op"));
  if (baseline.id !== current.id) {
    throw new DiffError(`root id changed (${baseline.id} → ${current.id})`);
  }
  const base = indexTree(baseline);
  const cur = indexTree(current);
  for (const [id, loc] of cur) {
    const before = base.get(id);
    if (before && before.node.type !== loc.node.type) {
      throw new DiffError(`node ${id} changed type (${before.node.type} → ${loc.node.type})`);
    }
  }
  const survives = (id: string) => base.has(id) && cur.has(id);
  const hasSurvivorBelow = (node: DesignNode) => {
    let found = false;
    walk(node, (n) => {
      if (found) return "skip";
      if (n !== node && survives(n.id)) found = true;
    });
    return found;
  };

  const work: TreeHolder = { current: clone(baseline) };
  const ops: TreeOp[] = [];
  const emit = (op: TreeOp) => {
    applyTreeOpInPlace(work, op);
    ops.push(op);
  };

  // 1. Delete removed subtrees that contain nothing that survives. Removed nodes that still
  //    hold survivors are deleted after the survivors have moved out (step 3).
  const deferred: string[] = [];
  walk(baseline, (node, parent) => {
    if (survives(node.id)) return;
    if (parent && !survives(parent.id)) return; // handled by an ancestor
    if (hasSurvivorBelow(node)) {
      deferred.push(node.id);
      return;
    }
    emit({ id: newOpId(), frameId, op: "delete", nodeId: node.id });
    return "skip";
  });

  // 2. Structure: walk the target tree parents-first and place each child after its predecessor.
  const deepInserted = new Set<string>();
  const placeChildren = (target: ContainerNode) => {
    const workParent = findNode(work.current, target.id)?.node as ContainerNode;
    const finalIds = target.children.map((c) => c.id);
    const sameParent = new Set(finalIds.filter((id) => base.get(id)?.parent?.id === target.id && survives(id)));
    const workOrder = workParent.children.map((c) => c.id).filter((id) => sameParent.has(id));
    const finalOrder = finalIds.filter((id) => sameParent.has(id));
    const stable = new Set(lcs(workOrder, finalOrder));

    target.children.forEach((child, i) => {
      if (stable.has(child.id)) return;
      const prevId = i > 0 ? finalIds[i - 1] : undefined;
      const indexAfter = (siblings: DesignNode[]) =>
        prevId === undefined ? 0 : siblings.findIndex((s) => s.id === prevId) + 1;

      if (!base.has(child.id)) {
        const shallow = hasSurvivorBelow(child);
        const node = shallow && isContainer(child) ? clone({ ...child, children: [] }) : clone(child);
        if (!shallow) deepInserted.add(child.id);
        emit({ id: newOpId(), frameId, op: "insert", parentId: target.id, index: indexAfter(workParent.children), node });
        return;
      }
      const loc = findNode(work.current, child.id)!;
      const siblings = workParent.children.filter((s) => s.id !== child.id);
      const index = indexAfter(siblings);
      if (loc.parent?.id === target.id && loc.index === index) return;
      emit({ id: newOpId(), frameId, op: "move", nodeId: child.id, parentId: target.id, index });
    });

    for (const child of target.children) {
      if (isContainer(child) && !deepInserted.has(child.id)) placeChildren(child);
    }
  };
  if (isContainer(current)) placeChildren(current);

  // 3. Delete removed containers whose survivors have moved out.
  for (const nodeId of deferred) emit({ id: newOpId(), frameId, op: "delete", nodeId });

  // 4. Property edits on surviving nodes.
  walk(current, (node) => {
    if (deepInserted.has(node.id)) return "skip";
    const before = base.get(node.id)?.node;
    if (before) for (const op of propertyOps(frameId, before, node, newOpId)) emit(op);
  });

  if (!deepEqual(normalizeNode(work.current), normalizeNode(current))) {
    throw new DiffError("internal error: diff does not reproduce the current tree");
  }
  return ops;
}

function propertyOps(frameId: string, before: DesignNode, after: DesignNode, newOpId: () => string): TreeOp[] {
  const ops: TreeOp[] = [];
  const base = () => ({ id: newOpId(), frameId, nodeId: after.id });

  if ((before.name ?? null) !== (after.name ?? null)) {
    ops.push({ ...base(), op: "rename", name: after.name ?? null });
  }
  const style = diffObject(before.style, after.style);
  if (style) ops.push({ ...base(), op: "restyle", style });
  const layout = diffObject(before.layout, after.layout);
  const box = diffObject(before.box, after.box);
  if (layout || box) ops.push({ ...base(), op: "relayout", ...(layout && { layout }), ...(box && { box }) });
  if ((before.hidden ?? false) !== (after.hidden ?? false)) {
    ops.push({ ...base(), op: "setVisibility", hidden: after.hidden ?? false });
  }
  ops.push(...overrideOps(before.overrides, after.overrides, base));

  if (before.type === "text" && after.type === "text") {
    if (before.text !== after.text || !deepEqual(before.spans ?? [], after.spans ?? [])) {
      ops.push({ ...base(), op: "retext", text: after.text, ...(after.spans?.length ? { spans: clone(after.spans) } : {}) });
    }
  }
  if (before.type === "image" && after.type === "image") {
    if (before.src !== after.src || before.alt !== after.alt) {
      ops.push({ ...base(), op: "replaceImage", src: after.src, alt: after.alt ?? null });
    }
  }
  if (before.type === "link" && after.type === "link") {
    if (before.href !== after.href || before.targetFrameId !== after.targetFrameId) {
      ops.push({ ...base(), op: "setLink", href: after.href ?? null, targetFrameId: after.targetFrameId ?? null });
    }
  }
  if (before.type === "button" && after.type === "button" && before.targetFrameId !== after.targetFrameId) {
    ops.push({ ...base(), op: "setLink", targetFrameId: after.targetFrameId ?? null });
  }
  if (before.type === "instance" && after.type === "instance") {
    if (before.componentId !== after.componentId) {
      ops.push({ ...base(), op: "swapComponent", componentId: after.componentId, props: clone(after.props) });
    } else {
      const props = diffObject(before.props, after.props);
      if (props) ops.push({ ...base(), op: "setProps", props: props as Record<string, JsonValue> });
    }
  }
  const attrKeys = [...ATTR_KEYS[after.type], ...COMMON_ATTR_KEYS];
  const pick = (node: DesignNode) =>
    Object.fromEntries(attrKeys.map((k) => [k, (node as unknown as Record<string, unknown>)[k]]));
  const attrs = diffObject(pick(before), pick(after));
  if (attrs) ops.push({ ...base(), op: "setAttrs", attrs: attrs as Record<string, JsonValue> });
  const tagChanged = (before.platformRaw?.tag ?? null) !== (after.platformRaw?.tag ?? null);
  if (tagChanged || !deepEqual(before.platformRaw?.unmapped ?? [], after.platformRaw?.unmapped ?? [])) {
    ops.push({ ...base(), op: "setClasses", unmapped: after.platformRaw?.unmapped?.length ? [...after.platformRaw.unmapped] : null, ...(tagChanged && { tag: after.platformRaw?.tag ?? null }) });
  }

  ops.push(...annotationOps(frameId, after.id, before.annotations, after.annotations, newOpId));
  return ops;
}

function overrideOps(
  before: Override[] | undefined,
  after: Override[] | undefined,
  base: () => { id: string; frameId: string; nodeId: string },
): TreeOp[] {
  const ops: TreeOp[] = [];
  const byKey = (list: Override[] | undefined) => new Map((list ?? []).map((o) => [conditionKey(o.when), o]));
  const left = byKey(before);
  const right = byKey(after);
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const b = left.get(key);
    const a = right.get(key);
    const when = clone((a ?? b)!.when);
    const style = diffObject(b?.style, a?.style);
    if (style) ops.push({ ...base(), op: "restyle", style, when });
    const layout = diffObject(b?.layout, a?.layout);
    const box = diffObject(b?.box, a?.box);
    if (layout || box) ops.push({ ...base(), op: "relayout", ...(layout && { layout }), ...(box && { box }), when });
    if (b?.hidden !== a?.hidden) {
      ops.push({ ...base(), op: "setVisibility", hidden: a?.hidden ?? null, when });
    }
  }
  return ops;
}

/** Annotation changes on a node (`nodeId`) or, when `nodeId` is undefined, on the frame. */
export function annotationOps(
  frameId: string,
  nodeId: string | undefined,
  before: Annotation[] | undefined,
  after: Annotation[] | undefined,
  newOpId: () => string,
): TreeOp[] {
  const ops: TreeOp[] = [];
  const target = nodeId === undefined ? {} : { nodeId };
  const left = before ?? [];
  const right = after ?? [];
  // `annotate` appends, so keep the longest prefix of `right` that appears in order (and
  // unchanged) in `left`; remove everything else and append the rest in target order.
  const kept = new Set<string>();
  let j = 0;
  for (const annotation of right) {
    while (j < left.length && left[j]!.id !== annotation.id) j++;
    if (j >= left.length || !deepEqual(left[j], annotation)) break;
    kept.add(annotation.id);
    j++;
  }
  for (const annotation of left) {
    if (!kept.has(annotation.id)) ops.push({ id: newOpId(), frameId, op: "unannotate", ...target, annotationId: annotation.id });
  }
  for (const annotation of right) {
    if (!kept.has(annotation.id)) ops.push({ id: newOpId(), frameId, op: "annotate", ...target, annotation: clone(annotation) });
  }
  return ops;
}

/** Longest common subsequence of two id lists. */
export function lcs(a: readonly string[], b: readonly string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}
