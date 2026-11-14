import { type BoxPatch, type Condition, type DesignNode, findNode, type Frame, type Op, type Project, type StylePatch, type Tokens } from "@appshape/ir";
import { type NodeSelection, useEditor } from "../store";
import { frameHandle } from "./frames";
import { newOpId } from "./board";
import { variantProps } from "./components";
import { forCopies } from "./linked";

/**
 * Where element edits go: the base style, or the override of the active breakpoint, state and (inside
 * a component) variant. The inspector and the on-canvas handles use the same condition.
 */
export function editCondition(frame: Frame): Condition | undefined {
  const { breakpoint, variant, state } = useEditor.getState();
  const active = variant && variantProps(frame.component).some((p) => p.name === variant.name && p.options?.includes(variant.value)) ? variant : undefined;
  const condition: Condition = { ...(breakpoint && { viewport: breakpoint }), ...(state && { state }), ...(active && { prop: active }) } as Condition;
  return Object.keys(condition).length > 0 ? condition : undefined;
}

/** A box edit of one element (all linked copies unless "this one only"); by default under the inspector's condition. */
export function boxOps(project: Project, frame: Frame, node: DesignNode, box: BoxPatch, when: Condition | undefined = editCondition(frame)): Op[] {
  const op: Op = { id: newOpId(), frameId: frame.id, nodeId: node.id, op: "relayout", box, ...(when && { when }) };
  return forCopies(project, [op], useEditor.getState().codeScope);
}

/**
 * Where a free move applies: the screen size it was made on and larger (the placement's breakpoint,
 * mobile-first), so a move on the desktop screen leaves the phone screen alone. "Edit for" in the
 * inspector, when set, wins.
 */
export function freeCondition(project: Project, sel: NodeSelection, frame: Frame): Condition | undefined {
  const base = editCondition(frame);
  if (useEditor.getState().breakpoint) return base;
  const placement = project.board.items.find((i) => i.id === sel.itemId);
  const viewport = placement?.type === "frame" ? (frame.viewports.find((v) => v.id === placement.viewportId) ?? frame.viewports[0]) : undefined;
  return viewport?.breakpoint ? { ...base, viewport: viewport.breakpoint } : base;
}

/** The grid inside screens: the design system's base spacing (`spacing.2`), 8 px by default. */
export function screenGrid(tokens: Tokens): number {
  const value = tokens.groups.spacing?.["2"];
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 8;
  return typeof value === "string" && value.endsWith("rem") ? n * 16 : n;
}

const px = (value: string) => parseFloat(value) || 0;

/**
 * "Move freely": the element moves by `dx`/`dy` (design px) and keeps its slot in the layout: a
 * relative offset (`relative` + left/top), so nothing else moves. Elements taken out of the layout
 * (absolute) move their inset; children of sketch frames (absolute layout) their `box.x/y`. The offset
 * applies to the screen size it was made on and larger (`freeCondition`).
 */
export function freeMoveOps(project: Project, sel: NodeSelection, dx: number, dy: number): Op[] {
  const frame = project.frames.find((f) => f.id === sel.frameId);
  const found = frame && findNode(frame.current, sel.nodeId);
  if (!frame || !found?.parent) return [];
  const { node, parent } = found;
  if (parent.layout?.mode === "absolute") {
    return boxOps(project, frame, node, { x: Math.round((node.box?.x ?? 0) + dx), y: Math.round((node.box?.y ?? 0) + dy) });
  }
  const el = frameHandle(sel.itemId)?.element(node.id);
  if (!el) return [];
  const style = getComputedStyle(el);
  const detached = style.position === "absolute" || style.position === "fixed";
  // the offset in effect on this placement (0 when none), plus the move
  const left = Math.round(px(style.left) + dx);
  const top = Math.round(px(style.top) + dy);
  const box: BoxPatch = { ...(!detached && style.position !== "relative" && { position: "relative" }), inset: { left, top } };
  return boxOps(project, frame, node, box, freeCondition(project, sel, frame));
}

/**
 * "Detach from layout": the element leaves the layout and stays where it is (`absolute` with left/top
 * in its parent, which becomes `relative` if it isn't positioned), keeping its width so text doesn't
 * re-wrap. For overlays like a badge on a picture; the siblings close the gap.
 */
