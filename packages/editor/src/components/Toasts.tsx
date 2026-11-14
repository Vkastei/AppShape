import type { LogEntry } from "@appshape/protocol";
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dismissToast, useEditor } from "../store";

/** How long a toast stays (ms); a running step stays until its result (or 2 minutes). */
function lifetime(entry: LogEntry): number {
  if (entry.level === "error") return 10_000;
  if (entry.level === "warn") return 7_000;
  if (entry.task && !entry.done) return 120_000;
  return 4_000;
}

/** Steps and problems at the top of the board; click one for the log panel. */
export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const logs = useEditor((s) => s.logs);
  // the open log panel lists them anyway
  const panelOpen = useEditor((s) => s.logPanel !== undefined);
  if (panelOpen) return null;
  const byId = new Map(logs.map((l) => [l.id, l]));
  const shown = toasts.map((id) => byId.get(id)).filter((e): e is LogEntry => e !== undefined);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-2" role="status" aria-live="polite" aria-label="Messages">
      {shown.map((entry) => (
        <Toast key={entry.task ?? entry.id} entry={entry} />
      ))}
    </div>
  );
}

function Toast({ entry }: { entry: LogEntry }) {
  const [hover, setHover] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => {
    if (hover) return;
    timer.current = window.setTimeout(() => dismissToast(entry.id), lifetime(entry));
    return () => window.clearTimeout(timer.current);
  }, [entry, hover]);

  const running = entry.task !== undefined && !entry.done && entry.level === "step";
  const Icon = running ? Loader2 : entry.level === "error" ? CircleAlert : entry.level === "warn" ? TriangleAlert : entry.level === "step" ? CircleCheck : Info;
  // ink outline and offset shadow like the toolbar; problems in their own color
  const tone =
    entry.level === "error"
      ? "border-red-600 text-red-950 shadow-[2px_2px_0_0_#dc2626]"
      : entry.level === "warn"
        ? "border-amber-500 text-amber-950 shadow-[2px_2px_0_0_#f59e0b]"
        : "border-ink text-ink shadow-offset-sm";
  const iconTone = entry.level === "error" ? "text-red-600" : entry.level === "warn" ? "text-amber-600" : entry.level === "step" && !running ? "text-teal-600" : "text-ink-soft";
  return (
    <div
      data-testid="toast"
      className={`pointer-events-auto flex max-w-[min(560px,90vw)] items-start gap-2 rounded-xl border-[1.5px] bg-white py-2 pl-3 pr-1.5 text-sm font-medium ${tone}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${iconTone} ${running ? "animate-spin" : ""}`} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        title="Show in the log"
        onClick={() => {
          dismissToast(entry.id);
          useEditor.setState({ logPanel: { focus: entry.id }, toasts: [] });
        }}
      >
        <span className="block">{entry.text}</span>
        {entry.detail && (entry.level === "error" || entry.level === "warn") && <span className="block text-xs opacity-70">Click for details</span>}
      </button>
      <button type="button" aria-label="Close message" onClick={() => dismissToast(entry.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-soft/70 hover:bg-ink/[0.06] hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}
