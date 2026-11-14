import { type Gradient, type GradientStop, type Shadow, type Style, type StylePatch, type StyleValue, type Tokens } from "@appshape/ir";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Plus, X } from "lucide-react";
import { ColorField, Row, Section, Segmented, TextInput, TokenField } from "./Fields";

/** Inspector controls for gradients, shadows, blur and transforms (one element or several). */

interface Shared<T> {
  value: T | undefined;
  mixed: boolean;
}

const num = (raw: string): number | null => {
  const n = Number(raw.trim().replace(/[°%]$/, ""));
  return raw.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** Two colors of the project for a new gradient: its brand scale, or the first colors it has. */
function defaultStops(tokens: Tokens): GradientStop[] {
  const colors = tokens.groups.color ?? {};
  const pick = (...names: string[]) => names.find((n) => colors[n] !== undefined);
  const from = pick("primary-400", "indigo-500", "primary") ?? Object.keys(colors)[0];
  const to = pick("primary-700", "violet-600", "accent-foreground") ?? Object.keys(colors)[1] ?? from;
  return [{ color: from ? `$color.${from}` : "#6366f1" }, { color: to ? `$color.${to}` : "#7c3aed" }];
}

const DIRECTIONS: { value: string; angle: Gradient["angle"]; icon: React.ReactNode; title: string }[] = [
  { value: "0", angle: 0, icon: <ArrowUp size={12} />, title: "To the top" },
  { value: "to-tr", angle: "to-tr", icon: <ArrowUpRight size={12} />, title: "To the top right corner" },
  { value: "90", angle: 90, icon: <ArrowRight size={12} />, title: "To the right" },
  { value: "to-br", angle: "to-br", icon: <ArrowDownRight size={12} />, title: "To the bottom right corner" },
  { value: "180", angle: 180, icon: <ArrowDown size={12} />, title: "Down" },
  { value: "to-bl", angle: "to-bl", icon: <ArrowDownLeft size={12} />, title: "To the bottom left corner" },
  { value: "270", angle: 270, icon: <ArrowLeft size={12} />, title: "To the left" },
  { value: "to-tl", angle: "to-tl", icon: <ArrowUpLeft size={12} />, title: "To the top left corner" },
];
const STOP_LABEL = ["Start", "Middle", "End"];

/** Gradient: none / linear / radial, its direction and 2–3 color stops (drawn over a background image). */
export function GradientRows({ shared, tokens, overImage, onChange }: { shared: Shared<Gradient>; tokens: Tokens; overImage: boolean; onChange: (g: Gradient | null) => void }) {
  const g = shared.value;
  const kind = shared.mixed ? undefined : (g?.type ?? "none");
  const setStop = (i: number, patch: Partial<GradientStop>) => g && onChange({ ...g, stops: g.stops.map((s, j) => (j === i ? clean({ ...s, ...patch }) : s)) });
  const angle = g?.angle ?? 180;
  return (
    <>
      <Row label="Gradient" hint={overImage ? "Drawn over the background image (a tint)" : "A gradient over the fill color"}>
        <Segmented
          label="Gradient"
          value={kind}
          options={[
            { value: "none", label: "None" },
            { value: "linear", label: "Linear" },
            { value: "radial", label: "Radial" },
          ]}
          onChange={(type) => (type === "none" ? onChange(null) : onChange({ ...(g ?? { stops: defaultStops(tokens) }), type }))}
        />
      </Row>
      {g?.type === "linear" && (
        <Row label="Direction">
          <Segmented label="Gradient direction" value={String(angle)} options={DIRECTIONS.map((d) => ({ value: d.value, label: d.icon, title: d.title }))} onChange={(value) => onChange(clean({ ...g, angle: DIRECTIONS.find((d) => d.value === value)!.angle }))} />
          <div className="w-12 shrink-0">
            <TextInput label="Gradient angle" value={typeof angle === "number" ? String(angle) : ""} placeholder="°" onCommit={(raw) => num(raw) !== null && onChange(clean({ ...g, angle: ((num(raw)! % 360) + 360) % 360 }))} />
          </div>
        </Row>
      )}
      {g?.stops.map((stop, i) => (
        <Row key={i} label={g.stops.length === 2 && i === 1 ? "End" : STOP_LABEL[i]!}>
          <ColorField label={`Gradient ${(g.stops.length === 2 && i === 1 ? "End" : STOP_LABEL[i]!).toLowerCase()} color`} tokens={tokens} value={stop.color} onChange={(color) => setStop(i, { color: color ?? "transparent" })} />
          <div className="w-11 shrink-0">
            <TextInput label={`Gradient stop ${i + 1} position`} value={stop.at === undefined ? "" : String(stop.at)} placeholder={i === 0 ? "0%" : i === g.stops.length - 1 ? "100%" : "50%"} onCommit={(raw) => setStop(i, { at: num(raw) ?? undefined })} />
          </div>
          {g.stops.length === 3 && i === 1 ? (
            <button type="button" aria-label="Remove the middle color" title="Remove the middle color" onClick={(e) => (e.preventDefault(), onChange({ ...g, stops: [g.stops[0]!, g.stops[2]!] }))} className="grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
              <X size={12} />
            </button>
          ) : g.stops.length === 2 && i === 0 ? (
            <button type="button" aria-label="Add a middle color" title="Add a middle color" onClick={(e) => (e.preventDefault(), onChange({ ...g, stops: [g.stops[0]!, { color: g.stops[0]!.color }, g.stops[1]!] }))} className="grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
              <Plus size={12} />
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          )}
        </Row>
      ))}
    </>
  );
}

function clean<T extends object>(o: T): T {
  // a downward gradient is the default: no angle
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && !(k === "angle" && v === 180))) as T;
}