export function detachOps(project: Project, sel: NodeSelection): Op[] {
  const frame = project.frames.find((f) => f.id === sel.frameId);
  const found = frame && findNode(frame.current, sel.nodeId);
  if (!frame || !found?.parent) return [];
  const { node, parent } = found;
  const handle = frameHandle(sel.itemId);
  const el = handle?.element(node.id);
  const parentEl = handle?.element(parent.id);
  if (!el || !parentEl) return [];
  const zoom = useEditor.getState().camera.zoom;
  const rect = el.getBoundingClientRect();
  const parentRect = parentEl.getBoundingClientRect();
  const style = getComputedStyle(el);
  const parentStyle = getComputedStyle(parentEl);
  // `left`/`top` position the margin box inside the parent's padding box
  const left = Math.round((rect.left - parentRect.left) / zoom - px(parentStyle.borderLeftWidth) - px(style.marginLeft));
  const top = Math.round((rect.top - parentRect.top) / zoom - px(parentStyle.borderTopWidth) - px(style.marginTop));
  const box: BoxPatch = { position: "absolute", inset: { left, top } };
  if (node.box?.width?.mode !== "fixed") box.width = { mode: "fixed", value: Math.round(rect.width / zoom) };
  if (node.box?.height?.mode === "fill") box.height = { mode: "fixed", value: Math.round(rect.height / zoom) };
  const ops = boxOps(project, frame, node, box);
  if (parentStyle.position === "static") {
    ops.push(...forCopies(project, [{ id: newOpId(), frameId: frame.id, nodeId: parent.id, op: "relayout", box: { position: "relative" } }], useEditor.getState().codeScope));
  }
  return ops;
}

/** A free placement of an element: where it applies, how, and by how much. */
export interface Placement {
  /** The condition it is stored under (undefined: all screen sizes). */
  when: Condition | undefined;
  kind: "nudged" | "detached";
  left: number | undefined;
  top: number | undefined;
}

const offset = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?[\d.]+px$/.test(v) ? parseFloat(v) : undefined);

/**
 * The element's free placements, base and per screen size (for the inspector's Position row). A
 * `relative` without an offset (a parent made relative, or the app's own) is not one.
 */
export function placementsOf(node: DesignNode): Placement[] {
  const entries: { when: Condition | undefined; box: Partial<NonNullable<DesignNode["box"]>> | undefined }[] = [
    { when: undefined, box: node.box },
    ...(node.overrides ?? []).filter((o) => o.box && !o.when.state && !o.when.scheme).map((o) => ({ when: o.when, box: o.box })),
  ];
  const out: Placement[] = [];
  for (const { when, box } of entries) {
    if (!box) continue;
    // sticky and fixed elements are pinned (the inspector's Pin row), not placed freely
    if (box.position === "sticky" || box.position === "fixed") continue;
    const positioned = box.position === "absolute" ? "detached" : box.inset ? "nudged" : undefined;
    if (!positioned) continue;
    out.push({ when, kind: positioned, left: offset(box.inset?.left), top: offset(box.inset?.top) });
  }
  return out;
}

/** "Put back in layout": removes a free placement (keeps a `relative` the imported app had itself). */
export function putBackOps(project: Project, frame: Frame, node: DesignNode, when: Condition | undefined): Op[] {
  const baseline = frame.baseline && findNode(frame.baseline, node.id)?.node.box?.position;
  const box: BoxPatch = { inset: null, ...(baseline !== "relative" || when ? { position: null } : {}) };
  return boxOps(project, frame, node, box, when);
}

/** A style edit of one element (all linked copies unless "this one only"), under the inspector's condition. */
export function styleOps(project: Project, frame: Frame, node: DesignNode, style: StylePatch): Op[] {
  const when = editCondition(frame);
  return forCopies(project, [{ id: newOpId(), frameId: frame.id, nodeId: node.id, op: "restyle", style, ...(when && { when }) }], useEditor.getState().codeScope);
}

/**
 * Scaling a text by a corner (like Canva or PowerPoint): the font grows or shrinks with the box. Its
 * line height follows when it is in px, a fixed width scales too; the height stays automatic.
 */
