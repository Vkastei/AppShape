import { ANNOTATION_KINDS, type Condition, conditionKey, type ContainerNode, createId, type DesignNode, type Frame, INPUT_TYPES, isContainer, type Op, themedTokens, type Tokens } from "@appshape/ir";
import { DEFAULT_BREAKPOINTS } from "@appshape/render";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowUpToLine,
  Component as ComponentIcon,
  MonitorSmartphone,
  Palette,
  Trash2,
  X,
} from "lucide-react";
import { resetToAllSizesOps, type SizeDifference, SIZES, setVisibilityBySizeOps, showAllSizesOps, sizeDifferences, visibilityBySize } from "../lib/responsive";
import { resetScreenTheme } from "../lib/theme";
import { useState } from "react";
import { newOpId } from "../lib/board";
import { deleteSelected, makeComponent } from "../lib/actions";
import { type ArrangeAction, arrangeNodesOps, layoutActionHint, nodeArrangement } from "../lib/arrange";
import { componentName as nameOf, variantProps } from "../lib/components";
import { deleteOps, nodeContext, nodeLabel } from "../lib/nodes";
import { ComponentSection, InstanceSection, PropertySection } from "./ComponentPanels";
import { ClassesSection } from "./ClassesSection";
import { ImagePick } from "./SettingsDialog";
import { InteractionSection, ScreenBehaviorRows } from "./InteractionFields";
import { BindRow, canRepeat, DataSection, listOf, repeatWithData } from "./DataFields";
import { AiShortcuts } from "./Markup";
import { DesignSections, type Target, targetOf } from "./DesignSections";
import { forCopies, linkedCopies } from "../lib/linked";
import { dispatch, type EditState, type NodeSelection, notify, selectedNodes, selectNode, useEditor } from "../store";
import { Row, Section, Segmented, TextInput } from "./Fields";
import { IconPicker } from "./IconPicker";
import { boxOps, detachOps, type Placement, placementsOf, putBackOps } from "../lib/edits";
import { chooseImageFile, replaceImage } from "../lib/images";

type Edit = Record<string, unknown>;

const STATES: { value: EditState | "default"; label: string; title: string }[] = [
  { value: "default", label: "Default", title: "How it looks normally" },
  { value: "hover", label: "Hover", title: "While the pointer is over it" },
  { value: "focus", label: "Focus", title: "While it has the keyboard focus (inputs, buttons)" },
  { value: "active", label: "Pressed", title: "While it is pressed" },
  { value: "disabled", label: "Disabled", title: "When it can't be used" },
];

