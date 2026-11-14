import type { LogEntry, LogSource } from "@appshape/protocol";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Copy, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../store";

const SOURCES: { id: LogSource | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "app", label: "Your app" },
  { id: "import", label: "Bring in" },
  { id: "apply", label: "Code" },
  { id: "verify", label: "Checks" },
  { id: "agent", label: "AI" },
  { id: "editor", label: "Board" },
  { id: "server", label: "AppShape" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Everything AppShape did in this session, over the board (opened from a toast or the top bar). */
export function LogPanel() {
  const panel = useEditor((s) => s.logPanel);
  const logs = useEditor((s) => s.logs);
  const [source, setSource] = useState<LogSource | "all">("all");
  const [output, setOutput] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const close = () => useEditor.setState({ logPanel: undefined, logSeenAt: new Date().toISOString() });

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panel]);

  const focusEntry = panel?.focus ? logs.find((l) => l.id === panel.focus) : undefined;
  // a focused entry is always visible, whatever the filters
  const shown = useMemo(
    () => logs.filter((l) => l.id === focusEntry?.id || ((source === "all" || l.source === source) && (output || l.level !== "output"))),
    [logs, source, output, focusEntry],
  );

  // steps whose result has come: their start entry no longer spins
  const finished = useMemo(() => new Set(logs.filter((l) => l.done && l.task).map((l) => l.task!)), [logs]);

  useLayoutEffect(() => {
    if (!panel) return;
    const target = panel.focus ? list.current?.querySelector(`[data-entry="${panel.focus}"]`) : list.current?.lastElementChild;
    target?.scrollIntoView({ block: panel.focus ? "center" : "end" });
  }, [panel, shown.length]);

  if (!panel) return null;
  const copy = () => void navigator.clipboard?.writeText(shown.map((l) => `${time(l.at)} [${l.source}] ${l.text}${l.detail ? `\n${l.detail}` : ""}`).join("\n"));
  return (
    <section className="absolute inset-x-0 top-0 z-30 flex h-[45%] min-h-56 flex-col border-b-[1.5px] border-ink bg-white shadow-float" aria-label="Activity">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <h2 className="mr-2 text-sm font-semibold text-zinc-900">Activity</h2>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Show">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={source === s.id}
              onClick={() => setSource(s.id)}
              className={`rounded-full px-2.5 py-0.5 text-xs ${source === s.id ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={output} onChange={(e) => setOutput(e.target.checked)} /> Your app's output
        </label>
        <span className="flex-1" />
        <button type="button" onClick={copy} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100" title="Copy what is shown">
          <Copy size={13} /> Copy
        </button>
        <button type="button" aria-label="Close activity" onClick={close} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
          <X size={16} />
        </button>
      </header>
      <ol ref={list} className="min-h-0 flex-1 overflow-auto py-1 text-xs" data-testid="log-list">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-zinc-500">Nothing yet. Starting your app, bringing in pages, sending the design to the code and checks show up here.</li>}
        {shown.map((entry) => (
          <Row key={entry.id} entry={entry} focused={entry.id === panel.focus} finished={entry.task !== undefined && finished.has(entry.task)} />
        ))}
      </ol>
    </section>
  );
}

function Row({ entry, focused, finished }: { entry: LogEntry; focused: boolean; finished: boolean }) {
  const [open, setOpen] = useState(focused);
  const running = entry.level === "step" && entry.task !== undefined && !entry.done && !finished;
  if (entry.level === "output") {
    return (
      <li data-entry={entry.id} className="flex gap-3 px-3 font-mono text-[11px] leading-4 text-zinc-500">
        <span className="w-20 shrink-0 whitespace-nowrap text-zinc-400">{time(entry.at)}</span>
        <span className="whitespace-pre-wrap break-all">{entry.text}</span>
      </li>
    );
  }
  const result = entry.level === "step" && (entry.done || entry.task === undefined);
  const Icon = running ? Loader2 : entry.level === "error" ? CircleAlert : entry.level === "warn" ? TriangleAlert : result ? CircleCheck : Info;
  const tone = entry.level === "error" ? "text-red-600" : entry.level === "warn" ? "text-amber-600" : result ? "text-teal-600" : "text-zinc-400";
  return (
    <li data-entry={entry.id} className={`px-3 py-1 ${focused ? "bg-amber-50" : ""}`}>
      <button type="button" disabled={!entry.detail} onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 text-left">
        <span className="w-20 shrink-0 whitespace-nowrap text-zinc-400">{time(entry.at)}</span>
        <Icon size={13} className={`mt-px shrink-0 ${tone}`} />
        <span className={`flex-1 ${entry.level === "error" ? "text-red-800" : "text-zinc-800"}`}>{entry.text}</span>
        <span className="shrink-0 text-zinc-400">{SOURCES.find((s) => s.id === entry.source)?.label}</span>
        {entry.detail ? open ? <ChevronDown size={13} className="shrink-0 text-zinc-400" /> : <ChevronRight size={13} className="shrink-0 text-zinc-400" /> : <span className="w-[13px]" />}
      </button>
      {open && entry.detail && <pre className="ml-[108px] mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 font-mono text-[11px] leading-4 text-zinc-700">{entry.detail}</pre>}
    </li>
  );
}
