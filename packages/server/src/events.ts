import type { AppProcess } from "@appshape/capture";
import type { Changeset } from "@appshape/ir";
import type { LogEntry, LogLevel, LogSource } from "@appshape/protocol";
import type { Logger } from "./session";

const MAX_ENTRIES = 1000;

export interface Step {
  /** The step finished: its result replaces the running toast. */
  done(text: string, detail?: string): void;
  /** It failed: shown as an error. */
  fail(text: string, detail?: string): void;
}

/**
 * Everything AppShape does in this session, for the editor's toasts and log panel (recent entries
 * kept, new ones pushed to listeners). Also a `Logger`: info/warn/error go to the console as before.
 */
export class EventLog implements Logger {
  private entries: LogEntry[] = [];
  private next = 1;
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(private readonly echo?: Logger) {}

  add(entry: Omit<LogEntry, "id" | "at">): LogEntry {
    const full: LogEntry = { id: `l${this.next++}`, at: new Date().toISOString(), ...entry };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    if (this.echo && entry.level !== "output") {
      const line = `${entry.text}${entry.detail && entry.level === "error" ? `\n${entry.detail}` : ""}`;
      if (entry.level === "error") this.echo.error(line);
      else if (entry.level === "warn") this.echo.warn(line);
      else this.echo.info(line);
    }
    for (const listener of this.listeners) listener(full);
    return full;
  }

  recent(): LogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  info(text: string, source: LogSource = "server"): void {
    this.add({ level: "info", source, text });
  }

  warn(text: string, source: LogSource = "server"): void {
    this.add({ level: "warn", source, text });
  }

  error(text: string, source: LogSource = "server", detail?: string): void {
    this.add({ level: "error", source, text, ...(detail && { detail }) });
  }

  /** Starts a step ("Starting your app…"); its result comes with `done` or `fail`. */
  step(source: LogSource, text: string, task = `${source}-${this.next}`): Step {
    this.add({ level: "step", source, text, task });
    let finished = false;
    const finish = (level: LogLevel, result: string, detail?: string) => {
      if (finished) return;
      finished = true;
      this.add({ level, source, text: result, task, done: true, ...(detail && { detail }) });
    };
    return { done: (result, detail) => finish("step", result, detail), fail: (result, detail) => finish("error", result, detail) };
  }

  /** The user's app (install, dev server): its output in the log, its state changes as steps. */
  watchApp(app: AppProcess): () => void {
    let step: Step | undefined;
    return app.onEvent((event) => {
      if (event.type === "line") {
        this.add({ level: "output", source: "app", text: event.line });
        return;
      }
      switch (event.state) {
        case "installing":
          step?.done("Stopped");
          step = this.step("app", "Installing your app's packages…", "app");
          break;
        case "starting":
          step?.done("Packages installed");
          step = this.step("app", "Starting your app…", "app");
          break;
        case "running":
          step?.done("Your app is running", event.url);
          step = undefined;
          break;
        case "failed": {
          const tail = app.status().log.slice(-15).join("\n");
          if (step) step.fail("Your app couldn't start", tail);
          else this.add({ level: "error", source: "app", text: "Your app stopped with an error", detail: tail });
          step = undefined;
          break;
        }
        case "stopped":
          step?.done("Stopped");
          step = undefined;
          this.add({ level: "info", source: "app", text: "Your app stopped" });
          break;
      }
    });
  }

  /** Status changes an agent made (seen when the project reloads from disk). */
  changesetChanges(before: readonly Changeset[], after: readonly Changeset[]): void {
    const old = new Map(before.map((c) => [c.id, c.status]));
    const SAY: Partial<Record<Changeset["status"], string>> = {
      in_progress: "Your AI started working on",
      applied: "Your AI says it finished",
      verified: "Checked and matching the design:",
      needs_fix: "Needs a fix after the check:",
    };
    for (const changeset of after) {
      const was = old.get(changeset.id);
      if (was === undefined || was === changeset.status) continue;
      const say = SAY[changeset.status];
      if (say) this.add({ level: "step", source: changeset.status === "verified" || changeset.status === "needs_fix" ? "verify" : "agent", text: `${say} ${changeset.title}`, detail: changeset.id });
    }
  }
}
