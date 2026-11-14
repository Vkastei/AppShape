import { conditionKey, type DesignNode, findNode, isContainer, type Project, themedTokens } from "@appshape/ir";
import { listOf } from "./DataFields";
import { AskAi } from "./Markup";
import { RichTextEditor, spansToHtml } from "./RichText";
import { useLayoutEffect, useRef, useState } from "react";
import { type ClientRect, frameHandle } from "../lib/frames";
import { componentName as nameOf } from "../lib/components";
import { nodeLabel } from "../lib/nodes";
import { dispatch, type NodeSelection, useEditor } from "../store";
import { newOpId } from "../lib/board";
import { forCopies } from "../lib/linked";
import { boxOps, editCondition, handleDirection, styleOps, proportionalHandle, type ResizeHandle, resizeBox, resizedSize, scaleTextOps, screenGrid } from "../lib/edits";
import { type Box, snapResize } from "../lib/snap";
import { Guides } from "./Guides";

/** Overlays re-measure on this event while something is dragged inside a screen. */
export const overlayRefresh = new EventTarget();
export const refreshOverlay = () => overlayRefresh.dispatchEvent(new Event("refresh"));

export interface DropTarget {
  itemId: string;
  parentId: string;
  index: number;
  /** Indicator line in client coordinates. */
  line: ClientRect;
  /** The receiving container (outlined while dragging). */
  container: ClientRect;
  /** What the drop does ("Between Title and Text", "Beside Image", "Into Card"). */
  label: string;
  /** Next to an element in a vertical layout: both go into a new row. */
  beside?: { nodeId: string; side: "before" | "after" };
}

interface OverlayProps {
  container: HTMLDivElement | null;
  drop: DropTarget | undefined;
}

function rectOf(sel: NodeSelection | undefined): ClientRect | undefined {
  return sel ? frameHandle(sel.itemId)?.nodeRect(sel.nodeId) : undefined;
}

