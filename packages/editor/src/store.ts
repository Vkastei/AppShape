import {
  type AnyOp,
  applyCommandToProject,
  createId,
  findNode,
  invertCommand,
  type MarkupShape,
  type Project,
} from "@appshape/ir";
import { type AiStatus, type AppStylesResponse, type CodeStatusResponse, type FontMeta, type LogEntry, type ProjectSnapshot, type ServerMessage, TOAST_LEVELS, type WireProblem } from "@appshape/protocol";
import { create } from "zustand";
import { aiStatus, type Connection, fetchAppStyles, fetchLogs, fetchSnapshot } from "./lib/api";
import type { Camera, Sizes } from "./lib/geometry";
import type { MarkupTool } from "./lib/markup";
import type { GuideLine, Measure } from "./lib/snap";

/** States the inspector edits (Pressed is the format's `active`). */
export type EditState = "hover" | "focus" | "active" | "disabled" | "group-hover";
export type Tool = "select" | "hand" | "note" | "arrow" | "section" | "text" | "draw";
export type SidebarTab = "screens" | "library" | "components" | "layers" | "design";

/** An element selected inside a screen placement. */
export interface NodeSelection {
  /** The board placement it was selected in (a screen can be placed several times). */
  itemId: string;
  frameId: string;
  nodeId: string;
}

interface UndoEntry {
  ops: AnyOp[];
  inverse: AnyOp[];
}

export interface EditorState {
  status: "loading" | "ready" | "error";
  connected: boolean;
  error: string | undefined;
  /** What AppShape did (server and editor), newest last; the log panel shows them. */
  logs: LogEntry[];
  /** Entries shown as toasts right now (ids, oldest first). */
  toasts: string[];
  /** The log panel is open (optionally scrolled to an entry). */
  logPanel: { focus?: string } | undefined;
  /** When the log panel was last closed (errors after it mark the Activity button). */
  logSeenAt: string;
  token: string | undefined;
  project: Project | undefined;
  /** Fonts installed in the project (`.appshape/assets/fonts`), loaded into the page. */
  fonts: FontMeta[];
  location: ProjectSnapshot["location"] | undefined;
  problems: WireProblem[];
  rev: number;
  camera: Camera;
  tool: Tool;
  selection: string[];
  editingId: string | undefined;
  /** Selected element inside a screen (exclusive with board selection). */
  node: NodeSelection | undefined;
  /** Further selected elements (Shift-click), on any screen; `node` is the one clicked first. */
  extraNodes: NodeSelection[];
  hover: NodeSelection | undefined;
  /** Inline text editing of `node`. */
  editingText: boolean;
  /** Breakpoint that inspector edits go to; undefined = all sizes (base). */
  breakpoint: string | undefined;
  /** Interaction state that inspector edits go to (and the selection shows); undefined = default. */
  state: EditState | undefined;
  /** Component variant that inspector edits go to (inside component frames); undefined = all. */
  variant: { name: string; value: string } | undefined;
  /** Inline editing of a text property inside an instance (rendered id of the text element). */
  editingProp: { sel: NodeSelection; prop: string; elementId: string } | undefined;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  /** The command palette (Ctrl+K) and the shortcut overview (?). */
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /** A screen whose name is being edited in the screens list (F2). */
  renamingScreen: string | undefined;
  /** Counts "New screen" requests from the palette (the screens list opens its form). */
  newScreenRequest: number;
  showFlows: boolean;
  /** Screen shown in prototype mode, with history for "back". */
  prototype: { frameId: string; history: string[] } | undefined;
  sizes: Sizes;
  /** The app's code: stack, whether the design was applied, the running dev server. */
  appStatus: CodeStatusResponse | undefined;
  applyOpen: boolean;
  /** Imported app's CSS, rendered in every frame. */
  appStyles: AppStylesResponse | undefined;
  /** CSS for the classes the design keeps as they are (see `watchBoardCss`). */
  boardCss: string;
  importOpen: boolean;
  settingsOpen: boolean;
  /** The theme starter dialog. */
  themeOpen: boolean;
  /** The screen the theme starter was opened for (its own theme), if any. */
  themeScreen?: string;
  /** The design checks panel, optionally for one screen. */
  checksOpen: boolean;
  checksScreen?: string;
  /** Keys of design check findings this person ignores (saved in the project's .cache). */
  ignoredChecks: string[];
  /** Imported elements rendered by shared code: edit all copies (default) or this one only. */
  codeScope: "all" | "this";
  /** Color scheme the screens are shown in (`dark:` styles, the app's dark mode). */
  scheme: "light" | "dark";
  /** Dragging an element inside a screen moves it freely (an offset, its slot stays) instead of reordering it. */
  freeMove: boolean;
  /** Free move stays on for other elements too ("Keep on"); otherwise it ends with the element it was used on. */
  freeMovePinned: boolean;
  /** The element the switch was last used on. */
  freeMoveUsedOn: string | undefined;
  /** Snapping on the board and in screens (per browser). */
  snap: SnapPrefs;
  /** Guides while dragging or resizing inside a screen (client coordinates). */
  elementGuides: { lines: GuideLine[]; measures: Measure[] } | undefined;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** Draw & describe: the drawing tool, color (legend key or hex) and stroke width. */
  draw: { tool: MarkupTool; color: string; width: number };
  /** The screen placement being drawn on (the draw tool); the rest of the board dims. */
  drawingOn: string | undefined;
  /** The shape being drawn right now (placement and shape in the screen's design px). */
  markupDraft: { itemId: string; shape: MarkupShape } | undefined;
  /** A label being typed (placement and position). */
  labelDraft: { itemId: string; x: number; y: number } | undefined;
  /** Drawings are shown on the screens. */
  showMarkup: boolean;
  /** The drawing whose panel is open (message, sending, the proposal). */
  openRequest: string | undefined;
  /** Per proposed drawing: the screen shown before or after the proposal (default after). */
  proposalView: Record<string, "before" | "after">;
  /** Elements of a proposal pointed out (hovering a change). */
  proposalHover: { requestId: string; ids: string[] } | undefined;
  /** AppShape's AI: whether a key is there, the model, spending (loaded with the board). */
  ai: AiStatus | undefined;
  /** The settings page to open with the settings dialog. */
  settingsPage: string | undefined;
}

