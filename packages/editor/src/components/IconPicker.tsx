import { ChevronDown, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchIcons, iconUrl } from "../lib/api";
import { useEditor } from "../store";

const MAX_RESULTS = 240;

type Icon = { name: string; tags: string[] };

/** Matches by name first, then by lucide's tags ("home" finds `house`). */
export function searchIcons(icons: readonly Icon[], query: string): Icon[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return icons.slice(0, MAX_RESULTS);
  const words = query.trim().toLowerCase().split(/\s+/);
  const scored: { icon: Icon; score: number }[] = [];
  for (const icon of icons) {
    let score = 0;
    if (icon.name === q) score = 4;
    else if (icon.name.startsWith(q)) score = 3;
    else if (icon.name.includes(q)) score = 2;
    else if (words.every((w) => icon.tags.some((t) => t.includes(w)) || icon.name.includes(w))) score = 1;
    if (score) scored.push({ icon, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.icon.name.length - b.icon.name.length || a.icon.name.localeCompare(b.icon.name))
    .slice(0, MAX_RESULTS)
    .map((s) => s.icon);
}

/** Icon field of the inspector: shows the icon, opens a searchable grid of the set. */
export function IconPicker({ set = "lucide", value, onChange }: { set?: string; value: string; onChange: (name: string) => void }) {
  const token = useEditor((s) => s.token);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = token ? iconUrl(token, set, value) : undefined;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Icon"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault(); // inside a <label>
          setOpen(!open);
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-zinc-200 px-1.5 py-1 text-left text-xs hover:border-zinc-300"
      >
        {preview ? <img src={preview} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
      </button>
      {open && token && set === "lucide" && (
        <IconPopover
          token={token}
          anchor={trigger.current}
          value={value}
          onPick={(name) => {
            setOpen(false);
            onChange(name);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function IconPopover({
  token,
  anchor,
  value,
  onPick,
  onClose,
}: {
  token: string;
  anchor: HTMLElement | null;
  value: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [icons, setIcons] = useState<Icon[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchIcons(token)
      .then((r) => setIcons(r.icons))
      .catch((e: unknown) => setError((e as Error).message));
  }, [token]);

  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const width = 288;
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: Math.min(rect.bottom + 4, window.innerHeight - 368) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [anchor, onClose]);

  const results = useMemo(() => (icons ? searchIcons(icons, query) : []), [icons, query]);

  if (!position) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an icon"
      className="fixed z-50 flex w-72 flex-col rounded-lg border border-ink bg-white shadow-offset-sm"
      style={{ left: position.left, top: position.top, maxHeight: 360 }}
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-2 py-1.5">
        <Search size={13} className="text-zinc-400" />
        <input
          autoFocus
          aria-label="Search icons"
          value={query}
          placeholder={icons ? `Search ${icons.length} icons…` : "Loading icons…"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) onPick(results[0].name);
          }}
          className="min-w-0 flex-1 text-xs outline-none"
        />
      </div>
      {error && <div className="p-3 text-xs text-red-700">{error}</div>}
      <div role="listbox" aria-label="Icons" className="grid grid-cols-6 gap-0.5 overflow-y-auto p-1.5">
        {results.map((icon) => (
          <button
            key={icon.name}
            type="button"
            role="option"
            aria-selected={icon.name === value}
            title={icon.name}
            onClick={() => onPick(icon.name)}
            className={`grid h-10 place-items-center rounded hover:bg-zinc-100 ${icon.name === value ? "bg-accent-50 ring-1 ring-accent-400" : ""}`}
          >
            <img src={iconUrl(token, "lucide", icon.name)} alt={icon.name} loading="lazy" className="h-5 w-5" />
          </button>
        ))}
        {icons && results.length === 0 && <div className="col-span-6 p-3 text-center text-xs text-zinc-500">No icon matches “{query}”.</div>}
      </div>
    </div>,
    document.body,
  );
}
