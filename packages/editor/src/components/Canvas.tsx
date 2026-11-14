import { applyCommandToProject, type BoardItem, type BoardOp, findNode, type InstanceNode, navTargets } from "@appshape/ir";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { attachOps, dragSet, framesById, moveOps, newItemId, newOpId } from "../lib/board";
import {
  type Camera,
  center,
  clipToRect,
  DEFAULT_NOTE_SIZE,
  intersects,
  itemBounds,
  type Point,
  type Rect,
  rectFromPoints,
  unionRects,
  screenToWorld,
  visibleWorldRect,
  zoomAt,
} from "../lib/geometry";
import { frameHandle } from "../lib/frames";
import { goTo } from "../lib/view";
import { boundProp, getDraggedComponent, newInstance, placementError, sourcesOf } from "../lib/components";
import { applyTemplate, getLibraryDrag, insertSection, libraryDrop, screenFromSection, screenFromTemplate, setLibraryDrag } from "../lib/library";
import { besideOps, clickTarget, moveToOps } from "../lib/nodes";
import { dispatch, type NodeSelection, notify, selectedNodes, selectNode, toggleNodeSelection, useEditor } from "../store";
import { computeDrop, type DropTarget, Overlay, refreshOverlay } from "./Overlay";
import { freeMoveOps, screenGrid } from "../lib/edits";
import { addBoardImages, imageFiles, insertImages, replaceImage } from "../lib/images";
import { Arrows } from "./Arrows";
import { QuickMenu, type QuickMenuAt } from "./QuickMenu";
import { Guides } from "./Guides";
import { NO_SNAP, type SnapOptions, type SnapResult, snapMove, snapResize } from "../lib/snap";
import { FrameItem, ImageItem, NoteItem, SectionItem, TextItem } from "./Items";
import { commitShape, newShapeId } from "./Markup";
import { dragShape, finishShape, placementTarget, removeShapesOps, requestFor, shapeAt } from "../lib/markup";

type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "move"; start: Point; ids: string[]; moved: boolean; selected: string[]; clicked: string }
  | { kind: "jump"; start: Point; targetId: string }
  | { kind: "marquee"; start: Point; additive: boolean }
  | { kind: "section"; start: Point }
  | { kind: "arrow"; fromId: string }
  | { kind: "resize"; id: string; start: Point; rect: Rect }
  /** Drawing on a screen (Draw & describe): points in the screen's design px. */
  | { kind: "draw"; itemId: string; origin: Point; shapeId: string; points: [number, number][] }
  | { kind: "erase"; itemId: string; origin: Point }
  | {
      kind: "node";
      sel: NodeSelection;
      start: Point;
      moved: boolean;
      /** Ctrl/Cmd held at the start: this drag moves freely (like the switch). */
      freeDrag: boolean;
      /** "Move freely": the element shifted by an inline translate until the drop. */
      free?: FreeDrag;
    };

/** A free drag: the element, where it and its siblings are, its parent's content box (client px). */
interface FreeDrag {
  el: HTMLElement;
  saved: string;
  dx: number;
  dy: number;
  rect: Rect;
  parent: Rect;
  siblings: Rect[];
  /** The screen's grid in client px. */
  grid: number;
}

/** Measures what a free drag snaps to, before the element moves. */
function startFreeDrag(sel: NodeSelection): FreeDrag | undefined {
  const { project, camera } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === sel.frameId);
  const location = frame && findNode(frame.current, sel.nodeId);
  const handle = frameHandle(sel.itemId);
  const el = handle?.element(sel.nodeId) as HTMLElement | undefined;
  const parentEl = location?.parent && (handle?.element(location.parent.id) as HTMLElement | undefined);
  if (!project || !el || !parentEl || !location?.parent) return undefined;
  const box = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const p = getComputedStyle(parentEl);
  const outer = parentEl.getBoundingClientRect();
  const inset = (v: string) => (parseFloat(v) || 0) * camera.zoom;
  const parent = {
    x: outer.left + inset(p.borderLeftWidth) + inset(p.paddingLeft),
    y: outer.top + inset(p.borderTopWidth) + inset(p.paddingTop),
    w: outer.width - inset(p.borderLeftWidth) - inset(p.borderRightWidth) - inset(p.paddingLeft) - inset(p.paddingRight),
    h: outer.height - inset(p.borderTopWidth) - inset(p.borderBottomWidth) - inset(p.paddingTop) - inset(p.paddingBottom),
  };
  const siblings = location.parent.children
    .filter((c) => c.id !== sel.nodeId)
    .map((c) => handle!.element(c.id)?.getBoundingClientRect())
    .filter((r): r is DOMRect => r !== undefined && r.width > 0 && r.height > 0)
    .map(box);
  return { el, saved: el.style.cssText, dx: 0, dy: 0, rect: box(el.getBoundingClientRect()), parent, siblings, grid: screenGrid(project.tokens) * camera.zoom };
}

