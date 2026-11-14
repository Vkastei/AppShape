import { type DesignNode, findNode, isContainer, type Project } from "@appshape/ir";
import { DEFAULT_BREAKPOINTS } from "@appshape/render";
import { STARTER_COMPONENTS } from "@appshape/kit";
import { type EditState, type EditorState, dispatch, type NodeSelection, notify, redo, selectedNodes, selectNode, setScheme, setSnap, type SidebarTab, type Tool, undo, useEditor } from "../store";
import { deleteSelected, detachInstance, editComponent, insertComponent, makeComponent } from "./actions";
import { type ArrangeAction, arrangeBoardOps, arrangeNodesOps, layoutActionHint, nodeArrangement } from "./arrange";
import { deleteOps as deleteItemsOps, duplicateOps as duplicateItemsOps } from "./board";
import { copySelection, copyStyle, pasteStyle } from "./clipboard";
import { detachOps, placementsOf, putBackOps } from "./edits";
import { insertStarter } from "./kit";
import { linkedCopies } from "./linked";
import { hasEntrances, playOnBoard } from "./motion";
import { deleteOps, duplicateOps, moveSiblingOps, nodeContext, unwrapOps, wrapOps } from "./nodes";
import { canStackOnPhones, showAllSizesOps, stackOnPhonesOps } from "./responsive";
import { PRIMITIVES, type PrimitiveKind } from "./templates";
import { fitCamera, setZoom, zoomBy, zoomToFit, zoomToSelection } from "./view";

/**
 * Everything the toolbar, the inspector's buttons and the keyboard can do, as one list: the command
 * palette (Ctrl+K) searches it, the shortcut overview (?) shows its keys.
 */

export interface Command {
  id: string;
  title: string;
  group: "Edit" | "Element" | "Selection" | "Insert" | "View" | "Tools" | "Panels" | "Go to" | "Code";
  /** Shortcut, as shown (e.g. "Ctrl+D"). */
  keys?: string;
  /** Extra words it is found by. */
  keywords?: string;
  run: () => void;
}

/** Inserting a building block (set by the toolbar, which owns the insert logic). */
let insertPrimitive: ((kind: PrimitiveKind) => void) | undefined;
export function registerInsert(fn: (kind: PrimitiveKind) => void): void {
  insertPrimitive = fn;
}

const set = useEditor.setState;
const state = () => useEditor.getState();

/** Selects the first placement of a screen's element (for "select same"). */
function firstPlacement(project: Project, frameId: string): string | undefined {
  return project.board.items.find((i) => i.type === "frame" && i.frameId === frameId)?.id;
}

/** Elements on every screen that look like `node` (same type and style), or instances of the same component. */
export function sameAs(project: Project, sel: NodeSelection, kind: "style" | "component"): NodeSelection[] {
  const frame = project.frames.find((f) => f.id === sel.frameId);
  const node = frame && findNode(frame.current, sel.nodeId)?.node;
  if (!node) return [];
  const key = (n: DesignNode) => (kind === "component" ? (n.type === "instance" ? n.componentId : undefined) : JSON.stringify([n.type, n.style ?? {}, n.overrides?.filter((o) => o.style) ?? []]));
  const wanted = key(node);
  if (wanted === undefined) return [];
  const out: NodeSelection[] = [];
  for (const f of project.frames) {
    if (f.kind === "component") continue;
    const itemId = f.id === sel.frameId ? sel.itemId : firstPlacement(project, f.id);
    if (!itemId) continue;
    const visit = (n: DesignNode) => {
      if (key(n) === wanted && (n.id !== f.current.id || kind === "component")) out.push({ itemId, frameId: f.id, nodeId: n.id });
      if (isContainer(n) && n.type !== "instance") n.children.forEach(visit);
    };
    visit(f.current);
  }
  // the clicked one first
  return [sel, ...out.filter((s) => !(s.itemId === sel.itemId && s.nodeId === sel.nodeId))];
}

export function selectSame(kind: "style" | "component"): void {
  const { project, node } = state();
  if (!project || !node) return;
  const all = sameAs(project, node, kind);
  set({ node: all[0], extraNodes: all.slice(1), selection: [] });
  notify(all.length > 1 ? `Selected ${all.length} elements` : "No other element is the same");
}