const SCHEME_KEY = "appshape.scheme";
const SNAP_KEY = "appshape.snap";

export interface SnapPrefs {
  /** Snap to the grid (board 24, screens the base spacing). */
  grid: boolean;
  /** Align to other objects: edges, centers, equal spacing and sizes. */
  guides: boolean;
}

function initialSnap(): SnapPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAP_KEY) ?? "null") as Partial<SnapPrefs> | null;
    if (saved) return { grid: saved.grid !== false, guides: saved.guides !== false };
  } catch {
    // storage blocked or unreadable
  }
  return { grid: true, guides: true };
}

export function setSnap(patch: Partial<SnapPrefs>): void {
  const snap = { ...useEditor.getState().snap, ...patch };
  useEditor.setState({ snap });
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
  } catch {
    // storage blocked: the choice lasts for this session
  }
}

/** The scheme picked last on this browser, else the system's (what the app shows here, too). */
function initialScheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem(SCHEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage blocked
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setScheme(scheme: "light" | "dark"): void {
  useEditor.setState({ scheme });
  try {
    localStorage.setItem(SCHEME_KEY, scheme);
  } catch {
    // storage blocked: the choice lasts for this session
  }
}

const initial: EditorState = {
  status: "loading",
  connected: false,
  error: undefined,
  logs: [],
  toasts: [],
  logPanel: undefined,
  logSeenAt: new Date(0).toISOString(),
  token: undefined,
  project: undefined,
  fonts: [],
  location: undefined,
  problems: [],
  rev: 0,
  camera: { x: 0, y: 0, zoom: 0.5 },
  tool: "select",
  selection: [],
  editingId: undefined,
  node: undefined,
  extraNodes: [],
  hover: undefined,
  editingText: false,
  breakpoint: undefined,
  state: undefined,
  variant: undefined,
  editingProp: undefined,
  sidebarTab: "screens",
  sidebarOpen: true,
  inspectorOpen: true,
  paletteOpen: false,
  shortcutsOpen: false,
  renamingScreen: undefined,
  newScreenRequest: 0,
  showFlows: true,
  prototype: undefined,
  sizes: {},
  appStatus: undefined,
  applyOpen: false,
  appStyles: undefined,
  boardCss: "",
  importOpen: false,
  settingsOpen: false,
  themeOpen: false,
  checksOpen: false,
  ignoredChecks: [],
  codeScope: "all",
  scheme: initialScheme(),
  freeMove: false,
  freeMovePinned: false,
  freeMoveUsedOn: undefined,
  snap: initialSnap(),
  elementGuides: undefined,
  undoStack: [],
  redoStack: [],
  draw: { tool: "pen", color: "change", width: 4 },
  drawingOn: undefined,
  markupDraft: undefined,
  labelDraft: undefined,
  showMarkup: true,
  openRequest: undefined,
  proposalView: {},
  proposalHover: undefined,
  ai: undefined,
  settingsPage: undefined,
};

export const useEditor = create<EditorState>(() => initial);

// Selecting another element (not adding one with Shift) ends a multi-selection.
useEditor.subscribe((state, previous) => {
  if (state.node !== previous.node && state.extraNodes === previous.extraNodes && state.extraNodes.length > 0) useEditor.setState({ extraNodes: [] });
});

const sameSel = (a: NodeSelection, b: NodeSelection) => a.itemId === b.itemId && a.nodeId === b.nodeId;

/** Every selected element: the first one, then the ones added with Shift. */
export function selectedNodes(state: Pick<EditorState, "node" | "extraNodes"> = useEditor.getState()): NodeSelection[] {
  return state.node ? [state.node, ...state.extraNodes] : [];
}

/**
 * Shift-click: adds an element to the selection, or takes it out again. An element and one inside
 * it are never selected together (the newer one wins).
 */
export function toggleNodeSelection(sel: NodeSelection): void {
  const state = get();
  const all = selectedNodes(state);
  if (all.length === 0) return selectNode(sel);
  const project = state.project;
  const contains = (outer: NodeSelection, inner: NodeSelection) => {
    if (outer.frameId !== inner.frameId || outer.itemId !== inner.itemId) return false;
    const frame = project?.frames.find((f) => f.id === outer.frameId);
    const node = frame && findNode(frame.current, outer.nodeId)?.node;
    return Boolean(node && findNode(node, inner.nodeId));
  };
  const next = all.some((s) => sameSel(s, sel)) ? all.filter((s) => !sameSel(s, sel)) : [...all.filter((s) => !contains(s, sel) && !contains(sel, s)), sel];
  const [first, ...rest] = next;
  set({ node: first, extraNodes: rest, selection: [], editingText: false, editingId: undefined, editingProp: undefined });
}

// Leaving the draw tool ends drawing (the drawing stays).
useEditor.subscribe((state, previous) => {
  if (state.tool !== "draw" && previous.tool === "draw") useEditor.setState({ drawingOn: undefined, markupDraft: undefined, labelDraft: undefined });
});

// "Move freely" ends with the element it was used on, unless it is kept on.
useEditor.subscribe((state, previous) => {
  if (state.node === previous.node || !state.freeMove || state.freeMovePinned || !state.freeMoveUsedOn) return;
  if (state.node?.nodeId !== state.freeMoveUsedOn) useEditor.setState({ freeMove: false, freeMoveUsedOn: undefined });
});

let connection: Connection | undefined;
/** Commands sent and not acknowledged yet (see `whenSynced`). */
let inFlight = 0;

/** Resolves when the server has every edit sent so far (before asking it to act on them). */
export async function whenSynced(timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (inFlight > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}
/** Commands made while disconnected; sent on reconnect if the server did not change meanwhile. */
let queued: { command: { id: string; ops: AnyOp[] }; baseRev: number }[] = [];
export function setConnection(next: Connection | undefined): void {
  connection = next;
}

const set = useEditor.setState;
const get = useEditor.getState;

const MAX_LOGS = 1000;
const MAX_TOASTS = 3;
let localId = 0;

/** Adds a log entry; steps, warnings and errors also pop up as a toast (a step's result replaces its start). */
export function addLog(entry: LogEntry, toast = true): void {
  set((state) => {
    const logs = [...state.logs, entry];
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    if (!toast || !TOAST_LEVELS.has(entry.level)) return { logs };
    const byId = new Map(logs.map((l) => [l.id, l]));
    const others = state.toasts.filter((id) => !entry.task || byId.get(id)?.task !== entry.task);
    return { logs, toasts: [...others, entry.id].slice(-MAX_TOASTS) };
  });
}

export function dismissToast(id: string): void {
  set((state) => ({ toasts: state.toasts.filter((t) => t !== id) }));
}

/** A message from the editor itself (shown as a toast and kept in the log). */
export function notify(text: string, level: "step" | "warn" | "error" = "step", detail?: string): void {
  addLog({ id: `e${++localId}`, at: new Date().toISOString(), level, source: "editor", text, ...(detail && { detail }) });
}

/** Loads what happened before the editor opened (log panel only, no toasts). */
export async function loadLogs(): Promise<void> {
  const { token } = get();
  if (!token) return;
  try {
    const { entries } = await fetchLogs(token);
    set((state) => ({ logs: [...entries, ...state.logs.filter((l) => !entries.some((e) => e.id === l.id))].slice(-MAX_LOGS) }));
  } catch {
    // older server: no history
  }
}

export function loadSnapshot(snapshot: ProjectSnapshot): void {
  const ids = new Set(snapshot.project.board.items.map((i) => i.id));
  const nodeExists = (sel: NodeSelection | undefined) => {
    const frame = sel && snapshot.project.frames.find((f) => f.id === sel.frameId);
    return Boolean(sel && frame && ids.has(sel.itemId) && findNode(frame.current, sel.nodeId));
  };
  set((state) => ({
    node: nodeExists(state.node) ? state.node : undefined,
    extraNodes: state.extraNodes.filter(nodeExists),
    hover: undefined,
    status: "ready",
    project: snapshot.project,
    location: snapshot.location,
    problems: snapshot.problems,
    rev: snapshot.rev,
    selection: state.selection.filter((id) => ids.has(id)),
    editingId: undefined,
    undoStack: [],
    redoStack: [],
  }));
}

/**
 * Applies a command locally (optimistic) and sends it to the server. Returns false when the
 * command is invalid for the current state.
 */
export function dispatch(ops: AnyOp[], options: { undoable?: boolean } = {}): boolean {
  const { project, rev } = get();
  if (!project || ops.length === 0) return false;
  const undoable = options.undoable ?? true;
  let next: Project;
  let inverse: AnyOp[] = [];
  try {
    const before = { board: project.board, frames: new Map(project.frames.map((f) => [f.id, f])), tokens: project.tokens, ...(project.requests && { requests: project.requests }) };
    if (undoable) inverse = invertCommand(before, ops);
    next = applyCommandToProject(project, ops);
  } catch (error) {
    notify((error as Error).message);
    return false;
  }
  set((state) => ({
    project: next,
    node: validNode(next, state.node),
    extraNodes: validNodes(next, state.extraNodes),
    hover: validNode(next, state.hover),
    ...(undoable && { undoStack: [...state.undoStack.slice(-199), { ops, inverse }], redoStack: [] }),
  }));
  const message = { type: "command" as const, command: { id: createId("c"), ops }, baseRev: rev };
  if (queued.length === 0 && connection?.send(message)) inFlight++;
  else {
    queued.push(message);
    notify("Not connected: changes will be saved when the server is back.");
  }
  return true;
}

/** The same array when every element still exists (so the multi-selection isn't ended). */
function validNodes(project: Project, list: NodeSelection[]): NodeSelection[] {
  const kept = list.filter((s) => validNode(project, s));
  return kept.length === list.length ? list : kept;
}

function validNode(project: Project, sel: NodeSelection | undefined): NodeSelection | undefined {
  if (!sel) return undefined;
  const frame = project.frames.find((f) => f.id === sel.frameId);
  const placed = project.board.items.some((i) => i.id === sel.itemId);
  return frame && placed && findNode(frame.current, sel.nodeId) ? sel : undefined;
}

/**
 * Selects an element in a screen placement (clears the board selection). Inside a component's
 * variant preview, inspector edits go to that variant.
 */
export function selectNode(sel: NodeSelection | undefined): void {
  const { project, node, variant } = get();
  // Within the same placement the chosen variant stays; another placement decides it anew.
  let nextVariant = sel && sel.itemId === node?.itemId ? variant : undefined;
  if (sel && sel.itemId !== node?.itemId) {
    const placement = project?.board.items.find((i) => i.id === sel.itemId);
    const frame = project?.frames.find((f) => f.id === sel.frameId);
    const props = placement?.type === "frame" ? placement.props : undefined;
    const preview = frame?.component?.props.find((p) => p.type === "enum" && props?.[p.name] !== undefined);
    if (preview) nextVariant = { name: preview.name, value: String(props![preview.name]) };
  }
  // the state shown (and edited) belongs to the element it was picked for
  const keepState = sel && node && sel.itemId === node.itemId && sel.nodeId === node.nodeId;
  set({ node: sel, selection: [], editingText: false, editingId: undefined, editingProp: undefined, variant: nextVariant, ...(!keepState && { state: undefined }) });
}

export function undo(): void {
  const entry = get().undoStack.at(-1);
  if (!entry) return;
  set((state) => ({ undoStack: state.undoStack.slice(0, -1) }));
  if (dispatch(entry.inverse, { undoable: false })) set((state) => ({ redoStack: [...state.redoStack, entry] }));
}

export function redo(): void {
  const entry = get().redoStack.at(-1);
  if (!entry) return;
  set((state) => ({ redoStack: state.redoStack.slice(0, -1) }));
  if (dispatch(entry.ops, { undoable: false })) set((state) => ({ undoStack: [...state.undoStack, entry] }));
}

export async function handleServerMessage(message: ServerMessage): Promise<void> {
  switch (message.type) {
    case "hello": {
      // a new connection: nothing earlier is waiting for an answer any more
      inFlight = 0;
      const pending = queued;
      queued = [];
      if (message.rev !== get().rev) {
        if (pending.length > 0) notify("The project changed while offline; your unsaved changes were dropped.");
        await resync();
      } else {
        for (const item of pending) connection?.send({ type: "command", ...item });
      }
      break;
    }
    case "ack":
      inFlight = Math.max(0, inFlight - 1);
      set({ rev: message.rev });
      break;
    case "reject":
      inFlight = Math.max(0, inFlight - 1);
      notify(`Change rejected: ${message.error}`);
      await resync();
      break;
    case "applied": {
      const { project } = get();
      if (!project) return;
      try {
        const next = applyCommandToProject(project, message.command.ops);
        set((state) => ({ project: next, rev: message.rev, node: validNode(next, state.node), extraNodes: validNodes(next, state.extraNodes) }));
        // A capture from the capture browser: it may have brought new CSS of the app.
        if (message.command.ops.some((op) => op.op === "createFrame" && op.frame.kind === "imported")) {
          void loadAppStyles();
        }
      } catch {
        await resync();
      }
      break;
    }
    case "reset":
      loadSnapshot(message.snapshot);
      if (message.reason.startsWith("changed on disk")) addLog({ id: `e${++localId}`, at: new Date().toISOString(), level: "info", source: "editor", text: "Reloaded: files changed on disk", detail: message.reason });
      break;
    case "log":
      addLog(message.entry);
      break;
  }
}

/** Replaces local state with the server's (after a reject or reconnect). */
export async function resync(): Promise<void> {
  const { token } = get();
  if (!token) return;
  loadSnapshot(await fetchSnapshot(token));
}

export function setSize(id: string, w: number, h: number): void {
  const current = get().sizes[id];
  if (current && Math.abs(current.w - w) < 0.5 && Math.abs(current.h - h) < 0.5) return;
  set((state) => ({ sizes: { ...state.sizes, [id]: { w, h } } }));
}

/** Loads the AI's status (key, model, spending); the board works without it. */
export async function loadAi(): Promise<void> {
  const { token } = get();
  if (!token) return;
  try {
    set({ ai: await aiStatus(token) });
  } catch {
    // older server: no AI
  }
}

/** Loads the imported app's CSS (empty when nothing was imported) into frames and the document. */
export async function loadAppStyles(): Promise<void> {
  const { token } = get();
  if (!token) return;
  try {
    const appStyles = await fetchAppStyles(token);
    set({ appStyles: appStyles.shadow || appStyles.document ? appStyles : undefined });
    // @font-face and @property only work in the document, not in shadow roots.
    let style = document.getElementById("aps-app-document-css") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "aps-app-document-css";
      document.head.appendChild(style);
    }
    style.textContent = appStyles.document;
  } catch {
    // older server or no styles: frames render without the app's CSS
  }
}
