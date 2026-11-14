import type { AgentRunStatus } from "@appshape/protocol";
import { Bot, Loader2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { agentRunStatus, saveAgentRunSettings, startAgentRun, stopAgentRun } from "../lib/api";
import { notify, useEditor } from "../store";

/** A system notification when the board isn't in front (asked for once, when the person turns this on). */
function notifyAway(text: string) {
  if (typeof Notification === "undefined" || !document.hidden || Notification.permission !== "granted") return;
  new Notification("AppShape", { body: text });
}

const askForNotifications = () => {
  if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
};

/**
 * Claude Code for one job (`prompt`: the sentence the person would paste): AppShape starts it in
 * the app's folder. On its own when the person said yes once (and only once per job), else with a
 * button; then what it's doing, Stop, and the outcome.
 */
export function AgentStarter({ prompt }: { prompt: string }) {
  const token = useEditor((s) => s.token);
  const [status, setStatus] = useState<AgentRunStatus>();
  const [always, setAlways] = useState(false);
  const started = useRef(false);
  const run = status?.runs.filter((r) => r.prompt === prompt).at(-1);
  const busy = status?.runs.some((r) => r.state === "running");

  const refresh = async () => {
    if (!token) return;
    try {
      setStatus(await agentRunStatus(token));
    } catch {
      // the server is restarting: the next poll tries again
    }
  };
  const start = async () => {
    if (!token) return;
    started.current = true;
    try {
      await startAgentRun(token, prompt);
      await refresh();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, prompt]);
  // while it works: its state every 2 s, and a notification when it ends
  const wasRunning = useRef(false);
  useEffect(() => {
    if (run?.state === "running") wasRunning.current = true;
    else if (wasRunning.current && run) {
      wasRunning.current = false;
      notifyAway(run.state === "done" ? `Claude Code is done: ${prompt}` : `Claude Code stopped: ${prompt}`);
    }
    if (run?.state !== "running") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.state, run?.id]);
  // on its own: once per job, only when the person said yes
  useEffect(() => {
    if (status?.available && status.autoStart && !run && !busy && !started.current) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.available, status?.autoStart, run, busy]);

  if (!status?.available) return null;
  if (run?.state === "running") {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-white/70 px-2 py-1.5 text-xs" role="status" data-testid="agent-run">
        <Loader2 size={13} className="animate-spin" />
        <span className="flex-1">Claude Code is working on it (started by AppShape). Its steps are in Activity.</span>
        <button type="button" onClick={() => token && void stopAgentRun(token).then(setStatus)} className="flex items-center gap-1 font-semibold underline">
          <Square size={10} /> Stop
        </button>
      </div>
    );
  }
  if (run) {
    return (
      <div className="space-y-1 rounded-md bg-white/70 px-2 py-1.5 text-xs" data-testid="agent-run">
        <p className="font-semibold">{run.state === "done" ? "Claude Code is done." : run.state === "stopped" ? "Claude Code was stopped." : "Claude Code stopped with a problem."}</p>
        {run.summary && <p className="line-clamp-4 whitespace-pre-line text-ink-soft">{run.summary}</p>}
        {run.state !== "done" && (
          <button type="button" disabled={busy} onClick={() => void start()} className="font-semibold underline disabled:opacity-40">
            Start it again
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          askForNotifications();
          if (always && token) setStatus(await saveAgentRunSettings(token, true));
          await start();
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-accent-50 disabled:opacity-40"
        title="AppShape starts Claude Code in your app's folder with your Claude login; it may edit files and run the app's scripts, not install anything or use the web"
      >
        <Bot size={15} /> {busy ? "Claude Code is busy with another job" : "Start Claude Code now"}
      </button>
      <label className="flex items-center gap-1.5 text-[11px] text-ink-soft">
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        From now on, start it on its own
      </label>
    </div>
  );
}

/** The setting (Settings → AI agents): let AppShape start Claude Code on its own. */
export function AgentAutoStartSetting() {
  const token = useEditor((s) => s.token);
  const [status, setStatus] = useState<AgentRunStatus>();
  useEffect(() => {
    if (token) void agentRunStatus(token).then(setStatus).catch(() => {});
  }, [token]);
  if (!status) return null;
  return (
    <label className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm" data-testid="agent-autostart">
      <input
        type="checkbox"
        className="mt-1"
        checked={status.autoStart}
        disabled={!status.available && !status.autoStart}
        onChange={async (e) => {
          if (!token) return;
          if (e.target.checked) askForNotifications();
          setStatus(await saveAgentRunSettings(token, e.target.checked));
        }}
      />
      <span>
        <span className="font-medium text-zinc-900">Let AppShape start Claude Code</span>
        <span className="block text-xs text-zinc-500">
          After <em>Apply to code</em> and for drawings you send to your coding agent, AppShape starts Claude Code in this app's folder with your Claude login, and tells you when it's done. It may edit files and run the app's scripts; it can't install anything or use the web.
          {!status.available && status.reason && <span className="mt-1 block text-amber-700">{status.reason}</span>}
        </span>
      </span>
    </label>
  );
}