/** F2: rename the selected element (its layer name), screen or note. */
export function renameSelection(): void {
  const { node, selection, project } = state();
  if (node) {
    set({ inspectorOpen: true });
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('aside[aria-label="Inspector"] input[aria-label="Layer name"]');
      input?.focus();
      input?.select();
    });
    return;
  }
  const item = selection.length === 1 ? project?.board.items.find((i) => i.id === selection[0]) : undefined;
  if (item?.type === "frame") set({ sidebarOpen: true, sidebarTab: "screens", renamingScreen: item.frameId });
  else if (item && (item.type === "note" || item.type === "text" || item.type === "section" || item.type === "arrow")) set({ editingId: item.id });
}

function nodeCommands(project: Project, s: EditorState): Command[] {
  const sel = s.node;
  if (!sel) return [];
  const ctx = nodeContext(project, sel);
  if (!ctx) return [];
  const many = s.extraNodes.length > 0;
  const select = (nodeId: string | undefined) => nodeId && selectNode({ ...sel, nodeId });
  const out: Command[] = [];
  const add = (c: Command) => out.push(c);
  if (ctx.parent) {
    add({ id: "el.delete", group: "Element", title: many ? "Delete the selected elements" : "Delete element", keys: "Del", run: () => (many ? deleteSelected() : dispatch(deleteOps(ctx)) && select(ctx.parent?.id)) });
    if (!many) {
      add({ id: "el.duplicate", group: "Element", title: "Duplicate element", keys: "Ctrl+D", run: () => {
        const { ops, newId } = duplicateOps(ctx);
        if (dispatch(ops)) select(newId);
      } });
      add({ id: "el.wrap", group: "Element", title: "Wrap in a stack", keys: "Ctrl+G", keywords: "group container", run: () => {
        const { ops, newId } = wrapOps(ctx);
        if (dispatch(ops)) select(newId);
      } });
      add({ id: "el.parent", group: "Selection", title: "Select parent", keys: "Esc", run: () => select(ctx.parent!.id) });
      add({ id: "el.up", group: "Element", title: "Move up / before the previous", keys: "Alt+↑", keywords: "reorder", run: () => dispatch(moveSiblingOps(ctx, -1)) });
      add({ id: "el.down", group: "Element", title: "Move down / after the next", keys: "Alt+↓", keywords: "reorder", run: () => dispatch(moveSiblingOps(ctx, 1)) });
      add({ id: "el.copy", group: "Edit", title: "Copy element", keys: "Ctrl+C", run: () => copySelection(false) });
      add({ id: "el.cut", group: "Edit", title: "Cut element", keys: "Ctrl+X", run: () => copySelection(true) });
      add({ id: "el.copyStyle", group: "Edit", title: "Copy style", keys: "Ctrl+Alt+C", run: copyStyle });
      add({ id: "el.pasteStyle", group: "Edit", title: "Paste style", keys: "Ctrl+Alt+V", run: pasteStyle });
      if (ctx.node.type !== "instance") add({ id: "el.component", group: "Element", title: "Create component", keys: "Ctrl+Alt+K", run: makeComponent });
      if (ctx.parent.layout?.mode !== "absolute") {
        if (!placementsOf(ctx.node).some((p) => p.kind === "detached")) add({ id: "el.detach", group: "Element", title: "Detach from layout", keywords: "absolute overlay", run: () => dispatch(detachOps(project, sel)) });
        for (const p of placementsOf(ctx.node)) add({ id: `el.putBack.${p.when?.viewport ?? "all"}`, group: "Element", title: `Put back in layout${p.when?.viewport ? ` (${p.when.viewport} and up)` : ""}`, run: () => dispatch(putBackOps(project, ctx.frame, ctx.node, p.when)) });
      }
    }
  }
  if (!many) {
    if (isContainer(ctx.node) && ctx.parent) add({ id: "el.unwrap", group: "Element", title: "Remove the container (keep its elements)", keys: "Ctrl+Shift+G", keywords: "unwrap ungroup", run: () => dispatch(unwrapOps(ctx)) });
    if (isContainer(ctx.node) && ctx.node.children[0]) add({ id: "el.child", group: "Selection", title: "Select first child", keys: "Enter", run: () => select((ctx.node as { children: DesignNode[] }).children[0]!.id) });
    if (ctx.node.type === "instance") add({ id: "el.detachInstance", group: "Element", title: "Detach instance (plain elements)", keys: "Ctrl+Alt+B", run: detachInstance });
    if (ctx.node.type === "text") add({ id: "el.editText", group: "Element", title: "Edit text", keys: "Enter", keywords: "bold italic link", run: () => set({ editingText: true }) });
    if (canStackOnPhones(ctx.node)) add({ id: "el.stack", group: "Element", title: "Stack on phones", keywords: "responsive mobile", run: () => dispatch(stackOnPhonesOps(ctx.frame.id, ctx.node)) });
    add({ id: "el.rename", group: "Element", title: "Rename layer", keys: "F2", run: renameSelection });
    if (ctx.node.style?.motion) add({ id: "el.playMotion", group: "Element", title: "Preview the animation", keywords: "motion entrance play", run: () => playOnBoard({ itemId: sel.itemId, nodeId: ctx.node.id }) });
    add({ id: "sel.sameStyle", group: "Selection", title: "Select same style", keywords: "similar", run: () => selectSame("style") });
    if (ctx.node.type === "instance") add({ id: "sel.sameComponent", group: "Selection", title: "Select same component", keywords: "instances", run: () => selectSame("component") });
    if (ctx.node.source && linkedCopies(project, ctx.frame.id, ctx.node.id).length > 1) {
      add({ id: "el.scope", group: "Element", title: s.codeScope === "all" ? "Edit this copy only (shared code)" : "Edit all copies (shared code)", run: () => set({ codeScope: s.codeScope === "all" ? "this" : "all" }) });
    }
    if (!ctx.parent && ctx.frame.platform === "web" && ctx.frame.kind !== "component") {
      add({ id: "screen.allSizes", group: "Element", title: "Show all sizes (phone, tablet, desktop)", keywords: "responsive", run: () => dispatch(showAllSizesOps(project, ctx.frame, s.sizes)) });
      add({ id: "screen.theme", group: "Element", title: "Give this screen its own theme", run: () => set({ themeOpen: true, themeScreen: ctx.frame.id }) });
    }
  }
  if (many) {
    const sels = selectedNodes(s);
    const arrangement = nodeArrangement(project, sels);
    for (const [action, title] of ARRANGE) {
      const ok = arrangement.mode === "free" || (arrangement.mode === "layout" && layoutActionHint(arrangement.direction, action));
      if (ok) add({ id: `arrange.${title}`, group: "Selection", title, keywords: "align distribute", run: () => dispatch(arrangeNodesOps(project, sels, action)) });
    }
  }
  // what edits go to: screen size and state
  for (const b of ["all", ...Object.keys(project.tokens.groups.breakpoint ?? DEFAULT_BREAKPOINTS)]) {
    add({ id: `editFor.${b}`, group: "Element", title: b === "all" ? "Edit for all screen sizes" : `Edit for ${b} and up`, keywords: "breakpoint responsive", run: () => set({ breakpoint: b === "all" ? undefined : b }) });
  }
  for (const [value, label] of STATES) add({ id: `state.${value}`, group: "Element", title: value ? `Edit the ${label} state` : "Edit the default state", keywords: "hover focus pressed disabled", run: () => set({ state: value }) });
  return out;
}

