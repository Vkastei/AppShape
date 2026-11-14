import { type DesignNode, type EffectStyle, isContainer, type Op, type Project, resolveToken, type Style, type StylePatch, type StyleValue, type TextStyle, type Tokens } from "@appshape/ir";
import { missingStyleOps } from "@appshape/kit";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { newOpId } from "../lib/board";
import { dispatch, useEditor } from "../store";
import { ColorField, Row, Segmented, TextInput, TokenField } from "./Fields";

/**
 * Named text and effect styles: edited in the design panel (changing H2 changes every H2 on every
 * screen), picked and created in the inspector.
 */

const TEXT_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform"] as const;
const EFFECT_KEYS = ["shadow", "shadowColor", "blur", "backdropBlur"] as const;
const BLUR_FALLBACK = ["4px", "8px", "12px", "16px", "24px", "40px"];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "style";
function uniqueId(name: string, taken: Record<string, unknown> | undefined): string {
  const base = slug(name);
  let id = base;
  for (let i = 2; taken?.[id]; i++) id = `${base}-${i}`;
  return id;
}

/** How many elements (on all screens and components) use a named style. */
export function styleUses(project: Project, kind: "textStyle" | "effectStyle", id: string): number {
  let count = 0;
  const visit = (n: DesignNode) => {
    if (n.style?.[kind] === id) count++;
    if (isContainer(n)) n.children.forEach(visit);
  };
  for (const f of project.frames) visit(f.current);
  return count;
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
const css = (tokens: Tokens, v: StyleValue | undefined, px = true) => (v === undefined ? undefined : typeof v === "number" ? (px ? `${v}px` : String(v)) : String(resolveToken(tokens, v) ?? v));

// ── design panel ──────────────────────────────────────────────────────────

export function TextStylesEditor() {
  const project = useEditor((s) => s.project)!;
  const tokens = project.tokens;
  const styles = tokens.textStyles ?? {};
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string>();
  const set = (id: string, value: TextStyle | null) => dispatch([{ id: newOpId(), op: "setTextStyle", style: id, value }]);
  return (
    <section className="border-t border-zinc-100 px-3 py-1.5" aria-label="Text styles">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 py-1 text-xs font-semibold text-zinc-700">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Text styles
        <span className="ml-auto font-normal text-zinc-400">{Object.keys(styles).length}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 pb-1">
          {Object.keys(styles).length === 0 && <MissingDefaults tokens={tokens} />}
          {Object.entries(styles).map(([id, s]) => (
            <div key={id}>
              <button type="button" onClick={() => setEditing(editing === id ? undefined : id)} aria-expanded={editing === id} aria-label={`Text style ${s.name}`} className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-zinc-50">
                <span
                  className="min-w-0 flex-1 truncate text-ink"
                  style={{
                    fontFamily: css(tokens, s.fontFamily, false),
                    fontSize: `min(${css(tokens, s.fontSize) ?? "1rem"}, 26px)`,
                    fontWeight: css(tokens, s.fontWeight, false) as never,
                    letterSpacing: css(tokens, s.letterSpacing),
                    textTransform: s.textTransform as never,
                    lineHeight: 1.2,
                  }}
                >
                  {s.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-400">{[s.fontSize, ...Object.values(s.sizes ?? {}).map((p) => p.fontSize)].filter(Boolean).map((v) => String(v).replace(/^\$\w+\./, "")).join(" → ")}</span>
              </button>
              {editing === id && <TextStyleFields id={id} style={s} tokens={tokens} onChange={(v) => set(id, v)} uses={styleUses(project, "textStyle", id)} />}
            </div>
          ))}
          <NewStyle label="New text style" onCreate={(name) => set(uniqueId(name, styles), { name, fontSize: tokens.groups.fontSize?.base !== undefined ? "$fontSize.base" : 16 })} />
        </div>
      )}
    </section>
  );
}

