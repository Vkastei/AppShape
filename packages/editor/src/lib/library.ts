import { type AnyOp, applyCommandToProject, createId, type DesignNode, findNode, type Frame, type JsonValue, type Project } from "@appshape/ir";
import { buildPage, isSection, overlayDef, overlayFrame, overlayUses, pageTemplate, type SectionContext, sectionDef, sectionOverlays, sectionUses, starterComponentFrame } from "@appshape/kit";
import type { DropTarget } from "../components/Overlay";
import { addScreen, freeSpot } from "../components/Sidebar";
import { dispatch, notify, selectNode, useEditor } from "../store";
import { newOpId } from "./board";
import { componentSpot } from "./components";
import type { Sizes } from "./geometry";
import { type ClientRect, frameHandle } from "./frames";
import { ensureStarterOps, projectTint, starterIn } from "./kit";
import { newScreen, slugRoute } from "./templates";

/**
 * The section library on the board: sections go into a screen at a drop position, page templates
 * fill a screen or become a new one. Starter components they use are added to the project once.
 */

/** What is being dragged from the library (drag events don't expose their data while dragging). */
export interface LibraryDrag {
  kind: "section" | "page";
  key: string;
}
let dragged: LibraryDrag | undefined;
export const setLibraryDrag = (drag: LibraryDrag | undefined) => (dragged = drag);
export const getLibraryDrag = () => dragged;

const instance = (componentId: string, props: Record<string, JsonValue>, fill: DesignNode[]): DesignNode => ({ id: createId("n"), type: "instance", origin: "added", componentId, props, children: fill });

/** The starter components, overlay screens (a header's mobile menu) and tokens sections need, added to the project. */
function prepare(project: Project, sizes: Sizes, sectionKeys: readonly string[], near?: { x: number; y: number }, overlays: readonly string[] = sectionOverlays(sectionKeys)): { ops: AnyOp[]; ctx: SectionContext } {
  const ops: AnyOp[] = [];
  let work = project;
  const ids = new Map<string, string>();
  let spot: { x: number; y: number } | undefined = near;
  for (const key of new Set([...sectionUses(sectionKeys), ...overlayUses(overlays)])) {
    if (!starterIn(work, key)) spot ??= componentSpot(project, sizes);
    const result = ensureStarterOps(work, key, sizes, starterIn(work, key) ? undefined : spot);
    if (result.ops.length > 0) {
      ops.push(...result.ops);
      work = applyCommandToProject(work, result.ops);
      spot = { x: spot!.x, y: spot!.y + 160 };
    }
    ids.set(key, result.componentId);
  }
  // pictures are tinted with the brand color (the project's, or the default theme's it just got)
  const ctx: SectionContext = { tint: projectTint(work), use: (key, props = {}, fill = []) => instance(ids.get(key)!, props, fill) };
  // overlay screens: the project's (by name), or a new one from the kit, right of everything
  const overlayIds = new Map<string, string>();
  let at: { x: number; y: number } | undefined;
  for (const key of overlays) {
    const def = overlayDef(key);
    if (!def) continue;
    const existing = work.frames.find((f) => f.overlay && f.name === def.name);
    if (existing) {
      overlayIds.set(key, existing.id);
      continue;
    }
    const frame = overlayFrame(key, ctx, { adapter: project.adapters[0]?.id ?? "react-vite" });
    at = at ? { x: at.x + def.width + 120, y: at.y } : freeSpot();
    ops.push({ id: newOpId(), frameId: frame.id, op: "createFrame", frame }, { id: newOpId(), op: "addItem", item: { type: "frame", id: createId("b"), frameId: frame.id, x: at.x, y: at.y, viewportId: frame.viewports[0]!.id } });
    overlayIds.set(key, frame.id);
  }
  ctx.overlay = (key) => overlayIds.get(key)!;
  return { ops, ctx };
}

/** A new overlay screen from the kit (`mobile-menu`, `dialog`, `dropdown-menu`): the ops and its id. */
export function overlayFromKit(key: string): { ops: AnyOp[]; frameId: string } | undefined {
  const { project, sizes } = useEditor.getState();
  if (!project || !overlayDef(key)) return undefined;
  const { ops, ctx } = prepare(project, sizes, [], undefined, [key]);
  return { ops, frameId: ctx.overlay!(key) };
}

