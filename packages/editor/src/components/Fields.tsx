import { parseTokenRef, resolveToken, type StyleValue, type TokenGroup, type Tokens } from "@appshape/ir";
import { useEffect, useRef, useState } from "react";

/** Small form controls for the inspector. Values are IR style values (token refs or raw). */

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[76px_1fr] items-center gap-2 py-1 text-xs">
      <span className="truncate text-zinc-500" title={hint ?? label}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b border-zinc-200 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 rounded-md bg-zinc-100 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title ?? (typeof o.label === "string" ? o.label : o.value)}
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-[11px] ${value === o.value ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text input that commits on blur / Enter. */
export function TextInput({
  value,
  onCommit,
  placeholder,
  multiline,
  label,
}: {
  value: string | undefined;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  label?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    if (draft !== (value ?? "")) onCommit(draft);
  };
  const props = {
    value: draft,
    placeholder,
    "aria-label": label,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) (e.target as HTMLElement).blur();
      if (e.key === "Escape") {
        setDraft(value ?? "");
        (e.target as HTMLElement).blur();
      }
    },
    className: "w-full min-w-0 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs outline-none focus:border-accent-500",
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

function tokenNames(tokens: Tokens, group: TokenGroup): string[] {
  const names = Object.keys(tokens.groups[group] ?? {});
  const numeric = (n: string) => (/^[0-9.]+$/.test(n) ? Number(n) : Number.NaN);
  const sizeOrder = ["3xs", "2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
  return names.sort((a, b) => {
    const [na, nb] = [numeric(a), numeric(b)];
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    const [sa, sb] = [sizeOrder.indexOf(a), sizeOrder.indexOf(b)];
    if (sa >= 0 && sb >= 0) return sa - sb;
    return a.localeCompare(b);
  });
}

const CUSTOM = "__custom";
const MIXED = "__mixed";

/** Pick a design-system token of `group`, or enter a custom value. */
export function TokenField({
  tokens,
  group,
  value,
  onChange,
  label,
  extra = [],
  mixed = false,
}: {
  tokens: Tokens;
  group: TokenGroup;
  value: StyleValue | undefined;
  onChange: (value: StyleValue | null) => void;
  label?: string;
  /** Additional raw choices, e.g. "auto". */
  extra?: string[];
  /** Several elements with different values are edited. */
  mixed?: boolean;
}) {
  const ref = typeof value === "string" ? parseTokenRef(value) : undefined;
  const isToken = ref?.group === group;
  const [custom, setCustom] = useState(false);
  const selectValue = mixed ? MIXED : value === undefined ? "" : isToken ? ref!.name : extra.includes(String(value)) ? `raw:${value}` : CUSTOM;
  const showCustom = custom || selectValue === CUSTOM;
  return (
    <>
      <select
        aria-label={label}
        value={showCustom ? CUSTOM : selectValue}
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === CUSTOM);
          if (v === MIXED) return;
          if (v === "") onChange(null);
          else if (v.startsWith("raw:")) onChange(v.slice(4));
          else if (v !== CUSTOM) onChange(`$${group}.${v}`);
        }}
        className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-1 text-xs"
      >
        {mixed && <option value={MIXED}>Mixed</option>}
        <option value="">—</option>
        {extra.map((x) => (
          <option key={x} value={`raw:${x}`}>
            {x}
          </option>
        ))}
        {tokenNames(tokens, group).map((name) => (
          <option key={name} value={name}>
            {name} · {String(tokens.groups[group]![name]).slice(0, 24)}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {showCustom && (
        <div className="w-20 shrink-0">
          <TextInput label={label && `${label} (custom)`} value={isToken || value === undefined ? "" : String(value)} placeholder="e.g. 12px" onCommit={(v) => onChange(v.trim() ? v.trim() : null)} />
        </div>
      )}
    </>
  );
}

/** Color swatch picker over the design system's colors, plus custom colors. */
export function ColorField({
  tokens,
  value,
  onChange,
  label,
  mixed = false,
}: {
  tokens: Tokens;
  value: StyleValue | undefined;
  onChange: (value: StyleValue | null) => void;
  label: string;
  /** Several elements with different values are edited. */
  mixed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const resolved = value === undefined ? undefined : typeof value === "string" && value.startsWith("$") ? resolveToken(tokens, value) : value;
  const name = mixed ? "Mixed" : typeof value === "string" && value.startsWith("$color.") ? value.slice(7) : value === undefined ? "None" : String(value);
  const colors = tokenNames(tokens, "color");
  // a design-system color, optionally see-through (`$color.white/10`)
  const tokenMatch = typeof value === "string" && !mixed ? /^\$color\.([^/]+)(?:\/(\d+(?:\.\d+)?))?$/.exec(value) : null;
  const token = tokenMatch?.[1];
  const alpha = tokenMatch?.[2] !== undefined ? Number(tokenMatch[2]) : undefined;
  const families = new Map<string, string[]>();
  for (const c of colors) {
    const family = /^(.*)-\d+$/.exec(c)?.[1] ?? "base";
    families.set(family, [...(families.get(family) ?? []), c]);
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded border border-zinc-200 bg-white px-1.5 py-1 text-left text-xs"
      >
        <span className="h-4 w-4 shrink-0 rounded border border-zinc-300" style={{ background: resolved === undefined || mixed ? "repeating-linear-gradient(45deg,#fff 0 3px,#e4e4e7 3px 6px)" : String(resolved) }} />
        <span className="truncate">{name}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded-lg border border-ink bg-white shadow-offset-sm p-2" role="dialog" aria-label={`${label} colors`}>
          <button type="button" onClick={() => (onChange(null), setOpen(false))} className="mb-1 w-full rounded px-1 py-0.5 text-left text-xs text-zinc-600 hover:bg-zinc-100">
            None
          </button>
          {[...families].map(([family, names]) => (
            <div key={family} className="mb-1 flex items-center gap-1">
              <span className="w-12 shrink-0 truncate text-[10px] text-zinc-500">{family}</span>
              <div className="flex flex-wrap gap-0.5">
                {names.map((n) => (
                  <button
                    key={n}
                    type="button"
                    title={n}
                    aria-label={n}
                    onClick={() => (onChange(`$color.${n}${alpha !== undefined ? `/${alpha}` : ""}`), setOpen(false))}
                    className={`h-4 w-4 rounded-sm border ${token === n ? "ring-2 ring-accent-500" : "border-black/10"}`}
                    style={{ background: String(tokens.groups.color![n]) }}
                  />
                ))}
              </div>
            </div>
          ))}
          {token && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                aria-label={`${label} opacity`}
                value={alpha ?? 100}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(`$color.${token}${n < 100 ? `/${n}` : ""}`);
                }}
                className="min-w-0 flex-1 accent-[var(--color-accent-600)]"
              />
              <span className="w-9 text-right tabular-nums text-zinc-600">{alpha ?? 100}%</span>
            </div>
          )}
          <div className="mt-2">
            <TextInput label={`${label} custom`} value={typeof value === "string" && !value.startsWith("$") ? value : ""} placeholder="Custom, e.g. #1e293b" onCommit={(v) => onChange(v.trim() || null)} />
          </div>
        </div>
      )}
    </div>
  );
}
