import type { BoardItem } from "@appshape/ir";
import { ArrowUpRight, Download, Monitor, Smartphone, Square, StickyNote, Type } from "lucide-react";
import { useEffect, useRef } from "react";
import { newItemId, newOpId } from "../lib/board";
import { DEFAULT_NOTE_SIZE, type Point } from "../lib/geometry";
import { newScreen, type ScreenPreset, slugRoute } from "../lib/templates";
import { dispatch, type Tool, useEditor } from "../store";
import { addScreen } from "./Sidebar";

/** Where the menu was opened: on screen (inside the canvas) and on the board. */
export interface QuickMenuAt {
  screen: Point;
  world: Point;
}

interface Entry {
  label: string;
  /** Tooltip. */
  hint: string;
  /** Pressing this key while the menu is open picks the entry. */
  key: string;
  icon: React.ReactNode;
  run: (world: Point) => void;
}

function add(item: BoardItem, edit: boolean, index?: number): void {
  if (dispatch([{ id: newOpId(), op: "addItem", item, ...(index !== undefined && { index }) }])) {
    useEditor.setState({ selection: [item.id], node: undefined, tool: "select", editingId: edit ? item.id : undefined });
  }
}

function screenAt(preset: ScreenPreset, world: Point): void {
  const project = useEditor.getState().project!;
  const name = `Screen ${project.frames.filter((f) => f.kind !== "component").length + 1}`;
  addScreen(newScreen(name, slugRoute(name), preset, project.tokens, project.adapters[0]?.id), { x: Math.round(world.x), y: Math.round(world.y) });
}

const useTool = (tool: Tool) => () => useEditor.setState({ tool, selection: [], node: undefined });

const ENTRIES: (Entry | "divider")[] = [
  { label: "Web page here", hint: "A new screen for the browser", key: "w", icon: <Monitor size={15} />, run: (p) => screenAt("desktop", p) },
  { label: "Phone screen here", hint: "A new screen for a phone", key: "p", icon: <Smartphone size={15} />, run: (p) => screenAt("phone", p) },
  "divider",
  {
    label: "Note",
    hint: "A sticky note",
    key: "n",
    icon: <StickyNote size={15} />,
    run: (p) => add({ type: "note", id: newItemId(), x: Math.round(p.x - DEFAULT_NOTE_SIZE.w / 2), y: Math.round(p.y - DEFAULT_NOTE_SIZE.h / 2), text: "", color: "yellow" }, true),
  },
  { label: "Text", hint: "Text on the board", key: "t", icon: <Type size={15} />, run: (p) => add({ type: "text", id: newItemId(), x: Math.round(p.x), y: Math.round(p.y), text: "Text" }, true) },
  {
    label: "Section",
    hint: "A frame to group things",
    key: "s",
    icon: <Square size={15} />,
    run: (p) => add({ type: "section", id: newItemId(), name: "Section", x: Math.round(p.x), y: Math.round(p.y), w: 800, h: 500 }, false, 0),
  },
  { label: "Arrow", hint: "Then drag from one item to another", key: "a", icon: <ArrowUpRight size={15} />, run: useTool("arrow") },
  "divider",
  { label: "Bring in a page", hint: "From your running app", key: "i", icon: <Download size={15} />, run: () => useEditor.setState({ importOpen: true }) },
];

/** Right-click on the empty board: the things you can put there, at the pointer. */
export function QuickMenu({ at, onClose }: { at: QuickMenuAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = ENTRIES.filter((e): e is Entry => e !== "divider");

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const pick = (entry: Entry) => {
      onClose();
      entry.run(at.world);
    };
    const onKey = (e: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const entry = entries.find((x) => x.key === e.key.toLowerCase());
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      else if (entry && !e.ctrlKey && !e.metaKey && !e.altKey) pick(entry);
      else if (e.key !== "Enter" && e.key !== " " && e.key !== "Tab") return;
      else if (e.key === "Tab") onClose();
      else return; // Enter/Space: the focused button's click
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("wheel", onClose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, onClose]);

  // keep the menu inside the canvas
  const width = 236;
  const height = 330;
  const parent = ref.current?.parentElement?.getBoundingClientRect();
  const left = Math.max(8, Math.min(at.screen.x, (parent?.width ?? Infinity) - width - 8));
  const top = Math.max(8, Math.min(at.screen.y, (parent?.height ?? Infinity) - height - 8));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Add to the board"
      data-no-drag
      className="absolute z-30 w-[236px] rounded-xl border-[1.5px] border-ink bg-white p-1 text-sm shadow-offset"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Add here</div>
      {ENTRIES.map((entry, i) =>
        entry === "divider" ? (
          <div key={`d${i}`} className="mx-2 my-1 h-px bg-ink/10" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            title={entry.hint}
            onClick={() => {
              onClose();
              entry.run(at.world);
            }}
            className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-ink outline-none hover:bg-accent-50 focus-visible:bg-accent-50 focus-visible:ring-1 focus-visible:ring-ink"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink/[0.05] text-ink-soft group-hover:bg-accent-500 group-hover:text-white group-focus-visible:bg-accent-500 group-focus-visible:text-white">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{entry.label}</span>
            <kbd className="shrink-0 rounded border border-ink/20 px-1 font-sans text-[11px] text-ink-soft">{entry.key.toUpperCase()}</kbd>
          </button>
        ),
      )}
    </div>
  );
}
