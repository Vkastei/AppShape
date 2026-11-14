import { type AppProcessStatus, type CodeApplyResponse, type CodePlanResponse, type CodeStatusResponse, STACK_LABELS, type StackId } from "@appshape/protocol";
import { Bot, ChevronDown, ChevronRight, Copy, ExternalLink, FileMinus, FilePen, FilePlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { codeApply, codePlan, codeProcess, codeStatus } from "../lib/api";
import { diffStats, hunks, lineDiff } from "../lib/diff";
import { notify, useEditor } from "../store";
import { AgentStarter } from "./AgentRun";
import { VerifyPanel } from "./VerifyPanel";

type Step =
  | { kind: "loading" }
  | { kind: "pick"; status: CodeStatusResponse }
  | { kind: "preview"; status: CodeStatusResponse; plan: CodePlanResponse; stack?: StackId }
  | { kind: "applying"; plan: CodePlanResponse }
  | { kind: "done"; plan: CodePlanResponse; result: CodeApplyResponse; status: CodeStatusResponse }
  | { kind: "error"; message: string };

/** Preview the code changes the design makes, then write them. */
export function ApplyDialog({ onClose }: { onClose: () => void }) {
  const token = useEditor((s) => s.token)!;
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const configured = useEditor((s) => s.project?.settings?.code?.stack);
  const [stack, setStack] = useState<StackId>(configured && configured in STACK_LABELS ? (configured as StackId) : "vite-react-router");

  const preview = async (status: CodeStatusResponse, chosen?: StackId) => {
    setStep({ kind: "loading" });
    try {
      setStep({ kind: "preview", status, plan: await codePlan(token, chosen), ...(chosen && { stack: chosen }) });
    } catch (error) {
      setStep({ kind: "error", message: (error as Error).message });
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const status = await codeStatus(token);
        if (status.app === "unsupported") setStep({ kind: "error", message: `AppShape can't generate code into this folder: ${status.reason}.` });
        else if (status.app === "none") setStep({ kind: "pick", status });
        else await preview(status);
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
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (plan: CodePlanResponse, chosen?: StackId) => {
    setStep({ kind: "applying", plan });
    try {
      const result = await codeApply(token, { planId: plan.planId, ...(chosen && { stack: chosen }) });
      const status = await codeStatus(token);
      setStep({ kind: "done", plan, result, status });
      useEditor.setState({ appStatus: status });
    } catch (error) {
      setStep({ kind: "error", message: (error as Error).message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6" role="dialog" aria-label="Apply to code" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border-[1.5px] border-ink bg-white shadow-offset">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <h2 className="flex-1 text-[17px] font-extrabold tracking-[-0.01em] text-ink">Apply the design to code</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
          {step.kind === "loading" && <Spinner text="Comparing the design with the code…" />}
          {step.kind === "error" && <p className="rounded bg-red-50 p-3 text-red-800">{step.message}</p>}
          {step.kind === "pick" && (
            <div>
              <p className="mb-3 text-zinc-700">
                There is no app in <code className="rounded bg-zinc-100 px-1">{step.status.appRoot}</code> yet. AppShape will create one with your screens, components and design system, install it with pnpm and start it.
              </p>
              <fieldset className="grid grid-cols-2 gap-2" aria-label="Stack">
                {(Object.keys(STACK_LABELS) as StackId[]).map((id) => (
                  <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 ${stack === id ? "border-accent-500 bg-accent-50" : "border-zinc-200 hover:border-zinc-300"}`}>
                    <input type="radio" name="stack" value={id} checked={stack === id} onChange={() => setStack(id)} />
                    <span className="font-medium text-zinc-800">{STACK_LABELS[id]}</span>
                  </label>
                ))}
              </fieldset>
              <p className="mt-2 text-xs text-zinc-500">All use React 19, Tailwind CSS v4 and TypeScript.</p>
            </div>
          )}
          {step.kind === "preview" && <OpenChangesets onShow={onClose} />}
          {(step.kind === "preview" || step.kind === "applying") && <Preview plan={step.plan} />}
          {step.kind === "done" && <Done step={step} onShow={onClose} />}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          {step.kind === "done" || step.kind === "error" ? (
            <button type="button" onClick={onClose} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">
                Cancel
              </button>
              {step.kind === "pick" && (
                <button type="button" onClick={() => void preview(step.status, stack)} className="rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600">
                  Preview code
                </button>
              )}
              {step.kind === "preview" && (
                <button
                  type="button"
                  disabled={step.plan.changes.length === 0 && step.plan.tasks.length === 0}
                  onClick={() => void apply(step.plan, step.stack)}
                  className="rounded-md border border-ink bg-accent-500 px-3 py-1.5 text-sm font-semibold text-white shadow-offset-sm hover:bg-accent-600 disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
                >
                  {step.plan.scaffold ? "Create app" : `Apply ${step.plan.changes.length} file change${step.plan.changes.length === 1 ? "" : "s"}`}
                </button>
              )}
              {step.kind === "applying" && <Spinner text="Writing…" />}
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

function Preview({ plan }: { plan: CodePlanResponse }) {
  if (plan.changes.length === 0 && plan.tasks.length === 0) {
    return <p className="text-zinc-600">The code is up to date with the design.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">
        {STACK_LABELS[plan.stack]} · Changes AppShape can make exactly are written directly; the rest goes to your coding agent.
      </p>
      {plan.changes.length > 0 && (
        <section aria-label="File changes" className="mb-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Files ({plan.changes.length})</h3>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {plan.changes.map((change) => (
              <FileRow key={change.path} change={change} />
            ))}
          </ul>
        </section>
      )}
      {plan.tasks.length > 0 && (
        <section aria-label="Tasks for the AI" className="mb-3">
          <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-accent-700">
            <Bot size={13} /> For your coding agent ({plan.tasks.length})
          </h3>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-accent-200">
            {plan.tasks.map((task, i) => (
              <TaskRow key={i} task={task} />
            ))}
          </ul>
        </section>
      )}
      {plan.warnings.length > 0 && (
        <ul className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({ change }: { change: CodePlanResponse["changes"][number] }) {
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => diffStats(change.before, change.after), [change]);
  const Icon = change.after === undefined ? FileMinus : change.before === undefined ? FilePlus : FilePen;
  const color = change.after === undefined ? "text-red-600" : change.before === undefined ? "text-teal-600" : "text-amber-600";
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50" aria-expanded={open}>
        {open ? <ChevronDown size={13} className="text-zinc-400" /> : <ChevronRight size={13} className="text-zinc-400" />}
        <Icon size={14} className={color} />
        <span className="font-mono text-xs text-zinc-800">{change.path}</span>
        <span className="flex-1 truncate text-xs text-zinc-500">{change.summary}</span>
        {!change.copyFrom && <span className="font-mono text-[11px] text-teal-600">+{stats.added}</span>}
        {!change.copyFrom && <span className="font-mono text-[11px] text-red-600">−{stats.removed}</span>}
      </button>
      {open && (change.copyFrom ? <p className="px-3 py-2 text-xs text-ink-soft">Copied from <code>.appshape/{change.copyFrom}</code></p> : <Diff before={change.before ?? ""} after={change.after ?? ""} />)}
    </li>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => hunks(lineDiff(before, after)), [before, after]);
  return (
    <pre className="max-h-80 overflow-auto border-t border-zinc-100 bg-zinc-50 py-1 font-mono text-[11px] leading-4" data-testid="diff">
      {lines.map((line, i) =>
        line.kind === "gap" ? (
          <div key={i} className="px-3 text-zinc-400">
            ⋯ {line.count} unchanged line{line.count > 1 ? "s" : ""}
          </div>
        ) : (
          <div key={i} className={`px-3 ${line.kind === "add" ? "bg-teal-50 text-teal-900" : line.kind === "remove" ? "bg-red-50 text-red-900" : "text-zinc-600"}`}>
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
            {line.text}
          </div>
        ),
      )}
    </pre>
  );
}

function TaskRow({ task }: { task: CodePlanResponse["tasks"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-1.5">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left" disabled={!task.code}>
        {task.code ? open ? <ChevronDown size={13} className="mt-0.5 text-zinc-400" /> : <ChevronRight size={13} className="mt-0.5 text-zinc-400" /> : <span className="w-[13px]" />}
        <span className="flex-1 text-xs text-zinc-800">{task.summary}</span>
        {task.file && (
          <span className="shrink-0 font-mono text-[11px] text-zinc-500">
            {task.file}
            {task.line ? `:${task.line}` : ""}
          </span>
        )}
      </button>
      {open && task.code && <pre className="mt-1 max-h-60 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[11px] leading-4 text-zinc-700">{task.code}</pre>}
    </li>
  );
}

/** Changesets an agent is working on (or should): check them against the running app. */
function OpenChangesets({ onShow }: { onShow: () => void }) {
  const changesets = useEditor((s) => s.project?.changesets ?? []);
  const open = changesets.filter((c) => c.status !== "verified" && c.status !== "draft" && (c.tasks?.length || c.changes?.length));
  const [selected, setSelected] = useState<string>();
  if (open.length === 0) return null;
  const LABEL: Record<string, string> = { ready: "waiting for the agent", in_progress: "agent working", applied: "agent done", needs_fix: "needs a fix" };
  return (
    <section aria-label="Agent changesets" className="mb-3">
      <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-accent-700">
        <Bot size={13} /> Agent changesets
      </h3>
      <ul className="mb-2 divide-y divide-zinc-100 rounded-lg border border-accent-200">
        {open.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="font-mono text-zinc-800">{c.id}</span>
            <span className="flex-1 truncate text-zinc-500">{c.tasks?.length ?? c.changes?.length} task(s) · {LABEL[c.status] ?? c.status}</span>
            <button type="button" onClick={() => setSelected(selected === c.id ? undefined : c.id)} className="rounded px-2 py-0.5 font-medium text-accent-700 hover:bg-accent-50">
              {selected === c.id ? "Hide" : "Verify"}
            </button>
          </li>
        ))}
      </ul>
      {selected && <VerifyPanel key={selected} changesetId={selected} onShow={onShow} />}
    </section>
  );
}

function Done({ step, onShow }: { step: Extract<Step, { kind: "done" }>; onShow: () => void }) {
  const { result, plan } = step;
  return (
    <div className="space-y-3">
      <p className="text-zinc-800">
        {plan.scaffold ? "Created the app" : "Updated the code"}: {result.written.length} file{result.written.length === 1 ? "" : "s"} written
        {result.deleted.length ? `, ${result.deleted.length} deleted` : ""}.
      </p>
      {result.taskCount > 0 && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 p-3 text-xs text-accent-950">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <Bot size={13} /> {result.taskCount} task{result.taskCount === 1 ? "" : "s"} for your coding agent ({result.changesetId})
          </div>
          <p className="flex flex-wrap items-center gap-1">
            Ask your coding agent: <em>"Implement the AppShape changeset {result.changesetId}"</em>
            <button
              type="button"
              aria-label="Copy the sentence"
              title="Copy"
              onClick={() => void navigator.clipboard?.writeText(`Implement the AppShape changeset ${result.changesetId}`).then(() => notify("Copied: paste it into your coding agent."))}
              className="grid h-5 w-5 place-items-center rounded hover:bg-white"
            >
              <Copy size={12} />
            </button>
          </p>
          <p className="mt-1 text-accent-900/80">
            Not connected yet?{" "}
            <button type="button" onClick={() => useEditor.setState({ settingsOpen: true })} className="font-semibold underline">
              Pick your coding AI
            </button>{" "}
            in the project settings. Agents without AppShape's tools can read <code className="rounded bg-white px-1">.appshape/{result.specFile}</code>.
          </p>
          <div className="mt-2">
            <AgentStarter prompt={`Implement the AppShape changeset ${result.changesetId}`} />
          </div>
        </div>
      )}
      {!plan.scaffold && result.frameIds.length > 0 && <VerifyPanel frameIds={result.frameIds} onShow={onShow} />}
      <ProcessPanel initial={step.status.process} />
    </div>
  );
}

/** Install / dev server progress after creating an app. */
export function ProcessPanel({ initial }: { initial: AppProcessStatus }) {
  const token = useEditor((s) => s.token)!;
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    if (status.state !== "installing" && status.state !== "starting") return;
    const timer = window.setTimeout(async () => {
      const next = await codeProcess(token).catch(() => status);
      setStatus(next);
      useEditor.setState((s) => ({ appStatus: s.appStatus && { ...s.appStatus, process: next } }));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [status, token]);
  if (status.state === "idle" || status.state === "stopped") return null;
  return (
    <div className="rounded-lg border border-zinc-200">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs">
        {(status.state === "installing" || status.state === "starting") && <Loader2 size={13} className="animate-spin text-accent-700" />}
        <span className="font-medium text-zinc-800">
          {status.state === "installing" ? "Installing dependencies…" : status.state === "starting" ? "Starting the app…" : status.state === "running" ? "The app is running" : "Something went wrong"}
        </span>
        {status.url && (
          <a href={status.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-accent-700 hover:underline">
            Open app <ExternalLink size={12} />
          </a>
        )}
      </div>
      <pre className="max-h-40 overflow-auto bg-zinc-950 p-2 font-mono text-[10px] leading-4 text-zinc-300" data-testid="process-log">
        {status.log.slice(-20).join("\n")}
      </pre>
    </div>
  );
}