/** Where a new screen goes, and where components it brings go (right of it, not on top of it). */
function newScreenSpots(project: Project, at?: { x: number; y: number }) {
  const screen = at ?? freeSpot();
  const components = project.frames.some((f) => f.kind === "component") ? undefined : { x: screen.x + 1280 + 200, y: screen.y };
  return { screen, components };
}

/**
 * For previews (the library's thumbnails): the project's own starter components where it has them,
 * the kit's otherwise. Nothing is added to the project.
 */
export function previewContext(project: Project, keys: readonly string[]): { ctx: SectionContext; frames: Frame[] } {
  const frames: Frame[] = [];
  const ids = new Map<string, string>();
  for (const key of sectionUses(keys)) {
    const own = starterIn(project, key);
    if (own) ids.set(key, own.id);
    else {
      const frame = starterComponentFrame(key, { adapter: "preview", tint: projectTint(project) });
      frames.push(frame);
      ids.set(key, frame.id);
    }
  }
  return { frames, ctx: { tint: projectTint(project), use: (key, props = {}, fill = []) => instance(ids.get(key)!, props, fill) } };
}

/** A screen made only of sections needs no padding or gap of its own (the sections bring theirs). */
function bareRootOps(frame: Frame): AnyOp[] {
  const layout = frame.current.layout;
  if (!layout?.padding && layout?.gap === undefined) return [];
  const children = "children" in frame.current ? frame.current.children : [];
  if (!children.every(isSection)) return [];
  return [{ id: newOpId(), frameId: frame.id, op: "relayout", nodeId: frame.current.id, layout: { padding: null, gap: null } }];
}

/** Inserts a section into a screen's top level at `index` (end when omitted). */
export function insertSection(key: string, frameId: string, itemId: string, index?: number): void {
  const { project, sizes } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === frameId);
  const def = sectionDef(key);
  if (!project || !frame || !def || !("children" in frame.current)) return;
  const { ops, ctx } = prepare(project, sizes, [key]);
  const node = def.build(ctx);
  ops.push(...bareRootOps(frame));
  ops.push({ id: newOpId(), frameId, op: "insert", parentId: frame.current.id, index: index ?? frame.current.children.length, node });
  if (dispatch(ops)) selectNode({ itemId, frameId, nodeId: node.id });
}

/** Fills a screen with a page template (its content is replaced; one Ctrl+Z brings it back). */
export function applyTemplate(key: string, frameId: string, itemId: string): void {
  const { project, sizes } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === frameId);
  const template = pageTemplate(key);
  if (!project || !frame || !template || !("children" in frame.current)) return;
  if (frame.current.children.length > 0 && !window.confirm(`Replace what's on "${frame.name}" with the ${template.name.toLowerCase()}? (Undo with Ctrl+Z)`)) return;
  const { ops, ctx } = prepare(project, sizes, template.sections);
  const page = buildPage(template, ctx);
  for (const child of frame.current.children) ops.push({ id: newOpId(), frameId, op: "delete", nodeId: child.id });
  ops.push({ id: newOpId(), frameId, op: "relayout", nodeId: frame.current.id, layout: { mode: "flex", direction: "column", padding: null, gap: null } });
  ops.push({ id: newOpId(), frameId, op: "restyle", nodeId: frame.current.id, style: { background: "$color.background", color: "$color.foreground" } });
  page.children.forEach((section, i) => ops.push({ id: newOpId(), frameId, op: "insert", parentId: frame.current.id, index: i, node: section }));
  if (dispatch(ops)) {
    selectNode({ itemId, frameId, nodeId: frame.current.id });
    notify(`${template.name} applied. Click any text to change it; drag sections from the library to add more.`);
  }
}

/** A new screen made from a page template (at `at` on the board, or right of everything). */
export function screenFromTemplate(key: string, at?: { x: number; y: number }, screenName?: string): void {
  const { project, sizes } = useEditor.getState();
  const template = pageTemplate(key);
  if (!project || !template) return;
  const spots = newScreenSpots(project, at);
  const { ops, ctx } = prepare(project, sizes, template.sections, spots.components);
  const taken = new Set(project.frames.map((f) => f.name));
  const base = screenName ?? template.screen;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  const frame = newScreen(name, slugRoute(name), "desktop", applyCommandToProject(project, ops).tokens, project.adapters[0]?.id);
  frame.current = { ...buildPage(template, ctx), id: frame.current.id, name };
  addScreen(frame, spots.screen, ops);
}

