import type { Board } from "./board";
import type { Frame } from "./frame";

export interface ReferenceProblem {
  /** Where the problem is, e.g. `board.items[3]`. */
  where: string;
  message: string;
}

/** Dangling references between board items and frames. Not errors for apply, but worth reporting. */
export function findReferenceProblems(board: Board, frames: ReadonlyMap<string, Frame>): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const itemIds = new Set(board.items.map((item) => item.id));
  board.items.forEach((item, i) => {
    const where = `board.items[${i}] (${item.id})`;
    if (item.type === "frame") {
      const frame = frames.get(item.frameId);
      if (!frame) problems.push({ where, message: `frame ${item.frameId} does not exist` });
      else if (item.viewportId && !frame.viewports.some((v) => v.id === item.viewportId)) {
        problems.push({ where, message: `frame ${item.frameId} has no viewport ${item.viewportId}` });
      }
    }
    if (item.type === "note" && item.attachedTo && !frames.has(item.attachedTo.frameId)) {
      problems.push({ where, message: `note is attached to missing frame ${item.attachedTo.frameId}` });
    }
    if (item.type === "arrow") {
      for (const end of [item.from, item.to]) {
        if ("itemId" in end && !itemIds.has(end.itemId)) {
          problems.push({ where, message: `arrow points to missing item ${end.itemId}` });
        }
      }
    }
  });
  return problems;
}
