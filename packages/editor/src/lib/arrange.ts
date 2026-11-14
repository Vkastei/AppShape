import { type AnyOp, type ContainerNode, findNode, type Frame, type Op, type Project } from "@appshape/ir";
import { type NodeSelection, useEditor } from "../store";
import { moveOps, newOpId } from "./board";
import { frameHandle } from "./frames";
import { itemBounds, type Rect, type Sizes } from "./geometry";
import { editCondition, freeMoveOps, placementsOf } from "./edits";
import { forCopies } from "./linked";

/**
 * Align and distribute: board items and elements placed freely move (geometry); elements in an auto
 * layout get the layout's own alignment instead (align self, the container's distribution), so the
 * result stays responsive.
 */

export type AlignHow = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type ArrangeAction = { kind: "align"; how: AlignHow } | { kind: "distribute"; axis: "x" | "y" };

export interface Delta {
  dx: number;
  dy: number;
}

/** How far each rect moves to line up with the others (on the outermost edge, or the middle of all). */
export function alignDeltas(rects: Rect[], how: AlignHow): Delta[] {
  if (rects.length === 0) return [];
  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return rects.map((r) => {
    switch (how) {
      case "left":
        return { dx: left - r.x, dy: 0 };
      case "right":
        return { dx: right - (r.x + r.w), dy: 0 };
      case "hcenter":
        return { dx: (left + right) / 2 - (r.x + r.w / 2), dy: 0 };
      case "top":
        return { dx: 0, dy: top - r.y };
      case "bottom":
        return { dx: 0, dy: bottom - (r.y + r.h) };
      case "vcenter":
        return { dx: 0, dy: (top + bottom) / 2 - (r.y + r.h / 2) };
    }
  });
}

/** Equal gaps between the rects along an axis; the first and the last stay where they are. */
export function distributeDeltas(rects: Rect[], axis: "x" | "y"): Delta[] {
  const deltas = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return deltas;
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const size = (r: Rect) => (axis === "x" ? r.w : r.h);
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => pos(a.r) - pos(b.r));
  const first = order[0]!.r;
  const last = order.at(-1)!.r;
  const total = pos(last) + size(last) - pos(first);
  const gap = (total - order.reduce((sum, o) => sum + size(o.r), 0)) / (order.length - 1);
  let at = pos(first);
  for (const { r, i } of order) {
    const d = at - pos(r);
    deltas[i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    at += size(r) + gap;
  }
  return deltas;
}

const applyAction = (rects: Rect[], action: ArrangeAction) => (action.kind === "align" ? alignDeltas(rects, action.how) : distributeDeltas(rects, action.axis));

/** Align or distribute board items (screens, notes, pictures, …). */
export function arrangeBoardOps(project: Project, ids: readonly string[], sizes: Sizes, action: ArrangeAction): AnyOp[] {
  const frames = new Map(project.frames.map((f) => [f.id, f]));
  const items = ids.map((id) => project.board.items.find((i) => i.id === id)).filter((i) => i !== undefined && i.type !== "arrow");
  const placed = items.map((item) => ({ item: item!, rect: itemBounds(item!, frames, sizes) })).filter((p): p is { item: NonNullable<(typeof items)[number]>; rect: Rect } => p.rect !== undefined);
  const deltas = applyAction(
    placed.map((p) => p.rect),
    action,
  );
  return placed.flatMap((p, i) => moveOps(project, [p.item.id], Math.round(deltas[i]!.dx), Math.round(deltas[i]!.dy)));
}

/** How a set of elements can be arranged. */
export type NodeArrangement =
  | { mode: "free" }
  | { mode: "layout"; frame: Frame; parent: ContainerNode; direction: "row" | "column" | "grid" }
  | { mode: "none"; reason: string };

