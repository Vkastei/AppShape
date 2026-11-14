import { CHECK_RULES, type Finding } from "@appshape/kit";
import { CircleAlert, Info, TriangleAlert, Wand2, X } from "lucide-react";
import { useState } from "react";
import { fixAll, fixFinding, setIgnored, showFinding, useFindings } from "../lib/checks";
import { useEditor } from "../store";

const ICON: Record<Finding["severity"], React.ReactNode> = {
  error: <CircleAlert size={14} className="shrink-0 text-red-600" aria-label="Problem" />,
  warning: <TriangleAlert size={14} className="shrink-0 text-amber-600" aria-label="Warning" />,
  info: <Info size={14} className="shrink-0 text-sky-600" aria-label="Hint" />,
};
const ORDER: Record<Finding["severity"], number> = { error: 0, warning: 1, info: 2 };

/**
 * Check design: what to improve on each screen (contrast, design system, headings, tap targets, …),
 * each with Fix where the fix is clear, Show, and Ignore. Nothing is blocked by it.
 */
export function ChecksPanel() {
  const open = useEditor((s) => s.checksOpen);
  const screen = useEditor((s) => s.checksScreen);
  const project = useEditor((s) => s.project);
  const ignored = useEditor((s) => s.ignoredChecks);
  const findings = useFindings();
  const [showIgnored, setShowIgnored] = useState(false);
  const [hints, setHints] = useState(true);
  if (!open || !project) return null;

  const frames = new Map(project.frames.map((f) => [f.id, f]));
  const visible = findings
    .filter((f) => (!screen || f.frameId === screen) && (showIgnored || !ignored.includes(f.key)) && (hints || f.severity !== "info"))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const byScreen = new Map<string, Finding[]>();
  for (const f of visible) byScreen.set(f.frameId, [...(byScreen.get(f.frameId) ?? []), f]);
  const fixable = visible.filter((f) => f.fix && !ignored.includes(f.key));
  const close = () => useEditor.setState({ checksOpen: false, checksScreen: undefined });

  return (
    <section className="absolute bottom-20 right-3 top-3 z-30 flex w-[26rem] flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset" aria-label="Design checks">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Check design{screen && frames.get(screen) ? `: ${frames.get(screen)!.name}` : ""}</h2>
          <p className="text-[11px] text-ink-soft">{visible.length === 0 ? "Nothing to improve. Nice." : `${visible.length} thing${visible.length === 1 ? "" : "s"} to look at`}</p>
        </div>
        {screen && (
          <button type="button" onClick={() => useEditor.setState({ checksScreen: undefined })} className="rounded px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-zinc-100">
            All screens
          </button>
        )}
        {fixable.length > 1 && (
          <button type="button" onClick={() => fixAll(fixable)} className="flex items-center gap-1 rounded-md border border-ink bg-accent-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-600">
            <Wand2 size={12} /> Fix all ({fixable.length})
          </button>
        )}
        <button type="button" aria-label="Close design checks" onClick={close} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
          <X size={15} />
        </button>
      </header>
      <div className="flex gap-3 border-b border-zinc-100 px-3 py-1.5 text-[11px] text-ink-soft">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> Hints
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> Ignored ({ignored.length})
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {[...byScreen].map(([frameId, list]) => (
          <div key={frameId} className="mb-2">
            <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft">{frames.get(frameId)?.name}</div>
            <ul className="space-y-1">
              {list.map((f) => {
                const isIgnored = ignored.includes(f.key);
                return (
                  <li key={f.key} className={`rounded-lg border px-2 py-1.5 ${isIgnored ? "border-dashed border-zinc-200 opacity-60" : "border-zinc-200"}`} aria-label={`${CHECK_RULES[f.rule]}: ${f.message}`}>
                    <div className="flex gap-2">
                      {ICON[f.severity]}
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-soft">{CHECK_RULES[f.rule]}</div>
                        <div className="text-xs leading-snug text-ink">{f.message}</div>
                      </div>
                    </div>
                    <div className="mt-1 flex justify-end gap-1">
                      <button type="button" onClick={() => showFinding(f)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-zinc-100">
                        Show
                      </button>
                      <button type="button" onClick={() => setIgnored(f.key, !isIgnored)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-zinc-100">
                        {isIgnored ? "Don't ignore" : "Ignore"}
                      </button>
                      {f.fix && !isIgnored && (
                        <button type="button" onClick={() => fixFinding(f)} className="rounded border border-ink/20 bg-accent-50 px-1.5 py-0.5 text-[11px] font-semibold text-ink hover:border-ink" title={f.fix.label}>
                          Fix: {f.fix.label}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