function TextStyleFields({ id, style, tokens, onChange, uses }: { id: string; style: TextStyle; tokens: Tokens; onChange: (v: TextStyle | null) => void; uses: number }) {
  const set = (patch: Partial<TextStyle>) => onChange(clean({ ...style, ...patch }) as TextStyle);
  const setSize = (bp: string, fontSize: StyleValue | null) => {
    const sizes = { ...style.sizes };
    if (fontSize === null) {
      const { fontSize: _f, ...rest } = sizes[bp] ?? {};
      if (Object.keys(rest).length) sizes[bp] = rest;
      else delete sizes[bp];
    } else sizes[bp] = { ...sizes[bp], fontSize };
    set({ sizes: Object.keys(sizes).length ? sizes : undefined });
  };
  return (
    <div className="mb-1 ml-1 flex flex-col border-l-2 border-accent-200 pl-2" role="group" aria-label={`Edit text style ${style.name}`}>
      <Row label="Name">
        <TextInput label="Style name" value={style.name} onCommit={(name) => name.trim() && set({ name: name.trim() })} />
      </Row>
      <Row label="Font">
        <TokenField label="Style font" tokens={tokens} group="fontFamily" value={style.fontFamily} onChange={(v) => set({ fontFamily: v ?? undefined })} />
      </Row>
      <Row label="Size" hint="On phones (the base size)">
        <TokenField label="Style size" tokens={tokens} group="fontSize" value={style.fontSize} onChange={(v) => set({ fontSize: v ?? undefined })} />
      </Row>
      {(["md", "lg"] as const).map((bp) => (
        <Row key={bp} label={bp === "md" ? "  Tablets up" : "  Desktops up"} hint={`From ${bp} up: a larger size (empty: as on smaller screens)`}>
          <TokenField label={`Style size ${bp}`} tokens={tokens} group="fontSize" value={style.sizes?.[bp]?.fontSize} onChange={(v) => setSize(bp, v)} />
        </Row>
      ))}
      <Row label="Weight">
        <TokenField label="Style weight" tokens={tokens} group="fontWeight" value={style.fontWeight} onChange={(v) => set({ fontWeight: v ?? undefined })} />
      </Row>
      <Row label="Line height">
        <TokenField label="Style line height" tokens={tokens} group="lineHeight" value={style.lineHeight} onChange={(v) => set({ lineHeight: v ?? undefined })} />
      </Row>
      <Row label="Letter spacing">
        <TokenField label="Style letter spacing" tokens={tokens} group="letterSpacing" value={style.letterSpacing} onChange={(v) => set({ letterSpacing: v ?? undefined })} />
      </Row>
      <Row label="Case">
        <Segmented
          label="Style case"
          value={style.textTransform ?? "none"}
          options={[
            { value: "none", label: "Aa" },
            { value: "uppercase", label: "AA" },
            { value: "lowercase", label: "aa" },
          ]}
          onChange={(v) => set({ textTransform: v === "none" ? undefined : v })}
        />
      </Row>
      <StyleFooter id={id} kind="text" uses={uses} onDelete={() => onChange(null)} />
    </div>
  );
}

export function EffectStylesEditor() {
  const project = useEditor((s) => s.project)!;
  const tokens = project.tokens;
  const styles = tokens.effectStyles ?? {};
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const set = (id: string, value: EffectStyle | null) => dispatch([{ id: newOpId(), op: "setEffectStyle", style: id, value }]);
  return (
    <section className="border-t border-zinc-100 px-3 py-1.5" aria-label="Effect styles">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 py-1 text-xs font-semibold text-zinc-700">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Effect styles
        <span className="ml-auto font-normal text-zinc-400">{Object.keys(styles).length}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 pb-1">
          {Object.keys(styles).length === 0 && <MissingDefaults tokens={tokens} />}
          {Object.entries(styles).map(([id, e]) => (
            <div key={id}>
              <button type="button" onClick={() => setEditing(editing === id ? undefined : id)} aria-expanded={editing === id} aria-label={`Effect style ${e.name}`} className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-xs hover:bg-zinc-50">
                <span className="h-5 w-8 shrink-0 rounded bg-white" style={{ boxShadow: css(tokens, e.shadow, false), border: "1px solid rgb(0 0 0 / 0.06)" }} />
                <span className="min-w-0 flex-1 truncate text-ink">{e.name}</span>
              </button>
              {editing === id && <EffectStyleFields id={id} style={e} tokens={tokens} onChange={(v) => set(id, v)} uses={styleUses(project, "effectStyle", id)} />}
            </div>
          ))}
          <NewStyle label="New effect style" onCreate={(name) => set(uniqueId(name, styles), { name, shadow: tokens.groups.shadow?.md !== undefined ? "$shadow.md" : "0 4px 6px rgb(0 0 0 / 0.1)" })} />
        </div>
      )}
    </section>
  );
}

