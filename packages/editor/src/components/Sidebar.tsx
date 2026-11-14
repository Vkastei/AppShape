import {
  type AnyOp,
  type BoardItem,
  type DesignNode,
  type Frame,
  instancesOf,
  isContainer,
  type TokenGroup,
} from "@appshape/ir";
import { requestsOfFrames } from "../lib/markup";
import { ChevronDown, ChevronRight, Copy, Diamond, Eye, EyeOff, Moon, Palette, PencilRuler, Plus, Trash2, TriangleAlert } from "lucide-react";
import { deleteComponent, editComponent, insertComponent } from "../lib/actions";
import { componentName as nameOf, setDraggedComponent } from "../lib/components";
import { useEffect, useState } from "react";
import { framesById, newItemId, newOpId } from "../lib/board";
import { itemBounds, unionRects } from "../lib/geometry";
import { acceptsChildren, cloneWithNewIds, moveToOps, nodeLabel } from "../lib/nodes";
import { duplicateScreen, newScreen, SCREEN_PRESETS, type ScreenPreset, slugRoute } from "../lib/templates";
import { fitCamera } from "../lib/view";
import { dispatch, selectedNodes, selectNode, type SidebarTab, toggleNodeSelection, useEditor } from "../store";
import { TextInput } from "./Fields";
import { TokenFontButton } from "./FontPicker";
import { Library } from "./Library";
import { EffectStylesEditor, TextStylesEditor } from "./StylesPanel";
import { PAGE_TEMPLATES } from "@appshape/kit";
import { screenFromTemplate } from "../lib/library";