const STATES: [EditState | undefined, string][] = [
  [undefined, "Default"],
  ["hover", "Hover"],
  ["focus", "Focus"],
  ["active", "Pressed"],
  ["disabled", "Disabled"],
  ["group-hover", "Group hover"],
];

const ARRANGE: [ArrangeAction, string][] = [
  [{ kind: "align", how: "left" }, "Align left"],
  [{ kind: "align", how: "hcenter" }, "Align horizontal centers"],
  [{ kind: "align", how: "right" }, "Align right"],
  [{ kind: "align", how: "top" }, "Align top"],
  [{ kind: "align", how: "vcenter" }, "Align vertical centers"],
  [{ kind: "align", how: "bottom" }, "Align bottom"],
  [{ kind: "distribute", axis: "x" }, "Distribute horizontally"],
  [{ kind: "distribute", axis: "y" }, "Distribute vertically"],
];

const TOOLS: [Tool, string, string][] = [
  ["select", "Select tool", "V"],
  ["hand", "Pan tool", "H"],
  ["note", "Note tool", "N"],
  ["arrow", "Arrow tool", "A"],
  ["section", "Section tool", "S"],
  ["text", "Text tool", "T"],
];

const TABS: [SidebarTab, string][] = [
  ["screens", "Screens"],
  ["library", "Library (sections and page templates)"],
  ["components", "Components"],
  ["layers", "Layers"],
  ["design", "Design system"],
];