function EffectStyleFields({ id, style, tokens, onChange, uses }: { id: string; style: EffectStyle; tokens: Tokens; onChange: (v: EffectStyle | null) => void; uses: number }) {
  const set = (patch: Partial<EffectStyle>) => onChange(clean({ ...style, ...patch }) as EffectStyle);
  const blurExtra = tokens.groups.blur ? [] : BLUR_FALLBACK;
  return (
    <div className="mb-1 ml-1 flex flex-col border-l-2 border-accent-200 pl-2" role="group" aria-label={`Edit effect style ${style.name}`}>
      <Row label="Name">
        <TextInput label="Style name" value={style.name} onCommit={(name) => name.trim() && set({ name: name.trim() })} />
      </Row>
      <Row label="Shadow">
        <TokenField label="Style shadow" tokens={tokens} group="shadow" value={style.shadow} onChange={(v) => set({ shadow: v ?? undefined })} extra={["none"]} />
      </Row>
      <Row label="Shadow color">
        <ColorField label="Style shadow color" tokens={tokens} value={style.shadowColor} onChange={(v) => set({ shadowColor: v ?? undefined })} />
      </Row>
      <Row label="Blur">
        <TokenField label="Style blur" tokens={tokens} group="blur" value={style.blur} onChange={(v) => set({ blur: v ?? undefined })} extra={blurExtra} />
      </Row>
      <Row label="Backdrop blur">
        <TokenField label="Style backdrop blur" tokens={tokens} group="blur" value={style.backdropBlur} onChange={(v) => set({ backdropBlur: v ?? undefined })} extra={blurExtra} />
      </Row>
      <StyleFooter id={id} kind="effect" uses={uses} onDelete={() => onChange(null)} />
    </div>
  );
}