export function scaleTextOps(project: Project, frame: Frame, node: DesignNode, scale: number, measured: { fontSize: number }): Op[] {
  const fontSize = Math.max(1, Math.round(measured.fontSize * scale));
  const style: StylePatch = { fontSize: `${fontSize}px` };
  const lineHeight = node.style?.lineHeight;
  if (typeof lineHeight === "string" && /^[\d.]+px$/.test(lineHeight)) style.lineHeight = `${Math.round(parseFloat(lineHeight) * scale)}px`;
  const ops = styleOps(project, frame, node, style);
  const width = node.box?.width;
  if (width?.mode === "fixed" && typeof width.value === "number") ops.push(...boxOps(project, frame, node, { width: { mode: "fixed", value: Math.round(width.value * scale) } }));
  return ops;
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Shift on a side handle keeps the proportions: it acts like the corner next to it. */
export function proportionalHandle(handle: ResizeHandle): ResizeHandle {
  return handle === "e" || handle === "s" ? "se" : handle === "w" ? "sw" : handle === "n" ? "ne" : handle;
}

/** Horizontal and vertical direction of a handle: -1 (left/top), 0, 1 (right/bottom). */
export function handleDirection(handle: ResizeHandle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    y: handle.startsWith("n") ? -1 : handle.startsWith("s") ? 1 : 0,
  };
}

/**
 * New size for a handle dragged by `dx`/`dy` (design px): corners keep the proportions, sides change
 * one dimension.
 */
export function resizedSize(handle: ResizeHandle, start: { w: number; h: number }, dx: number, dy: number): { w: number; h: number } {
  const dir = handleDirection(handle);
  let w = dir.x ? Math.max(1, start.w + dx * dir.x) : start.w;
  let h = dir.y ? Math.max(1, start.h + dy * dir.y) : start.h;
  if (dir.x && dir.y && start.w > 0 && start.h > 0) {
    // the axis that changed most leads, growing or shrinking
    const sx = w / start.w;
    const sy = h / start.h;
    const scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    w = Math.max(1, start.w * scale);
    h = Math.max(1, start.h * scale);
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/**
 * The box edit for a resize: fixed sizes for the dimensions the handle changes; in a flex parent,
 * no grow/basis along its axis (they would override the size); limits that would clamp the size
 * removed; absolutely placed elements keep their opposite edge when resized from the left/top.
 */
export function resizeBox(
  node: DesignNode,
  parent: DesignNode | undefined,
  handle: ResizeHandle,
  start: { w: number; h: number },
  size: { w: number; h: number },
  measured: { maxWidth: number; minWidth: number; maxHeight: number; minHeight: number; absolute: boolean; left: number; top: number },
): BoxPatch {
  const dir = handleDirection(handle);
  const box: BoxPatch = {};
  const parentLayout = parent && "layout" in parent ? parent.layout : undefined;
  const row = parentLayout?.mode === "flex" && (parentLayout.direction ?? "row") === "row";
  const column = parentLayout?.mode === "flex" && parentLayout.direction === "column";
  if (dir.x && size.w !== start.w) {
    box.width = { mode: "fixed", value: size.w };
    if (row) Object.assign(box, { grow: null, basis: null });
    if (size.w > measured.maxWidth) box.maxWidth = null;
    if (size.w < measured.minWidth) box.minWidth = null;
  }
  if (dir.y && size.h !== start.h) {
    box.height = { mode: "fixed", value: size.h };
    if (column) Object.assign(box, { grow: null, basis: null });
    if (size.h > measured.maxHeight) box.maxHeight = null;
    if (size.h < measured.minHeight) box.minHeight = null;
  }
  if (measured.absolute && (dir.x === -1 || dir.y === -1)) {
    box.inset = {
      ...node.box?.inset,
      ...(dir.x === -1 && { left: Math.round(measured.left - (size.w - start.w)), right: undefined }),
      ...(dir.y === -1 && { top: Math.round(measured.top - (size.h - start.h)), bottom: undefined }),
    };
    if (box.inset.right === undefined) delete box.inset.right;
    if (box.inset.bottom === undefined) delete box.inset.bottom;
  }
  return box;
}