/** Hover/selection outlines, drop indicator and the inline text editor, in screen space. */
export function Overlay({ container, drop }: OverlayProps) {
  const project = useEditor((s) => s.project)!;
  const camera = useEditor((s) => s.camera);
  const node = useEditor((s) => s.node);
  const extraNodes = useEditor((s) => s.extraNodes);
  const editState = useEditor((s) => s.state);
  const hover = useEditor((s) => s.hover);
  const sizes = useEditor((s) => s.sizes);
  const editingText = useEditor((s) => s.editingText);
  const editingProp = useEditor((s) => s.editingProp);
  const tool = useEditor((s) => s.tool);
  const guides = useEditor((s) => s.elementGuides);
  const [tick, setTick] = useState(0);
  const [rects, setRects] = useState<{ hover?: ClientRect; node?: ClientRect; extras: ClientRect[]; prop?: ClientRect; origin: { x: number; y: number } }>({ extras: [], origin: { x: 0, y: 0 } });

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const origin = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const prop = editingProp && frameHandle(editingProp.sel.itemId)?.nodeRect(editingProp.elementId);
      const extras = extraNodes.map(rectOf).filter((r): r is ClientRect => r !== undefined);
      setRects({ hover: rectOf(hover), node: rectOf(node), extras, prop, origin: { x: origin.left, y: origin.top } });
    });
    return () => cancelAnimationFrame(frame);
  }, [container, camera, project, node, extraNodes, editState, hover, sizes, editingProp, tick]);

  useLayoutEffect(() => {
    const onRefresh = () => setTick((t) => t + 1);
    overlayRefresh.addEventListener("refresh", onRefresh);
    return () => overlayRefresh.removeEventListener("refresh", onRefresh);
  }, []);

  const local = (r: ClientRect) => ({ left: r.x - rects.origin.x, top: r.y - rects.origin.y, width: r.w, height: r.h });
  const selectedLocation = node && findNode(project.frames.find((f) => f.id === node.frameId)?.current ?? ({} as DesignNode), node.nodeId);
  const selectedNode = selectedLocation?.node;
  const componentName = (id: string) => nameOf(project, id);
  // Ask AI at a selected screen or section (web screens; not while editing text or drawing)
  const selectedFrame = node ? project.frames.find((f) => f.id === node.frameId) : undefined;
  const askAi =
    selectedFrame && selectedFrame.kind !== "component" && selectedFrame.platform === "web" && tool === "select" && !editingText && extraNodes.length === 0 && (!selectedLocation?.parent || selectedLocation.parent.id === selectedFrame.current.id)
      ? selectedFrame
      : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {rects.hover && !(hover && node && hover.itemId === node.itemId && hover.nodeId === node.nodeId) && (
        <div className="absolute border border-accent-400" style={local(rects.hover)} />
      )}
      {rects.node && selectedNode && (
        <div className="absolute border-2 border-accent-600" style={local(rects.node)} data-testid="node-selection">
          <div className="absolute -top-5 left-[-2px] whitespace-nowrap rounded-t bg-accent-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            {extraNodes.length > 0
              ? `${extraNodes.length + 1} selected`
              : `${nodeLabel(selectedNode, componentName)} · ${Math.round(rects.node.w / camera.zoom)}×${Math.round(rects.node.h / camera.zoom)}${editState ? ` · ${STATE_LABEL[editState]}` : ""}`}
          </div>
          {tool === "select" && !editingText && extraNodes.length === 0 && selectedLocation?.parent && node && <ResizeHandles sel={node} />}
          {tool === "select" && !editingText && extraNodes.length === 0 && selectedLocation?.parent && node && <RotateHandle sel={node} />}
        </div>
      )}
      {rects.node && selectedNode && askAi && (
        <div className="absolute flex -translate-x-full -translate-y-full justify-end pb-1.5" style={{ left: rects.node.x - rects.origin.x + rects.node.w, top: rects.node.y - rects.origin.y }} data-testid="ask-ai">
          <AskAi sel={node!} frame={askAi} />
        </div>
      )}
      {rects.extras.map((r, i) => (
        <div key={i} className="absolute border-2 border-accent-600" style={local(r)} data-testid="node-selection" />
      ))}
      {guides && <Guides lines={guides.lines} measures={guides.measures} unit={1} offset={rects.origin} />}
      {drop && (
        <>
          <div className="absolute rounded-sm border border-dashed border-accent-600/70" style={local(drop.container)} data-testid="drop-container" />
          <div className="absolute rounded-full bg-accent-600" style={local(drop.line)} />
          <div
            className="absolute whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ left: drop.line.x - rects.origin.x + drop.line.w + 6, top: drop.line.y - rects.origin.y + drop.line.h / 2, transform: "translateY(-50%)" }}
            data-testid="drop-label"
          >
            {drop.label}
          </div>
        </>
      )}
      {editingText && rects.node && selectedNode?.type === "text" && node && (
        <TextNodeEditor key={node.nodeId} sel={node} node={selectedNode} style={local(rects.node)} />
      )}
      {editingProp && rects.prop && (
        <TextEditor
          key={editingProp.elementId}
          itemId={editingProp.sel.itemId}
          elementId={editingProp.elementId}
          initial={frameHandle(editingProp.sel.itemId)?.element(editingProp.elementId)?.textContent ?? ""}
          style={local(rects.prop)}
          onCommit={(text) =>
            dispatch([{ id: newOpId(), frameId: editingProp.sel.frameId, op: "setProps", nodeId: editingProp.sel.nodeId, props: { [editingProp.prop]: text } }])
          }
          onDone={() => useEditor.setState({ editingProp: undefined })}
        />
      )}
    </div>
  );
}

/** How a state is called in the editor (the format's `active` is "Pressed"). */
export const STATE_LABEL: Record<string, string> = { hover: "Hover", focus: "Focus", active: "Pressed", disabled: "Disabled", "group-hover": "Group hover" };

const HANDLES: { id: ResizeHandle; cursor: string }[] = [
  { id: "nw", cursor: "nwse-resize" },
  { id: "n", cursor: "ns-resize" },
  { id: "ne", cursor: "nesw-resize" },
  { id: "e", cursor: "ew-resize" },
  { id: "se", cursor: "nwse-resize" },
  { id: "s", cursor: "ns-resize" },
  { id: "sw", cursor: "nesw-resize" },
  { id: "w", cursor: "ew-resize" },
];

const limit = (value: string, none: number) => (value === "none" || value === "auto" || value === "" ? none : parseFloat(value) || 0);

/**
 * Resize handles on the selected element: corners keep the proportions, sides change one
 * dimension. The element is previewed with inline sizes while dragging; the release writes one
 * box edit (current breakpoint, all linked copies unless "this one only").
 */
