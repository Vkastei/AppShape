import { RequestDock, startDrawing } from "./components/Markup";
import type { UiState } from "@appshape/protocol";
import { useEffect, useState } from "react";
import { Connection, fetchSnapshot, fetchUiState, readToken, saveUiState, takeLaunchAction, takeLaunchPage } from "./lib/api";
import { screenFromTemplate } from "./lib/library";
import { deleteOps, duplicateOps, moveOps, type ReorderDirection, reorderOps } from "./lib/board";
import { fitCamera, setZoom, zoomToFit, zoomToSelection } from "./lib/view";
import { isContainer } from "@appshape/ir";
import { deleteSelected, detachInstance, makeComponent } from "./lib/actions";
import { watchBoardCss } from "./lib/boardCss";
import { renameSelection } from "./lib/commands";
import { CommandPalette, Shortcuts } from "./components/CommandPalette";
import { freeMoveOps, screenGrid } from "./lib/edits";
import { ApplyDialog } from "./components/ApplyDialog";
import { ImportDialog } from "./components/ImportDialog";
import { BOARD_GRID, Canvas } from "./components/Canvas";
import { SCHEME_PROPERTY } from "./components/FrameView";
import { Toolbar, TopBar } from "./components/Chrome";
import { Inspector } from "./components/Inspector";
import { SettingsDialog } from "./components/SettingsDialog";
import { ChecksPanel } from "./components/ChecksPanel";
import { ThemeStarter } from "./components/ThemeStarter";
import { LogPanel } from "./components/LogPanel";
import { Toasts } from "./components/Toasts";
import { Welcome } from "./components/Welcome";
import { Prototype } from "./components/Prototype";
import { Sidebar } from "./components/Sidebar";
import { deleteOps as deleteNodeOps, duplicateOps as duplicateNodeOps, moveSiblingOps, nodeContext, unwrapOps, wrapOps } from "./lib/nodes";
import { dispatch, handleServerMessage, loadAi, loadAppStyles, loadLogs, loadSnapshot, redo, selectNode, setConnection, type Tool, undo, useEditor } from "./store";
import { loadProjectFonts } from "./lib/fonts";
import { copySelection, copyStyle, handlePaste, pasteStyle } from "./lib/clipboard";

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", n: "note", a: "arrow", s: "section", t: "text" };

async function start(): Promise<() => void> {
  const token = readToken();
  if (!token) {
    useEditor.setState({ status: "error", error: "No session token. Open the link printed by `appshape dev`." });
    return () => {};
  }
  useEditor.setState({ token });
  const [snapshot, uiState] = await Promise.all([fetchSnapshot(token), fetchUiState(token).catch((): UiState => ({}))]);
  loadSnapshot(snapshot);
  void loadAppStyles();
  void loadLogs();
  void loadAi();
  const stopBoardCss = watchBoardCss();
  // a new project for an existing app: bring in its pages first; a new app: pick its theme
  const action = takeLaunchAction();
  if (action === "import") useEditor.setState({ importOpen: true });
  if (action === "theme") useEditor.setState({ themeOpen: true });
  const connection = new Connection(token, {
    onMessage: (message) => void handleServerMessage(message),
    onStatus: (connected) => useEditor.setState({ connected }),
  });
  setConnection(connection);
  // a new app made from a page template (the wizard's *First page*): its first screen
  const page = takeLaunchPage();
  if (page && useEditor.getState().project?.frames.length === 0) screenFromTemplate(page);
  if (uiState.ignoredChecks) useEditor.setState({ ignoredChecks: uiState.ignoredChecks });
  const camera = uiState.camera ?? fitCamera();
  if (camera) useEditor.setState({ camera });

  // Remember the camera per project (in .appshape/.cache, not in git).
  let timer: number | undefined;
  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (state.camera === previous.camera) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveUiState(token, { camera: useEditor.getState().camera }).catch(() => {}), 500);
  });
  return () => {
    unsubscribe();
    stopBoardCss();
    connection.close();
    setConnection(undefined);
  };
}