function StyleFooter({ id, kind, uses, onDelete }: { id: string; kind: "text" | "effect"; uses: number; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] text-zinc-500">
      <span className="font-mono">{kind === "text" ? "type" : "effect"}-{id}</span>
      <span>· used by {uses} element{uses === 1 ? "" : "s"}</span>
      <button
        type="button"
        disabled={uses > 0}
        title={uses > 0 ? "Elements use this style: pick another style for them first" : "Delete the style"}
        aria-label="Delete style"
        onClick={onDelete}
        className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function NewStyle({ label, onCreate }: { label: string; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="mt-1 flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <TextInput label={label} value={name} placeholder={label} onCommit={setName} />
      </div>
      <button
        type="button"
        aria-label={`Add ${label.toLowerCase()}`}
        onClick={() => {
          if (!name.trim()) return;
          onCreate(name.trim());
          setName("");
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-accent-700 hover:bg-accent-50"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function MissingDefaults({ tokens }: { tokens: Tokens }) {
  return (
    <button
      type="button"
      onClick={() => dispatch(missingStyleOps(tokens))}
      className="mb-1 rounded border border-dashed border-zinc-300 px-2 py-1.5 text-left text-xs text-zinc-600 hover:border-accent-400 hover:text-accent-700"
    >
      Add the default styles (Display, H1–H4, Body, Small, Caption; Card, Raised, Overlay, Glass)
    </button>
  );
}

// ── inspector ─────────────────────────────────────────────────────────────

interface Target {
  frameId: string;
  node: DesignNode;
}

/** Ops that make elements use a style: their own values for what the style sets go (also per screen size). */
function useStyleOps(targets: readonly Target[], kind: "textStyle" | "effectStyle", id: string | null): Op[] {
  const keys = kind === "textStyle" ? TEXT_KEYS : EFFECT_KEYS;
  const cleared = Object.fromEntries(keys.map((k) => [k, null])) as StylePatch;
  return targets.flatMap(({ frameId, node }) => [
    { id: newOpId(), frameId, nodeId: node.id, op: "restyle" as const, style: { [kind]: id, ...(id && cleared) } },
    ...(id
      ? (node.overrides ?? [])
          .filter((o) => o.when.viewport && !o.when.state && !o.when.scheme && !o.when.prop && o.style && keys.some((k) => k in o.style!))
          .map((o) => ({ id: newOpId(), frameId, nodeId: node.id, op: "restyle" as const, when: o.when, style: Object.fromEntries(keys.filter((k) => k in o.style!).map((k) => [k, null])) as StylePatch }))
      : []),
  ]);
}

/** A style made from an element's own values (base, and font sizes per screen size). */
function styleFrom(node: DesignNode, kind: "textStyle" | "effectStyle", name: string): TextStyle | EffectStyle {
  const s = node.style ?? {};
  if (kind === "effectStyle") return clean({ name, shadow: typeof s.shadow === "object" ? undefined : s.shadow, shadowColor: s.shadowColor, blur: s.blur, backdropBlur: s.backdropBlur }) as EffectStyle;
  const sizes: NonNullable<TextStyle["sizes"]> = {};
  for (const o of node.overrides ?? []) {
    if (!o.when.viewport || o.when.state || o.when.scheme || o.when.prop || !o.style) continue;
    const part = clean({ fontSize: o.style.fontSize, lineHeight: o.style.lineHeight, letterSpacing: o.style.letterSpacing, fontWeight: o.style.fontWeight });
    if (Object.keys(part).length) sizes[o.when.viewport] = part;
  }
  return clean({ name, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform === "none" ? undefined : s.textTransform, sizes: Object.keys(sizes).length ? sizes : undefined }) as TextStyle;
}

/** Inspector row: the named style an element uses, its own changes, and "Save as style". */
export function StylePicker({ kind, targets, tokens, onSend }: { kind: "textStyle" | "effectStyle"; targets: readonly Target[]; tokens: Tokens; onSend: (ops: Op[]) => void }) {
  const styles = (kind === "textStyle" ? tokens.textStyles : tokens.effectStyles) ?? {};
  const keys: readonly string[] = kind === "textStyle" ? TEXT_KEYS : EFFECT_KEYS;
  const ids = new Set(targets.map((t) => t.node.style?.[kind] ?? ""));
  const current = ids.size === 1 ? [...ids][0]! : undefined;
  const own = targets.some((t) => keys.some((k) => t.node.style?.[k as keyof Style] !== undefined));
  const [saving, setSaving] = useState(false);
  const label = kind === "textStyle" ? "Text style" : "Effect style";
  return (
    <>
      <Row label={label} hint={kind === "textStyle" ? "A named style of the design system (H1, Body …): change it once, every element using it follows" : "A named shadow and blur of the design system"}>
        <select
          aria-label={label}
          value={current === undefined ? "mixed" : current}
          onChange={(e) => e.target.value !== "mixed" && onSend(useStyleOps(targets, kind, e.target.value || null))}
          className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
        >
          {current === undefined && <option value="mixed">Mixed</option>}
          <option value="">None</option>
          {Object.entries(styles).map(([id, s]) => (
            <option key={id} value={id}>
              {s.name}
            </option>
          ))}
        </select>
        {targets.length === 1 && (
          <button type="button" aria-label={`Save as ${label.toLowerCase()}`} title={`Save these values as a new ${label.toLowerCase()}`} onClick={(e) => (e.preventDefault(), setSaving(!saving))} className="shrink-0 rounded px-1 text-[11px] text-accent-700 hover:bg-accent-50">
            Save…
          </button>
        )}
      </Row>
      {current && own && (
        <div className="ml-[84px] flex items-center gap-1 pb-1 text-[11px] text-zinc-500">
          <span className="flex-1">Changed here: {keys.filter((k) => targets.some((t) => t.node.style?.[k as keyof Style] !== undefined)).join(", ")}</span>
          <button type="button" onClick={() => onSend(useStyleOps(targets, kind, current))} className="rounded px-1 text-accent-700 hover:bg-accent-50">
            Use the style's values
          </button>
        </div>
      )}
      {saving && targets.length === 1 && (
        <div className="ml-[84px] pb-1">
          <TextInput
            label={`New ${label.toLowerCase()} name`}
            value=""
            placeholder="Name, e.g. Card title"
            onCommit={(name) => {
              setSaving(false);
              if (!name.trim()) return;
              const t = targets[0]!;
              const id = uniqueId(name.trim(), styles);
              const value = styleFrom(t.node, kind, name.trim());
              onSend([{ id: newOpId(), op: kind === "textStyle" ? "setTextStyle" : "setEffectStyle", style: id, value } as never, ...useStyleOps(targets, kind, id)]);
            }}
          />
        </div>
      )}
    </>
  );
}
