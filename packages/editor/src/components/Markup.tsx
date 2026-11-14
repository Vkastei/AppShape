import { type AnyOp, createId, type DesignRequest, FREE_MARKUP_COLORS, type Frame, MARKUP_LEGEND, type MarkupShape, markupColor, proposalVariants } from "@appshape/ir";
import { markupSvg } from "@appshape/render";
import { ArrowUpRight, Bot, Check, Circle, Copy, Loader2, Sparkles, Eraser, Eye, EyeOff, PenLine, Pencil, RotateCcw, Square, StickyNote, Trash2, Type, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentStatus } from "@appshape/protocol";
import { aiEstimate, cancelDesign, fetchSettings, saveAi, startDesign } from "../lib/api";
import { frameHandle } from "../lib/frames";
import { framesById } from "../lib/board";
import { itemBounds } from "../lib/geometry";
import { acceptOps, addShapeOps, backToReviewOps, type Box, deleteRequestOps, fixFindingOps, isStale, MARKUP_WIDTHS, type MarkupTool, nodeDepths, phonesRequestOps, pickVariantOps, placementTarget, proposedFrame, reopenOps, requestFor, reviewRequestOps, sectionRequestOps, shapeTargets, skipFindingOps, updateRequestOps, VARIANT_GAP, variantsPlacement, variantsRequestOps } from "../lib/markup";
import { animateCamera, canvasSize, focusCamera } from "../lib/view";
import { showAllSizesOps } from "../lib/responsive";
import { AgentStarter } from "./AgentRun";
import { dispatch, notify, useEditor, whenSynced } from "../store";

/**
 * Draw & describe on the board: the Draw button and drawing bar, the drawing on each screen, and
 * the panel next to a drawn-on screen (what should change, and where it goes).
 */

const TOOLS: { tool: MarkupTool; label: string; icon: React.ReactNode }[] = [
  { tool: "pen", label: "Pen", icon: <PenLine size={15} /> },
  { tool: "arrow", label: "Arrow", icon: <ArrowUpRight size={15} /> },
  { tool: "rect", label: "Rectangle", icon: <Square size={15} /> },
  { tool: "ellipse", label: "Ellipse", icon: <Circle size={15} /> },
  { tool: "label", label: "Label", icon: <Type size={15} /> },
  { tool: "eraser", label: "Eraser", icon: <Eraser size={15} /> },
];

/** Starts drawing: on the selected screen, or on the screen clicked next. */
export function startDrawing(): void {
  const { selection, node, project } = useEditor.getState();
  const placement = node?.itemId ?? (selection.length === 1 && project?.board.items.find((i) => i.id === selection[0])?.type === "frame" ? selection[0] : undefined);
  const target = placement && project ? placementTarget(project, placement) : undefined;
  const drawable = target && target.frame.kind !== "component" ? placement : undefined;
  const request = drawable && project ? requestFor(project, target!.frame.id, target!.viewportId) : undefined;
  useEditor.setState({ tool: "draw", drawingOn: drawable, selection: [], node: undefined, extraNodes: [], showMarkup: true, ...(request && { openRequest: request.id }) });
  if (!drawable) notify("Click a screen to draw on it.");
}

