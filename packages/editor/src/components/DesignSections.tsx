import {
  type BackgroundImage,
  type Box,
  type BoxPatch,
  type Condition,
  type ContainerNode,
  conditionKey,
  type DesignNode,
  EASINGS,
  type Frame,
  isContainer,
  type Layout,
  type LayoutPatch,
  type Op,
  type Project,
  type Sizing,
  type Style,
  type StylePatch,
  type StyleValue,
  type Tokens,
  type Transition,
} from "@appshape/ir";
import { useState } from "react";
import { assetUrl } from "../lib/api";
import { newOpId } from "../lib/board";
import { editCondition } from "../lib/edits";
import { addImageFile, chooseImageFile } from "../lib/images";
import { forCopies } from "../lib/linked";
import { nodeContext } from "../lib/nodes";
import { canStackOnPhones, isStackedOnPhones, stackOnPhonesOps } from "../lib/responsive";
import { dispatch, type NodeSelection, notify, useEditor } from "../store";
import { EffectsSection, GradientRows, GradientTextRow, TransformSection } from "./EffectsFields";
import { FontField } from "./FontPicker";
import { BlendRows, BorderRows, RadiusRows } from "./ShapeFields";
import { MotionSection } from "./MotionFields";
import { StylePicker } from "./StylesPanel";
import { ColorField, Row, Section, Segmented, TextInput, TokenField } from "./Fields";

/**
 * The design sections of the inspector (auto layout, size and position, style, text, transition, animation)
 * for one element or several at once: a value shared by all is shown, different ones as "Mixed",
 * and an edit goes to every selected element in one undo step.
 */

/** A selected element, with what the inspector shows for it under the active condition. */
export interface Target {
  sel: NodeSelection;
  node: DesignNode;
  frame: Frame;
  parent: ContainerNode | undefined;
  /** Where edits go (breakpoint, state, variant), see `editCondition`. */
  when: Condition | undefined;
  layout: Partial<Layout>;
  box: Partial<Box>;
  style: Partial<Style>;
}

export function targetOf(project: Project, sel: NodeSelection): Target | undefined {
  const ctx = nodeContext(project, sel);
  if (!ctx) return undefined;
  const { node, frame, parent } = ctx;
  const when = editCondition(frame);
  const override = when ? node.overrides?.find((o) => conditionKey(o.when) === conditionKey(when)) : undefined;
  return {
    sel,
    node,
    frame,
    parent,
    when,
    layout: { ...node.layout, ...override?.layout },
    box: { ...node.box, ...override?.box },
    style: { ...node.style, ...override?.style },
  };
}

interface Shared<T> {
  value: T | undefined;
  mixed: boolean;
}

/** The value all targets share, or `mixed`. */
export function shared<T>(targets: readonly Target[], get: (t: Target) => T | undefined): Shared<T> {
  const values = targets.map(get);
  const first = JSON.stringify(values[0]);
  const mixed = values.some((v) => JSON.stringify(v) !== first);
  return { value: mixed ? undefined : values[0], mixed };
}

/** Edit helpers for a set of targets (shared code changes everywhere unless "this one only"). */
function useEdits(targets: readonly Target[]) {
  const project = useEditor((s) => s.project)!;
  const codeScope = useEditor((s) => s.codeScope);
  const send = (make: (t: Target) => Op[]) => dispatch(targets.flatMap((t) => forCopies(project, make(t), codeScope)));
  const base = (t: Target) => ({ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, ...(t.when && { when: t.when }) });
  return {
    send,
    restyle: (patch: StylePatch) => send((t) => [{ ...base(t), op: "restyle", style: patch }]),
    rebox: (patch: BoxPatch) => send((t) => [{ ...base(t), op: "relayout", box: patch }]),
    relayout: (patch: LayoutPatch) =>
      send((t) => {
        // A layout without mode is natural flow; edits that need a mode switch to a vertical stack.
        const needsMode = !t.layout.mode && (patch.gap || patch.align || patch.justify) && patch.mode === undefined;
        return [{ ...base(t), op: "relayout", layout: needsMode ? { mode: "flex", direction: "column", ...patch } : patch }];
      }),
    /** Transitions apply when entering and leaving a state, so they go to the base (per breakpoint). */
    retransition: (transition: Transition | null) =>
      send((t) => {
        const { state: _state, ...rest } = t.when ?? {};
        const when = Object.keys(rest).length > 0 ? (rest as Condition) : undefined;
        return [{ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "restyle", style: { transition }, ...(when && { when }) }];
      }),
  };
}