/** Above the selection: drag to rotate the element around its center (Shift: 15° steps). */
function RotateHandle({ sel }: { sel: NodeSelection }) {
  const drag = useRef<{ el: HTMLElement; saved: string; center: { x: number; y: number }; startPointer: number; start: number; angle: number; v4: boolean }>(undefined);
  const [badge, setBadge] = useState<string>();
  const pointerAngle = (e: React.PointerEvent, c: { x: number; y: number }) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = frameHandle(sel.itemId)?.element(sel.nodeId) as HTMLElement | undefined;
    const { project } = useEditor.getState();
    const frame = project?.frames.find((f) => f.id === sel.frameId);
    const node = frame && findNode(frame.current, sel.nodeId)?.node;
    if (!el || !frame || !node || !project) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const when = editCondition(frame);
    const shown = when ? (node.overrides?.find((o) => conditionKey(o.when) === conditionKey(when))?.style?.rotate ?? node.style?.rotate) : node.style?.rotate;
    drag.current = { el, saved: el.style.cssText, center, startPointer: pointerAngle(e, center), start: shown ?? 0, angle: shown ?? 0, v4: project.tokens.source !== "tailwind-v3" };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    let angle = d.start + pointerAngle(e, d.center) - d.startPointer;
    angle = ((Math.round(e.shiftKey ? angle / 15 : angle) * (e.shiftKey ? 15 : 1) + 540) % 360) - 180;
    d.angle = angle;
    d.el.style.cssText = d.saved;
    // the board's CSS rotates through the rotate property (Tailwind v4) or transform (v3): preview the difference there
    d.el.style.setProperty("rotate", `${d.v4 ? angle : angle - d.start}deg`, "important");
    setBadge(`${angle}°`);
    refreshOverlay();
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    setBadge(undefined);
    if (!d) return;
    e.stopPropagation();
    d.el.style.cssText = d.saved;
    const { project } = useEditor.getState();
    const frame = project?.frames.find((f) => f.id === sel.frameId);
    const node = frame && findNode(frame.current, sel.nodeId)?.node;
    if (project && frame && node && d.angle !== d.start) dispatch(styleOps(project, frame, node, { rotate: d.angle === 0 ? null : d.angle }));
    refreshOverlay();
  };
  return (
    <>
      <div className="pointer-events-none absolute -top-7 left-1/2 h-5 w-px bg-accent-600" />
      <div
        role="slider"
        aria-label="Rotate"
        aria-valuenow={drag.current?.angle ?? 0}
        title="Drag to rotate (Shift: 15° steps)"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="pointer-events-auto absolute -top-9 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border-2 border-accent-600 bg-white"
        data-testid="rotate-handle"
      />
      {badge && <div className="absolute -top-16 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">{badge}</div>}
    </>
  );
}