/** Right panel: edits the selected element (or several at once). */
export function Inspector() {
  const project = useEditor((s) => s.project)!;
  const sel = useEditor((s) => s.node);
  const extraNodes = useEditor((s) => s.extraNodes);
  const breakpoint = useEditor((s) => s.breakpoint);
  const variant = useEditor((s) => s.variant);
  // re-render when the state edited changes (targets read it through editCondition)
  useEditor((s) => s.state);
  const ctx = sel && nodeContext(project, sel);
  if (!sel || !ctx) return null;
  const { node, frame } = ctx;
  // swatches show what this screen shows (its own theme, if it has one)
  const tokens = themedTokens(project.tokens, frame.theme);
  const targets = selectedNodes({ node: sel, extraNodes }).map((s) => targetOf(project, s)).filter((t): t is Target => t !== undefined);
  if (targets.length > 1) return <MultiInspector targets={targets} tokens={tokens} />;
  const target = targets[0]!;
  const when = target.when;
  const variants = variantProps(frame.component);
  const activeVariant = variant && variants.some((p) => p.name === variant.name && p.options?.includes(variant.value)) ? variant : undefined;
  const isInstance = node.type === "instance";
  const componentFrame = frame.component ? (frame as typeof frame & { component: NonNullable<typeof frame.component> }) : undefined;
  const override = when ? node.overrides?.find((o) => conditionKey(o.when) === conditionKey(when)) : undefined;

  // Shared code (a component on several pages, list items) changes everywhere unless "this one only".
  const send = (ops: Op[]) => dispatch(forCopies(project, ops, useEditor.getState().codeScope));
  const base = { frameId: frame.id, nodeId: node.id };
  const componentName = (id: string) => nameOf(project, id);

  return (
    <aside className="z-10 flex w-80 shrink-0 flex-col overflow-y-auto border-l border-ink/10 bg-paper" aria-label="Inspector">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${isInstance || componentFrame ? "text-pink-600" : "text-accent-700"}`}>
            {isInstance ? "Instance" : componentFrame && !ctx.parent ? "Main component" : node.type}
          </div>
          <div className="truncate text-sm font-medium text-zinc-900">{nodeLabel(node, componentName)}</div>
        </div>
        {ctx.parent && !isInstance && (
          <button type="button" title="Create component (Ctrl+Alt+K)" aria-label="Create component" onClick={makeComponent} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-pink-50 hover:text-pink-700">
            <ComponentIcon size={14} />
          </button>
        )}
        {ctx.parent && (
          <button type="button" title="Select parent (Esc)" aria-label="Select parent" onClick={() => selectNode({ ...sel, nodeId: ctx.parent!.id })} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
            <ArrowUpToLine size={14} />
          </button>
        )}
        {ctx.parent && (
          <button type="button" title="Delete (Del)" aria-label="Delete element" onClick={() => send(deleteOps(ctx))} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-red-50 hover:text-red-600">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!ctx.parent && <CodeRow frameId={frame.id} />}
      {!ctx.parent && !componentFrame && <ThemeRow frameId={frame.id} />}
      {!ctx.parent && !componentFrame && frame.platform === "web" && <AllSizesRow frameId={frame.id} />}
      {!componentFrame && frame.platform === "web" && (!ctx.parent || ctx.parent.id === frame.current.id) && <AiShortcuts sel={sel} frame={frame} sectionOnly={Boolean(ctx.parent)} />}
      <SourceRow node={node} frameId={frame.id} />
      <Section title="Element">
        <Row label="Layer name">
          <TextInput label="Layer name" value={node.name} placeholder={nodeLabel({ ...node, name: undefined } as DesignNode, componentName)} onCommit={(name) => send([{ id: newOpId(), ...base, op: "rename", name: name.trim() || null }])} />
        </Row>
        <EditForRows tokens={tokens} breakpoint={breakpoint} groupHover={inHoverGroup(ctx.frame.current, node.id)} />
        {variants.length > 0 && (
          <Row label="Variant" hint="Edits apply to all variants, or only to one">
            <select
              aria-label="Variant"
              value={activeVariant ? `${activeVariant.name}=${activeVariant.value}` : ""}
              onChange={(e) => {
                const [name, value] = e.target.value.split("=");
                useEditor.setState({ variant: name && value !== undefined ? { name, value } : undefined });
              }}
              className="w-full rounded border border-pink-200 px-1 py-1 text-xs"
            >
              <option value="">All variants</option>
              {variants.flatMap((p) =>
                (p.options ?? []).map((o) => (
                  <option key={`${p.name}=${o}`} value={`${p.name}=${o}`}>
                    {p.name}: {o}
                  </option>
                )),
              )}
            </select>
          </Row>
        )}
        <Row label="Visible">
          <Segmented
            label="Visibility"
            value={(override?.hidden ?? node.hidden) ? "hidden" : "visible"}
            options={[{ value: "visible", label: "Shown" }, { value: "hidden", label: "Hidden" }]}
            onChange={(v) => send([{ id: newOpId(), ...base, op: "setVisibility", hidden: v === "hidden" ? true : when ? false : null, ...(when && { when }) }])}
          />
        </Row>
        {ctx.parent && frame.platform === "web" && isContainer(node) && node.type !== "instance" && (
          <Row label="Hover group" hint="Its elements can change while it is hovered: select one and edit its Group hover state (an arrow that moves when the card is hovered)">
            <Segmented
              label="Hover group"
              value={node.style?.hoverGroup ? "on" : "off"}
              options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
              onChange={(v) => send([{ id: newOpId(), ...base, op: "restyle", style: { hoverGroup: v === "on" ? true : null } }])}
            />
          </Row>
        )}
        {ctx.parent && frame.platform === "web" && (
          <Row label="Show on" hint="Hide it on some screen sizes (phones are the base, tablets from md, desktops from lg)">
            <SizeToggles node={node} onChange={(shown) => send(setVisibilityBySizeOps(frame.id, node, shown))} />
          </Row>
        )}
      </Section>

      {!ctx.parent && !componentFrame && frame.platform === "web" && frame.kind !== "imported" && frame.kind !== "sketch" && <PageSection frameId={frame.id} />}

      <SizeDifferences node={node} onReset={(area, key) => send(resetToAllSizesOps(frame.id, node, area, key))} />

      {node.type === "instance" && <InstanceSection node={node} sel={sel} />}
      {componentFrame && !ctx.parent && <ComponentSection frame={componentFrame} />}
      {componentFrame && <PropertySection frame={componentFrame} node={node} sel={sel} />}
      <ContentSection node={node} sel={sel} />
      <RepeatedSection node={node} frame={frame} parent={ctx.parent} sel={sel} />

      <DesignSections targets={targets} tokens={tokens} />
      {ctx.parent && ctx.parent.layout?.mode !== "absolute" && (
        <div className="border-b border-zinc-200 px-3 py-1">
          <PositionRow sel={sel} />
        </div>
      )}

      {node.type !== "slot" && <InteractionSection node={node} frame={frame} sel={sel} />}
      <NotesSection node={node} sel={sel} />
      <ClassesSection node={node} frame={frame} parent={ctx.parent} />
    </aside>
  );
}

/** Page settings of a screen: what browsers and link previews show (title, description, share image). */
function PageSection({ frameId }: { frameId: string }) {
  const frame = useEditor((s) => s.project!.frames.find((f) => f.id === frameId))!;
  const meta = frame.meta ?? {};
  const set = (patch: Partial<NonNullable<typeof frame.meta>>) => {
    const next = Object.fromEntries(Object.entries({ ...meta, ...patch }).filter(([, v]) => v !== undefined && v !== ""));
    dispatch([{ id: newOpId(), frameId, op: "updateFrame", patch: { meta: Object.keys(next).length ? next : null } }]);
  };
  return (
    <Section title="Page">
      <ScreenBehaviorRows frame={frame} />
      <Row label="Title" hint="In the browser tab and in search results">
        <TextInput label="Page title" value={meta.title} placeholder={frame.name} onCommit={(title) => set({ title: title.trim() || undefined })} />
      </Row>
      <Row label="Description" hint="Shown by search engines and link previews (about 150 characters)">
        <TextInput label="Page description" multiline value={meta.description} placeholder="What the page is about" onCommit={(description) => set({ description: description.trim() || undefined })} />
      </Row>
      <div className="grid grid-cols-[76px_1fr] items-center gap-2 py-1 text-xs">
        <span className="text-zinc-500" title="The picture link previews show (in chats and social networks), ideally 1200×630">
          Share image
        </span>
        <ImagePick label="Share image" value={meta.image} onChange={(image) => set({ image })} />
      </div>
    </Section>
  );
}

/** "Edit for": the screen size and the state edits go to (the board shows the selection in that state). */
/** Whether an ancestor of the node is a hover group (its Group hover state applies). */
function inHoverGroup(root: DesignNode, nodeId: string): boolean {
  const path: DesignNode[] = [];
  const find = (n: DesignNode): boolean => {
    if (n.id === nodeId) return true;
    path.push(n);
    if (isContainer(n) && n.children.some(find)) return true;
    path.pop();
    return false;
  };
  return find(root) && path.some((n) => n.style?.hoverGroup);
}

function EditForRows({ tokens, breakpoint, groupHover = false }: { tokens: Tokens; breakpoint: string | undefined; groupHover?: boolean }) {
  const state = useEditor((s) => s.state);
  const breakpoints = Object.keys(tokens.groups.breakpoint ?? DEFAULT_BREAKPOINTS);
  return (
    <>
      <Row label="Edit for" hint="Edits apply to all screen sizes, or from a breakpoint up">
        <Segmented
          label="Breakpoint"
          value={breakpoint ?? "all"}
          options={[{ value: "all", label: "All" }, ...breakpoints.map((b) => ({ value: b, label: b, title: `${b} and up (${tokens.groups.breakpoint?.[b] ?? DEFAULT_BREAKPOINTS[b]})` }))]}
          onChange={(v) => useEditor.setState({ breakpoint: v === "all" ? undefined : v })}
        />
      </Row>
      <Row label="State" hint="Edits apply to how it looks normally, or only in a state (hover, focus, …); the board shows the selection in that state">
        <Segmented
          label="State"
          value={state ?? "default"}
          options={groupHover || state === "group-hover" ? [...STATES, { value: "group-hover", label: "Group", title: "While its hover group (a parent) is hovered" }] : STATES}
          onChange={(v) => useEditor.setState({ state: v === "default" ? undefined : v })}
        />
      </Row>
    </>
  );
}

const ARRANGE_ACTIONS: { action: ArrangeAction; label: string; icon: React.ReactNode }[] = [
  { action: { kind: "align", how: "left" }, label: "Align left", icon: <AlignStartVertical size={14} /> },
  { action: { kind: "align", how: "hcenter" }, label: "Align horizontal centers", icon: <AlignCenterVertical size={14} /> },
  { action: { kind: "align", how: "right" }, label: "Align right", icon: <AlignEndVertical size={14} /> },
  { action: { kind: "align", how: "top" }, label: "Align top", icon: <AlignStartHorizontal size={14} /> },
  { action: { kind: "align", how: "vcenter" }, label: "Align vertical centers", icon: <AlignCenterHorizontal size={14} /> },
  { action: { kind: "align", how: "bottom" }, label: "Align bottom", icon: <AlignEndHorizontal size={14} /> },
  { action: { kind: "distribute", axis: "x" }, label: "Distribute horizontally", icon: <AlignHorizontalDistributeCenter size={14} /> },
  { action: { kind: "distribute", axis: "y" }, label: "Distribute vertically", icon: <AlignVerticalDistributeCenter size={14} /> },
];

/** Align and distribute buttons, for elements and for board items. */
export function ArrangeButtons({ enabled, onAction }: { enabled: (action: ArrangeAction) => string | true; onAction: (action: ArrangeAction) => void }) {
  return (
    <div className="flex flex-wrap gap-0.5" role="toolbar" aria-label="Align and distribute">
      {ARRANGE_ACTIONS.map(({ action, label, icon }) => {
        const ok = enabled(action);
        return (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={ok === true ? label : `${label}: ${ok}`}
            disabled={ok !== true}
            onClick={() => onAction(action)}
            className="grid h-7 w-7 place-items-center rounded text-zinc-600 hover:bg-zinc-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}

/** Several elements selected (Shift-click): what they share, edited at once; align and distribute. */
function MultiInspector({ targets, tokens }: { targets: Target[]; tokens: Tokens }) {
  const project = useEditor((s) => s.project)!;
  const breakpoint = useEditor((s) => s.breakpoint);
  const sels = targets.map((t) => t.sel);
  const arrangement = nodeArrangement(project, sels);
  const screens = new Set(sels.map((s) => s.itemId)).size;
  const enabled = (action: ArrangeAction): string | true => {
    if (arrangement.mode === "free") return action.kind === "distribute" && sels.length < 3 ? "Select three or more elements" : true;
    if (arrangement.mode === "none") return arrangement.reason;
    return layoutActionHint(arrangement.direction, action) ? true : arrangement.direction === "grid" ? "In a grid, elements line up along the grid" : "Along a row or stack, the order decides";
  };
  return (
    <aside className="z-10 flex w-80 shrink-0 flex-col overflow-y-auto border-l border-ink/10 bg-paper" aria-label="Inspector">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-accent-700">Selection</div>
          <div className="truncate text-sm font-medium text-zinc-900">
            {targets.length} elements{screens > 1 ? ` on ${screens} screens` : ""}
          </div>
        </div>
        <button type="button" title="Delete all (Del)" aria-label="Delete elements" onClick={deleteSelected} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-red-50 hover:text-red-600">
          <Trash2 size={14} />
        </button>
      </div>
      <Section title="Align & distribute">
        <ArrangeButtons enabled={enabled} onAction={(action) => dispatch(arrangeNodesOps(project, sels, action))} />
        {arrangement.mode === "layout" && <p className="mt-1 text-[11px] text-zinc-500">In an auto layout: across it each element aligns itself; along it the container spreads its elements.</p>}
        {arrangement.mode === "none" && <p className="mt-1 text-[11px] text-zinc-500">{arrangement.reason}.</p>}
      </Section>
      <Section title="Element">
        <EditForRows tokens={tokens} breakpoint={breakpoint} />
      </Section>
      <DesignSections targets={targets} tokens={tokens} />
    </aside>
  );
}

/**
 * Free placements of the element (moved freely, or detached from the layout), per screen size: the
 * offsets to adjust, "Put back in layout", or "Detach from layout" for overlays.
 */
function PositionRow({ sel }: { sel: NodeSelection }) {
  const project = useEditor((s) => s.project)!;
  const ctx = nodeContext(project, sel);
  if (!ctx) return null;
  const { node, frame } = ctx;
  const placements = placementsOf(node);
  const where = (when: Condition | undefined) => (when?.viewport ? `${when.viewport} and up` : "all sizes");
  const setOffset = (p: Placement, edge: "left" | "top", raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) return;
    dispatch(boxOps(project, frame, node, { inset: { left: p.left ?? 0, top: p.top ?? 0, [edge]: Math.round(n) } }, p.when));
  };
  return (
    <div className="py-1 text-xs" aria-label="Position" role="group">
      <div className="grid grid-cols-[76px_1fr] items-center gap-2">
        <span className="text-zinc-500" title="Moved freely or detached from the layout">
          Position
        </span>
        <div className="flex items-center gap-1">
          <span className="flex-1 text-zinc-700">{placements.length === 0 ? "In layout" : placements.some((p) => p.kind === "detached") ? "Detached" : "Moved freely"}</span>
          {!placements.some((p) => p.kind === "detached") && (
            <button type="button" onClick={() => dispatch(detachOps(project, sel))} title="Take it out of the layout (for overlays, like a badge on a picture); the elements around close the gap" className="rounded px-1.5 py-0.5 text-[11px] text-accent-700 hover:bg-accent-50">
              Detach from layout
            </button>
          )}
        </div>
      </div>
      {placements.map((p) => (
        <div key={p.when?.viewport ?? "all"} className="ml-[84px] mt-1 flex items-center gap-1" data-testid="placement">
          <span className="w-16 shrink-0 truncate text-zinc-500" title={p.kind === "detached" ? "Detached from the layout" : "Moved, keeps its place in the layout"}>
            {where(p.when)}
          </span>
          <span className="text-zinc-400">x</span>
          <TextInput label={`Offset x (${where(p.when)})`} value={String(p.left ?? 0)} onCommit={(v) => setOffset(p, "left", v)} />
          <span className="text-zinc-400">y</span>
          <TextInput label={`Offset y (${where(p.when)})`} value={String(p.top ?? 0)} onCommit={(v) => setOffset(p, "top", v)} />
          <button type="button" onClick={() => dispatch(putBackOps(project, frame, node, p.when))} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-700 hover:bg-accent-50" title="Back to its place in the layout">
            Put back
          </button>
        </div>
      ))}
    </div>
  );
}

/** Imported elements: the JSX that renders them, and classes kept as they are. */
function SourceRow({ node, frameId }: { node: DesignNode; frameId: string }) {
  const appRoot = useEditor((s) => s.location?.appRoot);
  const project = useEditor((s) => s.project)!;
  const scope = useEditor((s) => s.codeScope);
  const copies = node.source ? linkedCopies(project, frameId, node.id) : [];
  const screens = new Set(copies.map((c) => c.frameId)).size;
  const source = node.source;
  const unmapped = node.platformRaw?.unmapped ?? [];
  if (!source && unmapped.length === 0 && !node.redacted) return null;
  const absolute = source && appRoot ? `${appRoot.replace(/\\/g, "/")}/${source.file}:${source.line}:${source.col}` : undefined;
  return (
    <div className="flex flex-col gap-1 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs" aria-label="Source">
      {source && (
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Code</span>
          <a href={absolute ? `vscode://file/${absolute}` : undefined} title="Open in VS Code" className="truncate font-mono text-accent-700 hover:underline">
            {source.file}:{source.line}
          </a>
          {source.component && <span className="truncate text-zinc-500">in {source.component}</span>}
          {source.repeated && <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-800" title="Rendered several times from the same code (list or component)">×{source.repeated.count}</span>}
        </div>
      )}
      {copies.length > 1 && (
        <div className="flex items-center gap-1.5" title="These elements come from the same code, so in the app they change together">
          <span className="text-zinc-500">
            Same code: {copies.length} elements{screens > 1 ? ` on ${screens} screens` : ""}
          </span>
          <span className="ml-auto flex overflow-hidden rounded border border-zinc-300" role="radiogroup" aria-label="Edit">
            {(["all", "this"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => useEditor.setState({ codeScope: value })}
                className={`px-1.5 py-0.5 ${scope === value ? "bg-ink text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"}`}
              >
                {value === "all" ? "Edit all" : "This one"}
              </button>
            ))}
          </span>
        </div>
      )}
      {node.redacted && <span className="text-amber-700">Redacted: placeholder content, not the app's real data</span>}
      {unmapped.length > 0 && (
        <div className="flex flex-wrap gap-1" title="Classes AppShape keeps as they are (no editable equivalent)">
          {unmapped.map((cls) => (
            <span key={cls} className="rounded bg-zinc-200/70 px-1 font-mono text-[10px] text-zinc-600">
              {cls}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where the screen or component lives in the app's code (after "Apply to code"). */
const SIZE_LABEL: Record<string, string> = { sm: "Large phones and up (sm)", md: "Tablets and up (md)", lg: "Desktops and up (lg)", xl: "Large desktops (xl)", "2xl": "Very large screens (2xl)" };

/** Phone / tablet / desktop visibility of an element. */
function SizeToggles({ node, onChange }: { node: DesignNode; onChange: (shown: [boolean, boolean, boolean]) => void }) {
  const shown = visibilityBySize(node);
  return (
    <div className="flex gap-1" role="group" aria-label="Show on">
      {SIZES.map((size, i) => (
        <button
          key={size.id}
          type="button"
          aria-pressed={shown[i]}
          aria-label={`Show on ${size.label.toLowerCase()}`}
          title={`${shown[i] ? "Shown" : "Hidden"} on ${size.label.toLowerCase()}s`}
          onClick={(e) => {
            e.preventDefault();
            const next = [...shown] as [boolean, boolean, boolean];
            next[i] = !next[i];
            onChange(next);
          }}
          className={`flex flex-1 items-center justify-center gap-1 rounded border px-1.5 py-1 text-[11px] ${shown[i] ? "border-ink/30 bg-white text-ink" : "border-dashed border-zinc-300 text-zinc-400 line-through"}`}
        >
          {size.label}
        </button>
      ))}
    </div>
  );
}

/** What an element sets differently from a screen size up, each with "Reset to all sizes". */
function SizeDifferences({ node, onReset }: { node: DesignNode; onReset: (area: SizeDifference["area"], key: string) => void }) {
  const list = sizeDifferences(node);
  if (list.length === 0) return null;
  const byViewport = new Map<string, SizeDifference[]>();
  for (const d of list) byViewport.set(d.viewport, [...(byViewport.get(d.viewport) ?? []), d]);
  const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v).replace(/"/g, "").replace(/\$\w+\./g, "") : String(v).replace(/^\$\w+\./, ""));
  return (
    <Section title="Differs per screen size">
      {[...byViewport].map(([viewport, diffs]) => (
        <div key={viewport} className="mb-1.5">
          <div className="text-[11px] font-semibold text-indigo-700">{SIZE_LABEL[viewport] ?? viewport}</div>
          <ul>
            {diffs.map((d) => (
              <li key={`${d.area}.${d.key}`} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                <span className="w-24 shrink-0 truncate text-zinc-500">{d.key === "hidden" ? "Visible" : d.key}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-700" title={show(d.value)}>
                  {d.key === "hidden" ? (d.value ? "hidden" : "shown") : show(d.value)}
                </span>
                <button type="button" onClick={() => onReset(d.area, d.key)} title="Use the same value at every size" className="shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink">
                  Reset to all sizes
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

/** Shows a web screen at phone, tablet and desktop width side by side on the board. */
function AllSizesRow({ frameId }: { frameId: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 text-xs">
      <MonitorSmartphone size={13} className="shrink-0 text-zinc-500" />
      <span className="flex-1 text-zinc-500">Phone, tablet and desktop</span>
      <button
        type="button"
        onClick={() => {
          const { project, sizes } = useEditor.getState();
          const frame = project?.frames.find((f) => f.id === frameId);
          if (!project || !frame) return;
          const ops = showAllSizesOps(project, frame, sizes);
          if (ops.length === 0) notify("This screen is already shown at every size.");
          else dispatch(ops);
        }}
        className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 hover:border-zinc-400"
      >
        Show all sizes
      </button>
    </div>
  );
}

/** A screen's theme: the project's, or a named theme of its own (made with the theme starter). */
function ThemeRow({ frameId }: { frameId: string }) {
  const themes = useEditor((s) => s.project!.tokens.themes);
  const current = useEditor((s) => s.project!.frames.find((f) => f.id === frameId)?.theme);
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 text-xs">
      <Palette size={13} className="shrink-0 text-zinc-500" />
      <span className="text-zinc-500">Theme</span>
      <select
        aria-label="Screen theme"
        value={current && themes?.[current] ? current : ""}
        onChange={(e) => {
          if (e.target.value) dispatch([{ id: newOpId(), frameId, op: "updateFrame", patch: { theme: e.target.value } }]);
          else resetScreenTheme(frameId);
        }}
        className="min-w-0 flex-1 rounded border border-zinc-200 px-1 py-0.5"
      >
        <option value="">The project's theme</option>
        {Object.entries(themes ?? {}).map(([id, theme]) => (
          <option key={id} value={id}>
            {theme.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => useEditor.setState({ themeOpen: true, themeScreen: frameId })}
        title="Give this screen its own theme in the theme starter"
        className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 hover:border-zinc-400"
      >
        {current ? "Edit…" : "Own theme…"}
      </button>
    </div>
  );
}

function CodeRow({ frameId }: { frameId: string }) {
  const status = useEditor((s) => s.appStatus);
  const path = status?.files[frameId];
  if (!status || !path) return null;
  const absolute = `${status.appRoot.replace(/\\/g, "/")}/${path}`;
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs">
      <span className="text-zinc-500">Code</span>
      <a href={`vscode://file/${absolute}`} title="Open in VS Code" className="truncate font-mono text-accent-700 hover:underline">
        {path}
      </a>
    </div>
  );
}

function ContentSection({ node, sel }: { node: DesignNode; sel: NodeSelection }) {
  const base = { frameId: sel.frameId, nodeId: sel.nodeId };
  const project = useEditor((s) => s.project)!;
  const codeScope = useEditor((s) => s.codeScope);
  // Like the other inspector edits: shared code changes in every copy unless "this one only".
  const attrs = (a: Edit) => dispatch(forCopies(project, [{ id: newOpId(), ...base, op: "setAttrs", attrs: a as never }], codeScope));
  switch (node.type) {
    case "text":
      return (
        <Section title="Content">
          {node.spans?.length ? (
            // formatted parts are edited in place (the plain field would drop them)
            <div className="flex items-center gap-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-zinc-600" title={node.text}>
                Formatted text: double-click it on the board to edit
              </span>
              <button
                type="button"
                onClick={() => {
                  const { project, codeScope } = useEditor.getState();
                  dispatch(forCopies(project!, [{ id: newOpId(), ...base, op: "retext", text: node.text }], codeScope));
                }}
                className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 hover:border-zinc-400"
              >
                Clear formatting
              </button>
            </div>
          ) : (
            <TextInput label="Text" multiline value={node.text} onCommit={(text) => { const { project, codeScope } = useEditor.getState(); dispatch(forCopies(project!, [{ id: newOpId(), ...base, op: "retext", text }], codeScope)); }} />
          )}
          <Row label="Semantics">
            <Segmented
              label="Text role"
              value={node.semantic?.role === "heading" ? `h${node.semantic.level ?? 2}` : "text"}
              options={[
                { value: "text", label: "Text" },
                { value: "h1", label: "H1" },
                { value: "h2", label: "H2" },
                { value: "h3", label: "H3" },
              ]}
              onChange={(v) => attrs({ semantic: v === "text" ? null : { role: "heading", level: Number(v.slice(1)) } })}
            />
          </Row>
        </Section>
      );
    case "image":
      return (
        <Section title="Image">
          <Row label="Source">
            <TextInput label="Image source" value={node.src.startsWith("data:") ? "" : node.src} placeholder="https://… (placeholder)" onCommit={(src) => src.trim() && dispatch([{ id: newOpId(), ...base, op: "replaceImage", src: src.trim() }])} />
            <button
              type="button"
              aria-label="Upload an image"
              title="Choose an image file (or drop one onto the image)"
              onClick={async (e) => {
                e.preventDefault(); // inside the row's <label>
                const file = await chooseImageFile();
                if (file) await replaceImage(file, base.frameId, base.nodeId);
              }}
              className="shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs hover:border-zinc-300"
            >
              Upload…
            </button>
          </Row>
          <Row label="Alt text">
            <TextInput label="Alt text" value={node.alt} onCommit={(alt) => dispatch([{ id: newOpId(), ...base, op: "replaceImage", src: node.src, alt: alt || null }])} />
          </Row>
          <Row label="Fit">
            <Segmented label="Image fit" value={node.fit ?? "cover"} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} onChange={(v) => attrs({ fit: v })} />
          </Row>
        </Section>
      );
    case "input":
      return (
        <Section title="Input">
          <Row label="Type">
            <select aria-label="Input type" value={node.inputType} onChange={(e) => attrs({ inputType: e.target.value })} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
              {INPUT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Row>
          <Row label="Label">
            <TextInput label="Input label" value={node.label} onCommit={(v) => attrs({ label: v || null })} />
          </Row>
          <Row label="Placeholder">
            <TextInput label="Placeholder" value={node.placeholder} onCommit={(v) => attrs({ placeholder: v || null })} />
          </Row>
        </Section>
      );
    case "icon":
      return (
        <Section title="Icon">
          <Row label="Icon">
            <IconPicker set={node.set} value={node.icon} onChange={(icon) => icon !== node.icon && attrs({ icon })} />
          </Row>
        </Section>
      );
    default:
      return null;
  }
}

/** Repeated content: a list's data, an item design's bound fields, or making one from look-alike elements. */
function RepeatedSection({ node, frame, parent, sel }: { node: DesignNode; frame: Frame; parent: ContainerNode | undefined; sel: NodeSelection }) {
  if (node.type === "list" && node.items) return <DataSection node={node} sel={sel} />;
  const list = listOf(frame.current, node.id);
  if (list) {
    return (
      <Section title="Repeated content">
        <BindRow node={node} list={list} sel={sel} />
        {!["text", "image", "link"].includes(node.type) && <p className="text-[11px] text-zinc-500">Part of the design of each item of {list.name ?? "the list"}.</p>}
      </Section>
    );
  }
  if (!parent || !canRepeat(node) || frame.kind === "component") return null;
  return (
    <Section title="Repeated content">
      <p className="mb-1 text-[11px] text-zinc-500">Its elements look alike: keep one design and put what differs into data (generated as a data file and a .map()).</p>
      <button type="button" onClick={() => repeatWithData(frame, node as ContainerNode, parent.id, parent.children.indexOf(node), sel.itemId)} className="rounded border border-zinc-200 px-2 py-1 text-xs hover:border-ink">
        Make it one design + data
      </button>
    </Section>
  );
}

function NotesSection({ node, sel }: { node: DesignNode; sel: NodeSelection }) {
  const [kind, setKind] = useState<(typeof ANNOTATION_KINDS)[number]>("behavior");
  const [text, setText] = useState("");
  const base = { frameId: sel.frameId, nodeId: sel.nodeId };
  const add = () => {
    if (!text.trim()) return;
    dispatch([{ id: newOpId(), ...base, op: "annotate", annotation: { id: createId("a"), kind, text: text.trim(), author: "user" } }]);
    setText("");
  };
  return (
    <Section title="Notes for the AI">
      {(node.annotations ?? []).map((a) => (
        <div key={a.id} className="mb-1 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <span className="shrink-0 font-semibold capitalize">{a.kind}:</span>
          <span className="flex-1">{a.text}</span>
          <button type="button" aria-label="Remove note" onClick={() => dispatch([{ id: newOpId(), ...base, op: "unannotate", annotationId: a.id }])} className="text-amber-700 hover:text-red-600">
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <select aria-label="Note kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded border border-zinc-200 px-1 text-xs">
          {ANNOTATION_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          aria-label="Note text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") add();
          }}
          placeholder="e.g. opens the checkout"
          className="min-w-0 flex-1 rounded border border-zinc-200 px-1.5 py-1 text-xs"
        />
      </div>
    </Section>
  );
}