/** The screen (and its placement) a click in the library goes to: the selection's, if any. */
export function libraryTarget(): { frameId: string; itemId: string; index?: number } | undefined {
  const { project, node, selection } = useEditor.getState();
  if (!project) return undefined;
  if (node) {
    const frame = project.frames.find((f) => f.id === node.frameId);
    if (!frame || frame.kind === "component" || !("children" in frame.current)) return undefined;
    // after the section the selection is in
    const top = frame.current.children.findIndex((c) => findNode(c, node.nodeId) !== undefined);
    return { frameId: frame.id, itemId: node.itemId, ...(top >= 0 && { index: top + 1 }) };
  }
  const item = project.board.items.find((i) => i.id === selection[0]);
  if (item?.type !== "frame") return undefined;
  const frame = project.frames.find((f) => f.id === item.frameId);
  return frame && frame.kind !== "component" ? { frameId: frame.id, itemId: item.id } : undefined;
}

/** A new screen with one section (a section dropped onto the empty board). */
export function screenFromSection(key: string, at?: { x: number; y: number }): void {
  const { project, sizes } = useEditor.getState();
  const def = sectionDef(key);
  if (!project || !def) return;
  const spots = newScreenSpots(project, at);
  const { ops, ctx } = prepare(project, sizes, [key], spots.components);
  const taken = new Set(project.frames.map((f) => f.name));
  let name = def.name;
  for (let i = 2; taken.has(name); i++) name = `${def.name} ${i}`;
  const frame = newScreen(name, slugRoute(name), "desktop", applyCommandToProject(project, ops).tokens, project.adapters[0]?.id);
  const root = frame.current as Extract<DesignNode, { type: "box" }>;
  frame.current = { ...root, layout: { mode: "flex", direction: "column" }, children: [def.build(ctx)] };
  addScreen(frame, spots.screen, ops);
}

/**
 * Where a library item dragged over a screen lands: a section between the screen's top-level
 * sections (by the pointer's height); a page template fills the whole screen.
 */
export function libraryDrop(project: Project, itemId: string, clientY: number, kind: LibraryDrag["kind"]): DropTarget | undefined {
  const handle = frameHandle(itemId);
  const placement = project.board.items.find((i) => i.id === itemId);
  const frame = placement?.type === "frame" ? project.frames.find((f) => f.id === placement.frameId) : undefined;
  const root = frame?.current;
  const rootRect = root && handle?.nodeRect(root.id);
  if (!frame || frame.kind === "component" || !root || !("children" in root) || !rootRect) return undefined;
  const base = { itemId, parentId: root.id, container: rootRect };
  if (kind === "page") {
    return { ...base, index: 0, line: { x: rootRect.x, y: rootRect.y, w: rootRect.w, h: 3 }, label: root.children.length ? `Replace ${frame.name} with this page` : `Fill ${frame.name} with this page` };
  }
  const children = root.children.map((c) => ({ node: c, rect: handle!.nodeRect(c.id) })).filter((c): c is { node: DesignNode; rect: ClientRect } => c.rect !== undefined);
  const index = children.filter((c) => c.rect.y + c.rect.h / 2 < clientY).length;
  const prev = children[index - 1];
  const next = children[index];
  const y = prev && next ? (prev.rect.y + prev.rect.h + next.rect.y) / 2 : prev ? prev.rect.y + prev.rect.h : next ? next.rect.y : rootRect.y + 4;
  const name = (node: DesignNode) => node.name ?? node.type;
  const label = prev && next ? `Between ${name(prev.node)} and ${name(next.node)}` : next ? `Before ${name(next.node)}` : prev ? `After ${name(prev.node)}` : `Into ${frame.name}`;
  return { ...base, index: children.length === root.children.length ? index : root.children.length, line: { x: rootRect.x, y: y - 1.5, w: rootRect.w, h: 3 }, label };
}
