import { arrangeBoardOps } from "../lib/arrange";
import { registerInsert } from "../lib/commands";
import { ArrangeButtons } from "./Inspector";
import { STACK_LABELS } from "@appshape/protocol";
import {
  ArrowUpRight,
  Code2,
  Download,
  ExternalLink,
  Play,
  Waypoints,
  Hand,
  ListChecks,
  Magnet,
  Maximize,
  Move,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  ScrollText,
  Settings,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Sun,
  TriangleAlert,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { STARTER_COMPONENTS } from "@appshape/kit";
import { insertComponent, insertionContext } from "../lib/actions";
import { insertStarter } from "../lib/kit";
import { useFindingCounts } from "../lib/checks";
import { codeRun, codeStatus } from "../lib/api";
import { insertOps } from "../lib/nodes";
import { PRIMITIVES, type PrimitiveKind, primitive } from "../lib/templates";
import { setZoom, zoomBy, zoomToFit } from "../lib/view";
import { dispatch, redo, selectNode, setScheme, setSnap, type Tool, undo, useEditor } from "../store";
import { NOTE_COLORS, useNoteColor } from "./Items";
import { DrawBar, DrawButton } from "./Markup";
import { Logo } from "./Logo";

/** How a pressed button looks: tools are purple, flows teal, modes ink, panels a quiet tint. */
type Tone = "tool" | "flow" | "mode" | "panel";
const ACTIVE: Record<Tone, string> = {
  tool: "bg-accent-500 text-white ring-1 ring-inset ring-ink",
  flow: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-500/50",
  mode: "bg-ink text-white",
  panel: "bg-ink/[0.07] text-ink",
};

function IconButton({
  title,
  onClick,
  active,
  tone = "panel",
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  tone?: Tone;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors disabled:opacity-30 ${active ? ACTIVE[tone] : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-ink/15" />;

/** Opens the design checks; shows how many problems the screens have. */
function ChecksButton() {
  const open = useEditor((s) => s.checksOpen);
  const counts = useFindingCounts();
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <button
      type="button"
      onClick={() => useEditor.setState({ checksOpen: !open, checksScreen: undefined })}
      title="Check design: contrast, design system, headings, tap targets, …"
      aria-pressed={open}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium ${open ? "bg-ink/[0.07] text-ink" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"}`}
    >
      <ListChecks size={15} /> Check design
      {total > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold leading-4 text-white">{total}</span>}
    </button>
  );
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  inspectorOpen,
  onToggleInspector,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const showFlows = useEditor((s) => s.showFlows);
  const project = useEditor((s) => s.project);
  const connected = useEditor((s) => s.connected);
  const logOpen = useEditor((s) => s.logPanel !== undefined);
  const unseenError = useEditor((s) => s.logs.some((l) => l.level === "error" && l.at > s.logSeenAt));
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const zoom = useEditor((s) => s.camera.zoom);
  const scheme = useEditor((s) => s.scheme);
  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-ink/10 bg-paper px-2">
      <IconButton title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={onToggleSidebar} active={sidebarOpen}>
        <PanelLeft size={16} />
      </IconButton>
      <span title="AppShape" className="ml-1 shrink-0">
        <Logo size={26} />
      </span>
      <span className="text-ink/25">/</span>
      <span className="truncate font-semibold text-ink">{project?.name}</span>
      <span
        className={`ml-0.5 h-2 w-2 shrink-0 rounded-full ${connected ? "bg-teal-500" : "bg-amber-500"}`}
        title={connected ? "Connected" : "Reconnecting…"}
      />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => useEditor.setState(logOpen ? { logPanel: undefined, logSeenAt: new Date().toISOString() } : { logPanel: {}, toasts: [] })}
        title="What AppShape did: starting your app, bringing in pages, sending to code, checks"
        aria-pressed={logOpen}
        className={`relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium ${logOpen ? "bg-ink/[0.07] text-ink" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"}`}
      >
        <ScrollText size={15} /> Activity
        {unseenError && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-label="new problems" />}
      </button>
      <ChecksButton />
      <AppButton />
      <button
        type="button"
        onClick={() => useEditor.setState({ importOpen: true })}
        title="Capture pages of the running app as editable screens"
        className="flex h-8 items-center gap-1.5 rounded-md border border-ink/70 bg-white px-2.5 text-sm font-semibold text-ink hover:border-ink hover:bg-accent-50"
      >
        <Download size={15} /> Import pages
      </button>
      <button
        type="button"
        onClick={() => useEditor.setState({ applyOpen: true })}
        title="Generate or update the app's code from the design"
        className="mr-1 flex h-8 items-center gap-1.5 rounded-md border border-ink bg-accent-500 px-3 text-sm font-bold text-white shadow-offset-sm transition-[transform,box-shadow] hover:bg-accent-600 active:translate-x-px active:translate-y-px active:shadow-none"
      >
        <Code2 size={15} /> Apply to code
      </button>
      <Divider />
      <IconButton title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 size={16} />
      </IconButton>
      <Divider />
      <IconButton title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
        <ZoomOut size={16} />
      </IconButton>
      <button type="button" title="Zoom to 100% (Shift+0)" onClick={() => setZoom(1)} className="w-12 rounded-md text-center text-sm font-medium tabular-nums text-ink-soft hover:bg-ink/[0.06] hover:text-ink">
        {Math.round(zoom * 100)}%
      </button>
      <IconButton title="Zoom in" onClick={() => zoomBy(1.25)}>
        <ZoomIn size={16} />
      </IconButton>
      <IconButton title="Zoom to fit (Shift+1)" onClick={zoomToFit}>
        <Maximize size={16} />
      </IconButton>
      <SnapMenu />
      <Divider />
      <IconButton
        title={scheme === "dark" ? "Show screens in light mode" : "Show screens in dark mode"}
        onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
        active={scheme === "dark"}
        tone="mode"
      >
        {scheme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
      </IconButton>
      <IconButton title={showFlows ? "Hide flows" : "Show flows (links between screens)"} onClick={() => useEditor.setState({ showFlows: !showFlows })} active={showFlows} tone="flow">
        <Waypoints size={16} />
      </IconButton>
      <IconButton title="Project settings" onClick={() => useEditor.setState({ settingsOpen: true })}>
        <Settings size={16} />
      </IconButton>
      <IconButton title={inspectorOpen ? "Hide inspector" : "Show inspector"} onClick={onToggleInspector} active={inspectorOpen}>
        <PanelRight size={16} />
      </IconButton>
    </header>
  );
}

/** Snapping: grid and smart guides, for the board and inside screens. */
function SnapMenu() {
  const snap = useEditor((s) => s.snap);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const on = snap.grid || snap.guides;
  const row = (label: string, hint: string, value: boolean, change: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent-50">
      <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} className="mt-0.5 accent-[#8e44d6]" />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-soft">{hint}</span>
      </span>
    </label>
  );
  return (
    <div ref={ref} className="relative">
      <IconButton title="Snapping" onClick={() => setOpen(!open)} active={on} tone="flow">
        <Magnet size={16} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border-[1.5px] border-ink bg-white p-1.5 shadow-offset" role="dialog" aria-label="Snapping">
          {row("Snap to grid", "The board's dots (24); inside screens the base spacing (8).", snap.grid, (grid) => setSnap({ grid }))}
          {row("Smart guides", "Line up with other things: edges, centers, equal spacing and sizes.", snap.guides, (guides) => setSnap({ guides }))}
          <p className="px-2 pb-1 pt-1.5 text-xs text-ink-soft">
            Hold <kbd className="rounded border border-ink/20 px-1">Alt</kbd> while dragging to place without snapping; <kbd className="rounded border border-ink/20 px-1">Shift</kbd> keeps a straight line.
          </p>
        </div>
      )}
    </div>
  );
}

/** The running app (link), or a button to start its dev server once code exists. */
function AppButton() {
  const token = useEditor((s) => s.token);
  const status = useEditor((s) => s.appStatus);
  useEffect(() => {
    if (!token) return;
    const refresh = () => void codeStatus(token).then((appStatus) => useEditor.setState({ appStatus })).catch(() => {});
    refresh();
    const busy = status?.process.state === "installing" || status?.process.state === "starting";
    const timer = window.setInterval(refresh, busy ? 1000 : 10000);
    return () => window.clearInterval(timer);
  }, [token, status?.process.state]);
  if (!token || !status || status.app !== "app") return null;
  const process = status.process;
  if (process.url) {
    return (
      <a href={process.url} target="_blank" rel="noreferrer" title={`${status.stack ? STACK_LABELS[status.stack] : "App"} at ${process.url}`} className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-teal-700 hover:bg-teal-50">
        <span className="h-2 w-2 rounded-full bg-teal-500" /> App <ExternalLink size={13} />
      </a>
    );
  }
  if (process.state === "installing" || process.state === "starting") {
    return <span className="px-2 text-xs text-ink-soft">{process.state === "installing" ? "Installing…" : "Starting app…"}</span>;
  }
  return (
    <button
      type="button"
      title="Start the app's dev server (pnpm dev)"
      onClick={() => void codeRun(token).then((p) => useEditor.setState({ appStatus: { ...status, process: p } }))}
      className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-ink/[0.06] hover:text-ink"
    >
      <Play size={13} /> Run app
    </button>
  );
}

const TOOLS: { tool: Tool; title: string; icon: React.ReactNode }[] = [
  { tool: "select", title: "Select (V)", icon: <MousePointer2 size={16} /> },
  { tool: "hand", title: "Pan (H, or hold Space)", icon: <Hand size={16} /> },
  { tool: "note", title: "Note (N)", icon: <StickyNote size={16} /> },
  { tool: "arrow", title: "Arrow (A): drag from one item to another", icon: <ArrowUpRight size={16} /> },
  { tool: "section", title: "Section (S): drag a rectangle", icon: <Square size={16} /> },
  { tool: "text", title: "Text (T)", icon: <Type size={16} /> },
];

registerInsert((kind) => insertPrimitive(kind));

export function insertPrimitive(kind: PrimitiveKind): void {
  const target = insertionContext();
  if (!target?.ctx) return;
  const project = useEditor.getState().project!;
  const node = primitive(kind, project.tokens);
  if (dispatch(insertOps(target.ctx, node))) selectNode({ itemId: target.itemId, frameId: target.ctx.frame.id, nodeId: node.id });
}

function InsertMenu() {
  const canInsert = useEditor((s) => Boolean(s.node) || (s.selection.length === 1 && s.project?.board.items.find((i) => i.id === s.selection[0])?.type === "frame"));
  const components = (useEditor((s) => s.project?.frames) ?? []).filter((f) => f.kind === "component");
  // starter components the project doesn't have yet (the ones it has are among its components)
  const starters = STARTER_COMPONENTS.filter((c) => !components.some((f) => f.component?.kit === c.key));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={!canInsert}
        onClick={() => setOpen(!open)}
        title={canInsert ? "Insert element" : "Select a screen or element to insert into"}
        className="flex h-8 items-center gap-1 rounded-lg bg-ink px-2.5 text-sm font-semibold text-white hover:bg-ink-soft disabled:bg-zinc-200 disabled:text-zinc-400"
      >
        <Plus size={16} /> Insert
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 mb-2 grid w-64 -translate-x-1/2 grid-cols-3 gap-1 rounded-lg border border-ink bg-white shadow-offset-sm p-2" role="menu" aria-label="Insert element">
          {PRIMITIVES.map((p) => (
            <button
              key={p.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                insertPrimitive(p.kind);
                setOpen(false);
              }}
              className="rounded-md border border-zinc-200 px-2 py-2 text-xs font-medium text-ink hover:border-ink hover:bg-accent-50"
            >
              {p.label}
            </button>
          ))}
          {starters.length > 0 && <div className="col-span-3 mt-1 border-t border-zinc-100 pt-1.5 text-[11px] font-semibold text-teal-700">Starter components</div>}
          {starters.map((c) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              aria-label={`${c.name} (starter component)`}
              title={c.description}
              onClick={() => {
                insertStarter(c.key);
                setOpen(false);
              }}
              className="truncate rounded-md border border-teal-200 px-2 py-2 text-xs font-medium text-teal-800 hover:border-teal-500 hover:bg-teal-50"
            >
              {c.name}
            </button>
          ))}
          {components.length > 0 && <div className="col-span-3 mt-1 border-t border-zinc-100 pt-1.5 text-[11px] font-semibold text-pink-700">Components</div>}
          {components.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              onClick={() => {
                insertComponent(c.id);
                setOpen(false);
              }}
              className="truncate rounded-md border border-pink-200 px-2 py-2 text-xs font-medium text-pink-800 hover:border-pink-500 hover:bg-pink-50"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const freeMove = useEditor((s) => s.freeMove);
  const pinned = useEditor((s) => s.freeMovePinned);
  const [noteColor, setNoteColor] = useNoteColor();
  const arrangeable = useEditor((s) => s.selection.filter((id) => s.project?.board.items.find((i) => i.id === id)?.type !== "arrow").length);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
      {arrangeable > 1 && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border-[1.5px] border-ink bg-white py-0.5 pl-3 pr-1 text-xs font-semibold text-ink shadow-offset-sm" data-testid="arrange-bar">
          <span>{arrangeable} selected</span>
          <ArrangeButtons
            enabled={(action) => (action.kind === "distribute" && arrangeable < 3 ? "Select three or more" : true)}
            onAction={(action) => {
              const { project, selection, sizes } = useEditor.getState();
              if (project) dispatch(arrangeBoardOps(project, selection, sizes, action));
            }}
          />
        </div>
      )}
      {freeMove && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border-[1.5px] border-ink bg-accent-500 py-1 pl-3 pr-1 text-xs font-semibold text-white shadow-offset-sm" role="status" data-testid="free-move-bar">
          <Move size={14} />
          <span>Moving freely: elements keep their place in the layout, nothing else moves.{pinned ? "" : " Ends when you pick another element."}</span>
          <button
            type="button"
            aria-pressed={pinned}
            onClick={() => useEditor.setState({ freeMovePinned: !pinned })}
            className={`rounded-md px-2 py-1 ${pinned ? "bg-ink text-white" : "hover:bg-accent-600"}`}
          >
            {pinned ? "Kept on" : "Keep on"}
          </button>
          <button type="button" onClick={() => useEditor.setState({ freeMove: false, freeMovePinned: false, freeMoveUsedOn: undefined })} className="rounded-md bg-white px-2 py-1 text-ink hover:bg-accent-50">
            Turn off
          </button>
        </div>
      )}
      <DrawBar />
      {noteColor && (
        <div className="pointer-events-auto flex gap-1.5 rounded-xl border-[1.5px] border-ink bg-white p-1.5 shadow-offset-sm" aria-label="Note color">
          {Object.entries(NOTE_COLORS).map(([name, color]) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={`Note color ${name}`}
              onClick={() => setNoteColor(name)}
              className={`h-6 w-6 rounded-full border ${noteColor === name ? "ring-2 ring-ink ring-offset-1" : ""}`}
              style={{ background: color.bg, borderColor: color.border }}
            />
          ))}
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border-[1.5px] border-ink bg-white p-1 shadow-offset" role="toolbar">
        <InsertMenu />
        <DrawButton />
        <Divider />
        {TOOLS.map((t) => (
          <IconButton key={t.tool} title={t.title} active={tool === t.tool} tone="tool" onClick={() => useEditor.setState({ tool: t.tool })}>
            {t.icon}
          </IconButton>
        ))}
        <Divider />
        <button
          type="button"
          role="switch"
          aria-checked={freeMove}
          title={freeMove ? "Move freely is on (M): dragged elements move by themselves, nothing else moves" : "Move freely (M, or hold Ctrl while dragging): move elements anywhere instead of reordering them"}
          onClick={() => useEditor.setState({ freeMove: !freeMove, freeMovePinned: false, freeMoveUsedOn: undefined })}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors font-semibold ${freeMove ? "text-ink" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"}`}
        >
          <Move size={15} />
          Move freely
          <span className={`relative h-4 w-7 rounded-full border border-ink transition-colors ${freeMove ? "bg-accent-500" : "bg-white"}`}>
            <span className={`absolute top-[1px] h-3 w-3 rounded-full border border-ink bg-white transition-all ${freeMove ? "left-[13px]" : "left-[1px]"}`} />
          </span>
        </button>
      </div>
    </div>
  );
}
