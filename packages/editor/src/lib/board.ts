import { type BoardItem, type BoardOp, createId, type Frame, type JsonValue, type Project } from "@appshape/ir";
import { center, clipToRect, containsPoint, containsRect, intersects, itemBounds, type Point, type Sizes } from "./geometry";

/** Pure helpers that turn board interactions into board ops. */

export const newOpId = () => createId("op");
export const newItemId = () => createId("b");

export function framesById(project: Project): Map<string, Frame> {
  return new Map(project.frames.map((f) => [f.id, f]));
}

export function itemsById(project: Project): Map<string, BoardItem> {
  return new Map(project.board.items.map((item) => [item.id, item]));
}

const update = (itemId: string, patch: Record<string, JsonValue>): BoardOp => ({ id: newOpId(), op: "updateItem", itemId, patch });

/**
 * Items that move together with the selection: everything inside a selected section and notes
 * attached to (and overlapping) a selected frame placement.
 */
export function dragSet(project: Project, selected: readonly string[], sizes: Sizes): string[] {
  const frames = framesById(project);
  const items = itemsById(project);
  const result = new Set(selected.filter((id) => items.get(id) && items.get(id)!.type !== "arrow"));
  for (const id of selected) {
    const item = items.get(id);
    if (!item) continue;
    const bounds = itemBounds(item, frames, sizes);
    if (!bounds) continue;
    for (const other of project.board.items) {
      if (other.id === id || other.type === "arrow") continue;
      const otherBounds = itemBounds(other, frames, sizes)!;
      if (item.type === "section" && containsRect(bounds, otherBounds)) result.add(other.id);
      if (item.type === "frame" && other.type === "note" && other.attachedTo?.frameId === item.frameId && intersects(bounds, otherBounds)) {
        result.add(other.id);
      }
    }
  }
  return [...result];
}

export function moveOps(project: Project, ids: readonly string[], dx: number, dy: number): BoardOp[] {
  if (dx === 0 && dy === 0) return [];
  const items = itemsById(project);
  return ids.flatMap((id) => {
    const item = items.get(id);
    if (!item || item.type === "arrow") return [];
    return [update(id, { x: Math.round(item.x + dx), y: Math.round(item.y + dy) })];
  });
}

/** After notes were dropped: attach them to the frame placement under their center (or detach). */
export function attachOps(project: Project, noteIds: readonly string[], sizes: Sizes): BoardOp[] {
  const frames = framesById(project);
  const placements = project.board.items.filter((i) => i.type === "frame").reverse();
  const ops: BoardOp[] = [];
  for (const id of noteIds) {
    const note = project.board.items.find((i) => i.id === id);
    if (note?.type !== "note") continue;
    const c = center(itemBounds(note, frames, sizes)!);
    const target = placements.find((p) => containsPoint(itemBounds(p, frames, sizes)!, c));
    const frameId = target?.type === "frame" ? target.frameId : undefined;
    if (frameId === note.attachedTo?.frameId) continue;
    ops.push(update(id, { attachedTo: frameId ? { frameId } : null }));
  }
  return ops;
}

/** Deletes items and every arrow connected to them. */
export function deleteOps(project: Project, ids: readonly string[]): BoardOp[] {
  const doomed = new Set(ids);
  for (const item of project.board.items) {
    if (item.type !== "arrow") continue;
    const ends = [item.from, item.to].filter((e): e is { itemId: string } => "itemId" in e);
    if (ends.some((e) => doomed.has(e.itemId))) doomed.add(item.id);
  }
  return project.board.items.filter((i) => doomed.has(i.id)).map((i) => ({ id: newOpId(), op: "removeItem" as const, itemId: i.id }));
}

export function duplicateOps(project: Project, ids: readonly string[], offset = 24): { ops: BoardOp[]; newIds: string[] } {
  const ops: BoardOp[] = [];
  const newIds: string[] = [];
  for (const item of project.board.items) {
    if (!ids.includes(item.id) || item.type === "arrow") continue;
    const copy = { ...structuredClone(item), id: newItemId(), x: item.x + offset, y: item.y + offset } as BoardItem;
    ops.push({ id: newOpId(), op: "addItem", item: copy });
    newIds.push(copy.id);
  }
  return { ops, newIds };
}

export type ReorderDirection = "forward" | "backward" | "front" | "back";

export function reorderOps(project: Project, ids: readonly string[], direction: ReorderDirection): BoardOp[] {
  const order = project.board.items.map((i) => i.id);
  const selected = order.filter((id) => ids.includes(id));
  const ops: BoardOp[] = [];
  const moveTo = (id: string, index: number) => {
    const from = order.indexOf(id);
    if (from === index) return;
    order.splice(from, 1);
    order.splice(index, 0, id);
    ops.push({ id: newOpId(), op: "reorderItem", itemId: id, index });
  };
  switch (direction) {
    case "front":
      for (const id of selected) moveTo(id, order.length - 1);
      break;
    case "back":
      [...selected].reverse().forEach((id) => moveTo(id, 0));
      break;
    case "forward":
      for (const id of [...selected].reverse()) moveTo(id, Math.min(order.length - 1, order.indexOf(id) + 1));
      break;
    case "backward":
      for (const id of selected) moveTo(id, Math.max(0, order.indexOf(id) - 1));
      break;
  }
  return ops;
}

/** World coordinates of an arrow's two ends, clipped to the items they connect. */
export function arrowEnds(
  arrow: Extract<BoardItem, { type: "arrow" }>,
  items: ReadonlyMap<string, BoardItem>,
  frames: ReadonlyMap<string, Frame>,
  sizes: Sizes,
): { from: Point; to: Point } | undefined {
  const boundsOf = (end: typeof arrow.from) => {
    if (!("itemId" in end)) return { point: { x: end.x, y: end.y } };
    const item = items.get(end.itemId);
    const rect = item && itemBounds(item, frames, sizes);
    return rect ? { rect } : undefined;
  };
  const a = boundsOf(arrow.from);
  const b = boundsOf(arrow.to);
  if (!a || !b) return undefined;
  const aCenter = a.rect ? center(a.rect) : a.point!;
  const bCenter = b.rect ? center(b.rect) : b.point!;
  return {
    from: a.rect ? clipToRect(a.rect, bCenter) : aCenter,
    to: b.rect ? clipToRect(b.rect, aCenter) : bCenter,
  };
}