function ResizeHandles({ sel }: { sel: NodeSelection }) {
  const drag = useRef<{
    handle: ResizeHandle;
    pointer: { x: number; y: number };
    start: { w: number; h: number };
    el: HTMLElement;
    saved: string;
    measured: Parameters<typeof resizeBox>[5];
    /** Client rects for snapping: the element, its siblings, its parent's content box. */
    rect: Box;
    siblings: Box[];
    parent: Box;
    grid: number;
    /** A text scaled by a corner: its font size grows with it. */
    text?: { fontSize: number; lineHeight: number | undefined };
    size?: { w: number; h: number };
    used?: ResizeHandle;
  }>(undefined);
  const [badge, setBadge] = useState<string>();

  const onDown = (handle: ResizeHandle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const frameHandleOf = frameHandle(sel.itemId);
    const el = frameHandleOf?.element(sel.nodeId) as HTMLElement | undefined;
    if (!el) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const { camera, project } = useEditor.getState();
    const zoom = camera.zoom;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const frame = project?.frames.find((f) => f.id === sel.frameId);
    const found = frame && findNode(frame.current, sel.nodeId);
    const parentEl = found?.parent && (frameHandleOf?.element(found.parent.id) as HTMLElement | undefined);
    const outer = parentEl?.getBoundingClientRect();
    const p = parentEl ? getComputedStyle(parentEl) : undefined;
    const inset = (v: string | undefined) => (parseFloat(v ?? "") || 0) * zoom;
    const parent: Box = outer
      ? {
          x: outer.left + inset(p?.borderLeftWidth) + inset(p?.paddingLeft),
          y: outer.top + inset(p?.borderTopWidth) + inset(p?.paddingTop),
          w: outer.width - inset(p?.borderLeftWidth) - inset(p?.borderRightWidth) - inset(p?.paddingLeft) - inset(p?.paddingRight),
          h: outer.height - inset(p?.borderTopWidth) - inset(p?.borderBottomWidth) - inset(p?.paddingTop) - inset(p?.paddingBottom),
        }
      : { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    const siblings = (found?.parent?.children ?? [])
      .filter((c) => c.id !== sel.nodeId)
      .map((c) => frameHandleOf?.element(c.id)?.getBoundingClientRect())
      .filter((r): r is DOMRect => r !== undefined && r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
    drag.current = {
      handle,
      pointer: { x: e.clientX, y: e.clientY },
      start: { w: Math.round(rect.width / zoom), h: Math.round(rect.height / zoom) },
      el,
      saved: el.style.cssText,
      measured: {
        maxWidth: limit(style.maxWidth, Infinity),
        minWidth: limit(style.minWidth, 0),
        maxHeight: limit(style.maxHeight, Infinity),
        minHeight: limit(style.minHeight, 0),
        absolute: style.position === "absolute" || style.position === "fixed",
        left: limit(style.left, 0),
        top: limit(style.top, 0),
      },
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      siblings,
      parent,
      grid: project ? screenGrid(project.tokens) * zoom : 8 * zoom,
      ...(found?.node.type === "text" && { text: { fontSize: parseFloat(style.fontSize) || 16, lineHeight: style.lineHeight === "normal" ? undefined : parseFloat(style.lineHeight) } }),
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const zoom = useEditor.getState().camera.zoom;
    // Shift on a side keeps the proportions (corners always do)
    const handle = e.shiftKey ? proportionalHandle(d.handle) : d.handle;
    const dir = handleDirection(handle);
    const corner = Boolean(dir.x && dir.y);
    let size = resizedSize(handle, d.start, (e.clientX - d.pointer.x) / zoom, (e.clientY - d.pointer.y) / zoom);
    // snap the moving edge(s) (corners: by the width, the height follows)
    const { snap } = useEditor.getState();
    if (!e.altKey && (snap.guides || snap.grid)) {
      const w = size.w * zoom;
      const h = size.h * zoom;
      const box = { x: dir.x === -1 ? d.rect.x + d.rect.w - w : d.rect.x, y: dir.y === -1 ? d.rect.y + d.rect.h - h : d.rect.y, w, h };
      const edges = { x: dir.x, y: corner ? 0 : dir.y } as const;
      const snapped = snapResize(box, edges, d.siblings, { threshold: 6, guides: snap.guides, ...(snap.grid && { grid: d.grid, origin: { x: d.parent.x, y: d.parent.y } }), container: d.parent });
      if (corner && snapped.dx) {
        const scale = (size.w + snapped.dx / zoom) / d.start.w;
        size = { w: Math.round(d.start.w * scale), h: Math.round(d.start.h * scale) };
      } else size = { w: Math.round(size.w + snapped.dx / zoom), h: Math.round(size.h + snapped.dy / zoom) };
      useEditor.setState({ elementGuides: { lines: snapped.lines, measures: snapped.measures } });
    } else useEditor.setState({ elementGuides: undefined });
    size = { w: Math.max(1, size.w), h: Math.max(1, size.h) };
    d.size = size;
    d.used = handle;
    d.el.style.cssText = d.saved;
    const set = (property: string, value: string) => d.el.style.setProperty(property, value, "important");
    if (d.text && corner) {
      // a text scaled by a corner: the font follows, the box stays automatic
      const scale = size.w / d.start.w;
      set("font-size", `${d.text.fontSize * scale}px`);
      if (d.text.lineHeight) set("line-height", `${d.text.lineHeight * scale}px`);
      setBadge(`${Math.round(d.text.fontSize * scale)} px text`);
      refreshOverlay();
      return;
    }
    setBadge(`${size.w} × ${size.h}`);
    if (dir.x) {
      set("width", `${size.w}px`);
      set("min-width", "0");
      set("max-width", "none");
      set("flex-basis", "auto");
      set("flex-grow", "0");
      if (d.measured.absolute && dir.x === -1) set("left", `${d.measured.left - (size.w - d.start.w)}px`);
    }
    if (dir.y) {
      set("height", `${size.h}px`);
      set("min-height", "0");
      set("max-height", "none");
      if (d.measured.absolute && dir.y === -1) set("top", `${d.measured.top - (size.h - d.start.h)}px`);
    }
    refreshOverlay();
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    setBadge(undefined);
    useEditor.setState({ elementGuides: undefined });
    if (!d) return;
    e.stopPropagation();
    d.el.style.cssText = d.saved;
    const { project } = useEditor.getState();
    const frame = project?.frames.find((f) => f.id === sel.frameId);
    const found = frame && findNode(frame.current, sel.nodeId);
    if (!project || !frame || !found || !d.size || !d.used) {
      refreshOverlay();
      return;
    }
    const dir = handleDirection(d.used);
    if (d.text && dir.x && dir.y) {
      const scale = d.size.w / d.start.w;
      if (Math.abs(scale - 1) > 0.005) dispatch(scaleTextOps(project, frame, found.node, scale, d.text));
      refreshOverlay();
      return;
    }
    const box = resizeBox(found.node, found.parent, d.used, d.start, d.size, d.measured);
    if (Object.keys(box).length > 0) dispatch(boxOps(project, frame, found.node, box));
    refreshOverlay();
  };

  return (
    <>
      {HANDLES.map(({ id, cursor }) => {
        const dir = handleDirection(id);
        // centered on the element's edge (the outline's 2px border sits inside it), so a handle
        // covers only 4px of the element and grabbing near its edge still moves it
        const at = (d: number) => (d === -1 ? "-6px" : d === 1 ? "calc(100% - 2px)" : "calc(50% - 4px)");
        return (
          <div
            key={id}
            data-no-drag=""
            data-testid={`resize-${id}`}
            title={dir.x && dir.y ? "Resize (keeps proportions; on a text: its size)" : "Resize (Shift: keep proportions)"}
            className="pointer-events-auto absolute h-2 w-2 rounded-[1px] border border-accent-600 bg-white"
            style={{
              left: at(dir.x),
              top: at(dir.y),
              cursor,
            }}
            onPointerDown={onDown(id)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        );
      })}
      {badge && (
        <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="size-badge">
          {badge}
        </div>
      )}
    </>
  );
}

const transparent = (color: string) => color === "transparent" || /rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, " ")) || /\/\s*0\)$/.test(color);

/** Relative luminance of a computed `rgb()` color (0 dark … 1 light). */
function luminance(color: string): number | undefined {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(color);
  if (!m) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * What the text sits on, for the editor's background: the first solid background going up from the
 * element (inside the screen). Behind a picture or gradient (or nothing found), a contrasting color
 * from the text's own, so white text stays readable while it is edited.
 */
function backgroundBehind(element: Element, textColor: string): string {
  const text = luminance(textColor) ?? 0;
  const contrasting = text > 0.4 ? "#1f1b2e" : "#ffffff";
  for (let el: Element | null = element; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.backgroundImage !== "none") return contrasting;
    if (transparent(style.backgroundColor)) continue;
    // too close to the text (e.g. white text over a picture placed behind it): contrast instead
    const behind = luminance(style.backgroundColor);
    return behind !== undefined && Math.abs(behind - text) < 0.3 ? contrasting : style.backgroundColor;
  }
  return contrasting;
}

/** Edits a rendered text in place, matching its font. Commits on blur/Enter, Escape cancels. */
/** The font of a rendered text, at the board's zoom, on a readable background (for editing it in place). */
function useTextFont(itemId: string, elementId: string): React.CSSProperties | undefined {
  const [font, setFont] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    const element = frameHandle(itemId)?.element(elementId);
    if (!element) return setFont({});
    const computed = getComputedStyle(element);
    const zoom = useEditor.getState().camera.zoom;
    setFont({
      fontFamily: computed.fontFamily,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      fontSize: parseFloat(computed.fontSize) * zoom,
      lineHeight: computed.lineHeight === "normal" ? "normal" : `${parseFloat(computed.lineHeight) * zoom}px`,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign as React.CSSProperties["textAlign"],
      textTransform: computed.textTransform as React.CSSProperties["textTransform"],
      color: computed.color,
      caretColor: computed.color,
      background: backgroundBehind(element, computed.color),
    });
  }, [itemId, elementId]);
  return font;
}