export function nodeArrangement(project: Project, sels: readonly NodeSelection[]): NodeArrangement {
  if (sels.length < 2) return { mode: "none", reason: "Select two or more elements (Shift-click)" };
  const found = sels.map((s) => {
    const frame = project.frames.find((f) => f.id === s.frameId);
    const loc = frame && findNode(frame.current, s.nodeId);
    return frame && loc?.parent ? { frame, node: loc.node, parent: loc.parent } : undefined;
  });
  if (found.some((f) => !f)) return { mode: "none", reason: "A screen itself can't be aligned inside it" };
  const all = found as NonNullable<(typeof found)[number]>[];
  const sameScreen = sels.every((s) => s.itemId === sels[0]!.itemId);
  const free = all.every((f) => f.parent.layout?.mode === "absolute" || placementsOf(f.node).length > 0);
  if (free) return sameScreen ? { mode: "free" } : { mode: "none", reason: "Elements placed freely line up within one screen" };
  const parent = all[0]!.parent;
  if (!all.every((f) => f.parent === parent) || !sameScreen) return { mode: "none", reason: "Select elements in the same container (or placed freely)" };
  const layout = parent.layout;
  if (layout?.mode === "grid") return { mode: "layout", frame: all[0]!.frame, parent, direction: "grid" };
  if (layout?.mode === "flex") return { mode: "layout", frame: all[0]!.frame, parent, direction: layout.direction === "column" ? "column" : "row" };
  return { mode: "none", reason: "Their container flows normally: make it a stack or a row to align its elements" };
}

const SELF: Partial<Record<AlignHow, "start" | "center" | "end">> = { left: "start", hcenter: "center", right: "end", top: "start", vcenter: "center", bottom: "end" };
const horizontal = (how: AlignHow) => how === "left" || how === "hcenter" || how === "right";

/**
 * What an action does in an auto layout: across the layout each element aligns itself; along it the
 * container distributes all its elements. Undefined when the layout can't do it.
 */
export function layoutActionHint(direction: "row" | "column" | "grid", action: ArrangeAction): string | undefined {
  const along = direction === "row" ? "x" : direction === "column" ? "y" : undefined;
  if (action.kind === "distribute") return action.axis === along ? "Spreads the container's elements evenly (Space between)" : undefined;
  const isAlong = (horizontal(action.how) ? "x" : "y") === along;
  if (direction === "grid" && horizontal(action.how)) return undefined;
  return isAlong ? "Moves every element of the container (its Distribute setting)" : "Aligns the selected elements in their container (Align self)";
}

/** Ops for an action on several elements (see `layoutActionHint` for elements in an auto layout). */
export function arrangeNodesOps(project: Project, sels: readonly NodeSelection[], action: ArrangeAction): Op[] {
  const arrangement = nodeArrangement(project, sels);
  const scope = useEditor.getState().codeScope;
  if (arrangement.mode === "free") {
    const zoom = useEditor.getState().camera.zoom;
    const rects = sels.map((s) => frameHandle(s.itemId)?.nodeRect(s.nodeId));
    if (rects.some((r) => !r)) return [];
    const deltas = applyAction(
      rects.map((r) => ({ x: r!.x, y: r!.y, w: r!.w, h: r!.h })),
      action,
    );
    return sels.flatMap((s, i) => {
      const { dx, dy } = deltas[i]!;
      return Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? [] : freeMoveOps(project, s, Math.round(dx / zoom), Math.round(dy / zoom));
    });
  }
  if (arrangement.mode !== "layout" || !layoutActionHint(arrangement.direction, action)) return [];
  const { frame, parent, direction } = arrangement;
  const when = editCondition(frame);
  if (action.kind === "distribute") return forCopies(project, [{ id: newOpId(), frameId: frame.id, nodeId: parent.id, op: "relayout", layout: { justify: "between" }, ...(when && { when }) }], scope);
  const along = (horizontal(action.how) ? "row" : "column") === direction;
  if (along) return forCopies(project, [{ id: newOpId(), frameId: frame.id, nodeId: parent.id, op: "relayout", layout: { justify: SELF[action.how]! }, ...(when && { when }) }], scope);
  return forCopies(
    project,
    sels.map((s) => ({ id: newOpId(), frameId: frame.id, nodeId: s.nodeId, op: "relayout" as const, box: { alignSelf: SELF[action.how]! }, ...(when && { when }) })),
    scope,
  );
}
