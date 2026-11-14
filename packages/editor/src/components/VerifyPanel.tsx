import type { VerifyFrameResult, VerifyResponse } from "@appshape/protocol";
import { CircleCheck, CircleX, ExternalLink, Loader2, ScanSearch } from "lucide-react";
import { useState } from "react";
import { verifyApp, verifyFileUrl } from "../lib/api";
import { goTo } from "../lib/view";
import { selectNode, useEditor } from "../store";

/**
 * Checks the running app against the design: a changeset (its status follows) or screens (after a
 * direct apply). Failed elements select the element on the board.
 */
export function VerifyPanel({ frameIds, changesetId, onShow }: { frameIds?: string[]; changesetId?: string; onShow?: () => void }) {
  const token = useEditor((s) => s.token)!;
  const [state, setState] = useState<{ kind: "idle" } | { kind: "running" } | { kind: "done"; result: VerifyResponse } | { kind: "error"; message: string }>({ kind: "idle" });

  const run = async () => {
    setState({ kind: "running" });
    try {
      setState({ kind: "done", result: await verifyApp(token, { ...(changesetId && { changesetId }), ...(frameIds && { frameIds }) }) });
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200" data-testid="verify-panel">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <ScanSearch size={14} className="text-accent-700" />
        <span className="flex-1 text-zinc-700">
          {changesetId ? `Check what your coding agent did (${changesetId}) in the running app.` : "Check the changed screens in the running app."}
        </span>
        <button
          type="button"
          disabled={state.kind === "running"}
          onClick={() => void run()}
          className="flex items-center gap-1.5 rounded-md border border-ink bg-white px-2.5 py-1 font-semibold text-ink shadow-offset-sm hover:bg-accent-50 disabled:opacity-60"
        >
          {state.kind === "running" && <Loader2 size={12} className="animate-spin" />}
          {state.kind === "running" ? "Checking…" : state.kind === "done" ? "Check again" : "Check in the app"}
        </button>
      </div>
      {state.kind === "running" && <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">Opening the app and comparing every element with the design. This takes a few seconds per screen.</p>}
      {state.kind === "error" && <p className="border-t border-zinc-100 bg-red-50 px-3 py-2 text-xs text-red-800">{state.message}</p>}
      {state.kind === "done" && <Results result={state.result} token={token} onShow={onShow} />}
    </div>
  );
}

function Results({ result, token, onShow }: { result: VerifyResponse; token: string; onShow: (() => void) | undefined }) {
  const project = useEditor((s) => s.project)!;
  const names = new Map(project.frames.map((f) => [f.id, f.name]));
  const show = (frameId: string, key: string) => {
    const placement = project.board.items.find((i) => i.type === "frame" && i.frameId === frameId);
    if (!placement) return;
    onShow?.();
    goTo({ itemId: placement.id });
    selectNode({ itemId: placement.id, frameId, nodeId: key.split("/")[0]! });
  };
  const report = result.report;
  return (
    <div className="space-y-2 border-t border-zinc-100 px-3 py-2 text-xs">
      {report && (
        <div className={`flex items-center gap-1.5 font-medium ${report.status === "verified" ? "text-teal-700" : "text-rose-700"}`} data-testid="verify-status">
          {report.status === "verified" ? <CircleCheck size={14} /> : <CircleX size={14} />}
          {report.status === "verified" ? "Verified: the app matches the design." : `Needs a fix: ${report.results.filter((r) => r.status === "fail").length} of ${report.results.length} changes don't match yet.`}
        </div>
      )}
      {report?.results
        .filter((r) => r.status === "fail")
        .map((r) => (
          <div key={r.changeId}>
            <div className="font-medium text-zinc-800">{r.changeId}</div>
            <ul className="ml-3 list-disc text-zinc-600">
              {r.checks
                .filter((c) => c.status === "fail")
                .map((c, i) => (
                  <li key={i}>
                    {c.text}
                    {c.detail && <span className="text-rose-700">: {c.detail}</span>}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      <ul className="space-y-1.5">
        {result.frames.map((f) => (
          <FrameRow key={`${f.frameId}-${f.viewport}`} frame={f} name={names.get(f.frameId) ?? f.frameId} token={token} onSelect={(key) => show(f.frameId, key)} />
        ))}
      </ul>
      {result.rebaselined.length > 0 && (
        <p className="text-zinc-500">Matching pages are the new starting point for applying: {result.rebaselined.map((id) => names.get(id) ?? id).join(", ")}.</p>
      )}
    </div>
  );
}

function FrameRow({ frame, name, token, onSelect }: { frame: VerifyFrameResult; name: string; token: string; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ok = !frame.error && frame.failing.length === 0 && frame.extra.length === 0;
  return (
    <li data-testid="verify-frame">
      <div className="flex items-center gap-2">
        {ok ? <CircleCheck size={13} className="text-teal-600" /> : <CircleX size={13} className="text-rose-600" />}
        <button type="button" className="text-left text-zinc-800 hover:underline disabled:no-underline" disabled={ok} onClick={() => setOpen(!open)}>
          {name} · {frame.viewport}
        </button>
        <span className="text-zinc-500">
          {frame.error ?? (ok ? `${frame.elements} elements match` : `${frame.failing.length} of ${frame.elements} elements differ${frame.extra.length ? `, ${frame.extra.length} extra` : ""}`)}
        </span>
        {frame.images && (
          <a href={verifyFileUrl(token, frame.images.diff)} target="_blank" rel="noreferrer" className="ml-auto flex shrink-0 items-center gap-1 text-accent-700 hover:underline" title="Design and app pixels compared (red: different)">
            {frame.mismatchRatio !== undefined ? `${(frame.mismatchRatio * 100).toFixed(1)}% pixels` : "diff"} <ExternalLink size={11} />
          </a>
        )}
      </div>
      {open && (
        <ul className="ml-5 mt-1 space-y-0.5">
          {frame.failing.slice(0, 30).map((e) => (
            <li key={e.key}>
              <button type="button" className="text-left text-zinc-700 hover:text-accent-700" onClick={() => onSelect(e.key)}>
                <span className="font-medium">{e.label}</span>: <span className="text-rose-700">{e.problems[0] === "missing" ? "not found where the design has it" : e.problems.join("; ")}</span>
              </button>
            </li>
          ))}
          {frame.extra.length > 0 && <li className="text-zinc-600">Not in the design: {frame.extra.slice(0, 5).map((t) => `"${t.slice(0, 40)}"`).join(", ")}</li>}
        </ul>
      )}
    </li>
  );
}