/** Text filled with a gradient (the text color becomes transparent). */
export function GradientTextRow({ shared, tokens, onChange }: { shared: Shared<boolean>; tokens: Tokens; onChange: (patch: StylePatch) => void }) {
  return (
    <Row label="Gradient text" hint="The text is filled with the gradient (set it in Style → Gradient)">
      <Segmented
        label="Gradient text"
        value={shared.mixed ? undefined : shared.value ? "on" : "off"}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
        onChange={(v) => onChange(v === "on" ? { backgroundClip: "text", color: "transparent", gradient: { type: "linear", angle: 90, stops: defaultStops(tokens) } } : { backgroundClip: null, color: null, gradient: null })}
      />
    </Row>
  );
}

const BLUR_FALLBACK = ["4px", "8px", "12px", "16px", "24px", "40px"];

/** Shadows (a preset, or a list of custom ones), the shadow's color, blur and backdrop blur. */
export function EffectsSection({ style, tokens, onChange, children }: { style: (get: (s: Partial<Style>) => unknown) => Shared<unknown>; tokens: Tokens; onChange: (patch: StylePatch) => void; children?: React.ReactNode }) {
  const shadow = style((s) => s.shadow) as Shared<Style["shadow"]>;
  const custom = Array.isArray(shadow.value) ? shadow.value : undefined;
  const blurExtra = tokens.groups.blur ? [] : BLUR_FALLBACK;
  const setShadow = (i: number, patch: Partial<Shadow>) => custom && onChange({ shadow: custom.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Section title="Effects">
      {children}
      <Row label="Shadow">
        {custom ? (
          <span className="flex-1 text-xs text-zinc-600">{custom.length} custom shadow{custom.length > 1 ? "s" : ""}</span>
        ) : (
          <TokenField label="Shadow" tokens={tokens} group="shadow" value={shadow.value as StyleValue | undefined} mixed={shadow.mixed} onChange={(v) => onChange({ shadow: v })} extra={["none"]} />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onChange({ shadow: custom ? null : [{ x: 0, y: 8, blur: 24, spread: -6, color: tokens.groups.color?.black !== undefined ? "$color.black/20" : "rgb(0 0 0 / 0.2)" }], shadowColor: null });
          }}
          className="shrink-0 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50"
        >
          {custom ? "Preset" : "Custom"}
        </button>
      </Row>
      {custom?.map((s, i) => (
        <div key={i} className="mb-1 ml-[84px] flex flex-col gap-1 rounded border border-zinc-200 p-1.5 text-xs" role="group" aria-label={`Shadow ${i + 1}`}>
          <div className="flex items-center gap-1">
            {(["x", "y", "blur", "spread"] as const).map((k) => (
              <label key={k} className="flex min-w-0 flex-1 items-center gap-0.5">
                <span className="text-[10px] text-zinc-400">{k === "spread" ? "sp" : k}</span>
                <TextInput label={`Shadow ${i + 1} ${k}`} value={s[k] === undefined ? "" : String(s[k])} onCommit={(raw) => setShadow(i, { [k]: num(raw) ?? (k === "spread" ? undefined : 0) } as Partial<Shadow>)} />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <ColorField label={`Shadow ${i + 1} color`} tokens={tokens} value={s.color} onChange={(color) => setShadow(i, { color: color ?? "transparent" })} />
            <label className="flex items-center gap-1 text-[11px] text-zinc-600">
              <input type="checkbox" checked={s.inset === true} onChange={(e) => setShadow(i, { inset: e.target.checked || undefined })} /> Inner
            </label>
            <button type="button" aria-label={`Remove shadow ${i + 1}`} onClick={() => onChange({ shadow: custom.length > 1 ? custom.filter((_, j) => j !== i) : null })} className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-red-50 hover:text-red-600">
              <X size={12} />
            </button>
          </div>
        </div>
      ))}
      {custom && (
        <button type="button" onClick={() => onChange({ shadow: [...custom, { x: 0, y: 1, blur: 2, color: custom.at(-1)!.color }] })} className="mb-1 ml-[84px] flex items-center gap-1 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50">
          <Plus size={11} /> Add a shadow
        </button>
      )}
      {!custom && shadow.value !== undefined && shadow.value !== "none" && (
        <Row label="Shadow color" hint="Tints the shadow (e.g. a soft black, or the brand color)">
          <ColorField label="Shadow color" tokens={tokens} {...(style((x) => x.shadowColor) as Shared<StyleValue>)} onChange={(shadowColor) => onChange({ shadowColor })} />
        </Row>
      )}
      <Row label="Blur" hint="Blurs the element itself">
        <TokenField label="Blur" tokens={tokens} group="blur" {...(style((x) => x.blur) as Shared<StyleValue>)} onChange={(blur) => onChange({ blur })} extra={blurExtra} />
      </Row>
      <Row label="Backdrop blur" hint="Blurs what is behind the element: frosted glass (with a see-through fill)">
        <TokenField label="Backdrop blur" tokens={tokens} group="blur" {...(style((x) => x.backdropBlur) as Shared<StyleValue>)} onChange={(backdropBlur) => onChange({ backdropBlur })} extra={blurExtra} />
      </Row>
    </Section>
  );
}

/** Rotate, scale, move and skew (also per state: a hover lift is Move y −4 in Hover). */
export function TransformSection({ style, tokens, onChange }: { style: (get: (s: Partial<Style>) => unknown) => Shared<unknown>; tokens: Tokens; onChange: (patch: StylePatch) => void }) {
  const field = (label: string, get: (s: Partial<Style>) => number | undefined, set: (n: number | null) => void, placeholder: string) => {
    const shared = style(get) as Shared<number>;
    return <TextInput label={label} value={shared.value === undefined ? "" : String(shared.value)} placeholder={shared.mixed ? "Mixed" : placeholder} onCommit={(raw) => set(num(raw))} />;
  };
  const translate = style((s) => s.translate) as Shared<NonNullable<Style["translate"]>>;
  const skew = style((s) => s.skew) as Shared<NonNullable<Style["skew"]>>;
  const setTranslate = (axis: "x" | "y", v: StyleValue | null) => {
    const next = { ...translate.value, [axis]: v ?? undefined };
    onChange({ translate: next.x === undefined && next.y === undefined ? null : clean(next) });
  };
  const setSkew = (axis: "x" | "y", n: number | null) => {
    const next = { ...skew.value, [axis]: n ?? undefined };
    onChange({ skew: next.x === undefined && next.y === undefined ? null : clean(next) });
  };
  return (
    <Section title="Transform">
      <Row label="Rotate" hint="Degrees (or drag the round handle above the selection)">
        {field("Rotate", (s) => s.rotate, (n) => onChange({ rotate: n === 0 ? null : n }), "0°")}
        <Segmented label="Rotate by" value={undefined} options={[{ value: "-15", label: "−15°" }, { value: "15", label: "+15°" }]} onChange={(d) => onChange({ rotate: ((style((s) => s.rotate).value as number | undefined) ?? 0) + Number(d) || null })} />
      </Row>
      <Row label="Scale" hint="Percent (100 = actual size)">
        {field("Scale", (s) => s.scale, (n) => onChange({ scale: n === null || n === 100 ? null : n }), "100%")}
      </Row>
      <Row label="Move" hint="Moves it without changing the layout (x, y)">
        <TokenField label="Move x" tokens={tokens} group="spacing" {...(style((s) => s.translate?.x) as Shared<StyleValue>)} onChange={(v) => setTranslate("x", v)} extra={["-50%", "50%"]} />
        <TokenField label="Move y" tokens={tokens} group="spacing" {...(style((s) => s.translate?.y) as Shared<StyleValue>)} onChange={(v) => setTranslate("y", v)} extra={["-0.25rem", "-0.5rem", "-50%", "50%"]} />
      </Row>
      <Row label="Skew" hint="Degrees, x and y">
        {field("Skew x", (s) => s.skew?.x, (n) => setSkew("x", n), "0°")}
        {field("Skew y", (s) => s.skew?.y, (n) => setSkew("y", n), "0°")}
      </Row>
    </Section>
  );
}
