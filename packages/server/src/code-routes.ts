import { CodeService, PlanChangedError, STACK_IDS, type StackId } from "@appshape/codegen";
import type { CodeApplyResponse, CodePlanResponse, CodeStatusResponse } from "@appshape/protocol";
import type { DataLocation } from "@appshape/store";
import type { Hono } from "hono";
import { type AppProcess, devServerOptions, markupRenderer } from "@appshape/capture";
import type { EventLog } from "./events";
import type { ProjectSession } from "./session";

/** `/api/code/*`: preview and apply the design to the app's code, run the app. */
export function codeRoutes(app: Hono, session: ProjectSession, location: DataLocation, log: EventLog, appProcess: AppProcess, publish: (reason: string) => void): void {
  const service = new CodeService(location.appRoot, location.dataDir);
  const stackOf = (value: unknown): StackId | undefined => (STACK_IDS as readonly string[]).includes(value as string) ? (value as StackId) : undefined;

  app.get("/api/code", async (c) => {
    const status = await service.status();
    const state = await service.readState();
    const files: Record<string, string> = {};
    for (const [path, file] of Object.entries(state?.files ?? {})) if (file.frameId) files[file.frameId] = path;
    const body: CodeStatusResponse = {
      files,
      app: status.detection.kind,
      ...(status.detection.kind === "unsupported" && { reason: status.detection.reason }),
      ...(status.layout && { stack: status.layout.stack }),
      appRoot: location.appRoot,
      applied: status.applied,
      ...(status.appliedAt && { appliedAt: status.appliedAt }),
      process: appProcess.status(),
    };
    return c.json(body);
  });

  app.post("/api/code/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { stack?: unknown };
    await session.flush();
    try {
      const plan = await service.plan(session.snapshot().project, { ...(stackOf(body.stack) && { stack: stackOf(body.stack) }) });
      const response: CodePlanResponse = {
        planId: plan.planId,
        stack: plan.layout.stack,
        scaffold: plan.scaffold,
        changes: plan.changes.map((ch) => ({ path: ch.path, summary: ch.summary, ...(ch.before !== undefined && { before: ch.before }), ...(ch.after !== undefined && { after: ch.after }), ...(ch.copyFrom && { copyFrom: ch.copyFrom }) })),
        tasks: plan.tasks.map((t) => ({ kind: t.kind, summary: t.summary, ...(t.file && { file: t.file }), ...(t.line && { line: t.line }), ...(t.code && { code: t.code }) })),
        warnings: plan.warnings,
        install: plan.install,
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post("/api/code/apply", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { planId?: unknown; stack?: unknown };
    if (typeof body.planId !== "string") return c.json({ error: "planId is required" }, 400);
    await session.flush();
    try {
      const stack = stackOf(body.stack);
      const project = session.snapshot().project;
      const pictures = markupRenderer(project, location.appRoot, location.dataDir);
      const result = await service.apply(project, body.planId, { ...(stack && { stack }), markupImage: pictures.render }).finally(() => pictures.close());
      if (result.changeset) {
        session.addChangeset(result.changeset);
        publish(`tasks for the coding agent: ${result.changeset.id}`);
      }
      const files = result.written.length + result.deleted.length;
      log.add({
        level: "step",
        source: "apply",
        text: `Sent the design to the code: ${files} file${files === 1 ? "" : "s"} changed`,
        detail: [...result.written.map((f) => `changed  ${f}`), ...result.deleted.map((f) => `deleted  ${f}`)].join("\n"),
      });
      const tasks = result.changeset?.tasks?.length ?? 0;
      if (tasks) log.add({ level: "step", source: "agent", text: `${tasks} task${tasks === 1 ? "" : "s"} for your AI`, detail: result.changeset!.id });
      // APPSHAPE_NO_INSTALL: tests write the code without installing or starting it.
      const settings = session.snapshot().project.settings;
      if (result.install && settings?.code?.install !== false && !process.env.APPSHAPE_NO_INSTALL) {
        void devServerOptions(settings?.app, undefined, { freePort: false }).then((run) => appProcess.run({ ...run, install: true, start: result.scaffold }));
      }
      const response: CodeApplyResponse = {
        written: result.written,
        deleted: result.deleted,
        taskCount: result.changeset?.tasks?.length ?? 0,
        frameIds: result.frameIds,
        ...(result.changeset && { changesetId: result.changeset.id }),
        ...(result.specFiles[0] && { specFile: result.specFiles[0] }),
      };
      return c.json(response);
    } catch (error) {
      if (!(error instanceof PlanChangedError)) log.error("Couldn't send the design to the code", "apply", (error as Error).message);
      return c.json({ error: (error as Error).message }, error instanceof PlanChangedError ? 409 : 400);
    }
  });

  app.get("/api/code/process", (c) => c.json(appProcess.status()));
  app.post("/api/code/run", async (c) => {
    void devServerOptions(session.snapshot().project.settings?.app, undefined, { freePort: false }).then((run) => appProcess.run(run));
    return c.json(appProcess.status());
  });
  app.post("/api/code/stop", async (c) => {
    await appProcess.stop();
    return c.json(appProcess.status());
  });

}
