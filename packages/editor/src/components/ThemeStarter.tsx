import { applyTokenOps, componentSources, isTokenOp, themedTokens } from "@appshape/ir";
import {
  BRAND_PRESETS,
  DENSITIES,
  FONT_PAIRS,
  generateTheme,
  inferThemeOptions,
  parseColor,
  rgbToOklch,
  SHAPES,
  type ThemeOptions,
  themePreview,
  toHex,
} from "@appshape/kit";
import { Check, Loader2, Monitor, Moon, Smartphone, Sun, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../lib/api";
import { previewFamily } from "../lib/fonts";
import { applyTheme, resetScreenTheme, screenThemeTarget, themeChangeOps, tokensFor } from "../lib/theme";
import { notify, useEditor } from "../store";
import { FrameView } from "./FrameView";

const TINTS: { id: ThemeOptions["tint"]; label: string }[] = [
  { id: "none", label: "None" },
  { id: "subtle", label: "Subtle" },
  { id: "strong", label: "Strong" },
];
const SYSTEM_FONT = "ui-sans-serif, system-ui, sans-serif";

/** A row of choices (radio buttons). */
function Choices<T extends string>({ label, value, options, onChange, render }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; render?: (id: T) => React.ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-zinc-300 bg-white p-0.5 text-[13px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 ${value === o.id ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
        >
          {render?.(o.id)}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {hint && <p className="text-[12px] leading-snug text-ink-soft">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The theme starter: a brand color, a gray tint, a font pair, a shape and a density make the whole
 * design system (colors for light and dark mode included). The preview is a small page built from
 * the starter components, so every choice shows on real UI before it is applied.
 */
export function ThemeStarter({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const token = useEditor((s) => s.token)!;
  const boardScheme = useEditor((s) => s.scheme);
  // a screen it can apply to: the one it was opened for, else the selected screen
  const screen = useEditor((s) => {
    const item = s.project?.board.items.find((i) => i.id === s.selection[0]);
    const id = s.themeScreen ?? s.node?.frameId ?? (item?.type === "frame" ? item.frameId : undefined);
    const frame = s.project?.frames.find((f) => f.id === id);
    return frame && frame.kind !== "component" ? frame : undefined;
  });
  const [target, setTarget] = useState<"project" | "screen">(() => (useEditor.getState().themeScreen ? "screen" : "project"));
  const frame = target === "screen" ? screen : undefined;
  const [options, setOptions] = useState<ThemeOptions>(() => inferThemeOptions(tokensFor(project.tokens, frame)));
  const [brandText, setBrandText] = useState(options.brand);
  const [scheme, setScheme] = useState<"light" | "dark">(boardScheme);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<ThemeOptions>) => setOptions((o) => ({ ...o, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  // the pairs' fonts, for their buttons; the chosen pair in more weights for the preview
  const [fontState, setFontState] = useState<Record<string, "loading" | "ready" | "failed">>({});
  useEffect(() => {
    for (const pair of FONT_PAIRS) {
      if (!pair.heading) continue;
      setFontState((s) => ({ ...s, [pair.id]: "loading" }));
      void Promise.all([previewFamily(pair.heading, [700]), ...(pair.body ? [previewFamily(pair.body, [400])] : [])]).then((ok) =>
        setFontState((s) => ({ ...s, [pair.id]: ok.every(Boolean) ? "ready" : "failed" })),
      );
    }
  }, []);
  useEffect(() => {
    const pair = FONT_PAIRS.find((p) => p.id === options.fonts);
    if (pair?.heading) void previewFamily(pair.heading, [400, 600, 700]);
    if (pair?.body) void previewFamily(pair.body, [400, 500, 600, 700]);
  }, [options.fonts]);

  const preview = useMemo(() => themePreview(options.brand), [options.brand]);
  const sources = useMemo(() => componentSources(preview.frames), [preview]);
  const tokens = useMemo(() => {
    const ops = themeChangeOps(project, generateTheme(options), frame).filter(isTokenOp);
    return frame ? themedTokens(applyTokenOps(project.tokens, ops), screenThemeTarget(project, frame).id) : applyTokenOps(project.tokens, ops);
  }, [project, options, frame]);
  const resolveAsset = useCallback((src: string) => assetUrl(token, src), [token]);

  // the preview page scaled to the space it has
  const width = device === "desktop" ? 1100 : 390;
  const stage = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(700);
  const [height, setHeight] = useState(800);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth - 32));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, available / width);

  const commitBrand = (value: string) => {
    const color = parseColor(value);
    if (!color) {
      setBrandText(options.brand);
      return;
    }
    const hex = toHex(rgbToOklch(color));
    setBrandText(hex);
    set({ brand: hex });
  };

  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await applyTheme(options, frame?.id);
      notify(frame ? `Theme applied to ${frame.name}; the other screens keep the project's theme. Ctrl+Z undoes it.` : "Theme applied: every screen and component uses it now. Ctrl+Z undoes it.");
      onClose();
    } catch (e) {
      setError(`${(e as Error).message} Pick “System” fonts to work without downloads, or try again.`);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label="Theme starter" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="flex h-[min(780px,calc(100vh-3rem))] w-full max-w-6xl flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <div className="flex-1">
            <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink">Theme starter</h2>
            <p className="text-[12px] text-ink-soft">Five choices make the whole design system, for light and dark mode. Change it any time.</p>
          </div>
          <button type="button" aria-label="Close theme starter" onClick={onClose} disabled={busy} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
            <X size={16} />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
          <div className="min-h-0 space-y-5 overflow-y-auto border-r border-zinc-200 p-4">
            {screen && (
              <Group title="Apply to" hint={target === "screen" ? `Only ${screen.name} gets this theme; the other screens keep the project's.` : "Every screen and component."}>
                <Choices
                  label="Apply to"
                  value={target}
                  options={[
                    { id: "project", label: "Whole project" },
                    { id: "screen", label: `Only ${screen.name}` },
                  ]}
                  onChange={(next) => {
                    setTarget(next);
                    const inferred = inferThemeOptions(tokensFor(project.tokens, next === "screen" ? screen : undefined));
                    setOptions(inferred);
                    setBrandText(inferred.brand);
                  }}
                />
                {target === "screen" && screen.theme && (
                  <button
                    type="button"
                    onClick={() => {
                      resetScreenTheme(screen.id);
                      onClose();
                    }}
                    className="text-[12px] text-ink-soft underline hover:text-ink"
                  >
                    Use the project's theme for {screen.name} again
                  </button>
                )}
              </Group>
            )}
            <Group title="Brand color" hint="Buttons, links and highlights. A full color scale is made from it.">
              <div className="flex flex-wrap gap-1.5">
                {BRAND_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Brand color ${color}`}
                    aria-pressed={options.brand === color}
                    onClick={() => commitBrand(color)}
                    className={`grid h-7 w-7 place-items-center rounded-full border border-black/10 ${options.brand === color ? "ring-2 ring-ink ring-offset-1" : ""}`}
                    style={{ background: color }}
                  >
                    {options.brand === color && <Check size={13} className="text-white mix-blend-difference" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick a brand color" value={options.brand} onChange={(e) => commitBrand(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5" />
                <input
                  aria-label="Brand color"
                  value={brandText}
                  onChange={(e) => setBrandText(e.target.value)}
                  onBlur={(e) => commitBrand(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitBrand(e.currentTarget.value);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 font-mono text-[13px]"
                />
              </div>
            </Group>
            <Group title="Gray tint" hint="How much of the brand color the grays carry.">
              <Choices label="Gray tint" value={options.tint} options={TINTS} onChange={(tint) => set({ tint })} />
            </Group>
            <Group title="Fonts" hint="A heading font and a body font. Google fonts are copied into your project and your app.">
              <div role="radiogroup" aria-label="Fonts" className="grid grid-cols-2 gap-1.5">
                {FONT_PAIRS.map((pair) => (
                  <button
                    key={pair.id}
                    type="button"
                    role="radio"
                    aria-checked={options.fonts === pair.id}
                    aria-label={`Fonts ${pair.label}`}
                    onClick={() => set({ fonts: pair.id })}
                    className={`rounded-lg border px-2.5 py-2 text-left ${options.fonts === pair.id ? "border-ink bg-brand-soft" : "border-zinc-200 hover:border-zinc-400"}`}
                  >
                    <span className="block truncate text-[17px] font-bold leading-tight" style={{ fontFamily: pair.heading ? `"${pair.heading}", ${SYSTEM_FONT}` : SYSTEM_FONT }}>
                      {pair.label}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-ink-soft" style={{ fontFamily: pair.body ? `"${pair.body}", ${SYSTEM_FONT}` : SYSTEM_FONT }}>
                      {fontState[pair.id] === "loading" && <Loader2 size={10} className="shrink-0 animate-spin" aria-label="Loading the fonts" />}
                      <span className="truncate">
                        {fontState[pair.id] === "failed"
                          ? "Preview unavailable (offline?)"
                          : pair.heading
                            ? pair.heading === pair.body
                              ? pair.heading
                              : `${pair.heading} + ${pair.body}`
                            : "Your device's font, no download"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Group>
            <Group title="Shape" hint="Corners of buttons, cards and images.">
              <Choices
                label="Shape"
                value={options.shape}
                options={SHAPES}
                onChange={(shape) => set({ shape })}
                render={(id) => <span className="h-3.5 w-4 border-[1.5px] border-current" style={{ borderRadius: id === "sharp" ? 1 : id === "soft" ? 4 : 8 }} />}
              />
            </Group>
            <Group title="Spacing" hint="Room around sections: compact for apps and tools, airy for landing pages.">
              <Choices label="Spacing" value={options.density} options={DENSITIES} onChange={(density) => set({ density })} />
            </Group>
          </div>
          <div className="flex min-h-0 flex-col bg-zinc-100">
            <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
              <span className="flex-1 text-[12px] text-ink-soft">Preview</span>
              <div className="flex rounded-md border border-zinc-300 p-0.5">
                {(
                  [
                    ["desktop", "Desktop", <Monitor key="d" size={14} />],
                    ["phone", "Phone", <Smartphone key="p" size={14} />],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button key={id} type="button" aria-label={`Preview on ${label.toLowerCase()}`} aria-pressed={device === id} onClick={() => setDevice(id)} className={`grid h-6 w-7 place-items-center rounded ${device === id ? "bg-ink text-white" : "text-ink-soft"}`}>
                    {icon}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Preview in dark mode"
                aria-pressed={scheme === "dark"}
                onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
                className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] ${scheme === "dark" ? "border-ink bg-ink text-white" : "border-zinc-300 text-ink-soft"}`}
              >
                {scheme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                {scheme === "dark" ? "Dark" : "Light"}
              </button>
            </div>
            <div ref={stage} className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="theme-preview">
              <div className="mx-auto overflow-hidden rounded-lg shadow-md" style={{ width: width * scale, height: height * scale }}>
                <div style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                  <FrameView
                    tree={preview.root}
                    name="Theme preview"
                    viewport={{ id: "preview", width }}
                    tokens={tokens}
                    components={project.components}
                    resolveAsset={resolveAsset}
                    sources={sources}
                    scheme={scheme}
                    onResize={(_, h) => setHeight(h)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <footer className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3">
          {error ? <span className="flex-1 text-xs text-red-700">{error}</span> : <span className="flex-1 text-[12px] text-ink-soft">Your screens update when you apply. Undo with Ctrl+Z.</span>}
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="flex items-center gap-1.5 rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600 disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "Applying…" : "Apply theme"}
          </button>
        </footer>
      </div>
    </div>
  );
}
