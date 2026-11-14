import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AppProcess,
  CaptureBrowser,
  darkModeOf,
  devServerOptions,
  type ImportProgress,
  Importer,
  lucideIconList,
  lucideIconsDir,
  schemeQueries,
  STYLE_FILE_PLACEHOLDER,
  STYLES_DIR,
  type StylesMeta,
} from "@appshape/capture";
import type { AnyOp } from "@appshape/ir";
import type { AppStylesResponse, IconListResponse, ImportRequest, ImportResponse, ImportStatusResponse } from "@appshape/protocol";
import type { DataLocation } from "@appshape/store";
import type { Context, Hono } from "hono";
import type { EventLog } from "./events";
import type { ProjectSession } from "./session";

type ReadInside = (root: string, relative: string) => Promise<{ content: Uint8Array<ArrayBuffer>; type: string } | undefined>;

/**
 * `/api/import/*`: discover and capture pages of the app; `/api/app-styles`, `/api/app-public/*`
 * and `/api/icons/*`: what frames need to look like the app.
 */
export function importRoutes(
  app: Hono,
  session: ProjectSession,
  location: DataLocation,
  log: EventLog,
  appProcess: AppProcess,
  readInside: ReadInside,
  token: string,
  applyFromServer: (ops: AnyOp[]) => boolean,
): { close(): Promise<void> } {
  const importer = new Importer(location.appRoot, location.dataDir);
  const browser = new CaptureBrowser();
  let progress: ImportProgress | undefined;
  let running = false;

  app.get("/api/import", async (c) => {
    const status = await importer.status();
    const imported = new Map(session.snapshot().project.frames.filter((f) => f.kind === "imported" && f.target.route).map((f) => [f.target.route!, f.id]));
    const body: ImportStatusResponse = {
      app: status.detection.kind,
      ...(status.detection.kind === "unsupported" && { reason: status.detection.reason }),
      ...(status.detection.kind === "app" && { stack: status.detection.layout.stack, tailwind: status.detection.layout.tailwind }),
      packageManager: status.packageManager,
      routes: status.routes.map((r) => ({ ...r, ...(imported.has(r.path) && { frameId: imported.get(r.path)! }) })),
      process: appProcess.status(),
      ...(progress && { progress }),
      browserOpen: browser.isOpen,
    };
    return c.json(body);
  });

  /** Opens the capture browser on the app; each press of its button adds a screen. */
  app.post("/api/import/browser", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { devUrl?: unknown };
    const url = typeof body.devUrl === "string" && /^https?:\/\//.test(body.devUrl) ? body.devUrl : await devUrl();
    if (!url) return c.json({ error: "the app's dev server did not start; see its output" }, 502);
    try {
      await browser.open(url, join(location.dataDir, ".cache", "browser"), async (page) => {
        await session.flush();
        const project = session.snapshot().project;
        const result = await importer.captureOpenPage(project, page, { devUrl: url, redaction: project.redaction });
        if (result.ops.length === 0 || !applyFromServer(result.ops)) return "Nothing captured";
        const captured = result.pages[0];
        log.add({ level: "step", source: "import", text: `Captured "${captured?.name}"`, detail: page.url() });
        return `Captured as "${captured?.name}"`;
      });
      return c.json({ open: true });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });
  app.delete("/api/import/browser", async (c) => {
    await browser.close();
    return c.json({ open: false });
  });

  /** Starts the dev server (if it isn't running) and returns its URL. */
  const devUrl = async (): Promise<string | undefined> => {
    const current = appProcess.status();
    if (current.state === "running" && current.url) return current.url;
    const settings = session.snapshot().project.settings?.app;
    if (settings?.devUrl) return settings.devUrl;
    if (current.state !== "starting") {
      const status = await importer.status();
      const framework = status.detection.kind === "app" ? (status.detection.layout.stack.startsWith("next") ? "next" : "vite") : "other";
      await appProcess.run(await devServerOptions(settings, framework));
    }
    return appProcess.waitForUrl();
  };

  app.post("/api/import/dev", async (c) => {
    void devUrl();
    return c.json(appProcess.status());
  });

  app.post("/api/import", async (c) => {
    if (running) return c.json({ error: "an import is already running" }, 409);
    const body = (await c.req.json().catch(() => ({}))) as Partial<ImportRequest>;
    const pages = Array.isArray(body.pages) ? body.pages.filter((p) => typeof p?.route === "string") : [];
    if (pages.length === 0) return c.json({ error: "choose at least one page" }, 400);
    running = true;
    const step = log.step("import", `Bringing in ${pages.length} page${pages.length === 1 ? "" : "s"} from your app…`);
    try {
      progress = { step: "Starting the app", done: 0, total: pages.length + 2 };
      const url = typeof body.devUrl === "string" && /^https?:\/\//.test(body.devUrl) ? body.devUrl : await devUrl();
      if (!url) {
        step.fail("Couldn't bring in the pages: your app didn't start", appProcess.status().log.slice(-15).join("\n"));
        return c.json({ error: "the app's dev server did not start; see its output" }, 502);
      }
      await session.flush();
      const project = session.snapshot().project;
      const result = await importer.import(project, {
        devUrl: url,
        pages: pages.map((p) => ({ route: p.route, ...(typeof p.path === "string" && p.path && { path: p.path }) })),
        redaction: project.redaction,
        replace: body.replace === true,
        onProgress: (p) => {
          progress = p;
          log.add({ level: "info", source: "import", text: p.step });
        },
      });
      step.done(`Brought in ${result.pages.length} page${result.pages.length === 1 ? "" : "s"}`, [...result.pages.map((p) => `${p.route}  ${p.name}`), ...result.warnings].join("\n"));
      const response: ImportResponse = {
        ops: result.ops,
        pages: result.pages.map((p) => ({
          route: p.route,
          frameId: p.frameId,
          name: p.name,
          nodes: p.nodes,
          anchored: p.elements ? p.anchored / p.elements : 0,
          mapped: p.mappedClasses / Math.max(1, p.mappedClasses + p.unmappedClasses),
          redacted: p.redacted,
          warnings: p.warnings,
        })),
        warnings: result.warnings,
      };
      return c.json(response);
    } catch (error) {
      step.fail("Couldn't bring in the pages", (error as Error).message);
      return c.json({ error: (error as Error).message }, 500);
    } finally {
      running = false;
      progress = undefined;
    }
  });

  const stylesDir = join(location.dataDir, STYLES_DIR);
  app.get("/api/app-styles", async (c) => {
    const read = (name: string) => readFile(join(stylesDir, name), "utf8").catch(() => "");
    const [shadow, document, metaText] = await Promise.all([read("app.css"), read("document.css"), read("meta.json")]);
    let meta: Partial<StylesMeta> = {};
    try {
      meta = JSON.parse(metaText) as StylesMeta;
    } catch {
      // nothing imported yet
    }
    // url() requests can't send headers: the token goes in the query.
    const files = (css: string) =>
      css.replace(new RegExp(`${STYLE_FILE_PLACEHOLDER}/([A-Za-z0-9._-]+)`, "g"), (_m, name: string) => `/api/app-styles/files/${name}?token=${encodeURIComponent(token)}`);
    // Styles saved by earlier versions still have `prefers-color-scheme` media queries.
    const board = schemeQueries(shadow);
    const darkMode = darkModeOf(board);
    const body: AppStylesResponse = {
      shadow: files(board),
      document: files(document),
      htmlClasses: meta.htmlClasses ?? [],
      layered: meta.layered ?? false,
      ...(darkMode && { darkMode }),
      version: meta.capturedAt ?? "",
    };
    return c.json(body);
  });

  const serveFrom = (root: () => string, prefix: string) => async (c: Context) => {
    const data = await readInside(root(), c.req.path.slice(prefix.length));
    return data ? c.body(data.content, 200, { "content-type": data.type, "cache-control": "max-age=300" }) : c.text("not found", 404);
  };
  app.get("/api/app-styles/files/*", serveFrom(() => join(stylesDir, "files"), "/api/app-styles/files/"));
  // Root-relative images of imported pages (`/images/logo.png`) are files in the app's public/ folder.
  app.get("/api/app-public/*", serveFrom(() => join(location.appRoot, "public"), "/api/app-public/"));
  app.get("/api/icons/lucide", (c) => c.json({ icons: lucideIconList() } satisfies IconListResponse, 200, { "cache-control": "max-age=3600" }));
  app.get("/api/icons/lucide/*", serveFrom(lucideIconsDir, "/api/icons/lucide/"));
  return { close: () => browser.close() };
}
