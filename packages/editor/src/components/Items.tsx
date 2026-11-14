import { type BoardItem, type DesignRequest, type Frame, type Project, resolveProps, type Tokens, themedTokens, type Viewport } from "@appshape/ir";
import { Diamond, Palette, Play, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { assetUrl } from "../lib/api";
import { newOpId } from "../lib/board";
import { useFindingCounts } from "../lib/checks";
import { sourcesOf, usedSources } from "../lib/components";
import { DEFAULT_FRAME_HEIGHT, DEFAULT_NOTE_SIZE, frameViewport } from "../lib/geometry";
import { hasEntrances, playOnBoard } from "../lib/motion";
import { dispatch, setSize, useEditor } from "../store";
import { FrameView } from "./FrameView";
import { MarkupLayer, ProposalHighlights, RequestBadge, useProposal } from "./Markup";
import { otherVariants, pickVariantOps, proposedFrame, VARIANT_GAP, variantsPlacement } from "../lib/markup";

export const NOTE_COLORS: Record<string, { bg: string; border: string }> = {
  yellow: { bg: "#fef3c7", border: "#fcd34d" },
  pink: { bg: "#fce7f3", border: "#f9a8d4" },
  blue: { bg: "#dbeafe", border: "#93c5fd" },
  green: { bg: "#dcfce7", border: "#86efac" },
  purple: { bg: "#ede9fe", border: "#c4b5fd" },
};

/** A proposed design (Draw & describe): the brand purple. */
const PROPOSAL = "#8e44d6";

/** Selection: purple (accent-600, a little deeper than the brand color for thin lines). */
const SELECTION = "#7a2dbf";

interface ItemProps<T extends BoardItem["type"]> {
  item: Extract<BoardItem, { type: T }>;
  selected: boolean;
  zoom: number;
  offset: { dx: number; dy: number } | undefined;
}

function position(item: { x: number; y: number }, offset: ItemProps<"note">["offset"]) {
  return { left: item.x + (offset?.dx ?? 0), top: item.y + (offset?.dy ?? 0) };
}

function outline(selected: boolean, zoom: number) {
  return selected ? { outline: `${2 / zoom}px solid ${SELECTION}`, outlineOffset: `${2 / zoom}px` } : {};
}

/** Constant-size label above an item, independent of zoom. */
function Label({ zoom, children, className = "", maxWidth }: { zoom: number; children: React.ReactNode; className?: string; maxWidth?: number }) {
  return (
    <div
      className={`absolute bottom-full left-0 flex origin-bottom-left items-center gap-2 overflow-hidden whitespace-nowrap pb-1.5 text-xs ${className}`}
      style={{ transform: `scale(${1 / zoom})`, maxWidth }}
    >
      {children}
    </div>
  );
}

function ResizeHandle({ zoom }: { zoom: number }) {
  const size = 12 / zoom;
  return (
    <div
      data-handle="se"
      className="absolute rounded-sm border bg-white"
      style={{ width: size, height: size, right: -size / 2, bottom: -size / 2, borderColor: SELECTION, borderWidth: 1.5 / zoom, cursor: "nwse-resize" }}
    />
  );
}

/** Text editing in place; commits on blur or Ctrl+Enter, Escape cancels. */
function InlineText({
  value,
  onCommit,
  className,
  style,
  multiline = true,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = () => {
    useEditor.setState({ editingId: undefined });
    const next = ref.current?.value ?? value;
    if (!cancelled.current && next !== value) onCommit(next);
  };
  const props = {
    ref,
    defaultValue: value,
    className: `${className ?? ""} outline-none`,
    style,
    "data-no-drag": "",
    onBlur: finish,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        cancelled.current = true;
        ref.current?.blur();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !multiline)) ref.current?.blur();
    },
  };
  return multiline ? <textarea {...props} /> : <input {...props} />;
}

const updateItem = (itemId: string, patch: Record<string, string | number | null>) =>
  dispatch([{ id: newOpId(), op: "updateItem", itemId, patch }]);

