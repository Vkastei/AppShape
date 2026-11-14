import { type DesignNode, findNode, isContainer, type Op, type Project } from "@appshape/ir";

/**
 * Imported elements rendered by the same code (same source anchor): a component used on several
 * pages, or the items of a `.map()`. In the app they can only change together, so edits go to all
 * copies unless the user picks "this one only".
 */

export interface CopyRef {
  frameId: string;
  nodeId: string;
}

const anchorKey = (node: DesignNode) => (node.source ? `${node.source.file}:${node.source.line}:${node.source.col}` : undefined);

/** Every element with the same anchor as the node (including it), across imported frames. */
export function linkedCopies(project: Project, frameId: string, nodeId: string): CopyRef[] {
  const frame = project.frames.find((f) => f.id === frameId);
  const node = frame && findNode(frame.current, nodeId)?.node;
  const key = node && frame?.kind === "imported" ? anchorKey(node) : undefined;
  if (!key) return [{ frameId, nodeId }];
  const out: CopyRef[] = [];
  for (const f of project.frames) {
    if (f.kind !== "imported") continue;
    const visit = (n: DesignNode) => {
      if (anchorKey(n) === key) out.push({ frameId: f.id, nodeId: n.id });
      if (isContainer(n)) n.children.forEach(visit);
    };
    visit(f.current);
  }
  return out.length ? out : [{ frameId, nodeId }];
}

const COPYABLE = new Set(["restyle", "relayout", "setVisibility", "retext", "setAttrs", "setClasses", "replaceImage", "setLink"]);

/**
 * The ops for all copies of the edited elements. Text edits only go to copies showing the same
 * text (list items from data differ).
 */
export function forCopies(project: Project, ops: Op[], scope: "all" | "this"): Op[] {
  if (scope === "this") return ops;
  const out: Op[] = [];
  let n = 0;
  for (const op of ops) {
    out.push(op);
    const nodeId = (op as { nodeId?: string }).nodeId;
    if (!COPYABLE.has(op.op) || !nodeId) continue;
    const frame = project.frames.find((f) => f.id === op.frameId);
    const node = frame && findNode(frame.current, nodeId)?.node;
    if (!node) continue;
    for (const copy of linkedCopies(project, op.frameId, nodeId)) {
      if (copy.frameId === op.frameId && copy.nodeId === nodeId) continue;
      if (op.op === "retext") {
        const other = findNode(project.frames.find((f) => f.id === copy.frameId)!.current, copy.nodeId)?.node;
        if (other?.type !== "text" || node.type !== "text" || other.text !== node.text) continue;
      }
      out.push({ ...op, id: `${op.id}-${++n}`.slice(0, 64), frameId: copy.frameId, nodeId: copy.nodeId } as Op);
    }
  }
  return out;
}