/** A text element edited in place, with formatting for parts of it. */
function TextNodeEditor({ sel, node, style }: { sel: NodeSelection; node: Extract<DesignNode, { type: "text" }>; style: React.CSSProperties }) {
  const font = useTextFont(sel.itemId, sel.nodeId);
  const project = useEditor((s) => s.project)!;
  const tokens = themedTokens(project.tokens, project.frames.find((f) => f.id === sel.frameId)?.theme);
  if (!font) return null;
  // a text from a list's data: the board shows (and editing changes) the first item's value
  const frameRoot = project.frames.find((f) => f.id === sel.frameId)?.current;
  const key = node.bind?.text;
  const list = key && frameRoot ? listOf(frameRoot, node.id) : undefined;
  const shown = list && key && list.items?.[0]?.[key] !== undefined ? String(list.items[0][key]) : undefined;
  return (
    <RichTextEditor
      html={shown !== undefined ? spansToHtml(shown, undefined, tokens) : spansToHtml(node.text, node.spans, tokens)}
      font={font}
      style={style}
      tokens={tokens}
      onCommit={({ text, spans }) => {
        if (list && key) {
          if (text !== shown) dispatch([{ id: newOpId(), frameId: sel.frameId, nodeId: list.id, op: "setAttrs", attrs: { items: (list.items ?? []).map((item, i) => (i === 0 ? { ...item, [key]: text } : item)) } }]);
          return;
        }
        if (text === node.text && JSON.stringify(spans ?? null) === JSON.stringify(node.spans ?? null)) return;
        const { project, codeScope } = useEditor.getState();
        dispatch(forCopies(project!, [{ id: newOpId(), frameId: sel.frameId, op: "retext", nodeId: sel.nodeId, text, ...(spans && { spans }) }], codeScope));
      }}
      onDone={() => useEditor.setState({ editingText: false })}
    />
  );
}