/** Shortcuts for a selected element inside a screen. Returns true when handled. */
function onNodeKey(e: KeyboardEvent): boolean {
  const { project, node } = useEditor.getState();
  if (!project || !node) return false;
  const ctx = nodeContext(project, node);
  if (!ctx) return false;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const select = (nodeId: string | undefined) => nodeId && selectNode({ ...node, nodeId });

  // several elements selected: delete them all, Esc keeps the first
  if (useEditor.getState().extraNodes.length > 0) {
    if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "escape") useEditor.setState({ extraNodes: [] });
    else return false;
    e.preventDefault();
    return true;
  }

  if (mod && e.altKey && key === "c") {
    copyStyle();
  } else if (mod && e.altKey && key === "v") {
    pasteStyle();
  } else if (mod && !e.altKey && (key === "c" || key === "x")) {
    if (window.getSelection()?.toString()) return false; // copying text on the page
    copySelection(key === "x");
  } else if (mod && e.altKey && key === "k") {
    makeComponent();
  } else if (mod && e.altKey && key === "b") {
    if (ctx.node.type === "instance") detachInstance();
  } else if (key === "delete" || key === "backspace") {
    if (dispatch(deleteNodeOps(ctx))) select(ctx.parent?.id);
  } else if (mod && key === "d") {
    const { ops, newId } = duplicateNodeOps(ctx);
    if (dispatch(ops)) select(newId);
  } else if (mod && key === "g" && e.shiftKey) {
    dispatch(unwrapOps(ctx));
  } else if (mod && key === "g") {
    const { ops, newId } = wrapOps(ctx);
    if (dispatch(ops)) select(newId);
  } else if (e.altKey && (key === "arrowup" || key === "arrowleft")) {
    dispatch(moveSiblingOps(ctx, -1));
  } else if (e.altKey && (key === "arrowdown" || key === "arrowright")) {
    dispatch(moveSiblingOps(ctx, 1));
  } else if (!mod && key.startsWith("arrow") && ctx.parent) {
    // nudge: a free move (keeps its slot) by 1 px, or one grid step with Shift
    const step = e.shiftKey ? screenGrid(project.tokens) : 1;
    const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
    const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
    dispatch(freeMoveOps(project, node, dx, dy));
  } else if (key === "escape" || (key === "enter" && e.shiftKey)) {
    if (ctx.parent) select(ctx.parent.id);
    else useEditor.setState({ node: undefined });
  } else if (key === "enter") {
    if (ctx.node.type === "text") useEditor.setState({ editingText: true });
    else if (isContainer(ctx.node) && ctx.node.children[0]) select(ctx.node.children[0].id);
  } else {
    return false;
  }
  e.preventDefault();
  return true;
}

/** A dialog has the keyboard (board shortcuts and paste wait). */
function dialogOpen(): boolean {
  const { applyOpen, importOpen, settingsOpen, themeOpen, paletteOpen, shortcutsOpen } = useEditor.getState();
  return applyOpen || importOpen || settingsOpen || themeOpen || paletteOpen || shortcutsOpen;
}

/** Pasting elements or images onto the board (Ctrl+V); text fields keep their own paste. */
function onPaste(e: ClipboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
  if (!useEditor.getState().project || dialogOpen()) return;
  handlePaste(e);
}

function onKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // the command palette opens from anywhere (also from a field)
  if (mod && key === "k" && !e.altKey && !e.shiftKey && useEditor.getState().project) {
    e.preventDefault();
    useEditor.setState((s) => ({ paletteOpen: !s.paletteOpen }));
    return;
  }
  if (target.closest("input, textarea, select, [contenteditable=true]")) return;
  const { project, selection } = useEditor.getState();
  if (!project || dialogOpen()) return;
  if (key === "?" || (e.shiftKey && e.code === "Slash" && !mod)) {
    e.preventDefault();
    useEditor.setState({ shortcutsOpen: true });
    return;
  }
  if (key === "f2") {
    e.preventDefault();
    renameSelection();
    return;
  }
  if (!(mod && key === "z") && !(mod && key === "y") && onNodeKey(e)) return;

  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && key === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (mod && key === "a") {
    e.preventDefault();
    useEditor.setState({ selection: project.board.items.map((i) => i.id) });
    return;
  }
  if (mod && key === "d") {
    e.preventDefault();
    const { ops, newIds } = duplicateOps(project, selection);
    if (dispatch(ops)) useEditor.setState({ selection: newIds });
    return;
  }
  if (mod) return;

  if (e.shiftKey && (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit0")) {
    e.preventDefault();
    if (e.code === "Digit1") zoomToFit();
    else if (e.code === "Digit2") zoomToSelection();
    else setZoom(1);
    return;
  }
  if (key === "delete" || key === "backspace") {
    if (selection.length > 0 && dispatch(deleteOps(project, selection))) useEditor.setState({ selection: [] });
    return;
  }
  if (key === "escape") {
    useEditor.setState({ selection: [], tool: "select" });
    return;
  }
  if (key === "]" || key === "[" || e.code === "BracketRight" || e.code === "BracketLeft") {
    const forward = key === "]" || e.code === "BracketRight";
    const direction: ReorderDirection = forward ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward";
    dispatch(reorderOps(project, selection, direction));
    return;
  }
  if (key.startsWith("arrow") && selection.length > 0) {
    e.preventDefault();
    // Shift: one step of the board's grid
    const step = e.shiftKey ? BOARD_GRID : 1;
    const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
    const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
    dispatch(moveOps(project, selection, dx, dy));
    return;
  }
  if (!e.shiftKey && key === "d") startDrawing();
  else if (!e.shiftKey && TOOL_KEYS[key]) useEditor.setState({ tool: TOOL_KEYS[key] });
  else if (!e.shiftKey && key === "m") useEditor.setState({ freeMove: !useEditor.getState().freeMove, freeMovePinned: false, freeMoveUsedOn: undefined });
}

export function App() {
  const connected = useEditor((s) => s.connected);
  const fontTokens = useEditor((s) => JSON.stringify(s.project?.tokens.groups.fontFamily ?? {}));
  // the project's own fonts, in the page for the screens (again when font tokens change, e.g. from another tab)
  useEffect(() => {
    if (connected) void loadProjectFonts().catch(() => {});
  }, [connected, fontTokens]);
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const applyOpen = useEditor((s) => s.applyOpen);
  const importOpen = useEditor((s) => s.importOpen);
  const settingsOpen = useEditor((s) => s.settingsOpen);
  const themeOpen = useEditor((s) => s.themeOpen);
  const scheme = useEditor((s) => s.scheme);
  const sidebarOpen = useEditor((s) => s.sidebarOpen);

  // Inherited into every frame: the app's `prefers-color-scheme` rules are style queries on it.
  useEffect(() => {
    document.documentElement.style.setProperty(SCHEME_PROPERTY, scheme);
  }, [scheme]);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);

  useEffect(() => {
    let stop: (() => void) | undefined;
    start()
      .then((cleanup) => (stop = cleanup))
      .catch((err: unknown) => useEditor.setState({ status: "error", error: (err as Error).message }));
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste);
    return () => {
      stop?.();
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  if (status === "loading") return <div className="grid h-full place-items-center bg-paper text-ink-soft">Loading project…</div>;
  if (status === "error") {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">AppShape could not open the project</div>
          <div className="mt-1 text-sm">{error}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => useEditor.setState({ sidebarOpen: !sidebarOpen })}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => useEditor.setState({ inspectorOpen: !inspectorOpen })}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          <Welcome />
          <Toolbar />
          <RequestDock />
          <LogPanel />
          <ChecksPanel />
          <Toasts />
        </main>
        {inspectorOpen && <Inspector />}
      </div>
      <Prototype />
      <CommandPalette />
      <Shortcuts />
      {applyOpen && <ApplyDialog onClose={() => useEditor.setState({ applyOpen: false })} />}
      {importOpen && <ImportDialog onClose={() => useEditor.setState({ importOpen: false })} />}
      {settingsOpen && <SettingsDialog onClose={() => useEditor.setState({ settingsOpen: false })} />}
      {themeOpen && <ThemeStarter onClose={() => useEditor.setState({ themeOpen: false, themeScreen: undefined })} />}
    </div>
  );
}
