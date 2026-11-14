import { BLEND_MODES, type Corners, type Edges, type Style, type StylePatch, type StyleValue, type Tokens } from "@appshape/ir";
import { useState } from "react";
import { ColorField, Row, TokenField } from "./Fields";

/** Inspector controls for borders (per side), corners (per corner) and blending. */

interface Shared<T> {
  value: T | undefined;
  mixed: boolean;
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = [
  ["topLeft", "Top left"],
  ["topRight", "Top right"],
  ["bottomRight", "Bottom right"],
  ["bottomLeft", "Bottom left"],
] as const;
const WIDTHS = [1, 2, 4, 8];

function WidthSelect({ label, value, mixed, onChange }: { label: string; value: StyleValue | undefined; mixed?: boolean; onChange: (v: number | null) => void }) {
  return (
    <select
      aria-label={label}
      value={mixed ? "mixed" : String(value ?? "")}
      onChange={(e) => e.target.value !== "mixed" && onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-14 shrink-0 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
    >
      <option value="mixed" hidden>
        Mixed
      </option>
      <option value="">0</option>
      {[...new Set([...WIDTHS, ...(typeof value === "number" && !WIDTHS.includes(value) ? [value] : [])])].map((w) => (
        <option key={w} value={w}>
          {w}px
        </option>
      ))}
    </select>
  );
}

/** Border: one width for all sides, or per side (a line only at the bottom); one color. */
export function BorderRows({ style, tokens, onChange }: { style: (get: (s: Partial<Style>) => unknown) => Shared<unknown>; tokens: Tokens; onChange: (patch: StylePatch) => void }) {
  const width = style((s) => s.borderWidth) as Shared<Style["borderWidth"]>;
  const perSide = typeof width.value === "object" ? (width.value as Edges) : undefined;
  const [expanded, setExpanded] = useState(perSide !== undefined);
  const setSide = (side: (typeof SIDES)[number], v: number | null) => {
    const base: Edges = perSide ?? (width.value !== undefined ? Object.fromEntries(SIDES.map((s) => [s, width.value as StyleValue])) : {});
    const next = Object.fromEntries(Object.entries({ ...base, [side]: v ?? undefined }).filter(([, x]) => x !== undefined && x !== 0)) as Edges;
    const values = SIDES.map((s) => next[s]);
    onChange({ borderWidth: values.every((x) => x === undefined) ? null : values.every((x) => x === values[0]) ? values[0]! : next });
  };
  return (
    <>
      <Row label="Border">
        {!expanded && <WidthSelect label="Border width" value={perSide ? undefined : (width.value as StyleValue | undefined)} mixed={width.mixed || perSide !== undefined} onChange={(v) => onChange({ borderWidth: v })} />}
        <ColorField label="Border color" tokens={tokens} {...(style((s) => s.borderColor) as Shared<StyleValue>)} onChange={(borderColor) => onChange({ borderColor })} />
        <button type="button" aria-label="Border per side" onClick={(e) => (e.preventDefault(), setExpanded(!expanded))} className="shrink-0 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50">
          {expanded ? "Same" : "Sides"}
        </button>
      </Row>
      {expanded && (
        <div className="ml-[84px] grid grid-cols-2 gap-1 pb-1 text-[11px]">
          {SIDES.map((side) => (
            <label key={side} className="flex items-center gap-1">
              <span className="w-10 text-zinc-500">{side}</span>
              <WidthSelect label={`Border ${side}`} value={perSide ? perSide[side] : (width.value as StyleValue | undefined)} onChange={(v) => setSide(side, v)} />
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/** Radius: one for all corners, or per corner (a tab rounded only at the top). */
export function RadiusRows({ style, tokens, onChange }: { style: (get: (s: Partial<Style>) => unknown) => Shared<unknown>; tokens: Tokens; onChange: (patch: StylePatch) => void }) {
  const radius = style((s) => s.radius) as Shared<Style["radius"]>;
  const perCorner = typeof radius.value === "object" ? (radius.value as Corners) : undefined;
  const [expanded, setExpanded] = useState(perCorner !== undefined);
  const setCorner = (corner: (typeof CORNERS)[number][0], v: StyleValue | null) => {
    const base: Corners = perCorner ?? (radius.value !== undefined ? Object.fromEntries(CORNERS.map(([c]) => [c, radius.value as StyleValue])) : {});
    const next = Object.fromEntries(Object.entries({ ...base, [corner]: v ?? undefined }).filter(([, x]) => x !== undefined)) as Corners;
    const values = CORNERS.map(([c]) => next[c]);
    onChange({ radius: values.every((x) => x === undefined) ? null : values.every((x) => x === values[0]) ? values[0]! : next });
  };
  return (
    <>
      <Row label="Radius">
        {expanded ? (
          <span className="flex-1 text-xs text-zinc-500">Per corner</span>
        ) : (
          <TokenField label="Radius" tokens={tokens} group="radius" value={perCorner ? undefined : (radius.value as StyleValue | undefined)} mixed={radius.mixed} onChange={(v) => onChange({ radius: v })} />
        )}
        <button type="button" aria-label="Radius per corner" onClick={(e) => (e.preventDefault(), setExpanded(!expanded))} className="shrink-0 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50">
          {expanded ? "Same" : "Corners"}
        </button>
      </Row>
      {expanded &&
        CORNERS.map(([corner, label]) => (
          <Row key={corner} label={`  ${label}`}>
            <TokenField label={`Radius ${label.toLowerCase()}`} tokens={tokens} group="radius" value={perCorner ? perCorner[corner] : (radius.value as StyleValue | undefined)} onChange={(v) => setCorner(corner, v)} />
          </Row>
        ))}
    </>
  );
}

const BLEND_LABEL: Record<string, string> = { normal: "Normal", "color-dodge": "Color dodge", "color-burn": "Color burn", "hard-light": "Hard light", "soft-light": "Soft light", "plus-darker": "Plus darker", "plus-lighter": "Plus lighter" };
const label = (m: string) => BLEND_LABEL[m] ?? m[0]!.toUpperCase() + m.slice(1);

function BlendSelect({ aria, shared, onChange }: { aria: string; shared: Shared<string>; onChange: (v: string | null) => void }) {
  return (
    <select aria-label={aria} value={shared.mixed ? "mixed" : (shared.value ?? "")} onChange={(e) => e.target.value !== "mixed" && onChange(e.target.value || null)} className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs">
      {shared.mixed && <option value="mixed">Mixed</option>}
      <option value="">Normal</option>
      {BLEND_MODES.filter((m) => m !== "normal").map((m) => (
        <option key={m} value={m}>
          {label(m)}
        </option>
      ))}
    </select>
  );
}

/** Blending: the element with what is behind it; its background picture with its fill and gradient. */
export function BlendRows({ style, hasImage, onChange }: { style: (get: (s: Partial<Style>) => unknown) => Shared<unknown>; hasImage: boolean; onChange: (patch: StylePatch) => void }) {
  return (
    <>
      <Row label="Blend" hint="How the element mixes with what is behind it (e.g. Multiply for a logo on a photo)">
        <BlendSelect aria="Blend mode" shared={style((s) => s.blendMode) as Shared<string>} onChange={(v) => onChange({ blendMode: v as Style["blendMode"] | null })} />
      </Row>
      {hasImage && (
        <Row label="Image blend" hint="How the background picture mixes with the fill color and the gradient (a duotone photo)">
          <BlendSelect aria="Background image blend mode" shared={style((s) => s.backgroundBlendMode) as Shared<string>} onChange={(v) => onChange({ backgroundBlendMode: v as Style["backgroundBlendMode"] | null })} />
        </Row>
      )}
    </>
  );
}
