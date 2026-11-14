import { applyTokenOps, componentSources, type DesignNode, type Frame, type Tokens } from "@appshape/ir";
import { buildPage, missingThemeOps, PAGE_TEMPLATES, SECTION_CATEGORIES, SECTIONS } from "@appshape/kit";
import { FilePlus2, GripVertical, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../lib/api";
import { sourcesOf } from "../lib/components";
import { applyTemplate, insertSection, libraryTarget, previewContext, screenFromTemplate, setLibraryDrag } from "../lib/library";
import { notify, useEditor } from "../store";
import { FrameView } from "./FrameView";

const THUMB = 336;
const PAGE_WIDTH = 1280;

/** Thumbnail heights (fixed, so the list never shifts while thumbnails render). */
const THUMB_HEIGHT: Record<string, number> = { "header-simple": 30, "header-login": 30, logos: 72, "footer-simple": 64, "footer-columns": 116 };

/** A design rendered small, cropped to `height`; only while it is in view (the library has dozens). */
function Thumb({ tree, frames, height, tokens }: { tree: DesignNode; frames: Frame[]; height: number; tokens: Tokens }) {
  const project = useEditor((s) => s.project)!;
  const token = useEditor((s) => s.token)!;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: "300px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const sources = useMemo(() => new Map([...sourcesOf(project), ...componentSources(frames)]), [project, frames]);
  const resolveAsset = useCallback((src: string) => assetUrl(token, src), [token]);
  const scale = THUMB / PAGE_WIDTH;
  return (
    <div ref={ref} className="pointer-events-none overflow-hidden rounded-md border border-zinc-200 bg-white" style={{ width: THUMB, height }}>
      {visible && (
        <div style={{ width: PAGE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <FrameView tree={tree} name="Library" viewport={{ id: "library", width: PAGE_WIDTH }} tokens={tokens} components={project.components} resolveAsset={resolveAsset} sources={sources} />
        </div>
      )}
    </div>
  );
}

/** The same array as last time while its items are the same objects. */
function useStable<T>(items: T[]): T[] {
  const last = useRef(items);
  if (last.current.length !== items.length || last.current.some((item, i) => item !== items[i])) last.current = items;
  return last.current;
}

/**
 * The library: page templates and sections, drawn with the project's own theme and components.
 * Drag one onto a screen (or the empty board), or click to add it to the selected screen.
 */
export function Library() {
  const project = useEditor((s) => s.project)!;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  // previews use the project's own starter components (as they look now) and its colors; they are
  // built again only when those change, not on every edit
  const starters = useStable(project.frames.filter((f) => f.component?.kit));
  const preview = useMemo(
    () => previewContext({ ...project, frames: starters }, SECTIONS.map((s) => s.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starters, project.tokens],
  );
  const sections = useMemo(() => new Map(SECTIONS.map((s) => [s.key, s.build(preview.ctx)])), [preview]);
  // drawn as they will look once added: with the theme tokens and styles inserting adds where the project lacks them
  const previewTokens = useMemo(() => applyTokenOps(project.tokens, missingThemeOps(project.tokens)), [project.tokens]);
  const pages = useMemo(() => new Map(PAGE_TEMPLATES.map((t) => [t.key, buildPage(t, preview.ctx)])), [preview]);

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const shownPages = (category === "All" || category === "Pages") ? PAGE_TEMPLATES.filter((t) => matches(`${t.name} ${t.description}`)) : [];
  const shownSections = category === "Pages" ? [] : SECTIONS.filter((s) => (category === "All" || s.category === category) && matches(`${s.name} ${s.category} ${s.description}`));

  const drag = (kind: "section" | "page", key: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setLibraryDrag({ kind, key });
      e.dataTransfer.setData("text/plain", key);
      e.dataTransfer.effectAllowed = "copy";
    },
    onDragEnd: () => setLibraryDrag(undefined),
  });

  const addSection = (key: string) => {
    const target = libraryTarget();
    if (!target) {
      notify("Select a screen first, or drag the section onto one (or onto the empty board for a new screen).");
      return;
    }
    insertSection(key, target.frameId, target.itemId, target.index);
  };
  const usePage = (key: string) => {
    const target = libraryTarget();
    if (target) applyTemplate(key, target.frameId, target.itemId);
    else screenFromTemplate(key);
  };

  return (
    <div className="flex flex-col gap-2 px-3 pb-3" aria-label="Library">
      <p className="text-xs text-zinc-500">Ready-made pages and sections in your theme. Drag one onto a screen, or click + to add it to the selected screen.</p>
      <label className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1">
        <Search size={13} className="text-zinc-400" />
        <input aria-label="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search pages and sections" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Library category">
        {["All", "Pages", ...SECTION_CATEGORIES].map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`rounded-full px-2 py-0.5 text-[11px] ${category === c ? "bg-ink text-white" : "bg-white text-ink-soft ring-1 ring-inset ring-zinc-200 hover:text-ink"}`}>
            {c}
          </button>
        ))}
      </div>

      {shownPages.length > 0 && <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Pages</h3>}
      {shownPages.map((t) => (
        <article key={t.key} className="group rounded-lg border border-zinc-200 bg-white p-2 hover:border-ink/40" aria-label={`Page template ${t.name}`} {...drag("page", t.key)}>
          <Thumb tree={pages.get(t.key)!} frames={preview.frames} height={210} tokens={previewTokens} />
          <div className="mt-1.5 flex items-start gap-2">
            <GripVertical size={14} className="mt-0.5 shrink-0 cursor-grab text-zinc-300 group-hover:text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-ink">{t.name}</div>
              <div className="text-[11px] leading-snug text-ink-soft">{t.description}</div>
            </div>
            <button type="button" title="Use on the selected screen, or as a new screen" aria-label={`Use ${t.name}`} onClick={() => usePage(t.key)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-zinc-200 text-ink-soft hover:border-ink hover:text-ink">
              <FilePlus2 size={14} />
            </button>
          </div>
        </article>
      ))}

      {shownSections.length > 0 && <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Sections</h3>}
      {shownSections.map((s) => (
        <article key={s.key} className="group rounded-lg border border-zinc-200 bg-white p-2 hover:border-ink/40" aria-label={`Section ${s.name}`} {...drag("section", s.key)}>
          <Thumb tree={sections.get(s.key)!} frames={preview.frames} height={THUMB_HEIGHT[s.key] ?? 170} tokens={previewTokens} />
          <div className="mt-1.5 flex items-start gap-2">
            <GripVertical size={14} className="mt-0.5 shrink-0 cursor-grab text-zinc-300 group-hover:text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-ink">
                {s.name} <span className="font-normal text-ink-soft">· {s.category}</span>
              </div>
              <div className="text-[11px] leading-snug text-ink-soft">{s.description}</div>
            </div>
            <button type="button" title="Add to the selected screen" aria-label={`Add ${s.name}`} onClick={() => addSection(s.key)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-zinc-200 text-ink-soft hover:border-ink hover:text-ink">
              <Plus size={14} />
            </button>
          </div>
        </article>
      ))}
      {shownPages.length + shownSections.length === 0 && <p className="text-xs text-ink-soft">Nothing matches.</p>}
    </div>
  );
}
