import type { ImportResponse, ImportStatusResponse } from "@appshape/protocol";
import { STACK_LABELS } from "@appshape/protocol";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeCaptureBrowser, importPages, importStatus, openCaptureBrowser } from "../lib/api";
import { zoomToFit } from "../lib/view";
import { dispatch, loadAppStyles, useEditor } from "../store";

type Step =
  | { kind: "loading" }
  | { kind: "pick"; status: ImportStatusResponse }
  | { kind: "importing"; status: ImportStatusResponse }
  | { kind: "done"; result: ImportResponse }
  | { kind: "error"; message: string };

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** Captures pages of the running app into imported frames. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const token = useEditor((s) => s.token)!;
  const redaction = useEditor((s) => s.project?.redaction.mode ?? "strict");
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [devUrl, setDevUrl] = useState("");
  const [replace, setReplace] = useState(false);
  const [browser, setBrowser] = useState<"closed" | "opening" | "open">("closed");
  const [browserError, setBrowserError] = useState<string | undefined>(undefined);
  const openBrowser = async () => {
    setBrowser("opening");
    setBrowserError(undefined);
    try {
      await openCaptureBrowser(token, devUrl.trim() || undefined);
      setBrowser("open");
    } catch (error) {
      setBrowser("closed");
      setBrowserError((error as Error).message);
    }
  };
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const status = await importStatus(token);
        if (status.app !== "app") {
          setStep({ kind: "error", message: status.app === "none" ? "There is no app in this folder to import from." : `AppShape can't import this app: ${status.reason}.` });
          return;
        }
        setChosen(Object.fromEntries(status.routes.map((r) => [r.path, !r.dynamic && !r.frameId])));
        if (status.browserOpen) setBrowser("open");
        setStep({ kind: "pick", status });
      } catch (error) {
        setStep({ kind: "error", message: (error as Error).message });
      }
    })();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = step.kind === "pick" ? step.status.routes.filter((r) => chosen[r.path] && (!r.dynamic || paths[r.path]?.startsWith("/"))) : [];

  const start = async (status: ImportStatusResponse) => {
    setStep({ kind: "importing", status });
    poll.current = window.setInterval(() => {
      void importStatus(token)
        .then((next) => setStep((s) => (s.kind === "importing" ? { kind: "importing", status: next } : s)))
        .catch(() => undefined);
    }, 700);
    try {
      const result = await importPages(token, {
        pages: pages.map((r) => ({ route: r.path, ...(r.dynamic && { path: paths[r.path]! }) })),
        ...(devUrl.trim() && { devUrl: devUrl.trim() }),
        replace,
      });
      await loadAppStyles();
      if (result.ops.length > 0) {
        dispatch(result.ops);
        requestAnimationFrame(() => zoomToFit());
      }
      setStep({ kind: "done", result });
    } catch (error) {
      setStep({ kind: "error", message: (error as Error).message });
    } finally {
      window.clearInterval(poll.current);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label="Import pages" onPointerDown={(e) => e.target === e.currentTarget && step.kind !== "importing" && onClose()}>
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <h2 className="flex-1 text-[17px] font-extrabold tracking-[-0.01em] text-ink">Import pages from the app</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
          {step.kind === "loading" && <Spinner text="Looking at the app…" />}
          {step.kind === "error" && <p className="rounded bg-red-50 p-3 text-red-800">{step.message}</p>}
          {step.kind === "pick" && (
            <div className="flex flex-col gap-3">
              <p className="text-zinc-700">
                {step.status.stack ? STACK_LABELS[step.status.stack] : "React"} with Tailwind CSS v{step.status.tailwind}. AppShape opens each page in the running app and turns
                it into an editable screen that knows where every element lives in your code. Nothing in the app is changed.
              </p>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200" aria-label="Pages">
                {step.status.routes.map((route) => (
                  <li key={route.path} className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={route.path}
                      checked={chosen[route.path] ?? false}
                      onChange={(e) => setChosen((c) => ({ ...c, [route.path]: e.target.checked }))}
                    />
                    <span className="font-mono text-zinc-800">{route.path}</span>
                    {route.dynamic && (
                      <input
                        placeholder={`URL, e.g. ${route.path.replace(/\[\.{0,3}([^\]]+)\]|[:$](\w+)/g, "example")}`}
                        value={paths[route.path] ?? ""}
                        onChange={(e) => {
                          setPaths((p) => ({ ...p, [route.path]: e.target.value }));
                          setChosen((c) => ({ ...c, [route.path]: e.target.value.startsWith("/") }));
                        }}
                        className="min-w-0 flex-1 rounded border border-zinc-200 px-2 py-0.5 font-mono text-xs"
                      />
                    )}
                    <span className="ml-auto truncate text-xs text-zinc-400">{route.frameId ? "imported" : route.file}</span>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-zinc-700">
                <span className="shrink-0">Dev server</span>
                <input
                  placeholder={`started with ${step.status.packageManager} run dev, or a running one: http://localhost:3000`}
                  value={devUrl}
                  onChange={(e) => setDevUrl(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-zinc-200 px-2 py-1 text-xs"
                />
              </label>
              {step.status.routes.some((r) => r.frameId) && (
                <label className="flex items-center gap-2 text-zinc-700">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  Re-import pages that are already on the board (only those without design changes)
                </label>
              )}
              <div className="flex items-start gap-3 rounded-lg bg-zinc-50 p-3">
                <p className="flex-1 text-xs text-zinc-600">
                  <strong className="text-zinc-800">Pages behind a login, an open dialog, a later step of a form:</strong> use the app in the capture browser and press
                  its <em>Capture to AppShape</em> button. Each capture becomes a screen; logins are kept for next time.
                  {browserError && <span className="mt-1 block text-red-700">{browserError}</span>}
                </p>
                {browser === "open" ? (
                  <button type="button" onClick={() => void closeCaptureBrowser(token).then(() => setBrowser("closed"))} className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
                    Close capture browser
                  </button>
                ) : (
                  <button type="button" disabled={browser === "opening"} onClick={() => void openBrowser()} className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60">
                    {browser === "opening" ? "Opening…" : "Open capture browser"}
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                Redaction: <strong>{redaction}</strong>. Emails, phone numbers, long numbers and keys are replaced before anything is saved; external images become placeholders.
                Mark more with <code className="rounded bg-zinc-100 px-1">data-aps-redact</code>. The import above shows pages as a logged-out visitor sees them.
              </p>
            </div>
          )}
          {step.kind === "importing" && (
            <div className="flex flex-col gap-2">
              <Spinner text={step.status.progress ? `${step.status.progress.step} (${step.status.progress.done}/${step.status.progress.total})` : "Starting…"} />
              {step.status.process.state !== "idle" && step.status.process.log.length > 0 && (
                <pre className="max-h-40 overflow-auto rounded bg-zinc-900 p-2 text-[11px] leading-4 text-zinc-100">{step.status.process.log.slice(-12).join("\n")}</pre>
              )}
            </div>
          )}
          {step.kind === "done" && (
            <div className="flex flex-col gap-3">
              {step.result.pages.length === 0 ? (
                <p className="text-zinc-700">No pages were imported.</p>
              ) : (
                <table className="w-full text-left">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 font-medium">Page</th>
                      <th className="py-1 font-medium" title="Elements linked to the JSX that renders them">In code</th>
                      <th className="py-1 font-medium" title="Classes that became editable styles; the rest is kept as is">Editable styles</th>
                      <th className="py-1 font-medium">Redacted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.result.pages.map((page) => (
                      <tr key={page.frameId} className="border-t border-zinc-100">
                        <td className="py-1.5 text-zinc-800">
                          {page.name} <span className="font-mono text-xs text-zinc-400">{page.route}</span>
                        </td>
                        <td className="py-1.5">{percent(page.anchored)}</td>
                        <td className="py-1.5">{percent(page.mapped)}</td>
                        <td className="py-1.5">{page.redacted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {[...step.result.warnings, ...step.result.pages.flatMap((p) => p.warnings.map((w) => `${p.route}: ${w}`))].length > 0 && (
                <ul className="list-disc pl-5 text-xs text-amber-800">
                  {[...step.result.warnings, ...step.result.pages.flatMap((p) => p.warnings.map((w) => `${p.route}: ${w}`))].slice(0, 12).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          {step.kind === "done" || step.kind === "error" ? (
            <button type="button" onClick={onClose} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={step.kind === "importing"} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">
                Cancel
              </button>
              {step.kind === "pick" && (
                <button
                  type="button"
                  disabled={pages.length === 0}
                  onClick={() => void start(step.status)}
                  className="rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600 disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
                >
                  Import {pages.length} page{pages.length === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 text-zinc-500">
      <Loader2 size={14} className="animate-spin" /> {text}
    </span>
  );
}
