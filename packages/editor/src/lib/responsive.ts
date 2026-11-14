import type { AnyOp, BoardItem, Condition, DesignNode, Frame, Op, Override, Project, Viewport } from "@appshape/ir";
import { newItemId, newOpId } from "./board";

/**
 * Responsive help: what differs per screen size, putting it back to "all sizes", stacking rows on
 * phones, visibility per size and showing a screen at every size. Designs are mobile-first: the
 * base values are the phone's, `md` overrides start at tablets, `lg` at desktops.
 */

export const SIZES = [
  { id: "phone", label: "Phone", viewport: undefined },
  { id: "tablet", label: "Tablet", viewport: "md" },
  { id: "desktop", label: "Desktop", viewport: "lg" },
] as const;

const onlyViewport = (o: Override) => o.when.viewport !== undefined && !o.when.state && !o.when.scheme && !o.when.prop;
const at = (viewport: string): Condition => ({ viewport });

export interface SizeDifference {
  viewport: string;
  area: "layout" | "box" | "style" | "hidden";
  key: string;
  value: unknown;
}

/** Everything a node sets differently from a screen size up. */
export function sizeDifferences(node: DesignNode): SizeDifference[] {
  const list: SizeDifference[] = [];
  for (const o of node.overrides ?? []) {
    if (!onlyViewport(o)) continue;
    for (const area of ["layout", "box", "style"] as const) for (const [key, value] of Object.entries(o[area] ?? {})) list.push({ viewport: o.when.viewport!, area, key, value });
    if (o.hidden !== undefined) list.push({ viewport: o.when.viewport!, area: "hidden", key: "hidden", value: o.hidden });
  }
  return list;
}

/** Ops that make a property the same at every size again (its size-specific values go). */
export function resetToAllSizesOps(frameId: string, node: DesignNode, area: SizeDifference["area"], key: string): Op[] {
  const ops: Op[] = [];
  for (const o of node.overrides ?? []) {
    if (!onlyViewport(o)) continue;
    const base = { id: newOpId(), frameId, nodeId: node.id, when: o.when };
    if (area === "hidden" && o.hidden !== undefined) ops.push({ ...base, op: "setVisibility", hidden: null });
    else if (area === "style" && o.style && key in o.style) ops.push({ ...base, op: "restyle", style: { [key]: null } });
    else if ((area === "layout" || area === "box") && o[area] && key in o[area]!) ops.push({ ...base, op: "relayout", [area]: { [key]: null } });
  }
  return ops;
}

/** Whether a row or grid is a stack on phones and goes back to a row (or columns) from tablets up. */
export function isStackedOnPhones(node: DesignNode): boolean {
  const md = node.overrides?.find((o) => onlyViewport(o) && o.when.viewport === "md")?.layout;
  if (node.layout?.mode === "flex") return (node.layout.direction ?? "row") === "column" && md?.direction === "row";
  if (node.layout?.mode === "grid") return (node.layout.columns ?? 1) === 1 && typeof md?.columns === "number" && md.columns > 1;
  return false;
}

/** Whether "Stack on phones" applies: a row, or a grid with several columns. */
export function canStackOnPhones(node: DesignNode): boolean {
  if (isStackedOnPhones(node)) return false;
  if (node.layout?.mode === "flex") return (node.layout.direction ?? "row") === "row";
  return node.layout?.mode === "grid" && typeof node.layout.columns === "number" && node.layout.columns > 1;
}

/** Stack on phones: the base (phone) layout becomes a stack, tablets and up keep the row or columns. */
export function stackOnPhonesOps(frameId: string, node: DesignNode): Op[] {
  const layout = node.layout;
  if (!layout || !canStackOnPhones(node)) return [];
  const base = { frameId, nodeId: node.id };
  if (layout.mode === "grid") {
    return [
      { id: newOpId(), ...base, op: "relayout", layout: { columns: layout.columns! }, when: at("md") },
      { id: newOpId(), ...base, op: "relayout", layout: { columns: 1 } },
    ];
  }
  return [
    { id: newOpId(), ...base, op: "relayout", layout: { direction: "row" }, when: at("md") },
    { id: newOpId(), ...base, op: "relayout", layout: { direction: "column", ...(layout.wrap && { wrap: null }) } },
  ];
}

/** Whether a node shows on phones, tablets and desktops. */
export function visibilityBySize(node: DesignNode): [boolean, boolean, boolean] {
  const hiddenAt = (viewport: string) => node.overrides?.find((o) => onlyViewport(o) && o.when.viewport === viewport)?.hidden;
  const phone = !node.hidden;
  const tablet = !(hiddenAt("md") ?? !phone);
  const desktop = !(hiddenAt("lg") ?? !tablet);
  return [phone, tablet, desktop];
}

/** Ops for showing a node on the given sizes (phone, tablet, desktop). */
export function setVisibilityBySizeOps(frameId: string, node: DesignNode, shown: [boolean, boolean, boolean]): Op[] {
  const base = { frameId, nodeId: node.id };
  const [phone, tablet, desktop] = shown;
  return [
    { id: newOpId(), ...base, op: "setVisibility", hidden: phone ? null : true },
    { id: newOpId(), ...base, op: "setVisibility", hidden: tablet === phone ? null : !tablet, when: at("md") },
    { id: newOpId(), ...base, op: "setVisibility", hidden: desktop === tablet ? null : !desktop, when: at("lg") },
  ];
}

const SIZE_VIEWPORTS: Viewport[] = [
  { id: "mobile", width: 390 },
  { id: "tablet", width: 768, breakpoint: "md" },
  { id: "desktop", width: 1280, breakpoint: "lg" },
];

/** A web screen at phone, tablet and desktop width side by side (placements the board doesn't have yet). */
export function showAllSizesOps(project: Project, frame: Frame, sizes: Record<string, { w: number; h: number } | undefined>): AnyOp[] {
  if (frame.platform !== "web") return [];
  const placements = project.board.items.filter((i): i is Extract<BoardItem, { type: "frame" }> => i.type === "frame" && i.frameId === frame.id);
  const first = placements[0];
  if (!first) return [];
  const ops: AnyOp[] = [];
  const viewports = [...frame.viewports];
  // appended, not sorted: the first viewport is what placements without one show
  for (const v of SIZE_VIEWPORTS) if (!viewports.some((x) => x.width === v.width)) viewports.push(v);
  if (viewports.length !== frame.viewports.length) ops.push({ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { viewports } });
  const shown = (v: Viewport) => placements.some((p) => (p.viewportId ?? frame.viewports[0]!.id) === v.id);
  let x = Math.max(...placements.map((p) => p.x + (sizes[p.id]?.w ?? frame.viewports.find((v) => v.id === (p.viewportId ?? frame.viewports[0]!.id))?.width ?? 1280))) + 120;
  const missing = viewports.filter((v) => !shown(v) && SIZE_VIEWPORTS.some((s) => s.width === v.width)).sort((a, b) => a.width - b.width);
  for (const v of missing) {
    ops.push({ id: newOpId(), op: "addItem", item: { type: "frame", id: newItemId(), frameId: frame.id, x, y: first.y, viewportId: v.id } });
    x += v.width + 120;
  }
  return ops;
}