const DRAG_THRESHOLD = 3;
/** The board's dot grid (board units); moving and resizing snap to it. */
export const BOARD_GRID = 24;

const itemAt = (target: EventTarget | null): string | undefined =>
  (target as Element | null)?.closest?.("[data-item-id]")?.getAttribute("data-item-id") ?? undefined;

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.project)!;
  const camera = useEditor((s) => s.camera);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const sizes = useEditor((s) => s.sizes);
  const [viewport, setViewport] = useState({ w: 1200, h: 800 });
  const [drag, setDrag] = useState<{ ids: string[]; dx: number; dy: number }>();
  const [marquee, setMarquee] = useState<Rect>();
  const [quickMenu, setQuickMenu] = useState<QuickMenuAt>();
  const closeQuickMenu = useCallback(() => setQuickMenu(undefined), []);
  const [sectionDraft, setSectionDraft] = useState<Rect>();
  const [boardGuides, setBoardGuides] = useState<SnapResult>();
  const [arrowDraft, setArrowDraft] = useState<{ fromId: string; to: Point }>();
  const [resizeDraft, setResizeDraft] = useState<{ id: string; w: number; h: number }>();
  const [drop, setDrop] = useState<DropTarget>();
  const [flows, setFlows] = useState<{ id: string; from: Point; to: Point; targetId: string }[]>([]);
  const showFlows = useEditor((s) => s.showFlows);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture>(undefined);
  const spaceDown = useRef(false);
  /** Jump after a click on an arrow; waits for a possible double-click (label editing). */
  const pendingJump = useRef(0);

  const frames = useMemo(() => framesById(project), [project]);

  // Items with live drag/resize previews applied (for rendering and arrow geometry).
  const displayItems = useMemo(() => {
    const map = new Map<string, BoardItem>();
    for (const item of project.board.items) {
      let shown = item;
      if (drag?.ids.includes(item.id) && item.type !== "arrow") shown = { ...item, x: item.x + drag.dx, y: item.y + drag.dy } as BoardItem;
      if (resizeDraft?.id === item.id) shown = { ...shown, w: resizeDraft.w, h: resizeDraft.h } as BoardItem;
      map.set(item.id, shown);
    }
    return map;
  }, [project, drag, resizeDraft]);

  useEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    // Native listener: React's onWheel is passive and cannot prevent the browser zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const cam = useEditor.getState().camera;
      if (e.ctrlKey || e.metaKey) {
        useEditor.setState({ camera: zoomAt(cam, point, cam.zoom * Math.exp(-e.deltaY * 0.01)) });
      } else {
        useEditor.setState({ camera: { ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input, textarea, select")) {
        spaceDown.current = e.type === "keydown";
        el.style.cursor = spaceDown.current ? "grab" : "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Navigation flows: from each link/button with a target screen to that screen's placement.
  useLayoutEffect(() => {
    if (!showFlows) {
      setFlows([]);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const origin = containerRef.current?.getBoundingClientRect();
      if (!origin) return;
      const cam = useEditor.getState().camera;
      const next: { id: string; from: Point; to: Point; targetId: string }[] = [];
      const sources = sourcesOf(project);
      // Site-wide navigation (the same link on several screens, e.g. a header) only shows arrows
      // from selected screens; otherwise every page would point at every other page.
      const perFrame = new Map<string, ReturnType<typeof navTargets>>();
      const screensWithKey = new Map<string, Set<string>>();
      for (const frame of frames.values()) {
        if (frame.kind === "component") continue;
        const targets = navTargets(frame.current, sources);
        perFrame.set(frame.id, targets);
        for (const t of targets) if (t.sharedKey) (screensWithKey.get(t.sharedKey) ?? screensWithKey.set(t.sharedKey, new Set()).get(t.sharedKey)!).add(frame.id);
      }
      const selected = new Set(useEditor.getState().selection);
      for (const placement of project.board.items) {
        if (placement.type !== "frame") continue;
        const frame = frames.get(placement.frameId);
        const handle = frameHandle(placement.id);
        // Component definitions are building blocks, not screens: their links aren't flows.
        if (!frame || !handle || frame.kind === "component") continue;
        for (const { elementId, targetFrameId, sharedKey } of perFrame.get(frame.id) ?? []) {
          if (sharedKey && (screensWithKey.get(sharedKey)?.size ?? 0) > 2 && !selected.has(placement.id)) continue;
          const target = project.board.items.find((i) => i.type === "frame" && i.frameId === targetFrameId && i.id !== placement.id);
          const rect = handle.nodeRect(elementId);
          const targetBounds = target && itemBounds(target, frames, sizes);
          if (!rect || !targetBounds) continue;
          const topLeft = screenToWorld(cam, { x: rect.x - origin.left, y: rect.y - origin.top });
          const nodeRect = { x: topLeft.x, y: topLeft.y, w: rect.w / cam.zoom, h: rect.h / cam.zoom };
          next.push({
            id: `${placement.id}:${elementId}`,
            from: clipToRect(nodeRect, center(targetBounds)),
            to: clipToRect(targetBounds, center(nodeRect)),
            targetId: target.id,
          });
        }
      }
      setFlows(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [project, sizes, showFlows, frames, camera.zoom, selection]);

  const toScreen = (e: React.PointerEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toWorld = (e: React.PointerEvent): Point => screenToWorld(useEditor.getState().camera, toScreen(e));

  /** Boxes the board snaps to: items in and around the view (not arrows, not the moving ones). */
  const boardCandidates = (exclude: readonly string[]): Rect[] => {
    const cam = useEditor.getState().camera;
    const around = visibleWorldRect(cam, viewport);
    const area = { x: around.x - around.w, y: around.y - around.h, w: around.w * 3, h: around.h * 3 };
    return project.board.items
      .filter((i) => i.type !== "arrow" && !exclude.includes(i.id))
      .map((i) => itemBounds(i, frames, sizes))
      .filter((r): r is Rect => r !== undefined && intersects(r, area));
  };
  /** Board snapping: 6 screen px, the 24-unit dot grid. */
  const boardSnap = (): SnapOptions => {
    const { snap, camera: cam } = useEditor.getState();
    return { threshold: 6 / cam.zoom, guides: snap.guides, ...(snap.grid && { grid: BOARD_GRID }) };
  };

  const create = (item: BoardItem, index?: number, edit = false) => {
    if (dispatch([{ id: newOpId(), op: "addItem", item, ...(index !== undefined && { index }) }])) {
      useEditor.setState({ selection: [item.id], tool: "select", editingId: edit ? item.id : undefined });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as Element;
    if (target.closest("[data-no-drag]")) return;
    const state = useEditor.getState();
    if (state.editingId || state.editingText || state.editingProp) return; // the blur of the inline editor commits first
    // Keep focus where it is (e.g. on a just-created note's editor) and avoid text selection.
    e.preventDefault();
    const screen = toScreen(e);
    const world = screenToWorld(state.camera, screen);
    containerRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || state.tool === "hand" || spaceDown.current) {
      gesture.current = { kind: "pan", start: screen, camera: state.camera };
      return;
    }
    if (e.button !== 0) return;
    if (state.tool === "draw") {
      startDraw(e, world, target);
      return;
    }
    const flowTarget = target.closest("[data-flow-target]")?.getAttribute("data-flow-target");
    if (flowTarget && state.tool === "select") {
      gesture.current = { kind: "jump", start: screen, targetId: flowTarget };
      return;
    }
    const itemId = itemAt(target);

    // Inside a screen: select the element under the pointer (and allow dragging it).
    const content = target.closest("[data-frame-content]");
    if (content && state.tool === "select") {
      const placementId = content.getAttribute("data-frame-content")!;
      const placement = project.board.items.find((i) => i.id === placementId);
      const hitId = frameHandle(placementId)?.nodeAt(e.clientX, e.clientY);
      const frame = placement?.type === "frame" ? frames.get(placement.frameId) : undefined;
      const selectedHere = state.node?.itemId === placementId ? state.node.nodeId : undefined;
      // a proposal shown on the screen is reviewed, not edited: clicks select the screen
      const proposal = frame && project.requests?.find((r) => r.frameId === frame.id && r.status === "proposed" && (state.proposalView[r.id] ?? "after") === "after");
      const nodeId = frame && hitId && !proposal ? clickTarget(frame.current, hitId, selectedHere) : undefined;
      if (placement?.type === "frame" && nodeId) {
        const sel: NodeSelection = { itemId: placementId, frameId: placement.frameId, nodeId };
        // Shift: add to the selection (or take out), on any screen
        if (e.shiftKey && state.node) {
          toggleNodeSelection(sel);
          return;
        }
        const alreadySelected = selectedNodes(state).some((s) => s.itemId === sel.itemId && s.nodeId === sel.nodeId);
        if (!alreadySelected) selectNode(sel);
        gesture.current = { kind: "node", sel, start: { x: e.clientX, y: e.clientY }, moved: false, freeDrag: e.ctrlKey || e.metaKey };
        return;
      }
    }

    switch (state.tool) {
      case "note":
        create({ type: "note", id: newItemId(), x: Math.round(world.x - DEFAULT_NOTE_SIZE.w / 2), y: Math.round(world.y - DEFAULT_NOTE_SIZE.h / 2), text: "", color: "yellow" }, undefined, true);
        return;
      case "text":
        create({ type: "text", id: newItemId(), x: Math.round(world.x), y: Math.round(world.y), text: "Text" }, undefined, true);
        return;
      case "section": {
        const snapped = e.altKey ? NO_SNAP : snapMove({ ...world, w: 0, h: 0 }, boardCandidates([]), boardSnap());
        gesture.current = { kind: "section", start: { x: world.x + snapped.dx, y: world.y + snapped.dy } };
        return;
      }
      case "arrow":
        if (itemId && project.board.items.find((i) => i.id === itemId)?.type !== "arrow") {
          gesture.current = { kind: "arrow", fromId: itemId };
          setArrowDraft({ fromId: itemId, to: world });
        }
        return;
    }

    const handle = target.closest("[data-handle]");
    if (handle && itemId) {
      const item = project.board.items.find((i) => i.id === itemId);
      const rect = item && itemBounds(item, frames, sizes);
      if (rect) gesture.current = { kind: "resize", id: itemId, start: world, rect };
      return;
    }
    if (itemId) {
      let next = state.selection;
      if (e.shiftKey) next = next.includes(itemId) ? next.filter((id) => id !== itemId) : [...next, itemId];
      else if (!next.includes(itemId)) next = [itemId];
      useEditor.setState({ selection: next, node: undefined });
      if (next.includes(itemId)) gesture.current = { kind: "move", start: world, ids: dragSet(project, next, sizes), moved: false, selected: next, clicked: itemId };
      return;
    }
    if (!e.shiftKey) useEditor.setState({ selection: [], node: undefined });
    gesture.current = { kind: "marquee", start: world, additive: e.shiftKey };
  };

  /** Draw tool: a shape starts on the screen under the pointer (which becomes the one drawn on). */
  const startDraw = (e: React.PointerEvent, world: Point, target: Element) => {
    // a label being typed is done (the board keeps the focus from moving on its own)
    (document.activeElement as HTMLElement | null)?.blur?.();
    const state = useEditor.getState();
    const placement = project.board.items.find((i) => i.id === itemAt(target));
    const screen = placement?.type === "frame" ? placementTarget(project, placement.id) : undefined;
    if (placement?.type !== "frame" || !screen || screen.frame.kind === "component") {
      if (!state.drawingOn) notify("Click a screen to draw on it.");
      return;
    }
    if (state.drawingOn !== placement.id) {
      const request = requestFor(project, screen.frame.id, screen.viewportId);
      useEditor.setState({ drawingOn: placement.id, openRequest: request?.id });
    }
    const origin = { x: placement.x, y: placement.y };
    const local: [number, number] = [world.x - origin.x, world.y - origin.y];
    switch (state.draw.tool) {
      case "label":
        useEditor.setState({ labelDraft: { itemId: placement.id, x: local[0], y: local[1] } });
        return;
      case "eraser":
        gesture.current = { kind: "erase", itemId: placement.id, origin };
        eraseAt(placement.id, local);
        return;
      default: {
        const g = { kind: "draw" as const, itemId: placement.id, origin, shapeId: newShapeId(), points: [local] };
        gesture.current = g;
        const shape = dragShape(state.draw, g.shapeId, g.points, e.shiftKey);
        useEditor.setState({ markupDraft: shape && { itemId: placement.id, shape } });
      }
    }
  };
  const eraseAt = (itemId: string, at: [number, number]) => {
    const current = useEditor.getState().project!;
    const screen = placementTarget(current, itemId);
    const request = screen && requestFor(current, screen.frame.id, screen.viewportId);
    const hit = request && shapeAt(request.shapes, at[0], at[1], 6 / useEditor.getState().camera.zoom);
    if (request && hit) dispatch(removeShapesOps(request, [hit.id]));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) {
      updateHover(e);
      return;
    }
    const world = toWorld(e);
    switch (g.kind) {
      case "draw": {
        const point: [number, number] = [world.x - g.origin.x, world.y - g.origin.y];
        const last = g.points.at(-1)!;
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) * camera.zoom < 1) break;
        g.points.push(point);
        const shape = dragShape(useEditor.getState().draw, g.shapeId, g.points, e.shiftKey);
        useEditor.setState({ markupDraft: shape && { itemId: g.itemId, shape } });
        break;
      }
      case "erase":
        eraseAt(g.itemId, [world.x - g.origin.x, world.y - g.origin.y]);
        break;
      case "node": {
        if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_THRESHOLD * 2) return;
        g.moved = true;
        if (g.freeDrag || useEditor.getState().freeMove) {
          g.free ??= startFreeDrag(g.sel);
          if (!g.free) break;
          const f = g.free;
          let dx = e.clientX - g.start.x;
          let dy = e.clientY - g.start.y;
          const lock = e.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? "x" : "y") : undefined;
          if (lock === "x") dy = 0;
          if (lock === "y") dx = 0;
          // inside the parent's content box; full-width (or bigger) elements keep at least 16 px inside
          const clamp = (d: number, start: number, size: number, lo: number, hi: number) =>
            Math.min(Math.max(d, lo - start), (size < hi - lo - 1 ? hi - size : hi - 16) - start);
          dx = clamp(dx, f.rect.x, f.rect.w, f.parent.x, f.parent.x + f.parent.w);
          dy = clamp(dy, f.rect.y, f.rect.h, f.parent.y, f.parent.y + f.parent.h);
          const { snap } = useEditor.getState();
          const snapped = e.altKey
            ? NO_SNAP
            : snapMove({ ...f.rect, x: f.rect.x + dx, y: f.rect.y + dy }, f.siblings, { threshold: 6, guides: snap.guides, ...(snap.grid && { grid: f.grid, origin: { x: f.parent.x, y: f.parent.y } }), container: f.parent }, lock);
          dx = clamp(dx + snapped.dx, f.rect.x, f.rect.w, f.parent.x, f.parent.x + f.parent.w);
          dy = clamp(dy + snapped.dy, f.rect.y, f.rect.h, f.parent.y, f.parent.y + f.parent.h);
          useEditor.setState({ elementGuides: { lines: snapped.lines, measures: snapped.measures } });
          f.dx = dx / camera.zoom;
          f.dy = dy / camera.zoom;
          f.el.style.setProperty("translate", `${f.dx}px ${f.dy}px`, "important");
          refreshOverlay();
          break;
        }
        const target = computeDrop(project, g.sel.itemId, e.clientX, e.clientY, g.sel.nodeId);
        setDrop(target?.itemId === g.sel.itemId ? target : undefined);
        break;
      }
      case "pan": {
        const screen = toScreen(e);
        useEditor.setState({ camera: { ...g.camera, x: g.camera.x + screen.x - g.start.x, y: g.camera.y + screen.y - g.start.y } });
        break;
      }
      case "move": {
        let dx = world.x - g.start.x;
        let dy = world.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * camera.zoom < DRAG_THRESHOLD) return;
        g.moved = true;
        // Shift: only along the axis moved most; Alt: no snapping
        const lock = e.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? "x" : "y") : undefined;
        if (lock === "x") dy = 0;
        if (lock === "y") dx = 0;
        const group = unionRects(g.ids.map((id) => project.board.items.find((i) => i.id === id)).filter((i): i is BoardItem => i !== undefined && i.type !== "arrow").map((i) => itemBounds(i, frames, sizes)).filter((r): r is Rect => r !== undefined));
        const snapped = group && !e.altKey ? snapMove({ ...group, x: group.x + dx, y: group.y + dy }, boardCandidates(g.ids), boardSnap(), lock) : NO_SNAP;
        setBoardGuides(snapped);
        setDrag({ ids: g.ids, dx: dx + snapped.dx, dy: dy + snapped.dy });
        break;
      }
      case "marquee":
        setMarquee(rectFromPoints(g.start, world));
        break;
      case "section": {
        const snapped = e.altKey ? NO_SNAP : snapMove({ ...world, w: 0, h: 0 }, boardCandidates([]), boardSnap());
        setBoardGuides(snapped);
        setSectionDraft(rectFromPoints(g.start, { x: world.x + snapped.dx, y: world.y + snapped.dy }));
        break;
      }
      case "arrow":
        setArrowDraft({ fromId: g.fromId, to: world });
        break;
      case "resize": {
        const w = Math.max(80, g.rect.w + world.x - g.start.x);
        let h = Math.max(60, g.rect.h + world.y - g.start.y);
        // pictures keep their proportions
        if (project.board.items.find((i) => i.id === g.id)?.type === "image") {
          h = (w * g.rect.h) / g.rect.w;
          setResizeDraft({ id: g.id, w, h });
          break;
        }
        const snapped = e.altKey ? NO_SNAP : snapResize({ x: g.rect.x, y: g.rect.y, w, h }, { x: 1, y: 1 }, boardCandidates([g.id]), boardSnap());
        setBoardGuides(snapped);
        setResizeDraft({ id: g.id, w: Math.max(80, w + snapped.dx), h: Math.max(60, h + snapped.dy) });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = undefined;
    setBoardGuides(undefined);
    if (!g) return;
    switch (g.kind) {
      case "draw": {
        const shape = dragShape(useEditor.getState().draw, g.shapeId, g.points, e.shiftKey);
        useEditor.setState({ markupDraft: undefined });
        const done = shape && finishShape(shape);
        if (done) commitShape(g.itemId, done);
        break;
      }
      case "node":
        if (g.free) {
          g.free.el.style.cssText = g.free.saved;
          useEditor.setState({ elementGuides: undefined });
          const ops = freeMoveOps(project, g.sel, Math.round(g.free.dx), Math.round(g.free.dy));
          if (ops.length && dispatch(ops) && useEditor.getState().freeMove) useEditor.setState({ freeMoveUsedOn: g.sel.nodeId });
          refreshOverlay();
        } else if (g.moved && drop) {
          dispatch(drop.beside ? besideOps(project, g.sel, drop.beside.nodeId, drop.beside.side) : moveToOps(project, g.sel, drop.parentId, drop.index));
        } else if (!g.moved && useEditor.getState().extraNodes.length > 0) {
          // a click (no drag) on one of several selected elements selects just that one
          useEditor.setState({ node: g.sel, extraNodes: [] });
        }
        break;
      case "jump":
        if (Math.hypot(toScreen(e).x - g.start.x, toScreen(e).y - g.start.y) < DRAG_THRESHOLD * 2) goTo({ itemId: g.targetId });
        break;
      case "move": {
        // A click on an arrow (not a drag) also shows what it points at; it stays selected.
        const clicked = !g.moved && !e.shiftKey ? project.board.items.find((i) => i.id === g.clicked) : undefined;
        if (clicked?.type === "arrow") {
          window.clearTimeout(pendingJump.current);
          pendingJump.current = window.setTimeout(() => {
            goTo(clicked.to);
            useEditor.setState({ selection: [clicked.id] });
          }, 280);
        }
        if (!g.moved || !drag) break;
        const ops: BoardOp[] = moveOps(project, g.ids, drag.dx, drag.dy);
        const moved = applyCommandToProject(project, ops);
        const notes = g.selected.filter((id) => moved.board.items.find((i) => i.id === id)?.type === "note");
        dispatch([...ops, ...attachOps(moved, notes, sizes)]);
        break;
      }
      case "marquee": {
        if (!marquee) break;
        const hit = project.board.items
          .filter((item) => {
            const bounds = itemBounds(item, frames, sizes);
            return bounds && intersects(bounds, marquee);
          })
          .map((i) => i.id);
        const base = g.additive ? useEditor.getState().selection : [];
        useEditor.setState({ selection: [...new Set([...base, ...hit])] });
        break;
      }
      case "section":
        if (sectionDraft && sectionDraft.w > 20 && sectionDraft.h > 20) {
          const r = sectionDraft;
          create({ type: "section", id: newItemId(), name: "Section", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, 0);
        }
        break;
      case "arrow": {
        const targetId = itemAt(document.elementFromPoint(e.clientX, e.clientY));
        const target = project.board.items.find((i) => i.id === targetId);
        const to = target && target.type !== "arrow" && target.id !== g.fromId ? { itemId: target.id } : (() => {
          const p = toWorld(e);
          return { x: Math.round(p.x), y: Math.round(p.y) };
        })();
        create({ type: "arrow", id: newItemId(), kind: "flow", from: { itemId: g.fromId }, to });
        break;
      }
      case "resize":
        if (resizeDraft) {
          dispatch([{ id: newOpId(), op: "updateItem", itemId: g.id, patch: { w: Math.round(resizeDraft.w), h: Math.round(resizeDraft.h) } }]);
        }
        break;
    }
    setDrag(undefined);
    setMarquee(undefined);
    setSectionDraft(undefined);
    setArrowDraft(undefined);
    setResizeDraft(undefined);
    setDrop(undefined);
  };

  const hoverFrame = useRef(0);
  const updateHover = (e: React.PointerEvent) => {
    const target = e.target as Element;
    const clientX = e.clientX;
    const clientY = e.clientY;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const state = useEditor.getState();
      const content = state.tool === "select" ? target.closest?.("[data-frame-content]") : null;
      const placementId = content?.getAttribute("data-frame-content");
      const placement = placementId ? project.board.items.find((i) => i.id === placementId) : undefined;
      const nodeId = placementId ? frameHandle(placementId)?.nodeAt(clientX, clientY) : undefined;
      const next = placement?.type === "frame" && nodeId ? { itemId: placement.id, frameId: placement.frameId, nodeId } : undefined;
      const current = state.hover;
      if (current?.itemId !== next?.itemId || current?.nodeId !== next?.nodeId) useEditor.setState({ hover: next });
    });
  };

  /** Right-click: on the empty board, a menu of what can go there. No browser menu over the board (except in text). */
  const onContextMenu = (e: React.MouseEvent) => {
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    e.preventDefault();
    if (itemAt(target) || target.closest("[data-frame-content], [data-flow-target], [data-no-drag]")) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    useEditor.setState({ selection: [], node: undefined });
    setQuickMenu({ screen, world: screenToWorld(useEditor.getState().camera, screen) });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    window.clearTimeout(pendingJump.current);
    // Pointer capture retargets click events to the canvas; find what is really under the pointer.
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const { node } = useEditor.getState();
    if (target.closest("[data-frame-content]") && node) {
      const frame = project.frames.find((f) => f.id === node.frameId);
      const selected = frame && findNode(frame.current, node.nodeId)?.node;
      if (selected?.type === "text") useEditor.setState({ editingText: true });
      if (selected?.type === "instance") editTextProp(node, selected, e.clientX, e.clientY);
      return;
    }
    const itemId = itemAt(target);
    const item = project.board.items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.type === "note" || item.type === "text" || item.type === "arrow" || (item.type === "section" && target.closest("[data-section-title]"))) {
      useEditor.setState({ editingId: item.id, selection: [item.id] });
    }
  };

  /** Dragging a component from the library over a screen: where it would land. */
  const componentDrop = (e: React.DragEvent): DropTarget | undefined => {
    const content = (e.target as Element).closest?.("[data-frame-content]");
    const itemId = content?.getAttribute("data-frame-content");
    return itemId ? computeDrop(project, itemId, e.clientX, e.clientY, undefined, false) : undefined;
  };
  const draggingFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  /** A page or section from the library over a screen: where it would land. */
  const libraryTargetAt = (e: React.DragEvent): DropTarget | undefined => {
    const drag = getLibraryDrag();
    const itemId = (e.target as Element).closest?.("[data-frame-content]")?.getAttribute("data-frame-content");
    return drag && itemId ? libraryDrop(project, itemId, e.clientY, drag.kind) : undefined;
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!getDraggedComponent() && !draggingFiles(e) && !getLibraryDrag()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const target = getLibraryDrag() ? libraryTargetAt(e) : componentDrop(e);
    setDrop((current) => (current?.parentId === target?.parentId && current?.index === target?.index ? current : target));
  };
  const onDrop = (e: React.DragEvent) => {
    const library = getLibraryDrag();
    if (library) {
      e.preventDefault();
      const target = libraryTargetAt(e);
      setLibraryDrag(undefined);
      setDrop(undefined);
      const placement = target && project.board.items.find((i) => i.id === target.itemId);
      if (target && placement?.type === "frame") {
        if (library.kind === "page") applyTemplate(library.key, placement.frameId, placement.id);
        else insertSection(library.key, placement.frameId, placement.id, target.index);
      } else if (!(e.target as Element).closest?.("[data-frame-content]")) {
        // onto the empty board: a new screen there
        const rect = containerRef.current!.getBoundingClientRect();
        const world = screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        const at = { x: Math.round(world.x), y: Math.round(world.y) };
        if (library.kind === "page") screenFromTemplate(library.key, at);
        else screenFromSection(library.key, at);
      }
      return;
    }
    if (draggingFiles(e)) {
      e.preventDefault(); // never let the browser open the file instead
      setDrop(undefined);
      const files = imageFiles(e.dataTransfer.files);
      if (files.length === 0) {
        notify("Only images can be added to the board (PNG, JPG, GIF, WebP, AVIF, SVG).", "warn");
        return;
      }
      const target = componentDrop(e);
      const placement = target && project.board.items.find((i) => i.id === target.itemId);
      if (target && placement?.type === "frame") {
        // onto a picture: replace it; elsewhere in the screen: insert where the line shows
        const frame = project.frames.find((f) => f.id === placement.frameId);
        const under = frameHandle(target.itemId)?.nodeAt(e.clientX, e.clientY);
        const node = frame && under ? findNode(frame.current, under)?.node : undefined;
        if (node?.type === "image" && files.length === 1) {
          selectNode({ itemId: placement.id, frameId: placement.frameId, nodeId: node.id });
          void replaceImage(files[0]!, placement.frameId, node.id);
        } else {
          void insertImages(files, { itemId: placement.id, frameId: placement.frameId, parentId: target.parentId, index: target.index });
        }
      } else if (!(e.target as Element).closest?.("[data-frame-content]")) {
        const rect = containerRef.current!.getBoundingClientRect();
        void addBoardImages(files, screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
      }
      return;
    }
    const componentId = getDraggedComponent();
    const target = componentId ? componentDrop(e) : undefined;
    setDrop(undefined);
    if (!componentId || !target) return;
    e.preventDefault();
    const placement = project.board.items.find((i) => i.id === target.itemId);
    if (placement?.type !== "frame") return;
    const error = placementError(project, placement.frameId, componentId);
    if (error) {
      notify(error);
      return;
    }
    const node = newInstance(componentId);
    if (dispatch([{ id: newOpId(), frameId: placement.frameId, op: "insert", parentId: target.parentId, index: target.index, node }])) {
      selectNode({ itemId: placement.id, frameId: placement.frameId, nodeId: node.id });
    }
  };

  /** Double-click on a text inside an instance: edit the property bound to it in place. */
  const editTextProp = (sel: NodeSelection, instance: InstanceNode, clientX: number, clientY: number) => {
    const elementId = frameHandle(sel.itemId)?.innerAt(clientX, clientY);
    const source = sourcesOf(project).get(instance.componentId);
    // Only texts directly inside this instance (`<instance>/<text>`), not in nested instances.
    const innerId = elementId?.startsWith(`${sel.nodeId}/`) ? elementId.slice(sel.nodeId.length + 1) : undefined;
    if (!source) return;
    const hit = innerId && !innerId.includes("/") ? boundProp(source.def, innerId, "text") : undefined;
    if (hit) {
      useEditor.setState({ editingProp: { sel, prop: hit.name, elementId: elementId! } });
      return;
    }
    // Not on a text property: with a single one (e.g. a button's label), edit that.
    const texts = source.def.props.flatMap((p) => (p.bindings ?? []).filter((b) => b.field === "text").map((b) => ({ prop: p, nodeId: b.nodeId })));
    if (texts.length === 1) {
      useEditor.setState({ editingProp: { sel, prop: texts[0]!.prop.name, elementId: `${sel.nodeId}/${texts[0]!.nodeId}` } });
    }
  };

  const visible = visibleWorldRect(camera, viewport);
  const margin = { x: visible.x - visible.w * 0.5, y: visible.y - visible.h * 0.5, w: visible.w * 2, h: visible.h * 2 };
  const cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
  const drawingOn = useEditor((s) => s.drawingOn);
  const gridSize = BOARD_GRID * camera.zoom;
  const arrowFrom = arrowDraft && displayItems.get(arrowDraft.fromId);
  const arrowFromBounds = arrowFrom && itemBounds(arrowFrom, frames, sizes);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (el !== container) setContainer(el);
      }}
      data-testid="canvas"
      className="absolute inset-0 touch-none overflow-hidden select-none"
      style={{
        cursor,
        // cool lavender grey with a dot grid (index.css --color-canvas)
        backgroundColor: "#f3f2f7",
        backgroundImage: gridSize > 6 ? "radial-gradient(circle, rgb(31 27 46 / 0.17) 1px, transparent 1.2px)" : undefined,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => useEditor.setState({ hover: undefined })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.target === containerRef.current) setDrop(undefined);
      }}
      onDrop={onDrop}
    >
      <div
        className="absolute left-0 top-0"
        style={{ transformOrigin: "0 0", transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {/* drawing on a screen: the rest of the board steps back */}
        {drawingOn && <style>{`[data-testid="canvas"] [data-item-id]:not([data-item-id="${CSS.escape(drawingOn)}"]) { opacity: 0.35; }`}</style>}
        {project.board.items.map((original) => {
          const item = displayItems.get(original.id)!;
          const selected = selection.includes(item.id);
          const props = { selected, zoom: camera.zoom, offset: undefined };
          switch (item.type) {
            case "frame": {
              const bounds = itemBounds(item, frames, sizes)!;
              return <FrameItem key={item.id} item={item} frame={frames.get(item.frameId)} project={project} visible={intersects(bounds, margin)} {...props} />;
            }
            case "note":
              return <NoteItem key={item.id} item={item} {...props} />;
            case "section":
              return <SectionItem key={item.id} item={item} {...props} />;
            case "text":
              return <TextItem key={item.id} item={item} {...props} />;
            case "image":
              return <ImageItem key={item.id} item={item} {...props} />;
            default:
              return null;
          }
        })}
        <Arrows
          items={displayItems}
          frames={frames}
          sizes={sizes}
          zoom={camera.zoom}
          selection={selection}
          draft={arrowFromBounds && arrowDraft ? { from: center(arrowFromBounds), to: arrowDraft.to } : undefined}
          flows={flows}
        />
        {boardGuides && <Guides lines={boardGuides.lines} measures={boardGuides.measures} unit={1 / camera.zoom} />}
        {(marquee ?? sectionDraft) && (
          <div
            className={`pointer-events-none absolute ${sectionDraft ? "rounded-xl border-dashed" : ""}`}
            style={{
              left: (marquee ?? sectionDraft)!.x,
              top: (marquee ?? sectionDraft)!.y,
              width: (marquee ?? sectionDraft)!.w,
              height: (marquee ?? sectionDraft)!.h,
              border: `${1 / camera.zoom}px ${sectionDraft ? "dashed" : "solid"} #7a2dbf`,
              background: "rgba(255, 122, 69, 0.08)",
            }}
          />
        )}
      </div>
      <Overlay container={container} drop={drop} />
      {quickMenu && <QuickMenu at={quickMenu} onClose={closeQuickMenu} />}
    </div>
  );
}
