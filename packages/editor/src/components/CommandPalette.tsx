import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Command, commands, searchCommands } from "../lib/commands";
import { useEditor } from "../store";

/** Ctrl+K: search every action, screen and component, run it with Enter. */
export function CommandPalette() {
  const open = useEditor((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  // the commands of the moment the palette opened (selection, panels, …)
  const all = useMemo(() => commands(), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => searchCommands(all, query).slice(0, 80), [all, query]);
  const close = () => useEditor.setState({ paletteOpen: false });
  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    // after the palette is gone (focus back on the board, dialogs it opens on top)
    requestAnimationFrame(() => command.run());
  };
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-ink/20 pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex h-fit max-h-[70vh] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border-[1.5px] border-ink bg-white shadow-offset" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3">
          <Search size={16} className="shrink-0 text-zinc-400" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            aria-label="Search actions, screens and components"
            placeholder="Search actions, screens, components…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              }
            }}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded border border-zinc-200 px-1.5 text-[10px] text-zinc-400">Esc</kbd>
        </div>
        <ul ref={list} id="palette-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">Nothing found</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              onPointerMove={() => setActive(i)}
              onClick={() => run(c)}
              className={`flex cursor-default items-center gap-3 rounded-md px-2.5 py-1.5 text-sm ${i === active ? "bg-accent-100 text-ink" : "text-zinc-700"}`}
            >
              <span className="w-16 shrink-0 text-[11px] text-zinc-400">{c.group}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.keys && <kbd className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[10px] text-zinc-500">{c.keys}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Gestures that aren't commands (shown with the commands' shortcuts). */
const GESTURES: [string, string, string][] = [
  ["Selection", "Add to the selection / take out", "Shift+click"],
  ["Selection", "Select several board items", "Drag on the board"],
  ["Element", "Edit a text", "Double-click"],
  ["Element", "Move an element freely while dragging", "Ctrl+drag"],
  ["Element", "Nudge (1 px, Shift: a grid step)", "Arrow keys"],
  ["View", "Pan", "Space+drag"],
  ["View", "Zoom", "Ctrl+wheel"],
  ["View", "Drag without snapping", "Alt"],
  ["Panels", "Command palette", "Ctrl+K"],
];

/** "?": every shortcut, grouped. */
export function Shortcuts() {
  const open = useEditor((s) => s.shortcutsOpen);
  const groups = useMemo(() => {
    if (!open) return [];
    const rows = [...commands().filter((c) => c.keys && !c.id.startsWith("goto.")).map((c) => [c.group, c.title, c.keys!] as [string, string, string]), ...GESTURES];
    const seen = new Set<string>();
    const byGroup = new Map<string, [string, string][]>();
    for (const [group, title, keys] of rows) {
      if (seen.has(`${title}|${keys}`)) continue;
      seen.add(`${title}|${keys}`);
      byGroup.set(group, [...(byGroup.get(group) ?? []), [title, keys]]);
    }
    return [...byGroup];
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.stopImmediatePropagation();
        e.preventDefault();
        useEditor.setState({ shortcutsOpen: false });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 p-4" onPointerDown={(e) => e.target === e.currentTarget && useEditor.setState({ shortcutsOpen: false })}>
      <div className="flex max-h-[80vh] w-[min(760px,100%)] flex-col overflow-hidden rounded-xl border-[1.5px] border-ink bg-white shadow-offset" role="dialog" aria-label="Keyboard shortcuts">
        <div className="flex items-center border-b border-zinc-200 px-4 py-2.5">
          <h2 className="flex-1 text-base font-bold text-ink">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" onClick={() => useEditor.setState({ shortcutsOpen: false })} className="grid h-7 w-7 place-items-center rounded hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 gap-x-8 gap-y-4 overflow-y-auto p-4 sm:grid-cols-2">
          {groups.map(([group, rows]) => (
            <section key={group}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{group}</h3>
              <dl className="text-sm">
                {rows.map(([title, keys]) => (
                  <div key={`${title}|${keys}`} className="flex items-center gap-2 py-0.5">
                    <dt className="min-w-0 flex-1 truncate text-zinc-700">{title}</dt>
                    <dd>
                      <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] text-zinc-600">{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500">Everything else is in the command palette (Ctrl+K). Shortcuts for an element show when one is selected.</p>
      </div>
    </div>
  );
}