function TextEditor({
  itemId,
  elementId,
  initial,
  style,
  onCommit,
  onDone,
}: {
  itemId: string;
  /** Node id, or scoped id inside an instance. */
  elementId: string;
  initial: string;
  style: React.CSSProperties;
  onCommit: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const font = useTextFont(itemId, elementId);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [itemId, elementId]);

  const finish = () => {
    onDone();
    const text = ref.current?.value ?? initial;
    if (!cancelled.current && text !== initial) onCommit(text);
  };

  return (
    <textarea
      ref={ref}
      data-no-drag=""
      data-testid="text-editor"
      defaultValue={initial}
      className="pointer-events-auto absolute resize-none overflow-hidden p-0 outline-2 outline-accent-600"
      style={{ ...style, ...(font ?? {}), minWidth: 40 }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelled.current = true;
          ref.current?.blur();
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}

/** Near a container's edge (screen px), a drop goes next to it instead of into it. */
const EDGE = 8;

/**
 * Where a dragged element would land, in both directions: the container under the pointer (near its
 * edge: its parent), its children grouped into visual lines (rows, wrapping rows, grid rows), the
 * line by the pointer's height and the slot by its x. In a vertical layout, the outer quarters of an
 * element (away from its top and bottom) mean "beside it" (a new row with both).
 */
export function computeDrop(project: Project, itemId: string, clientX: number, clientY: number, draggedId?: string, allowBeside = true): DropTarget | undefined {
  const handle = frameHandle(itemId);
  const placement = project.board.items.find((i) => i.id === itemId);
  const frame = placement?.type === "frame" ? project.frames.find((f) => f.id === placement.frameId) : undefined;
  if (!handle || !frame) return undefined;
  const draggedNode = draggedId ? findNode(frame.current, draggedId)?.node : undefined;
  if (draggedId && !draggedNode) return undefined;
  const inDragged = (id: string) => Boolean(draggedNode && findNode(draggedNode, id));
  const hitId = handle.nodeAt(clientX, clientY, inDragged);
  if (!hitId) return undefined;
  const hit = findNode(frame.current, hitId);
  if (!hit) return undefined;
  let container = isContainer(hit.node) && hit.node.type !== "instance" ? hit.node : hit.parent;
  if (container === hit.node && hit.parent) {
    const r = handle.nodeRect(hit.node.id);
    if (r && Math.min(clientX - r.x, r.x + r.w - clientX, clientY - r.y, r.y + r.h - clientY) < EDGE) container = hit.parent;
  }
  if (!container) return undefined;
  const containerRect = handle.nodeRect(container.id);
  if (!containerRect) return undefined;
  const name = (node: DesignNode) => nodeLabel(node, (id) => nameOf(project, id));

  const row = container.layout?.mode === "flex" && (container.layout.direction ?? "row") === "row";
  const vertical = !row && container.layout?.mode !== "grid";
  const siblings = container.children
    .filter((c) => c.id !== draggedId)
    .map((c) => ({ node: c, rect: handle.nodeRect(c.id) }))
    .filter((s): s is { node: DesignNode; rect: ClientRect } => s.rect !== undefined && s.rect.w > 0 && s.rect.h > 0);
  const result = (index: number, line: ClientRect, label: string, beside?: DropTarget["beside"]): DropTarget => ({
    itemId,
    parentId: container!.id,
    index,
    line,
    container: containerRect,
    label,
    ...(beside && { beside }),
  });
  const thickness = 3;
  if (siblings.length === 0) {
    return result(0, { x: containerRect.x + 4, y: containerRect.y + 4, w: Math.max(containerRect.w - 8, 8), h: thickness }, `Into ${name(container)}`);
  }

  // visual lines: consecutive children whose heights overlap
  const lines: { start: number; items: typeof siblings; top: number; bottom: number }[] = [];
  siblings.forEach((s, i) => {
    const line = lines[lines.length - 1];
    const overlap = line ? Math.min(line.bottom, s.rect.y + s.rect.h) - Math.max(line.top, s.rect.y) : 0;
    if (line && overlap > Math.min(s.rect.h, line.bottom - line.top) / 3) {
      line.items.push(s);
      line.top = Math.min(line.top, s.rect.y);
      line.bottom = Math.max(line.bottom, s.rect.y + s.rect.h);
    } else lines.push({ start: i, items: [s], top: s.rect.y, bottom: s.rect.y + s.rect.h });
  });

  const between = (index: number) => {
    const prev = siblings[index - 1];
    const next = siblings[index];
    if (prev && next) return `Between ${name(prev.node)} and ${name(next.node)}`;
    return next ? `Before ${name(next.node)}` : `After ${name(prev!.node)}`;
  };
  // between two lines (or above the first, below the last): a horizontal line across the container
  const across = (index: number, y: number) => result(index, { x: containerRect.x, y: y - thickness / 2, w: containerRect.w, h: thickness }, between(index));

  const lineIndex = lines.findIndex((l) => clientY >= l.top && clientY <= l.bottom);
  if (lineIndex < 0) {
    const below = lines.findIndex((l) => clientY < l.top);
    if (below === 0) return across(0, lines[0]!.top - 2);
    if (below < 0) {
      const last = lines[lines.length - 1]!;
      return across(siblings.length, last.bottom + 2);
    }
    const prev = lines[below - 1]!;
    const next = lines[below]!;
    return across(next.start, (prev.bottom + next.top) / 2);
  }

  const line = lines[lineIndex]!;
  // one element in a vertical layout: above, below, or beside it (its outer quarters)
  if (line.items.length === 1 && vertical && allowBeside) {
    const only = line.items[0]!;
    const r = only.rect;
    const quarter = Math.min(r.w / 4, 80);
    // beside: the outer quarters, away from the top and bottom edges (those mean above/below)
    const middle = clientY > r.y + r.h / 4 && clientY < r.y + (r.h * 3) / 4;
    if (middle && (clientX < r.x + quarter || clientX > r.x + r.w - quarter)) {
      const side = clientX < r.x + quarter ? "before" : "after";
      const x = side === "before" ? r.x - 2 : r.x + r.w + 2;
      return result(line.start, { x: x - thickness / 2, y: r.y, w: thickness, h: r.h }, `Beside ${name(only.node)}`, { nodeId: only.node.id, side });
    }
    const before = clientY < r.y + r.h / 2;
    return across(before ? line.start : line.start + 1, before ? r.y - 2 : r.y + r.h + 2);
  }
  // several in a line (rows, wrapping rows, grid rows): the slot by x, a vertical line
  let slot = line.items.length;
  for (let i = 0; i < line.items.length; i++) {
    const r = line.items[i]!.rect;
    if (clientX < r.x + r.w / 2) {
      slot = i;
      break;
    }
  }
  const prev = line.items[slot - 1]?.rect;
  const next = line.items[slot]?.rect;
  const x = prev && next ? (prev.x + prev.w + next.x) / 2 : next ? next.x - 2 : prev!.x + prev!.w + 2;
  return result(line.start + slot, { x: x - thickness / 2, y: line.top, w: thickness, h: line.bottom - line.top }, between(line.start + slot));
}