export function NoteItem({ item, selected, zoom, offset }: ItemProps<"note">) {
  const editing = useEditor((s) => s.editingId === item.id);
  const color = NOTE_COLORS[item.color ?? "yellow"] ?? NOTE_COLORS.yellow!;
  return (
    <div
      data-item-id={item.id}
      className="absolute rounded-md p-3 text-[15px] leading-snug text-ink shadow-[0_1px_0_rgb(31_27_46/0.06),0_8px_16px_-10px_rgb(31_27_46/0.35)]"
      style={{
        ...position(item, offset),
        width: item.w ?? DEFAULT_NOTE_SIZE.w,
        height: item.h ?? DEFAULT_NOTE_SIZE.h,
        background: color.bg,
        border: `1px solid ${color.border}`,
        ...outline(selected, zoom),
      }}
    >
      {editing ? (
        <InlineText value={item.text} onCommit={(text) => updateItem(item.id, { text })} className="h-full w-full resize-none bg-transparent" />
      ) : (
        <div className="h-full overflow-hidden whitespace-pre-wrap break-words">{item.text || <span className="text-zinc-400">Empty note</span>}</div>
      )}
      {selected && !editing && <ResizeHandle zoom={zoom} />}
    </div>
  );
}

/** A picture on the board (references, mood boards): keeps its proportions when resized. */
export function ImageItem({ item, selected, zoom, offset }: ItemProps<"image">) {
  const token = useEditor((s) => s.token);
  const src = item.src.startsWith("asset:") ? (token ? assetUrl(token, item.src) : "") : item.src;
  return (
    <div data-item-id={item.id} className="absolute" style={{ ...position(item, offset), width: item.w, height: item.h, ...outline(selected, zoom) }}>
      {src && <img src={src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />}
      {selected && <ResizeHandle zoom={zoom} />}
    </div>
  );
}

export function TextItem({ item, selected, zoom, offset }: ItemProps<"text">) {
  const editing = useEditor((s) => s.editingId === item.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setSize(item.id, el.offsetWidth, el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id]);
  const fontSize = item.size ?? 24;
  return (
    <div
      ref={ref}
      data-item-id={item.id}
      className="absolute font-semibold whitespace-pre text-zinc-800"
      style={{ ...position(item, offset), fontSize, lineHeight: 1.3, minWidth: 40, ...outline(selected, zoom) }}
    >
      {editing ? (
        <InlineText value={item.text} onCommit={(text) => updateItem(item.id, { text })} className="bg-transparent" style={{ fontSize, width: "20em", height: "4em" }} />
      ) : (
        item.text || " "
      )}
    </div>
  );
}

export function SectionItem({ item, selected, zoom, offset }: ItemProps<"section">) {
  const editing = useEditor((s) => s.editingId === item.id);
  return (
    <div
      data-item-id={item.id}
      className="absolute rounded-xl"
      style={{
        ...position(item, offset),
        width: item.w,
        height: item.h,
        background: "rgba(31, 27, 46, 0.025)",
        border: `${1.5 / zoom}px dashed rgba(31, 27, 46, 0.32)`,
        ...outline(selected, zoom),
      }}
    >
      <Label zoom={zoom} className="font-semibold text-ink">
        {editing ? (
          <InlineText multiline={false} value={item.name} onCommit={(name) => updateItem(item.id, { name })} className="rounded bg-white px-1 text-xs" />
        ) : (
          <span data-section-title={item.id} className="cursor-text rounded-md border border-ink/15 bg-white px-1.5 py-0.5">
            {item.name}
          </span>
        )}
      </Label>
      {selected && <ResizeHandle zoom={zoom} />}
    </div>
  );
}

const KIND_BADGE: Record<Frame["kind"], string> = {
  imported: "bg-zinc-200/80 text-ink-soft",
  new: "bg-accent-100 text-accent-800",
  sketch: "bg-amber-100 text-amber-800",
  component: "bg-pink-100 text-pink-800",
};

/** How many design check problems a screen has (opens the checks for it). */
function FindingBadge({ frameId }: { frameId: string }) {
  const count = useFindingCounts().get(frameId) ?? 0;
  if (!count) return null;
  return (
    <button
      type="button"
      data-no-drag=""
      title={`${count} design check finding${count === 1 ? "" : "s"}`}
      aria-label={`${count} design check findings`}
      onClick={() => useEditor.setState({ checksOpen: true, checksScreen: frameId })}
      className="flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-200"
    >
      <TriangleAlert size={10} /> {count}
    </button>
  );
}

interface FrameItemProps extends ItemProps<"frame"> {
  frame: Frame | undefined;
  project: Project;
  visible: boolean;
}

export function FrameItem({ item, frame, project, selected, zoom, offset, visible }: FrameItemProps) {
  const token = useEditor((s) => s.token)!;
  const height = useEditor((s) => s.sizes[item.id]?.h);
  const viewport = frameViewport(frame, item.viewportId);
  const resolveAsset = useCallback((src: string) => assetUrl(token, src), [token]);
  const onResize = useCallback((w: number, h: number) => setSize(item.id, w, h), [item.id]);
  // Component placements can preview property values (e.g. one per variant).
  const ownTree = useMemo(
    () => (frame?.component && item.props ? resolveProps(frame.current, frame.component, item.props) : frame?.current),
    [frame, item.props],
  );
  // a proposal for the screen (Draw & describe) shows on every placement of it
  const proposal = useProposal(frame?.id);
  // a review's finding pointed at (its elements outlined on the screen)
  const hovered = useEditor((s) => (s.proposalHover && s.project?.requests?.some((r) => r.id === s.proposalHover!.requestId && r.frameId === frame?.id) ? s.proposalHover.requestId : undefined));
  const proposedTree = useMemo(() => (proposal?.view === "after" ? proposedFrame(project, proposal.request)?.current : undefined), [proposal, project]);
  const tree = proposedTree ?? ownTree;
  const allSources = sourcesOf(project);
  const sources = useMemo(() => (tree ? usedSources(tree, allSources) : new Map()), [tree, allSources]);
  // a screen with its own theme renders with it (as its page does in the code)
  const tokens = useMemo(() => themedTokens(project.tokens, frame?.theme), [project.tokens, frame?.theme]);
  const animated = useMemo(() => Boolean(tree && (hasEntrances(tree) || [...sources.values()].some((s) => hasEntrances(s.root)))), [tree, sources]);

  if (!frame || !viewport || !tree) {
    return (
      <div
        data-item-id={item.id}
        className="absolute grid place-items-center rounded border-2 border-dashed border-red-400 bg-red-50 text-red-700"
        style={{ ...position(item, offset), width: 600, height: 300, ...outline(selected, zoom) }}
      >
        Missing frame {item.frameId}
      </div>
    );
  }
  // The header has a constant screen size; keep it within the frame's on-screen width.
  const labelWidth = viewport.width * zoom;
  const compact = labelWidth < 300;
  const tiny = labelWidth < 170;
  const isComponent = frame.kind === "component";
  if (isComponent) {
    const preview = Object.entries(item.props ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
    return (
      <div
        data-item-id={item.id}
        className="absolute bg-white"
        style={{ ...position(item, offset), width: viewport.width, ...(selected ? outline(selected, zoom) : { outline: `${1 / zoom}px dashed #8b5cf6`, outlineOffset: `${4 / zoom}px` }) }}
      >
        <Label zoom={zoom} className="cursor-move text-pink-700" maxWidth={Math.max(labelWidth, 160)}>
          <Diamond size={11} className="shrink-0 fill-pink-500 text-pink-500" />
          <span className="truncate font-semibold">{frame.name}</span>
          {preview && <span className="truncate text-pink-500">{preview}</span>}
        </Label>
        {visible ? (
          <FrameView
            itemId={item.id}
            tree={tree}
            name={frame.name}
            viewport={viewport}
            tokens={project.tokens}
            components={project.components}
            resolveAsset={resolveAsset}
            sources={sources}
            componentId={frame.id}
            onResize={onResize}
          />
        ) : (
          <div className="bg-pink-50" style={{ width: viewport.width, height: height ?? 60 }} />
        )}
      </div>
    );
  }
  const proposing = proposal && !selected ? { outline: `${3 / zoom}px solid ${PROPOSAL}`, outlineOffset: `${3 / zoom}px` } : {};
  return (
    <div data-item-id={item.id} className="absolute bg-white shadow-sm" style={{ ...position(item, offset), width: viewport.width, ...outline(selected, zoom), ...proposing }}>
      <Label zoom={zoom} className="cursor-move text-zinc-600" maxWidth={labelWidth}>
        {proposal && (
          <span className="shrink-0 rounded bg-[#8e44d6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white" title={proposal.request.proposal?.idea ?? "A proposed design: review it in the panel next to the screen"}>
            {proposal.view === "before" ? "Before" : proposal.request.alternatives?.length ? `Variant ${proposal.request.proposal?.variant ?? 1} · picked` : "Proposal"}
          </span>
        )}
        {!tiny && (
          <button
            type="button"
            data-no-drag=""
            title="Play: click through this screen's links, with its animations"
            aria-label={`Play ${frame.name}`}
            onClick={() => useEditor.setState({ prototype: { frameId: frame.id, history: [] } })}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-accent-700"
          >
            <Play size={12} />
          </button>
        )}
        {!tiny && animated && (
          <button
            type="button"
            data-no-drag=""
            title="Play the animations here (the board shows how it ends)"
            aria-label={`Play animations of ${frame.name}`}
            onClick={() => playOnBoard({ itemId: item.id })}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-accent-700"
          >
            <Sparkles size={12} />
          </button>
        )}
        <span className="truncate font-semibold text-zinc-800">{frame.name}</span>
        {!tiny && (frame.overlay ? (
          <span className="shrink-0 rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent-800" title="Shown over other screens when an element opens it">overlay</span>
        ) : (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_BADGE[frame.kind]}`}>{frame.kind}</span>
        ))}
        {!compact && frame.target.route && <span className="truncate font-mono text-zinc-500">{frame.target.route}</span>}
        {!tiny && <FindingBadge frameId={frame.id} />}
        {!compact && frame.theme && project.tokens.themes?.[frame.theme] && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-800" title="This screen has its own theme">
            <Palette size={10} /> {project.tokens.themes[frame.theme]!.name}
          </span>
        )}
        {tiny ? null : compact ? (
          <span className="shrink-0 text-zinc-500">{viewport.width}px</span>
        ) : frame.viewports.length > 1 ? (
          <select
            data-no-drag=""
            value={viewport.id}
            onChange={(e) => updateItem(item.id, { viewportId: e.target.value })}
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
          >
            {frame.viewports.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {v.width}px
              </option>
            ))}
          </select>
        ) : (
          <span className="text-zinc-500">
            {viewport.id} · {viewport.width}px
          </span>
        )}
      </Label>
      {visible ? (
        <FrameView
          itemId={item.id}
          tree={tree}
          name={frame.name}
          viewport={viewport}
          tokens={tokens}
          components={project.components}
          resolveAsset={resolveAsset}
          sources={sources}
          onResize={onResize}
        />
      ) : (
        <div className="grid place-items-center bg-zinc-50 text-zinc-400" style={{ width: viewport.width, height: height ?? DEFAULT_FRAME_HEIGHT }}>
          {frame.name}
        </div>
      )}
      <MarkupLayer itemId={item.id} frameId={frame.id} viewportId={viewport.id} width={viewport.width} />
      {proposal ? <ProposalHighlights itemId={item.id} requestId={proposal.request.id} zoom={zoom} /> : hovered && <ProposalHighlights itemId={item.id} requestId={hovered} zoom={zoom} />}
      {proposal?.view === "after" && proposal.request.alternatives?.length ? (
        <VariantsBeside itemId={item.id} request={proposal.request} project={project} viewport={viewport} tokens={tokens} zoom={zoom} visible={visible} resolveAsset={resolveAsset} />
      ) : null}
      <RequestBadge itemId={item.id} frame={frame} viewportId={viewport.id} zoom={zoom} />
    </div>
  );
}

/**
 * Variants of a proposal (Draw & describe): the ones not picked show to the right of the screen
 * where it was drawn, read-only, to compare side by side. Pick swaps one onto the screen.
 */
function VariantsBeside({ itemId, request, project, viewport, tokens, zoom, visible, resolveAsset }: { itemId: string; request: DesignRequest; project: Project; viewport: Viewport; tokens: Tokens; zoom: number; visible: boolean; resolveAsset: (src: string) => string }) {
  const home = useMemo(() => variantsPlacement(project, request), [project, request]);
  const others = useMemo(() => (home === itemId ? otherVariants(project, request) : []), [home, itemId, project, request]);
  return (
    <>
      {others.map(({ proposal, frame }, k) => (
        <div
          key={proposal.variant}
          data-variant={proposal.variant}
          aria-label={`Variant ${proposal.variant}`}
          className="absolute top-0 bg-white shadow-sm"
          style={{ left: (viewport.width + VARIANT_GAP) * (k + 1), width: viewport.width, zIndex: 5, outline: `${2 / zoom}px dashed ${PROPOSAL}`, outlineOffset: `${3 / zoom}px` }}
        >
          <Label zoom={zoom} className="text-zinc-600" maxWidth={Math.max(viewport.width * zoom, 160)}>
            <span className="shrink-0 rounded border border-[#8e44d6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#8e44d6]">Variant {proposal.variant}</span>
            {proposal.idea && <span className="truncate font-semibold text-zinc-800">{proposal.idea}</span>}
            <button
              type="button"
              data-no-drag=""
              disabled={!frame}
              onClick={() => dispatch(pickVariantOps(request, proposal.variant!))}
              className="shrink-0 rounded bg-[#8e44d6] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#7a2dbf] disabled:opacity-40"
            >
              Pick
            </button>
          </Label>
          {frame && visible ? (
            <VariantScreen tree={frame.current} name={`${frame.name}, variant ${proposal.variant}`} project={project} viewport={viewport} tokens={tokens} resolveAsset={resolveAsset} />
          ) : (
            <div className="grid place-items-center bg-zinc-50 p-6 text-center text-xs text-zinc-500" style={{ height: viewport.height ?? DEFAULT_FRAME_HEIGHT }}>
              {frame ? `Variant ${proposal.variant}` : "The screen changed so much that this variant doesn't fit it any more."}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function VariantScreen({ tree, name, project, viewport, tokens, resolveAsset }: { tree: Frame["current"]; name: string; project: Project; viewport: Viewport; tokens: Tokens; resolveAsset: (src: string) => string }) {
  const allSources = sourcesOf(project);
  const sources = useMemo(() => usedSources(tree, allSources), [tree, allSources]);
  return <FrameView tree={tree} name={name} viewport={viewport} tokens={tokens} components={project.components} resolveAsset={resolveAsset} sources={sources} />;
}

/** Color of the selected notes (undefined when no note is selected) and a setter for all of them. */
export function useNoteColor(): [string | undefined, (color: string) => void] {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const notes = (project?.board.items ?? []).filter(
    (i): i is Extract<BoardItem, { type: "note" }> => i.type === "note" && selection.includes(i.id),
  );
  const apply = (color: string) =>
    dispatch(notes.map((n) => ({ id: newOpId(), op: "updateItem" as const, itemId: n.id, patch: { color } })));
  return [notes.length > 0 ? (notes[0]!.color ?? "yellow") : undefined, apply];
}
