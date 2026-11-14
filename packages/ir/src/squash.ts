import { applyOps } from "./apply";
import { deepEqual } from "./deep";
import { annotationOps, type DiffOptions, diffTree } from "./diff";
import type { Frame } from "./frame";
import { createId } from "./ids";
import { type Op, SCOPED_OPS, type Scope } from "./ops";

const scopedOps: ReadonlySet<string> = new Set(SCOPED_OPS);

/**
 * Ops that turn frame `before` into frame `after` (either may be undefined = frame absent):
 * `createFrame`, `deleteFrame`, or `updateFrame` + tree diff + frame annotation changes.
 */
export function diffFrame(
  frameId: string,
  before: Frame | undefined,
  after: Frame | undefined,
  options: DiffOptions = {},
): Op[] {
  const newOpId = options.createOpId ?? (() => createId("op"));
  if (!before && !after) return [];
  if (!after) return [{ id: newOpId(), frameId, op: "deleteFrame" }];

  const recreated =
    before &&
    (before.current.id !== after.current.id ||
      before.kind !== after.kind ||
      before.platform !== after.platform ||
      !deepEqual(before.baseline, after.baseline) ||
      !deepEqual(before.capture, after.capture));
  if (!before || recreated) {
    return [
      ...(recreated ? [{ id: newOpId(), frameId, op: "deleteFrame" as const }] : []),
      { id: newOpId(), frameId, op: "createFrame", frame: after },
    ];
  }

  const result: Op[] = [];
  const patch: Extract<Op, { op: "updateFrame" }>["patch"] = {};
  if (before.name !== after.name) patch.name = after.name;
  if (!deepEqual(before.target, after.target)) patch.target = after.target;
  if (!deepEqual(before.viewports, after.viewports)) patch.viewports = after.viewports;
  if (!deepEqual(before.component, after.component)) patch.component = after.component;
  if (before.theme !== after.theme) patch.theme = after.theme ?? null;
  if (!deepEqual(before.meta, after.meta)) patch.meta = after.meta ?? null;
  if (before.overlay !== after.overlay) patch.overlay = after.overlay ? true : null;
  if (before.transition !== after.transition) patch.transition = after.transition ?? null;
  if (Object.keys(patch).length > 0) result.push({ id: newOpId(), frameId, op: "updateFrame", patch });
  result.push(...diffTree(frameId, before.current, after.current, { createOpId: newOpId }));
  result.push(...annotationOps(frameId, undefined, before.annotations, after.annotations, newOpId));
  return result;
}

/**
 * Collapses an op log into the minimal ops with the same effect, per frame:
 * created-then-deleted frames vanish, created frames become one `createFrame`, edited frames
 * become a diff. The `scope` recorded on the original ops is carried over per node.
 */
export function squash(ops: readonly Op[], frames: ReadonlyMap<string, Frame>, options: DiffOptions = {}): Op[] {
  const byFrame = new Map<string, Op[]>();
  for (const op of ops) {
    const list = byFrame.get(op.frameId) ?? [];
    list.push(op);
    byFrame.set(op.frameId, list);
  }

  const result: Op[] = [];
  for (const [frameId, frameOps] of byFrame) {
    const before = frames.get(frameId);
    const start = new Map<string, Frame>(before ? [[frameId, before]] : []);
    const after = applyOps(start, frameOps).get(frameId);
    const scopes = scopeByNode(frameOps);
    for (const op of diffFrame(frameId, before, after, options)) {
      const nodeId = op.op === "insert" ? op.node.id : "nodeId" in op ? op.nodeId : undefined;
      const scope = nodeId !== undefined && scopedOps.has(op.op) ? scopes.get(nodeId) : undefined;
      result.push(scope ? ({ ...op, scope } as Op) : op);
    }
  }
  return result;
}

function scopeByNode(ops: readonly Op[]): Map<string, Scope> {
  const scopes = new Map<string, Scope>();
  for (const op of ops) {
    if (!("scope" in op) || !op.scope) continue;
    scopes.set(op.op === "insert" ? op.node.id : op.nodeId, op.scope);
  }
  return scopes;
}