export function commands(): Command[] {
  const s = state();
  const project = s.project;
  if (!project) return [];
  const out: Command[] = [];
  const add = (c: Command) => out.push(c);

  add({ id: "undo", group: "Edit", title: "Undo", keys: "Ctrl+Z", run: undo });
  add({ id: "redo", group: "Edit", title: "Redo", keys: "Ctrl+Shift+Z", run: redo });
  out.push(...nodeCommands(project, s));

  // board items
  if (s.selection.length > 0) {
    add({ id: "board.delete", group: "Edit", title: "Delete the selected items", keys: "Del", run: () => dispatch(deleteItemsOps(project, s.selection)) && set({ selection: [] }) });
    add({ id: "board.duplicate", group: "Edit", title: "Duplicate the selected items", keys: "Ctrl+D", run: () => {
      const { ops, newIds } = duplicateItemsOps(project, s.selection);
      if (dispatch(ops)) set({ selection: newIds });
    } });
    if (s.selection.length === 1) add({ id: "board.rename", group: "Edit", title: "Rename", keys: "F2", run: renameSelection });
    // screens: click through them, play their animations
    for (const item of project.board.items) {
      if (item.type !== "frame" || !s.selection.includes(item.id)) continue;
      const frame = project.frames.find((f) => f.id === item.frameId);
      if (!frame || frame.kind === "component") continue;
      add({ id: `play.${item.id}`, group: "View", title: `Play ${frame.name} (click through, with animations)`, keywords: "prototype preview", run: () => set({ prototype: { frameId: frame.id, history: [] } }) });
      if (hasEntrances(frame.current)) add({ id: `playMotion.${item.id}`, group: "View", title: `Play the animations of ${frame.name}`, keywords: "motion entrance", run: () => playOnBoard({ itemId: item.id }) });
    }
    if (s.selection.length > 1) {
      for (const [action, title] of ARRANGE) {
        if (action.kind === "distribute" && s.selection.length < 3) continue;
        add({ id: `board.${title}`, group: "Selection", title, keywords: "align distribute board", run: () => dispatch(arrangeBoardOps(project, s.selection, s.sizes, action)) });
      }
    }
  }
  add({ id: "board.selectAll", group: "Selection", title: "Select everything on the board", keys: "Ctrl+A", run: () => set({ selection: project.board.items.map((i) => i.id), node: undefined }) });

  // insert
  const canInsert = Boolean(s.node) || (s.selection.length === 1 && project.board.items.find((i) => i.id === s.selection[0])?.type === "frame");
  if (canInsert && insertPrimitive) for (const p of PRIMITIVES) add({ id: `insert.${p.kind}`, group: "Insert", title: `Insert ${p.label}`, run: () => insertPrimitive!(p.kind) });
  const components = project.frames.filter((f) => f.kind === "component");
  if (canInsert) {
    for (const c of components) add({ id: `insert.component.${c.id}`, group: "Insert", title: `Insert ${c.name} (component)`, run: () => insertComponent(c.id) });
    for (const c of STARTER_COMPONENTS.filter((k) => !components.some((f) => f.component?.kit === k.key))) add({ id: `insert.starter.${c.key}`, group: "Insert", title: `Insert ${c.name} (starter component)`, run: () => insertStarter(c.key) });
  }
  add({ id: "screen.new", group: "Insert", title: "New screen", keywords: "page", run: () => set({ sidebarOpen: true, sidebarTab: "screens", newScreenRequest: s.newScreenRequest + 1 }) });
  add({ id: "library", group: "Insert", title: "Open the library (sections, page templates)", keywords: "hero pricing footer template", run: () => set({ sidebarOpen: true, sidebarTab: "library" }) });

  // view
  add({ id: "zoom.in", group: "View", title: "Zoom in", keys: "Ctrl+wheel", run: () => zoomBy(1.25) });
  add({ id: "zoom.out", group: "View", title: "Zoom out", run: () => zoomBy(1 / 1.25) });
  add({ id: "zoom.100", group: "View", title: "Zoom to 100%", keys: "Shift+0", run: () => setZoom(1) });
  add({ id: "zoom.fit", group: "View", title: "Zoom to fit", keys: "Shift+1", run: zoomToFit });
  add({ id: "zoom.selection", group: "View", title: "Zoom to selection", keys: "Shift+2", run: zoomToSelection });
  add({ id: "scheme", group: "View", title: s.scheme === "dark" ? "Show screens in light mode" : "Show screens in dark mode", run: () => setScheme(s.scheme === "dark" ? "light" : "dark") });
  add({ id: "flows", group: "View", title: s.showFlows ? "Hide flows" : "Show flows (links between screens)", run: () => set({ showFlows: !s.showFlows }) });
  add({ id: "snap.grid", group: "View", title: s.snap.grid ? "Turn off snapping to the grid" : "Snap to the grid", run: () => setSnap({ grid: !s.snap.grid }) });
  add({ id: "snap.guides", group: "View", title: s.snap.guides ? "Turn off alignment guides" : "Show alignment guides", run: () => setSnap({ guides: !s.snap.guides }) });
  add({ id: "freeMove", group: "Tools", title: s.freeMove ? "Turn off moving freely" : "Move elements freely", keys: "M", run: () => set({ freeMove: !s.freeMove, freeMovePinned: false, freeMoveUsedOn: undefined }) });
  for (const [tool, title, key] of TOOLS) add({ id: `tool.${tool}`, group: "Tools", title, keys: key, run: () => set({ tool }) });

  // panels
  add({ id: "panel.sidebar", group: "Panels", title: s.sidebarOpen ? "Hide sidebar" : "Show sidebar", run: () => set({ sidebarOpen: !s.sidebarOpen }) });
  add({ id: "panel.inspector", group: "Panels", title: s.inspectorOpen ? "Hide inspector" : "Show inspector", run: () => set({ inspectorOpen: !s.inspectorOpen }) });
  for (const [tab, title] of TABS) add({ id: `tab.${tab}`, group: "Panels", title: `Show ${title}`, run: () => set({ sidebarOpen: true, sidebarTab: tab }) });
  add({ id: "theme", group: "Panels", title: "Theme starter", keywords: "colors fonts brand", run: () => set({ themeOpen: true, themeScreen: undefined }) });
  add({ id: "checks", group: "Panels", title: "Check design", keywords: "contrast accessibility", run: () => set({ checksOpen: true, checksScreen: undefined }) });
  add({ id: "activity", group: "Panels", title: "Activity (what AppShape did)", keywords: "log", run: () => set({ logPanel: {}, toasts: [] }) });
  add({ id: "settings", group: "Panels", title: "Project settings", keywords: "favicon site icon", run: () => set({ settingsOpen: true }) });
  add({ id: "shortcuts", group: "Panels", title: "Keyboard shortcuts", keys: "?", run: () => set({ shortcutsOpen: true }) });
  add({ id: "import", group: "Code", title: "Import pages of the running app", run: () => set({ importOpen: true }) });
  add({ id: "apply", group: "Code", title: "Apply to code", keywords: "generate export", run: () => set({ applyOpen: true }) });

  // go to
  for (const f of project.frames) {
    if (f.kind === "component") {
      add({ id: `goto.component.${f.id}`, group: "Go to", title: `${f.name} (component)`, run: () => editComponent(f.id) });
      continue;
    }
    const placement = project.board.items.find((i) => i.type === "frame" && i.frameId === f.id);
    if (!placement) continue;
    add({ id: `goto.screen.${f.id}`, group: "Go to", title: f.name, keywords: `screen ${f.target.route ?? ""}`, run: () => {
      const camera = fitCamera([placement]);
      if (camera) set({ camera });
      selectNode({ itemId: placement.id, frameId: f.id, nodeId: f.current.id });
    } });
  }
  return out;
}

/** Commands matching a search: every word must appear (title, group, keywords), best first. */
export function searchCommands(list: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  const scored = list
    .map((c) => {
      const title = c.title.toLowerCase();
      const hay = `${title} ${c.group.toLowerCase()} ${c.keywords?.toLowerCase() ?? ""}`;
      if (!words.every((w) => hay.includes(w))) return undefined;
      const score = (title.startsWith(words[0]!) ? 0 : 2) + (words.every((w) => title.includes(w)) ? 0 : 1);
      return { c, score };
    })
    .filter((x): x is { c: Command; score: number } => x !== undefined);
  return scored.sort((a, b) => a.score - b.score).map((x) => x.c);
}
