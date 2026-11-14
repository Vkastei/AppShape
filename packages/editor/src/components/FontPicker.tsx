import { type CatalogFont, type FontCatalogResponse, firstFamily, fontSlug, fontStack } from "@appshape/protocol";
import { parseTokenRef, type StyleValue } from "@appshape/ir";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchFontCatalog, installFont } from "../lib/api";
import { loadProjectFonts, previewFont } from "../lib/fonts";
import { newOpId } from "../lib/board";
import { dispatch, notify, useEditor } from "../store";

const MAX_RESULTS = 60;
const CATEGORIES = [
  { value: "", label: "All" },
  { value: "Sans Serif", label: "Sans" },
  { value: "Serif", label: "Serif" },
  { value: "Display", label: "Display" },
  { value: "Handwriting", label: "Script" },
  { value: "Monospace", label: "Mono" },
];

let catalog: Promise<FontCatalogResponse> | undefined;

/** Google Fonts families matching the search, most popular first. */
export function searchFonts(fonts: readonly CatalogFont[], query: string, category: string): CatalogFont[] {
  const q = query.trim().toLowerCase();
  const matches = fonts.filter((f) => (!category || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
  if (q) matches.sort((a, b) => Number(!a.family.toLowerCase().startsWith(q)) - Number(!b.family.toLowerCase().startsWith(q)));
  return matches.slice(0, MAX_RESULTS);
}

/**
 * Installs a Google font into the project if needed and makes sure a font token uses it; returns the
 * token name (an existing token naming that family, else a new one named after it).
 */
export async function adoptGoogleFont(family: string, tokenName?: string): Promise<string | undefined> {
  const { token, project, fonts } = useEditor.getState();
  if (!token || !project) return undefined;
  let font = fonts.find((f) => f.family === family);
  if (!font) {
    const installed = await installFont(token, family);
    await loadProjectFonts(installed.fonts);
    font = installed.fonts.find((f) => f.family === family);
    if (!font) return undefined;
  }
  const tokens = project.tokens.groups.fontFamily ?? {};
  const name = tokenName ?? Object.entries(tokens).find(([, v]) => typeof v === "string" && firstFamily(v) === font!.cssFamily)?.[0] ?? fontSlug(family);
  const stack = fontStack(font);
  if (tokens[name] !== stack) dispatch([{ id: newOpId(), op: "setToken", group: "fontFamily", name, value: stack }]);
  return name;
}

/** The font of an element (inspector): the project's font tokens first, then every Google font. */
export function FontField({ value, onChange }: { value: StyleValue | undefined; onChange: (value: string | null) => void }) {
  const tokens = useEditor((s) => s.project?.tokens.groups.fontFamily ?? {});
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ref = typeof value === "string" ? parseTokenRef(value) : undefined;
  const css = ref ? tokens[ref.name] : value;
  const label = ref ? `${ref.name} · ${firstFamily(String(css ?? ""))}` : value !== undefined ? firstFamily(String(value)) : "Default";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Font"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-zinc-200 px-1.5 py-1 text-left text-xs hover:border-zinc-300"
        style={css ? { fontFamily: String(css) } : undefined}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
      </button>
      {open && (
        <FontPopover
          anchor={trigger.current}
          current={ref?.name}
          projectFonts={Object.entries(tokens).map(([name, v]) => ({ name, css: String(v) }))}
          onPickToken={(name) => {
            setOpen(false);
            onChange(name === undefined ? null : `$fontFamily.${name}`);
          }}
          onPickGoogle={async (family) => {
            const name = await adoptGoogleFont(family);
            setOpen(false);
            if (name) onChange(`$fontFamily.${name}`);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** "Change font" of a font token, or (without a name) "Add font" (design-system panel). */
export function TokenFontButton({ name, value }: { name?: string; value?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={name ? `Change font ${name}` : "Add a Google font"}
        title="Choose a Google font"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] hover:border-zinc-300"
        style={value ? { fontFamily: value } : undefined}
      >
        {name ? "Aa" : "Add a Google font"}
      </button>
      {open && (
        <FontPopover
          anchor={trigger.current}
          onPickGoogle={async (family) => {
            await adoptGoogleFont(family, name);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FontPopover({
  anchor,
  current,
  projectFonts,
  onPickToken,
  onPickGoogle,
  onClose,
}: {
  anchor: HTMLElement | null;
  current?: string;
  projectFonts?: { name: string; css: string }[];
  onPickToken?: (name: string | undefined) => void;
  onPickGoogle: (family: string) => Promise<void>;
  onClose: () => void;
}) {
  const token = useEditor((s) => s.token);
  const installed = useEditor((s) => s.fonts);
  const [fonts, setFonts] = useState<CatalogFont[]>();
  const [complete, setComplete] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState<string>();
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    catalog ??= fetchFontCatalog(token);
    catalog.then((r) => {
      setFonts(r.fonts);
      setComplete(r.complete);
    }).catch((e: unknown) => {
      catalog = undefined;
      notify(`Couldn't load the font list: ${(e as Error).message}`, "error");
    });
  }, [token]);

  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const width = 300;
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 448)) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [anchor, onClose]);

  const results = useMemo(() => (fonts ? searchFonts(fonts, query, category) : []), [fonts, query, category]);
  useEffect(() => results.forEach(previewFont), [results]);

  const pick = async (family: string) => {
    setBusy(family);
    try {
      await onPickGoogle(family);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };

  if (!position) return null;
  const projectMatches = (projectFonts ?? []).filter((f) => !query.trim() || `${f.name} ${f.css}`.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose a font"
      className="fixed z-50 flex w-[300px] flex-col rounded-lg border border-ink bg-white shadow-offset-sm"
      style={{ left: position.left, top: position.top, maxHeight: 440 }}
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-2 py-1.5">
        <Search size={13} className="text-zinc-400" />
        <input
          autoFocus
          aria-label="Search fonts"
          value={query}
          placeholder={fonts ? `Search ${fonts.length.toLocaleString("en")} fonts…` : "Loading fonts…"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0] && !busy) void pick(results[0].family);
          }}
          className="min-w-0 flex-1 text-xs outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-2 py-1.5" role="group" aria-label="Font category">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={category === c.value}
            onClick={() => setCategory(c.value)}
            className={`rounded-full px-2 py-0.5 text-[11px] ${category === c.value ? "bg-ink text-white" : "text-ink-soft hover:bg-zinc-100"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {onPickToken && (
          <>
            <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">In this project</div>
            <button type="button" onClick={() => onPickToken(undefined)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-50">
              <span className="flex-1 text-ink-soft">Default</span>
              {current === undefined && <Check size={13} />}
            </button>
            {projectMatches.map((f) => (
              <button key={f.name} type="button" onClick={() => onPickToken(f.name)} className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-zinc-50" aria-label={`Project font ${f.name}`}>
                <span className="min-w-0 flex-1 truncate text-sm" style={{ fontFamily: f.css }}>
                  {firstFamily(f.css)}
                </span>
                <span className="font-mono text-[10px] text-ink-soft">{f.name}</span>
                {current === f.name && <Check size={13} />}
              </button>
            ))}
            <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Google Fonts</div>
          </>
        )}
        {!complete && <div className="px-3 py-1 text-[11px] text-amber-700">Google Fonts can't be reached: showing a few well-known fonts.</div>}
        <div role="listbox" aria-label="Google Fonts">
          {results.map((font) => (
            <button
              key={font.family}
              type="button"
              role="option"
              aria-selected={false}
              disabled={busy !== undefined}
              onClick={() => void pick(font.family)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-zinc-50 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate text-[15px]" style={{ fontFamily: `"${font.family}", ${fallback(font.category)}` }}>
                {font.family}
              </span>
              {busy === font.family ? (
                <Loader2 size={13} className="animate-spin text-ink-soft" />
              ) : installed.some((f) => f.family === font.family) ? (
                <span className="text-[10px] text-teal-700">in project</span>
              ) : (
                <span className="text-[10px] text-ink-soft">{CATEGORIES.find((c) => c.value === font.category)?.label ?? font.category}</span>
              )}
            </button>
          ))}
          {fonts && results.length === 0 && <div className="px-3 py-2 text-xs text-ink-soft">No font matches.</div>}
        </div>
      </div>
      <div className="border-t border-zinc-100 px-3 py-1.5 text-[10px] text-ink-soft">Fonts are copied into your project and your app, so visitors never load them from Google.</div>
    </div>,
    document.body,
  );
}

const fallback = (category: string) => (category === "Serif" ? "serif" : category === "Monospace" ? "monospace" : "sans-serif");