export function Sidebar() {
  const tab = useEditor((s) => s.sidebarTab);
  const tabs: { id: SidebarTab; label: string }[] = [
    { id: "screens", label: "Screens" },
    { id: "library", label: "Library" },
    { id: "components", label: "Components" },
    { id: "layers", label: "Layers" },
    { id: "design", label: "Design" },
  ];
  return (
    <aside className={`z-10 flex shrink-0 flex-col border-r border-ink/10 bg-paper text-sm ${tab === "library" ? "w-[23rem]" : "w-64"}`}>
      <div className="m-2 flex gap-0.5 rounded-lg bg-ink/[0.06] p-0.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => useEditor.setState({ sidebarTab: t.id })}
            className={`flex-auto whitespace-nowrap rounded-md px-1 py-1.5 text-[11px] font-semibold tracking-[-0.01em] transition-colors ${tab === t.id ? "bg-white text-ink shadow-[0_1px_0_rgb(31_27_46/0.1)] ring-1 ring-ink/15" : "text-ink-soft hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "screens" && <ScreensTab />}
        {tab === "library" && <Library />}
        {tab === "components" && <ComponentsTab />}
        {tab === "layers" && <LayersTab />}
        {tab === "design" && <DesignTab />}
      </div>
      <Footer />
    </aside>
  );
}

function Footer() {
  const problems = useEditor((s) => s.problems);
  const location = useEditor((s) => s.location);
  const [open, setOpen] = useState(false);
  return (
    <>
      {problems.length > 0 && (
        <div className="border-t border-zinc-200">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-700">
            <TriangleAlert size={14} /> {problems.length} problem{problems.length > 1 ? "s" : ""}
          </button>
          {open && (
            <ul className="max-h-48 overflow-auto px-3 pb-2 text-xs">
              {problems.map((p, i) => (
                <li key={i} className={`mb-1.5 ${p.severity === "error" ? "text-red-700" : "text-amber-800"}`}>
                  <span className="font-mono">{p.file}</span>: {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="truncate border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500" title={location?.dataDir}>
        {location?.mode === "external" ? "External data" : "In repo"}: {location?.dataDir}
      </div>
    </>
  );
}

// imported: from the code; new: not in the code yet (purple: still to send)
const KIND_DOT: Record<Frame["kind"], string> = { imported: "bg-ink-soft", new: "bg-accent-500", sketch: "bg-amber-500", component: "bg-pink-500" };

/** A board position right of everything else, for new screens. */
export function freeSpot(): { x: number; y: number } {
  const { project, sizes } = useEditor.getState();
  const frames = framesById(project!);
  const bounds = unionRects(project!.board.items.map((i) => itemBounds(i, frames, sizes)).filter((r) => r !== undefined));
  return bounds ? { x: Math.round(bounds.x + bounds.w + 200), y: Math.round(bounds.y) } : { x: 0, y: 0 };
}

/**
 * Creates a screen, places it on the board (at `at`, or right of everything), zooms to it and selects
 * its root. `before` are ops it needs first (components and tokens of a page template).
 */
export function addScreen(frame: Frame, at?: { x: number; y: number }, before: AnyOp[] = []): void {
  const spot = at ?? freeSpot();
  const placement: BoardItem = { type: "frame", id: newItemId(), frameId: frame.id, x: spot.x, y: spot.y, viewportId: frame.viewports[0]!.id };
  const ops: AnyOp[] = [
    ...before,
    { id: newOpId(), frameId: frame.id, op: "createFrame", frame },
    { id: newOpId(), op: "addItem", item: placement },
  ];
  if (!dispatch(ops)) return;
  const camera = fitCamera([placement]);
  useEditor.setState({ ...(camera && { camera }), selection: [] });
  selectNode({ itemId: placement.id, frameId: frame.id, nodeId: frame.current.id });
}

function ScreensTab() {
  const project = useEditor((s) => s.project)!;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ScreenPreset>("desktop");
  const [template, setTemplate] = useState("");
  const [editing, setEditing] = useState<string>();
  const newScreenRequest = useEditor((s) => s.newScreenRequest);
  useEffect(() => {
    if (newScreenRequest > 0) setCreating(true);
  }, [newScreenRequest]);
  // F2 / "Rename screen": edit its name here
  const renaming = useEditor((s) => s.renamingScreen);
  useEffect(() => {
    if (!renaming) return;
    setEditing(renaming);
    useEditor.setState({ renamingScreen: undefined });
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Screen name"]');
      input?.focus();
      input?.select();
    });
  }, [renaming]);
  const placements = (frameId: string) => project.board.items.filter((i) => i.type === "frame" && i.frameId === frameId);

  const focus = (frameId: string) => {
    const camera = fitCamera(placements(frameId));
    if (camera) useEditor.setState({ camera, selection: placements(frameId).map((p) => p.id), node: undefined });
  };
  const create = () => {
    const screenName = name.trim() || `Screen ${project.frames.length + 1}`;
    if (template && preset === "desktop") screenFromTemplate(template, undefined, name.trim() || undefined);
    else addScreen(newScreen(screenName, slugRoute(screenName), preset, project.tokens, project.adapters[0]?.id));
    setCreating(false);
    setName("");
    setTemplate("");
  };
  const duplicate = (frame: Frame) => {
    const copyName = `${frame.name} copy`;
    addScreen(duplicateScreen(frame, copyName, `${frame.target.route ?? slugRoute(frame.name)}-copy`, cloneWithNewIds));
  };
  const remove = (frame: Frame) => {
    if (!window.confirm(`Delete the screen "${frame.name}"? (Undo with Ctrl+Z)`)) return;
    const items = project.board.items.filter(
      (i) => (i.type === "frame" && i.frameId === frame.id) || (i.type === "note" && i.attachedTo?.frameId === frame.id),
    );
    const removedIds = new Set(items.map((i) => i.id));
    const arrows = project.board.items.filter((i) => i.type === "arrow" && [i.from, i.to].some((end) => "itemId" in end && removedIds.has(end.itemId)));
    dispatch([
      ...[...arrows, ...items].map((i) => ({ id: newOpId(), op: "removeItem" as const, itemId: i.id })),
      { id: newOpId(), frameId: frame.id, op: "deleteFrame" },
      ...requestsOfFrames(project, [frame.id]),
    ]);
  };
  const place = (frame: Frame) => {
    const spot = freeSpot();
    const item: BoardItem = { type: "frame", id: newItemId(), frameId: frame.id, x: spot.x, y: spot.y, viewportId: frame.viewports.at(-1)!.id };
    if (dispatch([{ id: newOpId(), op: "addItem", item }])) useEditor.setState({ selection: [item.id], node: undefined });
  };

  return (
    <div className="p-1.5">
      {creating ? (
        <div className="mb-2 rounded-lg border border-accent-200 bg-accent-50/50 p-2">
          <input
            autoFocus
            aria-label="Screen name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Screen name, e.g. Checkout"
            className="mb-1.5 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <select aria-label="Screen type" value={preset} onChange={(e) => setPreset(e.target.value as ScreenPreset)} className="mb-1.5 w-full rounded border border-zinc-300 px-1 py-1 text-xs">
            {SCREEN_PRESETS.map((p) => (
              <option key={p.preset} value={p.preset}>
                {p.label}
              </option>
            ))}
          </select>
          {preset === "desktop" && (
            <select aria-label="Start from" value={template} onChange={(e) => setTemplate(e.target.value)} className="mb-1.5 w-full rounded border border-zinc-300 px-1 py-1 text-xs">
              <option value="">Start empty</option>
              {PAGE_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setCreating(false)} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
              Cancel
            </button>
            <button type="button" onClick={create} className="rounded border border-ink bg-accent-500 px-2 py-1 text-xs font-semibold text-white hover:bg-accent-600">
              Create screen
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-medium text-zinc-600 hover:border-accent-400 hover:text-accent-700">
          <Plus size={14} /> New screen
        </button>
      )}
      <ul>
        {project.frames.filter((f) => f.kind !== "component").map((frame) => (
          <li key={frame.id} className="group rounded-md px-1.5 py-1.5 hover:bg-zinc-50">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[frame.kind]}`} title={frame.kind} />
              {editing === frame.id ? (
                <div className="flex-1">
                  <TextInput label="Screen name" value={frame.name} onCommit={(v) => (v.trim() && dispatch([{ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { name: v.trim() } }]), setEditing(undefined))} />
                  <TextInput label="Route" value={frame.target.route ?? ""} placeholder="/route" onCommit={(v) => dispatch([{ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { target: { ...frame.target, route: v.trim() || undefined } } }])} />
                </div>
              ) : (
                <button type="button" onClick={() => focus(frame.id)} onDoubleClick={() => setEditing(frame.id)} className="min-w-0 flex-1 text-left" title="Show on board (double-click to rename)">
                  <div className="truncate font-medium text-zinc-800">{frame.name}</div>
                  <div className="truncate font-mono text-xs text-zinc-500">
                    {frame.target.route ?? frame.platform} · {frame.platform === "mobile" ? "app" : "web"} · {placements(frame.id).length}× placed
                  </div>
                </button>
              )}
              <div className="flex opacity-0 group-hover:opacity-100">
                <IconAction title="Place another view" onClick={() => place(frame)} icon={<Plus size={13} />} />
                <IconAction title="Duplicate screen" onClick={() => duplicate(frame)} icon={<Copy size={13} />} />
                <IconAction title="Delete screen" onClick={() => remove(frame)} icon={<Trash2 size={13} />} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComponentsTab() {
  const project = useEditor((s) => s.project)!;
  const components = project.frames.filter((f) => f.kind === "component");
  return (
    <div className="p-1.5">
      <p className="px-1.5 pb-2 pt-1 text-xs text-zinc-500">
        {components.length === 0
          ? "No components yet. Select an element on a screen and press Ctrl+Alt+K (or the component button in the inspector) to make it reusable."
          : "Click to insert into the selection, or drag onto a screen. Double-click to edit."}
      </p>
      <ul aria-label="Components">
        {components.map((frame) => {
          const uses = instancesOf(project.frames, frame.id).length;
          const props = frame.component?.props.map((p) => p.name).join(", ");
          return (
            <li key={frame.id} className="group rounded-md hover:bg-pink-50">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-appshape-component", frame.id);
                    e.dataTransfer.effectAllowed = "copy";
                    setDraggedComponent(frame.id);
                  }}
                  onDragEnd={() => setDraggedComponent(undefined)}
                  onClick={() => insertComponent(frame.id)}
                  onDoubleClick={() => editComponent(frame.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={frame.component?.description ?? "Insert"}
                  aria-label={`Insert ${frame.name}`}
                >
                  <Diamond size={12} className="shrink-0 fill-pink-500 text-pink-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-zinc-800">{frame.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {uses === 1 ? "1 instance" : `${uses} instances`}
                      {props ? ` · ${props}` : ""}
                    </span>
                  </span>
                </button>
                <div className="flex opacity-0 group-hover:opacity-100">
                  <IconAction title="Edit component" onClick={() => editComponent(frame.id)} icon={<PencilRuler size={13} />} />
                  <IconAction title="Delete component" onClick={() => deleteComponent(frame.id)} icon={<Trash2 size={13} />} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IconAction({ title, onClick, icon }: { title: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900">
      {icon}
    </button>
  );
}

function LayersTab() {
  const project = useEditor((s) => s.project)!;
  const node = useEditor((s) => s.node);
  const selection = useEditor((s) => s.selection);
  const selectedPlacement = project.board.items.find((i) => i.type === "frame" && selection.includes(i.id));
  const itemId = node?.itemId ?? selectedPlacement?.id ?? project.board.items.find((i) => i.type === "frame")?.id;
  const placement = project.board.items.find((i) => i.id === itemId);
  const frame = placement?.type === "frame" ? project.frames.find((f) => f.id === placement.frameId) : undefined;
  if (!frame || !placement) return <p className="p-3 text-xs text-zinc-500">Select a screen to see its layers.</p>;
  return (
    <div className="py-1" role="tree" aria-label={`Layers of ${frame.name}`}>
      <div className="px-3 pb-1 text-xs font-semibold text-zinc-700">{frame.name}</div>
      <LayerRow node={frame.current} depth={0} frame={frame} itemId={placement.id} />
    </div>
  );
}

type DropPosition = "before" | "after" | "inside";

function LayerRow({ node, depth, frame, itemId }: { node: DesignNode; depth: number; frame: Frame; itemId: string }) {
  const project = useEditor((s) => s.project)!;
  const selected = useEditor((s) => selectedNodes(s).some((n) => n.nodeId === node.id && n.itemId === itemId));
  const [open, setOpen] = useState(depth < 3);
  const [dropAt, setDropAt] = useState<DropPosition>();
  const container = isContainer(node);
  const droppable = acceptsChildren(node);
  const componentName = (id: string) => nameOf(project, id);

  const position = (e: React.DragEvent): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (droppable && y > 0.25 && y < 0.75) return "inside";
    return y < 0.5 ? "before" : "after";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropAt(undefined);
    const draggedId = e.dataTransfer.getData("application/x-appshape-node");
    if (!draggedId || draggedId === node.id) return;
    const where = position(e);
    const parentLoc = findParent(frame.current, node.id);
    let parentId: string;
    let index: number;
    if (where === "inside" && acceptsChildren(node)) {
      parentId = node.id;
      index = node.children.filter((c) => c.id !== draggedId).length;
    } else {
      if (!parentLoc) return;
      parentId = parentLoc.parent.id;
      const siblings = parentLoc.parent.children.filter((c) => c.id !== draggedId);
      index = siblings.findIndex((c) => c.id === node.id) + (where === "after" ? 1 : 0);
    }
    dispatch(moveToOps(project, { frameId: frame.id, nodeId: draggedId }, parentId, index));
  };

  return (
    <div role="treeitem" aria-selected={selected} aria-label={nodeLabel(node, componentName)}>
      <div
        draggable={depth > 0}
        onDragStart={(e) => e.dataTransfer.setData("application/x-appshape-node", node.id)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropAt(position(e));
        }}
        onDragLeave={() => setDropAt(undefined)}
        onDrop={onDrop}
        onClick={(e) => (e.shiftKey ? toggleNodeSelection : selectNode)({ itemId, frameId: frame.id, nodeId: node.id })}
        className={`group relative flex cursor-default items-center gap-1 py-0.5 pr-2 text-xs ${selected ? "bg-accent-100 text-ink" : "text-zinc-700 hover:bg-zinc-100"} ${dropAt === "inside" ? "ring-2 ring-inset ring-accent-500" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {dropAt === "before" && <div className="absolute inset-x-0 top-0 h-0.5 bg-accent-600" />}
        {dropAt === "after" && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-600" />}
        {container && node.children.length > 0 ? (
          <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={(e) => (e.stopPropagation(), setOpen(!open))} className="text-zinc-400">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <span className={`min-w-0 flex-1 truncate ${node.type === "instance" ? "text-pink-700" : ""} ${node.hidden ? "opacity-50" : ""}`}>{nodeLabel(node, componentName)}</span>
        {depth > 0 && (
          <button
            type="button"
            aria-label={node.hidden ? "Show" : "Hide"}
            onClick={(e) => {
              e.stopPropagation();
              dispatch([{ id: newOpId(), frameId: frame.id, op: "setVisibility", nodeId: node.id, hidden: !node.hidden }]);
            }}
            className={`${node.hidden ? "" : "opacity-0 group-hover:opacity-100"} text-zinc-500`}
          >
            {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>
      {container && open && node.children.map((child) => <LayerRow key={child.id} node={child} depth={depth + 1} frame={frame} itemId={itemId} />)}
    </div>
  );
}

function findParent(root: DesignNode, id: string): { parent: Extract<DesignNode, { children: DesignNode[] }> } | undefined {
  if (!isContainer(root)) return undefined;
  for (const child of root.children) {
    if (child.id === id) return { parent: root };
    const found = findParent(child, id);
    if (found) return found;
  }
  return undefined;
}

const TOKEN_SECTIONS: { group: TokenGroup; title: string }[] = [
  { group: "color", title: "Colors" },
  { group: "fontFamily", title: "Fonts" },
  { group: "fontSize", title: "Font sizes" },
  { group: "radius", title: "Corner radius" },
  { group: "shadow", title: "Shadows" },
  { group: "blur", title: "Blur" },
  { group: "spacing", title: "Spacing" },
  { group: "breakpoint", title: "Breakpoints" },
];

function DesignTab() {
  const scheme = useEditor((s) => s.scheme);
  return (
    <div className="py-1">
      <div className="space-y-1.5 px-3 pb-2 pt-1">
        <button
          type="button"
          onClick={() => useEditor.setState({ themeOpen: true })}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink bg-accent-500 px-2 py-1.5 text-xs font-semibold text-white shadow-offset-sm hover:bg-accent-600"
        >
          <Palette size={14} /> Theme starter
        </button>
        <p className="text-xs text-zinc-500">The design system every screen uses. Changes apply everywhere and are handed to the AI as the app's theme.</p>
        {scheme === "dark" && (
          <p className="flex items-start gap-1 text-[11px] text-indigo-700">
            <Moon size={12} className="mt-px shrink-0" /> Showing dark mode: colors marked with a moon have their own dark value, and editing them changes that.
          </p>
        )}
      </div>
      <TextStylesEditor />
      <EffectStylesEditor />
      {TOKEN_SECTIONS.map((s) => (
        <TokenGroupEditor key={s.group} group={s.group} title={s.title} />
      ))}
    </div>
  );
}

function TokenGroupEditor({ group, title }: { group: TokenGroup; title: string }) {
  const tokens = useEditor((s) => s.project!.tokens);
  const scheme = useEditor((s) => s.scheme);
  const [open, setOpen] = useState(group === "color");
  const [openFamily, setOpenFamily] = useState<string>();
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const darkValues = tokens.dark?.[group] ?? {};
  /** In dark mode, tokens with a dark value show (and edit) that one. */
  const darkEdit = (name: string) => scheme === "dark" && darkValues[name] !== undefined;
  const entries = Object.entries(tokens.groups[group] ?? {}).map(([name, value]): [string, string | number] => [name, darkEdit(name) ? darkValues[name]! : value]);
  const set = (name: string, value: string | number | null) => dispatch([{ id: newOpId(), op: "setToken", group, name, value, ...(value !== null && darkEdit(name) && { scheme: "dark" as const }) }]);

  const add = () => {
    if (!newName.trim() || !newValue.trim()) return;
    set(newName.trim(), newValue.trim());
    setNewName("");
    setNewValue("");
  };

  const families = new Map<string, [string, string | number][]>();
  for (const entry of entries) {
    const family = group === "color" ? (/^(.*)-\d+$/.exec(entry[0])?.[1] ?? entry[0]) : "";
    families.set(family, [...(families.get(family) ?? []), entry]);
  }

  const row = ([name, value]: [string, string | number]) => (
    <div key={name} className="flex items-center gap-1 py-0.5">
      {group === "color" && <span className="h-4 w-4 shrink-0 rounded border border-black/10" style={{ background: String(value) }} />}
      <span className="w-16 shrink-0 truncate font-mono text-[11px] text-zinc-600" title={darkValues[name] !== undefined ? `${name} (own value in dark mode)` : name}>
        {name}
      </span>
      {darkValues[name] !== undefined && <Moon size={10} className="-ml-1 shrink-0 text-indigo-500" aria-label="Has a dark mode value" />}
      <div className="min-w-0 flex-1">
        <TextInput label={`${group} ${name}`} value={String(value)} onCommit={(v) => v.trim() && set(name, v.trim())} />
      </div>
      {group === "fontFamily" && <TokenFontButton name={name} value={String(value)} />}
      <button type="button" aria-label={`Remove ${name}`} onClick={() => set(name, null)} className="text-zinc-400 hover:text-red-600">
        <Trash2 size={12} />
      </button>
    </div>
  );

  return (
    <div className="border-b border-zinc-100 px-3 py-1.5">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 text-left text-xs font-semibold text-zinc-700">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}
        <span className="font-normal text-zinc-400">({entries.length})</span>
      </button>
      {open && (
        <div className="mt-1">
          {group === "color"
            ? [...families].map(([family, list]) =>
                list.length === 1 ? (
                  row(list[0]!)
                ) : (
                  <div key={family}>
                    <button type="button" onClick={() => setOpenFamily(openFamily === family ? undefined : family)} className="flex w-full items-center gap-1 py-0.5" aria-label={`Color family ${family}`}>
                      <span className="w-16 shrink-0 truncate text-left text-[11px] text-zinc-600">{family}</span>
                      <span className="flex flex-1 overflow-hidden rounded">
                        {list.map(([n, v]) => (
                          <span key={n} className="h-4 flex-1" style={{ background: String(v) }} title={n} />
                        ))}
                      </span>
                    </button>
                    {openFamily === family && <div className="pl-2">{list.map(row)}</div>}
                  </div>
                ),
              )
            : entries.map(row)}
          <div className="mt-1 flex gap-1">
            <input aria-label={`New ${group} name`} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="name" className="w-16 rounded border border-zinc-200 px-1 py-0.5 text-[11px]" />
            <input
              aria-label={`New ${group} value`}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") add();
              }}
              placeholder={group === "color" ? "#4f46e5" : "value"}
              className="min-w-0 flex-1 rounded border border-zinc-200 px-1 py-0.5 text-[11px]"
            />
            <button type="button" onClick={add} aria-label={`Add ${group}`} className="rounded bg-zinc-100 px-1.5 text-[11px] hover:bg-zinc-200">
              Add
            </button>
          </div>
          {group === "fontFamily" && (
            <div className="mt-1">
              <TokenFontButton />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
