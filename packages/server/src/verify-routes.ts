import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { type AppProcess, VERIFY_DIR, VerifyService } from "@appshape/capture";
import type { VerifyRequest, VerifyResponse } from "@appshape/protocol";
import type { DataLocation } from "@appshape/store";
import type { Hono } from "hono";
import type { EventLog } from "./events";
import type { ProjectSession } from "./session";

/**
 * `/api/verify`: the running app checked against the design, for a changeset (its status follows)
 * or for screens (after a direct apply). Uses the app the editor runs (*Run app*), else starts one
 * and keeps it for the next check.
 */
export function verifyRoutes(
  app: Hono,
  session: ProjectSession,
  location: DataLocation,
  log: EventLog,
  appProcess: AppProcess,
  publish: (reason: string) => void,
): { close: () => Promise<void> } {
  const service = new VerifyService(location.appRoot, location.dataDir);
  let running: Promise<unknown> = Promise.resolve();

  app.post("/api/verify", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as VerifyRequest;
    await session.flush();
    // one verification at a time (they share the browser and the dev server)
    const job = running.then(async (): Promise<VerifyResponse> => {
      const project = session.snapshot().project;
      const url = appProcess.status().state === "running" ? appProcess.status().url : undefined;
      const options = { ...(url && { url }), log: (line: string) => log.info(line, "verify") };
      const step = log.step("verify", "Checking your app against the design…");
      try {
        if (body.changesetId) {
          const result = await service.verifyChangeset(project, body.changesetId, options);
          session.addChangeset(result.changeset);
          publish(`checked ${body.changesetId}`);
          const failing = result.report.results.filter((r) => r.status === "fail").length;
          if (failing) step.fail(`${failing} of ${result.report.results.length} changes don't match the design yet`, body.changesetId);
          else step.done("The app matches the design", body.changesetId);
          return { report: result.report, frames: result.frames, rebaselined: result.rebaselined };
        }
        const frameIds = body.frameIds?.length ? body.frameIds : project.frames.filter((f) => f.kind !== "component" && f.target.route).map((f) => f.id);
        const result = await service.verifyFrames(project, frameIds, options);
        const differing = result.frames.filter((f) => f.error || f.failing.length || f.extra.length);
        const names = new Map(project.frames.map((f) => [f.id, f.name]));
        if (differing.length) step.fail(`${differing.length} of ${result.frames.length} screen views differ from the design`, differing.map((f) => `${names.get(f.frameId) ?? f.frameId} (${f.viewport}): ${f.error ?? `${f.failing.length} elements`}`).join("\n"));
        else step.done("The app matches the design");
        return { frames: result.frames, rebaselined: result.rebaselined };
      } catch (error) {
        step.fail("Couldn't check the app", (error as Error).message);
        throw error;
      }
    });
    running = job.catch(() => undefined);
    try {
      return c.json(await job);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  // screenshots and diff images (paths as in the response, relative to the data folder)
  const root = join(location.dataDir, ...VERIFY_DIR.split("/"));
  app.get("/api/verify/files/*", async (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/api/verify/files/".length));
    const file = normalize(join(location.dataDir, rel));
    if (!file.startsWith(root + sep) || extname(file) !== ".png") return c.text("not found", 404);
    try {
      return c.body(await readFile(file), 200, { "content-type": "image/png", "cache-control": "no-cache" });
    } catch {
      return c.text("not found", 404);
    }
  });

  return { close: () => service.close() };
}