export function DrawButton() {
  const drawing = useEditor((s) => s.tool === "draw");
  return (
    <button
      type="button"
      onClick={() => (drawing ? useEditor.setState({ tool: "select" }) : startDrawing())}
      aria-pressed={drawing}
      title="Draw on a screen (D): mark what should change and describe it"
      className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold ${drawing ? "bg-accent-500 text-white ring-1 ring-inset ring-ink" : "text-ink hover:bg-ink/[0.06]"}`}
    >
      <Pencil size={15} /> Draw
    </button>
  );
}

/** Tools, the legend's colors, free colors and stroke widths (above the toolbar while drawing). */
export function DrawBar() {
  const drawing = useEditor((s) => s.tool === "draw");
  const draw = useEditor((s) => s.draw);
  const show = useEditor((s) => s.showMarkup);
  const on = useEditor((s) => s.drawingOn);
  if (!drawing) return null;
  const setDraw = (patch: Partial<typeof draw>) => useEditor.setState({ draw: { ...draw, ...patch } });
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border-[1.5px] border-ink bg-white p-1 shadow-offset-sm" role="toolbar" aria-label="Drawing" data-testid="draw-bar">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={draw.tool === t.tool}
          onClick={() => setDraw({ tool: t.tool })}
          className={`grid h-7 w-7 place-items-center rounded-md ${draw.tool === t.tool ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"}`}
        >
          {t.icon}
        </button>
      ))}
      <div className="mx-1 h-5 w-px bg-ink/15" />
      {(Object.keys(MARKUP_LEGEND) as (keyof typeof MARKUP_LEGEND)[]).map((key) => (
        <button
          key={key}
          type="button"
          title={`${MARKUP_LEGEND[key].label}: ${MARKUP_LEGEND[key].hint}`}
          aria-label={`Color ${MARKUP_LEGEND[key].label}`}
          aria-pressed={draw.color === key}
          onClick={() => setDraw({ color: key, ...(draw.tool === "eraser" && { tool: "pen" }) })}
          className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-semibold ${draw.color === key ? "bg-ink/[0.08] text-ink ring-1 ring-ink/40" : "text-ink-soft hover:bg-ink/[0.05]"}`}
        >
          <span className="h-3 w-3 rounded-full" style={{ background: MARKUP_LEGEND[key].color }} />
          {MARKUP_LEGEND[key].label}
        </button>
      ))}
      {FREE_MARKUP_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title="A color without a meaning"
          aria-label={`Color ${color}`}
          aria-pressed={draw.color === color}
          onClick={() => setDraw({ color, ...(draw.tool === "eraser" && { tool: "pen" }) })}
          className={`grid h-7 w-6 place-items-center rounded-md ${draw.color === color ? "ring-1 ring-ink/40 bg-ink/[0.08]" : "hover:bg-ink/[0.05]"}`}
        >
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        </button>
      ))}
      <div className="mx-1 h-5 w-px bg-ink/15" />
      {MARKUP_WIDTHS.map((width) => (
        <button
          key={width}
          type="button"
          title={`Line ${width} px`}
          aria-label={`Line width ${width}`}
          aria-pressed={draw.width === width}
          onClick={() => setDraw({ width })}
          className={`grid h-7 w-7 place-items-center rounded-md ${draw.width === width ? "bg-ink/[0.08] ring-1 ring-ink/40" : "hover:bg-ink/[0.05]"}`}
        >
          <span className="w-4 rounded-full bg-ink" style={{ height: Math.max(1.5, width / 2) }} />
        </button>
      ))}
      <div className="mx-1 h-5 w-px bg-ink/15" />
      <button type="button" title={show ? "Hide drawings" : "Show drawings"} aria-label={show ? "Hide drawings" : "Show drawings"} onClick={() => useEditor.setState({ showMarkup: !show })} className="grid h-7 w-7 place-items-center rounded-md text-ink-soft hover:bg-ink/[0.06] hover:text-ink">
        {show ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <span className="px-1.5 text-xs text-ink-soft">{on ? "Shift: straight · Esc: done" : "Click a screen to draw on it"}</span>
      <button type="button" onClick={() => useEditor.setState({ tool: "select" })} className="rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white hover:bg-ink-soft">
        Done
      </button>
    </div>
  );
}

/** Rendered elements of a placement as boxes in the screen's design px (for what a shape touches). */
export function elementBoxes(itemId: string, frame: Frame, zoom: number): Box[] {
  const handle = frameHandle(itemId);
  const host = document.querySelector(`[data-frame-content="${CSS.escape(itemId)}"]`);
  if (!handle || !host) return [];
  const origin = host.getBoundingClientRect();
  const boxes: Box[] = [];
  for (const [id, depth] of nodeDepths(frame.current)) {
    const rect = handle.nodeRect(id);
    if (rect) boxes.push({ id, depth, x: (rect.x - origin.left) / zoom, y: (rect.y - origin.top) / zoom, w: rect.w / zoom, h: rect.h / zoom });
  }
  return boxes;
}

/** Adds a finished shape to the placement's screen (with the elements it touches). */
export function commitShape(itemId: string, shape: MarkupShape): void {
  const { project, camera } = useEditor.getState();
  const target = project && placementTarget(project, itemId);
  if (!project || !target) return;
  const targets = shapeTargets(shape, elementBoxes(itemId, target.frame, camera.zoom));
  const { ops, requestId } = addShapeOps(project, target.frame.id, target.viewportId, { ...shape, ...(targets.length && { targets }) });
  if (dispatch(ops)) useEditor.setState({ openRequest: requestId });
}

export const newShapeId = () => createId("s", 8);

/** The drawing on a screen placement (and the shape being drawn, and a label being typed). */
export function MarkupLayer({ itemId, frameId, viewportId, width }: { itemId: string; frameId: string; viewportId: string; width: number }) {
  const show = useEditor((s) => s.showMarkup);
  const request = useEditor((s) => s.project?.requests?.find((r) => r.frameId === frameId && r.viewportId === viewportId));
  const draft = useEditor((s) => (s.markupDraft?.itemId === itemId ? s.markupDraft.shape : undefined));
  const label = useEditor((s) => (s.labelDraft?.itemId === itemId ? s.labelDraft : undefined));
  const color = useEditor((s) => s.draw.color);
  // a proposal shown (after): the drawing belongs to the screen before it
  const after = useEditor((s) => request?.status === "proposed" && (s.proposalView[request.id] ?? "after") === "after");
  const svg = useMemo(() => {
    const shapes = [...(request?.shapes ?? []), ...(draft ? [draft] : [])];
    return shapes.length ? markupSvg(shapes, width, 1) : "";
  }, [request?.shapes, draft, width]);
  if ((!show || after) && !label) return null;
  return (
    <>
      {show && !after && svg && <div className="pointer-events-none absolute inset-0" data-testid="markup" dangerouslySetInnerHTML={{ __html: svg }} />}
      {label && <LabelInput itemId={itemId} x={label.x} y={label.y} color={markupColor(color)} />}
    </>
  );
}

function LabelInput({ itemId, x, y, color }: { itemId: string; x: number; y: number; color: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const finish = (commit: boolean) => {
    const text = ref.current?.value.trim() ?? "";
    useEditor.setState({ labelDraft: undefined });
    if (commit && text) {
      const { draw } = useEditor.getState();
      commitShape(itemId, { id: newShapeId(), kind: "label", color: draw.color, x: Math.round(x), y: Math.round(y), text: text.slice(0, 200) });
    }
  };
  return (
    <input
      ref={ref}
      data-no-drag=""
      aria-label="Label text"
      placeholder="Label"
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="absolute rounded border border-ink/30 bg-white/90 px-1 text-base font-bold outline-none"
      style={{ left: x - 4, top: y - 20, color, width: 220 }}
    />
  );
}

const STATUS_TEXT: Record<DesignRequest["status"], string> = { draft: "Drawing", designing: "Designing…", proposed: "Proposal to review" };
const INTENT_TEXT: Record<NonNullable<DesignRequest["intent"]>, string> = { phones: "Make it work on phones", section: "New section", review: "Review this page" };

/** Next to a drawn-on screen: a badge that opens its panel (the panel itself is docked to the board). */
export function RequestBadge({ itemId, frame, viewportId, zoom }: { itemId: string; frame: Frame; viewportId: string; zoom: number }) {
  const request = useEditor((s) => s.project?.requests?.find((r) => r.frameId === frame.id && r.viewportId === viewportId));
  const open = useEditor((s) => (request && s.openRequest === request.id) || s.drawingOn === itemId);
  if (!request || open) return null;
  return (
    <button
      type="button"
      data-no-drag=""
      onClick={() => useEditor.setState({ openRequest: request.id })}
      title="This screen has a drawing: open it"
      className="absolute left-full top-0 flex origin-top-left items-center gap-1 whitespace-nowrap rounded-md border border-ink/20 bg-white px-1.5 py-1 text-xs font-semibold text-accent-700 shadow-sm hover:border-ink"
      style={{ transform: `scale(${1 / zoom})`, marginLeft: 12 / zoom }}
    >
      <Pencil size={12} /> {request.route === "note" ? "Note for the agent" : request.route === "agent" && request.status === "designing" ? "Waiting for your agent" : request.status === "proposed" && request.review && !request.fixing ? "Review ready" : STATUS_TEXT[request.status]}
    </button>
  );
}

/** The open drawing's panel, docked to the board's top right: what should change, and what happens with it. */
export function RequestDock() {
  const request = useEditor((s) => {
    const requests = s.project?.requests ?? [];
    const open = s.openRequest ? requests.find((r) => r.id === s.openRequest) : undefined;
    if (open) return open;
    const target = s.drawingOn && s.project ? placementTarget(s.project, s.drawingOn) : undefined;
    return target ? requests.find((r) => r.frameId === target.frame.id && r.viewportId === target.viewportId) : undefined;
  });
  const frame = useEditor((s) => s.project?.frames.find((f) => f.id === request?.frameId));
  const show = useEditor((s) => s.showMarkup);
  if (!request || !frame) return null;
  return (
    <div
      data-no-drag=""
      role="dialog"
      aria-label={`Drawing on ${frame.name}`}
      className="absolute right-3 top-3 z-20 max-h-[calc(100%-6rem)] w-80 cursor-default overflow-auto rounded-xl border-[1.5px] border-ink bg-white text-sm text-ink shadow-offset"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-ink/10 px-3 py-2">
        <Pencil size={14} className="text-accent-600" />
        <span className="font-semibold">{request.intent && request.status === "draft" ? INTENT_TEXT[request.intent] : request.status === "proposed" && request.review && !request.fixing ? "Review" : request.status === "proposed" && request.alternatives?.length ? `${request.alternatives.length + 1} variants` : STATUS_TEXT[request.status]}</span>
        <span className="truncate text-xs text-ink-soft">{frame.name}</span>
        <span className="text-xs text-ink-soft">{request.shapes.length} mark{request.shapes.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <button type="button" title={show ? "Hide drawings" : "Show drawings"} aria-label={show ? "Hide drawings" : "Show drawings"} onClick={() => useEditor.setState({ showMarkup: !show })} className="grid h-6 w-6 place-items-center rounded text-ink-soft hover:bg-ink/[0.06]">
          {show ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button type="button" aria-label="Close" onClick={() => useEditor.setState({ openRequest: undefined, ...(useEditor.getState().tool === "draw" && { tool: "select" as const }) })} className="grid h-6 w-6 place-items-center rounded text-ink-soft hover:bg-ink/[0.06]">
          <X size={14} />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
          {(Object.keys(MARKUP_LEGEND) as (keyof typeof MARKUP_LEGEND)[]).map((key) => (
            <span key={key} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: MARKUP_LEGEND[key].color }} />
              {MARKUP_LEGEND[key].label.toLowerCase()}
            </span>
          ))}
        </div>
        {request.fixing && <FixingBanner request={request} />}
        {request.status === "proposed" && request.review && !request.fixing ? (
          <ReviewPanel request={request} />
        ) : request.status === "proposed" && request.proposal ? (
          <>
            {request.message.trim() && <p className="rounded-md bg-zinc-50 px-2 py-1.5 text-xs text-ink-soft">“{request.message.trim()}”</p>}
            <ProposalReview request={request} />
          </>
        ) : (
          <>
            <MessageField request={request} />
            <RequestActions request={request} />
            <DesignYourself request={request} />
          </>
        )}
      </div>
    </div>
  );
}

function MessageField({ request }: { request: DesignRequest }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // a change from elsewhere (undo, another tab) shows up unless the field is being edited
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = request.message;
  }, [request.message]);
  const commit = () => {
    const value = ref.current?.value ?? "";
    if (value !== request.message) dispatch(updateRequestOps(request, { message: value }));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{request.intent === "section" ? "What should the section be?" : request.intent === "phones" ? "Anything to keep in mind? (optional)" : request.intent === "review" ? "Anything to look at in particular? (optional)" : "What should change?"}</span>
      <textarea
        ref={ref}
        defaultValue={request.message}
        rows={3}
        autoFocus={request.intent === "section" && !request.message}
        placeholder={
          request.intent === "section"
            ? "Pricing with three plans and a monthly/yearly switch"
            : request.intent === "phones"
              ? "Keep the logo visible; the menu can fold away"
              : request.intent === "review"
                ? "Is it clear what visitors should do first?"
                : "Turn the crossed-out link into a button and put a search field in the green box"
        }
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            (e.target as HTMLTextAreaElement).blur();
            window.dispatchEvent(new CustomEvent(DESIGN_EVENT, { detail: request.id }));
          }
        }}
        className="w-full resize-y rounded-md border border-ink/20 px-2 py-1.5 text-sm outline-none focus:border-accent-500"
      />
    </label>
  );
}

function RequestActions({ request }: { request: DesignRequest }) {
  const remove = () => {
    if (dispatch(deleteRequestOps(request))) useEditor.setState({ openRequest: undefined });
  };
  /** Sends the drawing on (after the message being typed is saved). */
  const send = (patch: Partial<DesignRequest>) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const latest = useEditor.getState().project?.requests?.find((r) => r.id === request.id) ?? request;
    if (latest.intent === "section" && !latest.message.trim()) {
      notify("Describe the section first.", "warn");
      return;
    }
    if (!latest.intent && !latest.message.trim() && latest.shapes.length === 0) {
      notify("Draw or describe the change first.", "warn");
      return;
    }
    dispatch(updateRequestOps(latest, patch));
  };
  return (
    <div className="space-y-2">
      {request.route === "note" ? (
        <div className="rounded-md bg-teal-50 px-2.5 py-2 text-xs text-teal-900" role="status">
          <div className="flex items-center gap-1.5 font-semibold">
            <StickyNote size={13} /> Kept as a note for your coding agent
          </div>
          <p className="mt-0.5">It goes with the next <b>Apply to code</b>, with a picture of the drawing.</p>
          <button type="button" onClick={() => dispatch(updateRequestOps(request, { route: undefined }))} className="mt-1 font-semibold underline">
            Take it back
          </button>
        </div>
      ) : request.route === "agent" && request.status === "designing" ? (
        <WaitingForAgent request={request} />
      ) : request.route === "ai" && request.status === "designing" ? (
        <DesigningWithAi request={request} />
      ) : (
        <>
          {request.error && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900" role="alert">
              {request.error}
            </p>
          )}
          {request.intent !== "review" && <VariantsSwitch request={request} />}
          <AiChoice request={request} />
          <button
            type="button"
            onClick={() => send({ route: "agent", status: "designing", error: undefined })}
            title={request.intent === "review" ? "Your coding agent reviews the page; its findings show here" : "Your coding agent designs it (Claude Code, Codex, …); the proposal shows here for review"}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink bg-white px-3 py-1.5 text-sm font-semibold hover:bg-accent-50"
          >
            <Bot size={15} /> {request.intent === "review" ? "Review it with your coding agent" : "Design it with your coding agent"}
          </button>
          {request.intent !== "review" && (
            <button type="button" onClick={() => send({ route: "note" })} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink bg-white px-3 py-1.5 text-sm font-semibold hover:bg-accent-50">
              <StickyNote size={14} /> Keep as a note for the coding agent
            </button>
          )}
        </>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-ink-soft" title="This drawing's id (for appshape request / propose)">{request.id}</span>
        <button type="button" onClick={remove} className="flex items-center gap-1 rounded px-1.5 py-1 font-semibold text-red-700 hover:bg-red-50">
          <Trash2 size={12} /> Delete drawing
        </button>
      </div>
    </div>
  );
}

/** Ctrl+Enter in a drawing's message: design it (the event's detail is the request id). */
const DESIGN_EVENT = "appshape:design-request";

/** The latest version of a drawing (after the message being typed is saved), or undefined when it's empty. */
function readyRequest(id: string): DesignRequest | undefined {
  (document.activeElement as HTMLElement | null)?.blur();
  const latest = useEditor.getState().project?.requests?.find((r) => r.id === id);
  if (!latest) return undefined;
  if (latest.intent === "section" && !latest.message.trim()) {
    notify("Describe the section first.", "warn");
    return undefined;
  }
  if (!latest.intent && !latest.message.trim() && latest.shapes.length === 0) {
    notify("Draw or describe the change first.", "warn");
    return undefined;
  }
  return latest;
}

type Selected = { itemId: string; frameId: string; nodeId: string };

/** An element's box on its screen, in the screen's design px (undefined when it isn't rendered). */
function designBox(itemId: string, nodeIds: readonly string[]): { x: number; y: number; w: number; h: number } | undefined {
  const content = document.querySelector(`[data-frame-content="${CSS.escape(itemId)}"]`)?.getBoundingClientRect();
  const rects = nodeIds.map((id) => frameHandle(itemId)?.nodeRect(id)).filter((r): r is NonNullable<typeof r> => Boolean(r && r.w));
  if (!content || rects.length === 0) return undefined;
  const zoom = useEditor.getState().camera.zoom;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: (x - content.left) / zoom, y: (y - content.top) / zoom, w: (right - x) / zoom, h: (bottom - y) / zoom };
}

/** Opens the drawing panel on a request made by an AI action (or says why it can't). */
function openRequestFrom(result: { ops: AnyOp[]; requestId: string } | { problem: string }) {
  if ("problem" in result) return notify(result.problem, "warn");
  if (result.ops.length) dispatch(result.ops);
  useEditor.setState({ openRequest: result.requestId, showMarkup: true });
}

export interface AiAction {
  id: "describe" | "section" | "variants" | "phones" | "review";
  label: string;
  /** What it does, in a few words (the menu's second line and the button's title). */
  hint: string;
  run: () => void;
}

/**
 * What AI can do with a selected section or a whole screen (the inspector's AI row and *Ask AI* on
 * the board): describe a change, a new section from a sentence, 3 variants of the section, make the
 * screen work on phones, a review of the page. Each opens the drawing panel with the job; AppShape AI
 * or the coding agent does it, and the result is reviewed as usual.
 */
export function aiActions(sel: Selected, frame: Frame): AiAction[] {
  const whole = sel.nodeId === frame.current.id;
  const target = () => {
    const state = useEditor.getState();
    return state.project ? placementTarget(state.project, sel.itemId) : undefined;
  };
  const describe = () => {
    useEditor.setState({ selection: [sel.itemId], node: undefined });
    startDrawing();
  };
  const section = () => {
    const state = useEditor.getState();
    const at = target();
    const content = document.querySelector(`[data-frame-content="${sel.itemId}"]`)?.getBoundingClientRect();
    const element = frameHandle(sel.itemId)?.nodeRect(sel.nodeId);
    if (!state.project || !at || !content || !element) return;
    const zoom = state.camera.zoom;
    // below the selected section, or at the end of the screen
    const bottom = (element.y + element.h - content.top) / zoom;
    openRequestFrom(sectionRequestOps(state.project, frame, at.viewportId, { id: sel.nodeId, bottom: whole ? bottom - 8 : bottom, width: content.width / zoom }));
  };
  const variants = () => {
    const state = useEditor.getState();
    const at = target();
    const box = designBox(sel.itemId, [sel.nodeId]);
    if (!state.project || !at || !box) return;
    openRequestFrom(variantsRequestOps(state.project, frame, at.viewportId, { id: sel.nodeId, box }));
  };
  const phones = () => {
    const state = useEditor.getState();
    if (!state.project) return;
    // the phone size on the board, so the proposal can be seen there
    const sizes = showAllSizesOps(state.project, frame, state.sizes);
    if (sizes.length) dispatch(sizes);
    const project = useEditor.getState().project!;
    openRequestFrom(phonesRequestOps(project, project.frames.find((f) => f.id === frame.id) ?? frame));
  };
  const review = () => {
    const state = useEditor.getState();
    const at = target();
    if (!state.project || !at) return;
    openRequestFrom(reviewRequestOps(state.project, frame, at.viewportId));
  };
  return [
    { id: "describe", label: "Describe a change…", hint: "Draw on the screen and say what should change", run: describe },
    { id: "section", label: whole ? "New section…" : "New section below…", hint: "A section from a sentence, in your design system", run: section },
    ...(whole ? [] : [{ id: "variants" as const, label: "3 variants of this section", hint: "Three different takes side by side; pick one", run: variants }]),
    { id: "phones", label: "Make it work on phones", hint: "The phone layout; larger screens stay as they are", run: phones },
    { id: "review", label: "Review this page", hint: "What to improve, in plain words; fix what you pick", run: review },
  ];
}

/** The AI row in the inspector (a screen or one of its sections selected). */
export function AiShortcuts({ sel, frame }: { sel: Selected; frame: Frame; sectionOnly?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 text-xs">
      <Sparkles size={13} className="shrink-0 text-accent-600" />
      <span className="text-zinc-500">AI</span>
      <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
        {aiActions(sel, frame)
          .filter((a) => a.id !== "describe")
          .map((a) => (
            <button key={a.id} type="button" onClick={a.run} title={a.hint} className="rounded border border-zinc-200 px-1.5 py-0.5 hover:border-zinc-400">
              {a.label}
            </button>
          ))}
      </div>
    </div>
  );
}

/** *Ask AI* at the selected section or screen on the board: the AI actions, one click away. */
export function AskAi({ sel, frame }: { sel: Selected; frame: Frame }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [open]);
  return (
    <div ref={ref} data-no-drag="" className="pointer-events-auto relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-full border border-ink bg-accent-500 px-2.5 py-1 text-xs font-bold text-white shadow-offset-sm hover:bg-accent-600"
      >
        <Sparkles size={13} /> Ask AI
      </button>
      {open && (
        <div role="menu" aria-label="Ask AI" className="absolute right-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-xl border-[1.5px] border-ink bg-white py-1 text-left text-sm text-ink shadow-offset">
          {aiActions(sel, frame).map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.run();
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-accent-50"
            >
              <span className="block font-semibold">{a.label}</span>
              <span className="block text-xs text-ink-soft">{a.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One design, or three variants to compare side by side (for AppShape AI and the coding agent). */
function VariantsSwitch({ request }: { request: DesignRequest }) {
  const count = request.variants ?? 1;
  const choices = [
    { n: 1, label: "One design", title: "One proposal to review" },
    { n: 3, label: "3 variants", title: "Three different designs side by side on the board; pick one (AppShape AI: one request, about 2–3× the cost of one design)" },
  ];
  return (
    <div className="flex gap-0.5 rounded-md bg-ink/[0.05] p-0.5 text-xs" role="radiogroup" aria-label="How many designs">
      {choices.map((c) => (
        <button
          key={c.n}
          type="button"
          role="radio"
          aria-checked={count === c.n}
          title={c.title}
          onClick={() => count !== c.n && dispatch(updateRequestOps(request, { variants: c.n > 1 ? c.n : undefined }))}
          className={`flex-1 rounded px-2 py-1 ${count === c.n ? "bg-white font-semibold text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Moves the camera so the screen and its variants next to it are all in view (left of the drawing's panel). */
export function showVariants(request: DesignRequest): void {
  const { project, sizes } = useEditor.getState();
  const itemId = project && variantsPlacement(project, request);
  const item = itemId ? project.board.items.find((i) => i.id === itemId) : undefined;
  const rect = item && itemBounds(item, framesById(project!), sizes);
  if (!rect) return;
  const count = proposalVariants(request).length;
  const size = canvasSize();
  const panel = document.querySelector('[role="dialog"][aria-label^="Drawing on"]')?.getBoundingClientRect().width ?? 0;
  animateCamera(focusCamera({ ...rect, w: rect.w * count + VARIANT_GAP * (count - 1) }, { w: Math.max(size.w / 2, size.w - panel - 24), h: size.h }));
}

/** AppShape's AI: the model and expected cost; asks once what is sent; starts designing on the server. */
function AiChoice({ request }: { request: DesignRequest }) {
  const token = useEditor((s) => s.token);
  const ai = useEditor((s) => s.ai);
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [asking, setAsking] = useState(false);
  const label = ai?.models.find((m) => m.id === ai.model)?.label ?? ai?.model;
  const provider = ai?.models.find((m) => m.id === ai.model)?.provider;
  useEffect(() => {
    if (!token || !ai?.available) return;
    const timer = window.setTimeout(() => void aiEstimate(token, request.id).then((e) => setEstimates(e.byModel)).catch(() => {}), 300);
    return () => window.clearTimeout(timer);
  }, [token, ai?.available, request.id, request.updatedAt]);
  const estimate = ai ? estimates[ai.model] : undefined;
  // Ctrl+Enter in the message
  const startRef = useRef<() => Promise<void>>(undefined);
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === request.id) void startRef.current?.();
    };
    window.addEventListener(DESIGN_EVENT, listener);
    return () => window.removeEventListener(DESIGN_EVENT, listener);
  }, [request.id]);
  if (!ai) return null;
  const start = async () => {
    if (!token || !readyRequest(request.id)) return;
    // the latest settings (consent may have been given a moment ago)
    if (!useEditor.getState().ai?.consented) return setAsking(true);
    try {
      // the message just typed reaches the server first
      await whenSynced();
      await startDesign(token, request.id);
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  startRef.current = ai.available ? start : undefined;
  if (!ai.available) {
    return (
      <button type="button" onClick={() => useEditor.setState({ settingsOpen: true, settingsPage: "ai" })} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-ink/30 px-3 py-1.5 text-xs text-ink-soft hover:border-ink hover:text-ink" title="AppShape's AI designs it in seconds with your own API key">
        <Sparkles size={13} /> Design it with AppShape AI: add an API key
      </button>
    );
  }
  if (asking) {
    return (
      <div className="space-y-1.5 rounded-md border border-ink/20 px-2.5 py-2 text-xs" role="dialog" aria-label="What is sent">
        <p className="font-semibold">
          AppShape AI sends this to {provider === "anthropic" || !provider ? "Anthropic" : provider} ({label}):
        </p>
        <p className="text-ink-soft">A picture of the screen (with and without your drawing), the screen as JSX, your message, and your design system's tokens and components. Your project and key stay on this computer.</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={async () => {
              setAsking(false);
              if (!token) return;
              useEditor.setState({ ai: await saveAi(token, { consented: true }) });
              await start().catch(() => {});
            }}
            className="flex-1 rounded-md bg-ink px-2 py-1.5 font-semibold text-white hover:bg-ink-soft"
          >
            Send and design
          </button>
          <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1.5 font-semibold text-ink-soft hover:bg-ink/[0.06]">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => void start()} className="flex w-full flex-col items-center rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-white shadow-offset-sm hover:bg-accent-600" title="Ctrl+Enter in the message">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles size={15} /> {request.intent === "review" ? "Review it with AppShape AI" : "Design it with AppShape AI"}
        </span>
        <span className="text-[11px] text-white/80" data-testid="ai-estimate">
          {label}
          {estimate !== undefined && ` · ≈ ${dollars(estimate)}`}
        </span>
      </button>
      {ai.models.length > 1 && (
        <div className="flex gap-0.5 rounded-md bg-ink/[0.05] p-0.5" role="radiogroup" aria-label="AI model">
          {ai.models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === ai.model}
              onClick={() => token && m.id !== ai.model && void saveAi(token, { model: m.id }).then((next) => useEditor.setState({ ai: next }), (e: Error) => notify(e.message, "error"))}
              title={`${m.label}: ${m.note}`}
              className={`flex min-w-0 flex-1 flex-col items-center rounded px-1 py-0.5 text-[10px] leading-tight ${m.id === ai.model ? "bg-white font-semibold text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              <span className="truncate">{m.label.replace(/^Claude /, "")}</span>
              {estimates[m.id] !== undefined && <span className="font-normal opacity-75">≈ {dollars(estimates[m.id]!)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small amount of money: three decimals below 10 cents. */
const dollars = (usd: number) => `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** Designing on the server: how long it's been, and Cancel. Other screens stay editable. */
function DesigningWithAi({ request }: { request: DesignRequest }) {
  const token = useEditor((s) => s.token);
  const label = useEditor((s) => s.ai?.models.find((m) => m.id === s.ai?.model)?.label);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(request.updatedAt)) / 1000));
  return (
    <div className="space-y-1 rounded-md bg-accent-50 px-2.5 py-2 text-xs text-accent-900" role="status" data-testid="designing">
      <div className="flex items-center gap-1.5 font-semibold">
        <Loader2 size={13} className="animate-spin" /> Designing… <span className="font-mono font-normal">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
      </div>
      <p className="text-accent-800">
        {label ?? "AppShape AI"} is {request.intent === "review" ? "reviewing the page" : `working on ${(request.variants ?? 1) > 1 ? `${request.variants} variants` : "it"}`}. Other screens stay editable;{" "}
        {request.intent === "review" ? "the findings show here" : (request.variants ?? 1) > 1 ? "they show next to the screen" : "the proposal shows here"}.
      </p>
      <button type="button" onClick={() => token && void cancelDesign(token, request.id).catch(() => {})} className="font-semibold underline">
        Cancel
      </button>
    </div>
  );
}

/** Sent to the coding agent: the sentence to paste, until its proposal arrives. */
function WaitingForAgent({ request }: { request: DesignRequest }) {
  const token = useEditor((s) => s.token);
  const [agents, setAgents] = useState<AgentStatus[]>();
  useEffect(() => {
    if (token) void fetchSettings(token).then((r) => setAgents(r.agents)).catch(() => setAgents([]));
  }, [token]);
  const sentence = `Design AppShape request ${request.id}`;
  const connected = agents?.filter((a) => a.connected && a.mcp) ?? [];
  return (
    <div className="space-y-1.5 rounded-md bg-accent-50 px-2.5 py-2 text-xs text-accent-900" role="status" data-testid="waiting-for-agent">
      <div className="flex items-center gap-1.5 font-semibold">
        <Loader2 size={13} className="animate-spin" /> Waiting for your coding agent
      </div>
      <p>Paste this into {connected.length ? connected.map((a) => a.name).join(" or ") : "your coding agent"}:</p>
      <div className="flex items-center gap-1">
        <code className="flex-1 rounded bg-white px-2 py-1 font-mono text-[11px] text-ink">{sentence}</code>
        <button type="button" aria-label="Copy the sentence" title="Copy" onClick={() => void navigator.clipboard?.writeText(sentence).then(() => notify("Copied: paste it into your coding agent."))} className="grid h-6 w-6 place-items-center rounded hover:bg-white">
          <Copy size={12} />
        </button>
      </div>
      <AgentStarter prompt={sentence} />
      <p className="text-accent-800">{request.intent === "review" ? "The findings show" : "The proposal shows"} here as soon as {request.intent === "review" ? "they arrive" : "it arrives"}. Other screens stay editable.</p>
      {agents && connected.length === 0 && (
        <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
          No coding agent is connected to this project yet.{" "}
          <button type="button" onClick={() => useEditor.setState({ settingsOpen: true })} className="font-semibold underline">
            Connect one
          </button>
        </p>
      )}
      <button type="button" onClick={() => dispatch(updateRequestOps(request, { route: undefined, status: "draft" }))} className="font-semibold underline">
        Cancel
      </button>
    </div>
  );
}

/** A fix of a review's finding in progress: which one, and the way back to the review. */
function FixingBanner({ request }: { request: DesignRequest }) {
  const finding = request.review?.findings.find((f) => f.id === request.fixing);
  if (!finding) return null;
  return (
    <div className="flex items-center gap-2 rounded-md bg-accent-50 px-2.5 py-1.5 text-xs text-accent-900">
      <span className="min-w-0 flex-1">
        Fixing: <b>{finding.title}</b>
      </span>
      {request.status !== "designing" && (
        <button type="button" onClick={() => dispatch(backToReviewOps(request))} className="shrink-0 font-semibold underline">
          Back to the review
        </button>
      )}
    </div>
  );
}

/**
 * A review of the page: what to improve in plain words. *Fix it* turns a finding into a change
 * (designed the same way the review was made: AppShape AI or the coding agent); afterwards the
 * request comes back here with that finding ticked off.
 */
function ReviewPanel({ request }: { request: DesignRequest }) {
  const review = request.review!;
  const token = useEditor((s) => s.token);
  const models = useEditor((s) => s.ai?.models ?? []);
  const open = review.findings.filter((f) => !f.done);
  const done = review.findings.filter((f) => f.done);
  const hover = (ids: string[] | undefined) => useEditor.setState({ proposalHover: ids?.length ? { requestId: request.id, ids } : undefined });
  const fix = async (id: string) => {
    hover(undefined);
    const finding = review.findings.find((f) => f.id === id);
    const project = useEditor.getState().project;
    const itemId = project ? variantsPlacement(project, request) : undefined;
    const box = itemId && finding?.targets?.length ? designBox(itemId, finding.targets) : undefined;
    if (!dispatch(fixFindingOps(request, id, box))) return;
    // the same way the review was made: AppShape AI right away, or the coding agent
    if (request.route === "agent") {
      const latest = useEditor.getState().project?.requests?.find((r) => r.id === request.id);
      if (latest) dispatch(updateRequestOps(latest, { route: "agent", status: "designing" }));
      return;
    }
    if (request.route === "ai" && token) {
      await whenSynced();
      await startDesign(token, request.id).catch((e: Error) => notify(e.message, "error"));
    }
  };
  const by = review.by === "agent" ? "your coding agent" : (models.find((m) => m.id === review.by)?.label ?? review.by);
  return (
    <div className="space-y-2" data-testid="review">
      {review.summary && <p className="text-sm">{review.summary}</p>}
      <p className="text-[11px] text-ink-soft">
        by {by}
        {review.usage?.costUsd !== undefined && ` · $${review.usage.costUsd.toFixed(2)}`}
      </p>
      {open.length === 0 && <p className="rounded-md bg-teal-50 px-2 py-1.5 text-xs text-teal-900">{review.findings.length ? "All done." : "Nothing important to improve."}</p>}
      <ul className="space-y-1.5" aria-label="Findings">
        {open.map((f) => (
          <li key={f.id} onPointerEnter={() => hover(f.targets)} onPointerLeave={() => hover(undefined)} className="rounded-lg border border-ink/15 px-2.5 py-2 hover:border-ink/40">
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f.severity === "important" ? "bg-amber-500" : "bg-sky-400"}`} title={f.severity === "important" ? "Important" : "Nice to have"} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{f.title}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{f.why}</p>
              </div>
            </div>
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button type="button" onClick={() => dispatch(skipFindingOps(request, f.id))} className="rounded-md px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-ink/[0.06]">
                Skip
              </button>
              <button type="button" onClick={() => void fix(f.id)} title={f.fix} className="flex items-center gap-1 rounded-md border border-ink bg-accent-500 px-2 py-1 text-xs font-bold text-white hover:bg-accent-600">
                <Sparkles size={12} /> Fix it
              </button>
            </div>
          </li>
        ))}
      </ul>
      {done.length > 0 && <p className="text-[11px] text-ink-soft">{done.length} done: {done.map((f) => f.title).join(", ")}</p>}
      <div className="flex justify-between text-xs">
        <button type="button" onClick={() => dispatch(updateRequestOps(request, { status: "draft", review: undefined, route: undefined }))} className="font-semibold text-accent-700 underline">
          Review again
        </button>
        <button type="button" onClick={() => dispatch(deleteRequestOps(request)) && useEditor.setState({ openRequest: undefined })} className="font-semibold text-ink-soft hover:text-ink">
          Done with the review
        </button>
      </div>
    </div>
  );
}

/** The proposal shown for a screen (Draw & describe), and whether before or after it. */
export function useProposal(frameId: string | undefined): { request: DesignRequest; view: "before" | "after" } | undefined {
  const request = useEditor((s) => (frameId ? s.project?.requests?.find((r) => r.frameId === frameId && r.status === "proposed" && r.proposal) : undefined));
  const view = useEditor((s) => (request ? (s.proposalView[request.id] ?? "after") : "after"));
  return useMemo(() => (request ? { request, view } : undefined), [request, view]);
}

/** Outlines the elements of the change the pointer is on (in the change list). */
export function ProposalHighlights({ itemId, requestId, zoom }: { itemId: string; requestId: string; zoom: number }) {
  const ids = useEditor((s) => (s.proposalHover?.requestId === requestId ? s.proposalHover.ids : undefined));
  const [boxes, setBoxes] = useState<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  useLayoutEffect(() => {
    const handle = frameHandle(itemId);
    const host = document.querySelector(`[data-frame-content="${CSS.escape(itemId)}"]`);
    if (!ids || !handle || !host) return setBoxes([]);
    const origin = host.getBoundingClientRect();
    setBoxes(
      ids.flatMap((id) => {
        const r = handle.nodeRect(id);
        return r ? [{ id, x: (r.x - origin.left) / zoom, y: (r.y - origin.top) / zoom, w: r.w / zoom, h: r.h / zoom }] : [];
      }),
    );
  }, [ids, itemId, zoom]);
  return (
    <>
      {boxes.map((b) => (
        <div key={b.id} className="pointer-events-none absolute rounded-sm" data-testid="proposal-highlight" style={{ left: b.x - 3 / zoom, top: b.y - 3 / zoom, width: b.w + 6 / zoom, height: b.h + 6 / zoom, outline: `${2 / zoom}px solid #8e44d6`, background: "rgb(142 68 214 / 0.08)" }} />
      ))}
    </>
  );
}

/** Reviewing a proposal: before/after, the changes, warnings; accept, try again or discard. */
function ProposalReview({ request }: { request: DesignRequest }) {
  const proposal = request.proposal!;
  const models = useEditor((s) => s.ai?.models ?? []);
  const view = useEditor((s) => s.proposalView[request.id] ?? "after");
  const stale = useEditor((s) => (s.project ? isStale(s.project, request) : false));
  const fits = useEditor((s) => (s.project ? proposedFrame(s.project, request) !== undefined : false));
  const [again, setAgain] = useState(false);
  const followUp = useRef<HTMLTextAreaElement>(null);
  const variants = proposalVariants(request);
  // new variants: all of them in view
  const madeAt = variants.length > 1 ? proposal.at : undefined;
  useEffect(() => {
    if (madeAt) showVariants(useEditor.getState().project?.requests?.find((r) => r.id === request.id) ?? request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, madeAt]);
  const setView = (next: "before" | "after") => useEditor.setState((s) => ({ proposalView: { ...s.proposalView, [request.id]: next } }));
  const hover = (ids: string[] | undefined) => useEditor.setState({ proposalHover: ids ? { requestId: request.id, ids } : undefined });
  const accept = () => {
    hover(undefined);
    if (dispatch(acceptOps(request))) {
      // a review's fix: the panel stays, on the review
      if (!request.fixing) useEditor.setState((st) => ({ openRequest: undefined, ...(st.tool === "draw" && { tool: "select" as const }) }));
      notify(`Accepted ${proposal.summary.length} change${proposal.summary.length === 1 ? "" : "s"} (Ctrl+Z undoes them).`);
    }
  };
  return (
    <div className="space-y-2" data-testid="proposal">
      {variants.length > 1 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">Pick a variant</span>
            <button type="button" onClick={() => showVariants(request)} className="font-semibold text-accent-700 underline" title="Show the screen and its variants side by side">
              Show side by side
            </button>
          </div>
          <div className="space-y-0.5" role="radiogroup" aria-label="Variants">
            {variants.map((v) => (
              <button
                key={v.variant}
                type="button"
                role="radio"
                aria-checked={v === proposal}
                onClick={() => dispatch(pickVariantOps(request, v.variant!))}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs ${v === proposal ? "border-[#8e44d6] bg-accent-50 font-semibold" : "border-ink/15 hover:border-ink/40"}`}
              >
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${v === proposal ? "bg-[#8e44d6] text-white" : "bg-ink/[0.08] text-ink-soft"}`}>{v.variant}</span>
                <span className="min-w-0 flex-1 truncate">{v.idea ?? `Variant ${v.variant}`}</span>
                <span className="shrink-0 font-normal text-ink-soft">{v.summary.length} change{v.summary.length === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex rounded-md bg-zinc-100 p-0.5 text-xs" role="radiogroup" aria-label="Proposal view">
        {(["before", "after"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`flex-1 rounded px-2 py-1 ${view === v ? "bg-white font-semibold shadow-sm" : "text-ink-soft"}`}>
            {v === "before" ? "Before" : "After"}
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold">
          {proposal.summary.length ? `${proposal.summary.length} change${proposal.summary.length === 1 ? "" : "s"}` : "No changes"} <span className="font-normal text-ink-soft">· by {proposal.by === "file" ? "a file" : proposal.by === "agent" ? "your coding agent" : (models.find((m) => m.id === proposal.by)?.label ?? proposal.by)}{proposal.usage?.costUsd !== undefined && ` · $${proposal.usage.costUsd.toFixed(2)}${variants.length > 1 ? ` for all ${variants.length}` : ""}`}</span>
        </div>
        <ul className="max-h-48 space-y-0.5 overflow-auto text-xs" aria-label="Changes">
          {proposal.summary.map((line, i) => (
            <li key={i} onPointerEnter={() => hover(proposal.targets?.[i])} onPointerLeave={() => hover(undefined)} className="cursor-default rounded px-1.5 py-1 hover:bg-accent-50">
              {line}
            </li>
          ))}
        </ul>
      </div>
      {proposal.warnings?.map((w) => (
        <p key={w} className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900" role="note">
          {w}
        </p>
      ))}
      {proposal.questions?.map((q) => (
        <p key={q} className="rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
          {q}
        </p>
      ))}
      {!fits ? (
        <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800" role="alert">The screen changed so much that this proposal doesn't fit it any more. Try again.</p>
      ) : stale ? (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900" role="note">The screen changed since this was proposed: accepting applies its changes on top.</p>
      ) : null}
      {again ? (
        <div className="space-y-1.5">
          <textarea ref={followUp} rows={2} autoFocus aria-label="What should be different?" placeholder="What should be different? (e.g. keep the button on the left)" onKeyDown={(e) => e.stopPropagation()} className="w-full resize-y rounded-md border border-ink/20 px-2 py-1.5 text-sm outline-none focus:border-accent-500" />
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void askAgain(request, followUp.current?.value ?? "")} className="flex-1 rounded-md bg-ink px-2 py-1.5 text-xs font-semibold text-white hover:bg-ink-soft">
              Ask again
            </button>
            <button type="button" onClick={() => setAgain(false)} className="rounded-md px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/[0.06]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button type="button" disabled={!fits} onClick={accept} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-ink bg-accent-500 px-2 py-1.5 text-sm font-bold text-white shadow-offset-sm hover:bg-accent-600 disabled:opacity-40">
            <Check size={14} /> Accept
          </button>
          <button type="button" onClick={() => setAgain(true)} className="flex items-center gap-1 rounded-md border border-ink/30 px-2 py-1.5 text-xs font-semibold hover:bg-ink/[0.05]">
            <RotateCcw size={12} /> Try again
          </button>
          <button type="button" onClick={() => dispatch(reopenOps(request))} className="rounded-md px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/[0.06]">
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

/** Try again: the follow-up goes to whoever designed it (AppShape's AI runs again right away). */
async function askAgain(request: DesignRequest, followUp: string): Promise<void> {
  if (!dispatch(reopenOps(request, followUp))) return;
  const token = useEditor.getState().token;
  if (request.route !== "ai" || !token) return;
  await whenSynced();
  try {
    await startDesign(token, request.id);
  } catch (e) {
    notify((e as Error).message, "error");
  }
}

/** Designing a drawing without AppShape's AI: the commands that give and take the screen as JSX. */
function DesignYourself({ request }: { request: DesignRequest }) {
  const commands = `appshape request ${request.id}\nappshape propose ${request.id} design.tsx`;
  return (
    <details className="rounded-md border border-ink/10 px-2.5 py-1.5 text-xs">
      <summary className="cursor-pointer font-semibold">Design it with your coding agent or by hand</summary>
      <p className="mt-1 text-ink-soft">Get the screen as JSX with the drawing in words, change it, and propose it. The proposal shows here for review.</p>
      <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 px-2 py-1 font-mono text-[11px]">{commands}</pre>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(commands).then(() => notify("Copied the commands."))} className="mt-1 font-semibold text-accent-700 underline">
        Copy
      </button>
    </details>
  );
}