export function DesignSections({ targets, tokens }: { targets: Target[]; tokens: Tokens }) {
  const { restyle, rebox, relayout, retransition, send } = useEdits(targets);
  const single = targets.length === 1 ? targets[0] : undefined;
  const v = <T,>(get: (t: Target) => T | undefined) => shared(targets, get);
  const styleOf = (get: (s: Partial<Style>) => unknown) => shared(targets, (t) => get(t.style));
  const styleTargets = targets.map((t) => ({ frameId: t.frame.id, node: t.node }));
  // named style ops: a design-system op (create a style) plus element ops (all linked copies)
  const sendAny = (ops: Op[]) => dispatch(forCopies(useEditor.getState().project!, ops, useEditor.getState().codeScope));
  const containers = targets.every((t) => isContainer(t.node) && t.node.type !== "instance");
  const anyInstance = targets.some((t) => t.node.type === "instance");
  const hasText = targets.every((t) => t.node.type === "text" || t.node.type === "button" || t.node.type === "link" || t.node.type === "input" || isContainer(t.node));
  const inParent = targets.every((t) => t.parent && t.parent.layout?.mode !== "absolute");
  const parentMode = shared(targets, (t) => t.parent?.layout?.mode);

  const arrange = v((t) => (t.layout.mode === "flex" ? (t.layout.direction === "row" ? "row" : "column") : t.layout.mode === "grid" ? "grid" : "flow"));
  const mode = v((t) => t.layout.mode);
  const direction = v((t) => t.layout.direction);

  return (
    <>
      {containers && (
        <Section title="Auto layout">
          <Row label="Arrange">
            <Segmented
              label="Arrange"
              value={arrange.value}
              options={[
                { value: "flow", label: "Flow", title: "Normal flow" },
                { value: "column", label: "Stack ↓", title: "Vertical stack" },
                { value: "row", label: "Row →", title: "Horizontal row" },
                { value: "grid", label: "Grid" },
              ]}
              onChange={(a) =>
                send((t) => [
                  {
                    id: newOpId(),
                    frameId: t.frame.id,
                    nodeId: t.node.id,
                    op: "relayout",
                    layout: a === "flow" ? { mode: null, direction: null } : a === "grid" ? { mode: "grid", columns: t.layout.columns ?? 2, direction: null } : { mode: "flex", direction: a },
                    ...(t.when && { when: t.when }),
                  },
                ])
              }
            />
          </Row>
          {mode.value === "grid" && (
            <>
              <Row label="Columns" hint="A number of equal columns, or a template like 1fr 2fr">
                <GridTrackInput label="Columns" shared={v((t) => t.layout.columns)} onCommit={(columns) => relayout({ columns })} />
              </Row>
              <Row label="Rows" hint="Empty: as many as the content needs">
                <GridTrackInput label="Rows" shared={v((t) => t.layout.rows)} onCommit={(rows) => relayout({ rows })} />
              </Row>
            </>
          )}
          <Row label="Gap">
            <TokenField label="Gap" tokens={tokens} group="spacing" {...v((t) => t.layout.gap)} onChange={(gap) => relayout({ gap })} />
          </Row>
          {(mode.value === "flex" || mode.value === "grid") && (
            <>
              <Row label="Align">
                <Segmented
                  label="Align items"
                  value={v((t) => t.layout.align).value}
                  options={[
                    { value: "start", label: "Start" },
                    { value: "center", label: "Center" },
                    { value: "end", label: "End" },
                    { value: "stretch", label: "Fill" },
                  ]}
                  onChange={(align) => relayout({ align })}
                />
              </Row>
              <Row label="Distribute">
                <Segmented
                  label="Justify content"
                  value={v((t) => t.layout.justify).value}
                  options={[
                    { value: "start", label: "Start" },
                    { value: "center", label: "Center" },
                    { value: "end", label: "End" },
                    { value: "between", label: "Space" },
                  ]}
                  onChange={(justify) => relayout({ justify })}
                />
              </Row>
            </>
          )}
          {single && (canStackOnPhones(single.node) || isStackedOnPhones(single.node)) && (
            <Row label="Phones" hint="Rows and grids side by side are often too narrow on phones">
              {isStackedOnPhones(single.node) ? (
                <span className="text-xs text-teal-700">Stacked on phones, side by side from tablets up</span>
              ) : (
                <button
                  type="button"
                  aria-label="Stack on phones"
                  onClick={(e) => {
                    e.preventDefault();
                    send((t) => stackOnPhonesOps(t.frame.id, t.node));
                  }}
                  className="rounded border border-zinc-200 px-2 py-1 text-xs hover:border-ink"
                >
                  Stack on phones
                </button>
              )}
            </Row>
          )}
          {mode.value === "flex" && direction.value === "row" && (
            <Row label="Wrap">
              <Segmented label="Wrap" value={v((t) => (t.layout.wrap ? "wrap" : "nowrap")).value} options={[{ value: "nowrap", label: "No wrap" }, { value: "wrap", label: "Wrap" }]} onChange={(w) => relayout({ wrap: w === "wrap" ? true : null })} />
            </Row>
          )}
          <EdgesFields label="Padding" tokens={tokens} shared={v((t) => t.layout.padding)} onChange={(padding) => relayout({ padding })} />
        </Section>
      )}

      <Section title="Size & position">
        <SizingRow label="Width" shared={v((t) => t.box.width)} tokens={tokens} onChange={(width) => rebox({ width })} />
        <SizingRow label="Height" shared={v((t) => t.box.height)} tokens={tokens} onChange={(height) => rebox({ height })} />
        <Row label="Min / max W" hint="The smallest and largest width it may take">
          <TokenField label="Min width" tokens={tokens} group="size" {...v((t) => t.box.minWidth)} onChange={(minWidth) => rebox({ minWidth })} extra={["100%"]} />
          <TokenField label="Max width" tokens={tokens} group="size" {...v((t) => t.box.maxWidth)} onChange={(maxWidth) => rebox({ maxWidth })} extra={["100%"]} />
        </Row>
        <Row label="Min / max H" hint="The smallest and largest height it may take (100vh: the screen's height)">
          <TokenField label="Min height" tokens={tokens} group="size" {...v((t) => t.box.minHeight)} onChange={(minHeight) => rebox({ minHeight })} extra={["100vh", "100%"]} />
          <TokenField label="Max height" tokens={tokens} group="size" {...v((t) => t.box.maxHeight)} onChange={(maxHeight) => rebox({ maxHeight })} extra={["100vh", "100%"]} />
        </Row>
        <Row label="Proportions" hint="Keeps width and height in this ratio (pictures, videos, cards)">
          <AspectField shared={v((t) => t.box.aspectRatio)} onChange={(aspectRatio) => rebox({ aspectRatio })} />
        </Row>
        {inParent && (
          <Row label="Align self">
            <Segmented
              label="Align self"
              value={v((t) => t.box.alignSelf).value}
              options={[
                { value: "start", label: "Start" },
                { value: "center", label: "Center" },
                { value: "end", label: "End" },
                { value: "stretch", label: "Fill" },
              ]}
              onChange={(alignSelf) => send((t) => [{ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "relayout", box: { alignSelf: t.box.alignSelf === alignSelf ? null : alignSelf }, ...(t.when && { when: t.when }) }])}
            />
          </Row>
        )}
        {parentMode.value === "grid" && (
          <Row label="Grid span" hint="How many columns and rows of the grid it covers">
            <SpanSelect label="Column span" max={12} full shared={v((t) => t.box.colSpan)} onChange={(colSpan) => rebox({ colSpan })} />
            <SpanSelect label="Row span" max={6} shared={v((t) => t.box.rowSpan)} onChange={(rowSpan) => rebox({ rowSpan: rowSpan as number | null })} />
          </Row>
        )}
        {(parentMode.value === "flex" || parentMode.value === "grid") && (
          <Row label="Order" hint="Its place among the elements of the container, e.g. the picture first on phones">
            <OrderSelect shared={v((t) => t.box.order)} onChange={(order) => rebox({ order })} />
          </Row>
        )}
        <EdgesFields label="Margin" tokens={tokens} shared={v((t) => t.box.margin)} onChange={(margin) => rebox({ margin })} extra={["auto"]} />
        <Row label="Overflow" hint="Content larger than the element: shown, cut off, or scrollable">
          <Segmented
            label="Overflow"
            value={v((t) => (t.style.overflow === "scroll" ? "auto" : t.style.overflow ?? "visible")).value}
            options={[
              { value: "visible", label: "Visible" },
              { value: "hidden", label: "Clip" },
              { value: "auto", label: "Scroll" },
            ]}
            onChange={(overflow) => restyle({ overflow: overflow === "visible" ? null : overflow })}
          />
        </Row>
        <Row label="Z-index" hint="Which element is on top where elements overlap">
          <ZIndexSelect shared={v((t) => t.box.zIndex)} onChange={(zIndex) => rebox({ zIndex })} />
        </Row>
        {inParent && <PinRows targets={targets} tokens={tokens} onChange={rebox} />}
      </Section>

      {!anyInstance && (
        <Section title="Style">
          <Row label="Fill">
            <ColorField label="Fill" tokens={tokens} {...v((t) => t.style.background)} onChange={(background) => restyle({ background })} />
          </Row>
          {single && single.node.type !== "image" && single.node.type !== "text" && single.node.type !== "icon" && (
            <BackgroundImageRows value={single.style.backgroundImage} onChange={(backgroundImage) => restyle({ backgroundImage })} />
          )}
          <GradientRows shared={v((t) => t.style.gradient)} tokens={tokens} overImage={targets.some((t) => t.style.backgroundImage)} onChange={(gradient) => restyle({ gradient })} />
          <BorderRows style={styleOf} tokens={tokens} onChange={restyle} />
          <RadiusRows style={styleOf} tokens={tokens} onChange={restyle} />
          <Row label="Opacity">
            <TextInput
              label="Opacity"
              value={(() => {
                const o = v((t) => t.style.opacity);
                return o.value === undefined ? "" : String(o.value);
              })()}
              placeholder={v((t) => t.style.opacity).mixed ? "Mixed" : "1"}
              onCommit={(o) => restyle({ opacity: o.trim() === "" ? null : Number(o) })}
            />
          </Row>
          <BlendRows style={styleOf} hasImage={targets.some((t) => t.style.backgroundImage)} onChange={restyle} />
        </Section>
      )}
      {!anyInstance && (
        <EffectsSection style={styleOf} tokens={tokens} onChange={restyle}>
          <StylePicker kind="effectStyle" targets={styleTargets} tokens={tokens} onSend={sendAny} />
        </EffectsSection>
      )}
      {!anyInstance && <TransformSection style={styleOf} tokens={tokens} onChange={restyle} />}

      {hasText && !anyInstance && (
        <Section title="Text">
          <StylePicker kind="textStyle" targets={styleTargets} tokens={tokens} onSend={sendAny} />
          <Row label="Font">
            <FontField value={v((t) => t.style.fontFamily).value} onChange={(fontFamily) => restyle({ fontFamily })} />
          </Row>
          <Row label="Size">
            <TokenField label="Font size" tokens={tokens} group="fontSize" {...v((t) => t.style.fontSize)} onChange={(fontSize) => restyle({ fontSize })} />
          </Row>
          <Row label="Weight">
            <TokenField label="Font weight" tokens={tokens} group="fontWeight" {...v((t) => t.style.fontWeight)} onChange={(fontWeight) => restyle({ fontWeight })} />
          </Row>
          <Row label="Color">
            <ColorField label="Text color" tokens={tokens} {...v((t) => t.style.color)} onChange={(color) => restyle({ color })} />
          </Row>
          {targets.every((t) => t.node.type === "text") && <GradientTextRow shared={v((t) => t.style.backgroundClip === "text")} tokens={tokens} onChange={restyle} />}
          <Row label="Line height">
            <TokenField label="Line height" tokens={tokens} group="lineHeight" {...v((t) => t.style.lineHeight)} onChange={(lineHeight) => restyle({ lineHeight })} />
          </Row>
          <Row label="Letter spacing">
            <TokenField label="Letter spacing" tokens={tokens} group="letterSpacing" {...v((t) => t.style.letterSpacing)} onChange={(letterSpacing) => restyle({ letterSpacing })} />
          </Row>
          <Row label="Align">
            <Segmented
              label="Text align"
              value={v((t) => t.style.textAlign).value}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
              onChange={(textAlign) => send((t) => [{ id: newOpId(), frameId: t.frame.id, nodeId: t.node.id, op: "restyle", style: { textAlign: t.style.textAlign === textAlign ? null : textAlign }, ...(t.when && { when: t.when }) }])}
            />
          </Row>
          <Row label="Case">
            <Segmented
              label="Text transform"
              value={v((t) => t.style.textTransform ?? "none").value}
              options={[
                { value: "none", label: "Aa" },
                { value: "uppercase", label: "AA" },
                { value: "lowercase", label: "aa" },
              ]}
              onChange={(textTransform) => restyle({ textTransform: textTransform === "none" ? null : textTransform })}
            />
          </Row>
        </Section>
      )}

      <TransitionSection shared={shared(targets, (t) => baseTransition(t))} onChange={retransition} />
      <MotionSection targets={targets} send={send} />
    </>
  );
}

