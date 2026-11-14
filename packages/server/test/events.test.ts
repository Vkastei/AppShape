import type { AppProcess, AppProcessEvent } from "@appshape/capture";
import type { Changeset } from "@appshape/ir";
import type { LogEntry } from "@appshape/protocol";
import { describe, expect, it } from "vitest";
import { EventLog } from "../src/events";

const quiet = { info() {}, warn() {}, error() {} };

/** A stand-in for the app process: events are pushed by the test. */
function fakeApp(log: string[] = []) {
  let listener: ((event: AppProcessEvent) => void) | undefined;
  const app = {
    onEvent: (l: (event: AppProcessEvent) => void) => {
      listener = l;
      return () => (listener = undefined);
    },
    status: () => ({ state: "failed" as const, log }),
  } as unknown as AppProcess;
  return { app, emit: (event: AppProcessEvent) => listener?.(event) };
}

describe("event log", () => {
  it("keeps entries, tells listeners and pairs a step with its result", () => {
    const events = new EventLog(quiet);
    const seen: LogEntry[] = [];
    events.subscribe((e) => seen.push(e));
    const step = events.step("import", "Bringing in 2 pages…");
    step.done("Brought in 2 pages");
    step.fail("ignored after the result");
    events.warn("a problem");
    expect(seen.map((e) => [e.level, e.text, e.done ?? false])).toEqual([
      ["step", "Bringing in 2 pages…", false],
      ["step", "Brought in 2 pages", true],
      ["warn", "a problem", false],
    ]);
    expect(seen[0]!.task).toBe(seen[1]!.task);
    expect(events.recent()).toHaveLength(3);
  });

  it("turns the app's state into steps and its output into output lines", () => {
    const events = new EventLog(quiet);
    const { app, emit } = fakeApp(["error: port in use"]);
    events.watchApp(app);
    emit({ type: "state", state: "starting" });
    emit({ type: "line", line: "> next dev" });
    emit({ type: "state", state: "running", url: "http://localhost:3000" });
    emit({ type: "state", state: "starting" });
    emit({ type: "state", state: "failed" });
    expect(events.recent().map((e) => [e.level, e.text, e.detail ?? ""])).toEqual([
      ["step", "Starting your app…", ""],
      ["output", "> next dev", ""],
      ["step", "Your app is running", "http://localhost:3000"],
      ["step", "Starting your app…", ""],
      ["error", "Your app couldn't start", "error: port in use"],
    ]);
  });

  it("reports changeset status changes made by the agent", () => {
    const events = new EventLog(quiet);
    const cs = (status: Changeset["status"]) => ({ id: "cs_1", title: "Handoff", status }) as Changeset;
    events.changesetChanges([cs("ready")], [cs("in_progress")]);
    events.changesetChanges([cs("in_progress")], [cs("in_progress")]);
    events.changesetChanges([cs("in_progress")], [cs("applied")]);
    expect(events.recent().map((e) => [e.source, e.text])).toEqual([
      ["agent", "Your AI started working on Handoff"],
      ["agent", "Your AI says it finished Handoff"],
    ]);
  });
});