/** The transition in effect for the target's breakpoint (states don't have their own). */
function baseTransition(t: Target): Transition | string | undefined {
  const viewport = t.when?.viewport;
  const override = viewport ? t.node.overrides?.find((o) => o.when.viewport === viewport && !o.when.state && !o.when.scheme && !o.when.prop) : undefined;
  return override?.style?.transition ?? t.node.style?.transition;
}

const PROPERTY_OPTIONS: { value: NonNullable<Transition["property"]>; label: string }[] = [
  { value: "colors", label: "Colors" },
  { value: "shadow", label: "Shadow" },
  { value: "transform", label: "Move, scale, rotate" },
  { value: "opacity", label: "Opacity" },
  { value: "default", label: "Colors, shadow, move, opacity" },
  { value: "all", label: "Everything" },
];
const DURATIONS = [100, 150, 200, 300, 500];
const EASING_LABEL: Record<(typeof EASINGS)[number], string> = { "in-out": "Smooth", out: "Out", in: "In", linear: "Linear" };

/** How changes between states animate: which properties, how long, which curve. */
function TransitionSection({ shared: current, onChange }: { shared: Shared<Transition | string>; onChange: (t: Transition | null) => void }) {
  const raw = typeof current.value === "string" ? current.value : undefined;
  const t = typeof current.value === "object" ? current.value : undefined;
  const set = (patch: Partial<Transition>) => onChange({ property: "default", ...t, ...patch });
  return (
    <Section title="Transition">
      <Row label="Animate" hint="Changes to these properties (on hover, focus, …) animate instead of jumping">
        <select
          aria-label="Animate"
          value={current.mixed ? "mixed" : raw ? "raw" : (t?.property ?? "")}
          onChange={(e) => (e.target.value === "" ? onChange(null) : e.target.value !== "mixed" && e.target.value !== "raw" && set({ property: e.target.value as Transition["property"] }))}
          className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
        >
          {current.mixed && <option value="mixed">Mixed</option>}
          {raw && <option value="raw">Custom: {raw}</option>}
          <option value="">Nothing (changes jump)</option>
          {PROPERTY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {t?.property && (
        <>
          <Row label="Duration">
            <Segmented
              label="Duration"
              value={String(t.duration ?? 150)}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d}`, title: `${d} ms` }))}
              onChange={(d) => set({ duration: Number(d) === 150 ? undefined : Number(d) })}
            />
            <span className="text-[10px] text-zinc-400">ms</span>
          </Row>
          <Row label="Easing" hint="Smooth: slow start and end; Out: fast start (good for hover); In: slow start">
            <Segmented label="Easing" value={t.easing ?? "in-out"} options={EASINGS.map((e) => ({ value: e, label: EASING_LABEL[e] }))} onChange={(easing) => set({ easing: easing === "in-out" ? undefined : easing })} />
          </Row>
        </>
      )}
    </Section>
  );
}

/** Sticky (stays in view while scrolling past) or fixed (always at the same place on the screen). */
function PinRows({ targets, tokens, onChange }: { targets: Target[]; tokens: Tokens; onChange: (patch: BoxPatch) => void }) {
  const position = shared(targets, (t) => t.box.position);
  const pin = position.mixed ? undefined : position.value === "sticky" || position.value === "fixed" ? position.value : "none";
  const inset = shared(targets, (t) => t.box.inset);
  return (
    <>
      <Row label="Pin" hint="Sticky: stays in view while the page scrolls past it (a header). Fixed: always at the same place on the screen (a chat button)">
        <Segmented
          label="Pin"
          value={pin}
          options={[
            { value: "none", label: "No" },
            { value: "sticky", label: "Sticky" },
            { value: "fixed", label: "Fixed" },
          ]}
          onChange={(p) => onChange(p === "none" ? { position: null, inset: null } : p === "sticky" ? { position: "sticky", inset: { top: 0 } } : { position: "fixed", inset: { top: 0, left: 0, right: 0 } })}
        />
      </Row>
      {(pin === "sticky" || pin === "fixed") && <EdgesFields label="Insets" tokens={tokens} shared={inset} onChange={(v) => onChange({ inset: v })} startExpanded />}
    </>
  );
}

const RATIOS = [
  { value: "1 / 1", label: "1:1 square" },
  { value: "4 / 3", label: "4:3" },
  { value: "3 / 2", label: "3:2" },
  { value: "16 / 9", label: "16:9 video" },
  { value: "21 / 9", label: "21:9 wide" },
  { value: "3 / 4", label: "3:4 portrait" },
  { value: "2 / 3", label: "2:3 portrait" },
  { value: "9 / 16", label: "9:16 story" },
];

function AspectField({ shared: current, onChange }: { shared: Shared<string>; onChange: (v: string | null) => void }) {
  const ratio = current.value?.replace(/\s*\/\s*/, " / ");
  const known = ratio === undefined || RATIOS.some((r) => r.value === ratio);
  const [custom, setCustom] = useState(false);
  const showCustom = custom || !known;
  return (
    <>
      <select
        aria-label="Proportions"
        value={current.mixed ? "mixed" : showCustom ? "custom" : (ratio ?? "")}
        onChange={(e) => {
          setCustom(e.target.value === "custom");
          if (e.target.value === "" || (e.target.value !== "custom" && e.target.value !== "mixed")) onChange(e.target.value || null);
        }}
        className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
      >
        {current.mixed && <option value="mixed">Mixed</option>}
        <option value="">Free</option>
        {RATIOS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {showCustom && (
        <div className="w-16 shrink-0">
          <TextInput label="Proportions (custom)" value={known ? "" : current.value} placeholder="5 / 4" onCommit={(v) => (/^\s*[\d.]+\s*\/\s*[\d.]+\s*$/.test(v) ? onChange(v.replace(/\s*\/\s*/, " / ").trim()) : v.trim() === "" && onChange(null))} />
        </div>
      )}
    </>
  );
}

function SpanSelect({ label, max, full, shared: current, onChange }: { label: string; max: number; full?: boolean; shared: Shared<number | "full">; onChange: (v: number | "full" | null) => void }) {
  return (
    <select
      aria-label={label}
      title={label}
      value={current.mixed ? "mixed" : String(current.value ?? "")}
      onChange={(e) => e.target.value !== "mixed" && onChange(e.target.value === "" ? null : e.target.value === "full" ? "full" : Number(e.target.value))}
      className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
    >
      {current.mixed && <option value="mixed">Mixed</option>}
      <option value="">{label.startsWith("Column") ? "Cols: 1" : "Rows: 1"}</option>
      {Array.from({ length: max - 1 }, (_, i) => i + 2).map((n) => (
        <option key={n} value={n}>
          {label.startsWith("Column") ? `Cols: ${n}` : `Rows: ${n}`}
        </option>
      ))}
      {full && <option value="full">All columns</option>}
    </select>
  );
}

function OrderSelect({ shared: current, onChange }: { shared: Shared<number>; onChange: (v: number | null) => void }) {
  return (
    <select
      aria-label="Order"
      value={current.mixed ? "mixed" : String(current.value ?? "")}
      onChange={(e) => e.target.value !== "mixed" && onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
    >
      {current.mixed && <option value="mixed">Mixed</option>}
      <option value="">As placed</option>
      <option value={-9999}>First</option>
      <option value={9999}>Last</option>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

function ZIndexSelect({ shared: current, onChange }: { shared: Shared<StyleValue>; onChange: (v: StyleValue | null) => void }) {
  const steps = [0, 10, 20, 30, 40, 50];
  const value = current.value;
  const custom = value !== undefined && !steps.includes(Number(value));
  return (
    <>
      <select
        aria-label="Z-index"
        value={current.mixed ? "mixed" : custom ? "custom" : String(value ?? "")}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "mixed" || next === "custom") return;
          onChange(next === "" ? null : Number(next));
        }}
        className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
      >
        {current.mixed && <option value="mixed">Mixed</option>}
        {custom && <option value="custom">{String(value)}</option>}
        <option value="">Auto</option>
        {steps.map((n) => (
          <option key={n} value={n}>
            {n}
            {n === 50 ? " (top)" : ""}
          </option>
        ))}
      </select>
    </>
  );
}

function GridTrackInput({ label, shared: current, onCommit }: { label: string; shared: Shared<number | string>; onCommit: (v: number | string | null) => void }) {
  return (
    <TextInput
      label={label}
      value={current.value === undefined ? "" : String(current.value)}
      placeholder={current.mixed ? "Mixed" : label === "Rows" ? "auto" : ""}
      onCommit={(v) => onCommit(/^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : v.trim() || null)}
    />
  );
}

function SizingRow({ label, shared: current, tokens, onChange }: { label: string; shared: Shared<Sizing>; tokens: Tokens; onChange: (v: Sizing | null) => void }) {
  const value = current.value;
  const mode = current.mixed ? undefined : (value?.mode ?? "auto");
  return (
    <Row label={label}>
      <Segmented
        label={label}
        value={mode}
        options={[
          { value: "auto", label: "Auto" },
          { value: "hug", label: "Hug" },
          { value: "fill", label: "Fill" },
          { value: "fixed", label: "Fixed" },
        ]}
        onChange={(m) => onChange(m === "auto" ? null : m === "fixed" ? { mode: "fixed", value: value?.mode === "fixed" ? value.value : "$spacing.64" } : { mode: m })}
      />
      {value?.mode === "fixed" && (
        <div className="w-24 shrink-0">
          <TokenField label={`${label} value`} tokens={tokens} group="spacing" value={value.value} onChange={(x) => onChange(x === null ? null : { mode: "fixed", value: x })} />
        </div>
      )}
    </Row>
  );
}

type EdgeValues = { top?: StyleValue; right?: StyleValue; bottom?: StyleValue; left?: StyleValue };

function EdgesFields({
  label,
  tokens,
  shared: current,
  onChange,
  extra,
  startExpanded = false,
}: {
  label: string;
  tokens: Tokens;
  shared: Shared<EdgeValues>;
  onChange: (value: EdgeValues | null) => void;
  extra?: string[];
  startExpanded?: boolean;
}) {
  const value = current.value;
  const sides = ["top", "right", "bottom", "left"] as const;
  const uniform = value && sides.every((s) => value[s] === value.top) ? value.top : undefined;
  const [expanded, setExpanded] = useState(startExpanded || (value !== undefined && uniform === undefined));
  const set = (side: (typeof sides)[number] | "all", v: StyleValue | null) => {
    const next = side === "all" ? Object.fromEntries(sides.map((s) => [s, v])) : { ...value, [side]: v };
    const clean = Object.fromEntries(Object.entries(next).filter(([, x]) => x !== null && x !== undefined));
    onChange(Object.keys(clean).length > 0 ? clean : null);
  };
  return (
    <>
      <Row label={label}>
        {!expanded && <TokenField label={label} tokens={tokens} group="spacing" value={uniform} mixed={current.mixed} onChange={(v) => set("all", v)} extra={extra} />}
        <button type="button" onClick={() => setExpanded(!expanded)} className="shrink-0 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50" aria-label={`${label} per side`}>
          {expanded ? "Same" : "Sides"}
        </button>
      </Row>
      {expanded &&
        sides.map((side) => (
          <Row key={side} label={`  ${side}`}>
            <TokenField label={`${label} ${side}`} tokens={tokens} group="spacing" value={value?.[side]} mixed={current.mixed} onChange={(v) => set(side, v)} extra={extra} />
          </Row>
        ))}
    </>
  );
}

const BG_POSITIONS: { value: NonNullable<BackgroundImage["position"]>; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top", label: "Top" },
  { value: "top-right", label: "Top right" },
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom", label: "Bottom" },
  { value: "bottom-right", label: "Bottom right" },
];

/** A picture behind the element: add, replace, remove, how it fills and where it sits. */
function BackgroundImageRows({ value, onChange }: { value: BackgroundImage | undefined; onChange: (value: BackgroundImage | null) => void }) {
  const token = useEditor((s) => s.token);
  const choose = async (e: React.MouseEvent) => {
    e.preventDefault(); // inside the row's <label>
    const file = await chooseImageFile();
    if (!file) return;
    try {
      const { src } = await addImageFile(file);
      onChange(value ? { ...value, src } : { src, size: "cover", position: "center", repeat: false });
    } catch (e) {
      notify(`Couldn't add the image: ${(e as Error).message}`, "error");
    }
  };
  if (!value) {
    return (
      <Row label="Image">
        <button type="button" aria-label="Add a background image" onClick={choose} className="rounded border border-dashed border-zinc-300 px-2 py-1 text-xs text-ink-soft hover:border-zinc-400 hover:text-ink">
          Add a background image…
        </button>
      </Row>
    );
  }
  const preview = value.src.startsWith("asset:") ? (token ? assetUrl(token, value.src) : "") : value.src;
  return (
    <>
      <Row label="Image">
        <span className="h-6 w-8 shrink-0 rounded border border-zinc-200 bg-cover bg-center" style={{ backgroundImage: preview ? `url("${preview}")` : undefined }} aria-hidden />
        <Segmented
          label="Background size"
          value={value.size ?? "auto"}
          options={[
            { value: "cover", label: "Fill" },
            { value: "contain", label: "Fit" },
            { value: "auto", label: "Actual" },
          ]}
          onChange={(size) => onChange({ ...value, size })}
        />
        <button type="button" aria-label="Replace background image" title="Replace" onClick={choose} className="rounded px-1 text-xs text-ink-soft hover:bg-zinc-100 hover:text-ink">
          …
        </button>
        <button
          type="button"
          aria-label="Remove background image"
          title="Remove"
          onClick={(e) => {
            e.preventDefault();
            onChange(null);
          }}
          className="rounded px-1 text-xs text-ink-soft hover:bg-red-50 hover:text-red-600"
        >
          ×
        </button>
      </Row>
      <Row label="Position">
        <select
          aria-label="Background position"
          value={value.position ?? "center"}
          onChange={(e) => onChange({ ...value, position: e.target.value as BackgroundImage["position"] })}
          className="min-w-0 flex-1 rounded border border-zinc-200 px-1 py-1 text-xs"
        >
          {BG_POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          <input type="checkbox" checked={value.repeat === true} onChange={(e) => onChange({ ...value, repeat: e.target.checked })} /> Repeat
        </label>
      </Row>
    </>
  );
}
