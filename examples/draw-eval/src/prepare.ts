import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designPictures, type launchBrowser } from "@appshape/capture";
import { applyOps, type DesignRequest, type Frame, type Op, type Project } from "@appshape/ir";
import type { EvalCase } from "./cases";
import { desktopLanding, fixtureApp, landing, library, type EvalProject } from "./projects";
import { drawMarks, markNodes, measure } from "./render";
import { must, Screen } from "./tree";

type Browser = Awaited<ReturnType<typeof launchBrowser>>;

/** A case made ready to send: its screen, the elements it names, the drawn request and its two pictures. */
export interface Prepared {
  case: EvalCase;
  source: EvalProject;
  frame: Frame;
  before: Screen;
  refs: Record<string, string>;
  request: DesignRequest;
  images: Awaited<ReturnType<typeof designPictures>>;
}

export type Sources = Record<EvalCase["project"], EvalProject>;

/** The projects, loaded once per run (generated ones get their ids here). */
export async function loadSources(): Promise<Sources> {
  const empty = await mkdtemp(join(tmpdir(), "appshape-eval-"));
  return { landing: await landing(empty), desktopOnly: await desktopLanding(empty), pricing: await library(empty, ["pricing"]), fixture: await fixtureApp() };
}

export async function prepare(c: EvalCase, sources: Sources, browser: Browser): Promise<Prepared> {
  const source = sources[c.project];
  const frame = source.project.frames.find((f) => f.name === c.screen);
  if (!frame) throw new Error(`${c.id}: no screen "${c.screen}"`);
  const viewport = frame.viewports.find((v) => v.id === c.viewport) ?? frame.viewports[0]!;
  const before = new Screen(source.project, frame);
  const refs = Object.fromEntries(Object.entries(c.refs).map(([name, find]) => [name, must(find, before, `${c.id}.${name}`).id]));
  const drawn = c.marks.flatMap((m) => markNodes(m, before).map((n) => n.id));
  const rects = await measure(browser, source, frame, viewport.width, drawn);
  const at = new Date().toISOString();
  const request: DesignRequest = { id: `rq_${c.id.replace(/[^a-z0-9]/g, "")}`.slice(0, 24), frameId: frame.id, viewportId: viewport.id, message: c.message, status: "designing", route: "ai", ...(c.intent && { intent: c.intent }), ...(c.variants && { variants: c.variants }), shapes: drawMarks(c, before, rects, viewport.width), createdAt: at, updatedAt: at };
  const images = await designPictures({ project: source.project, request, appRoot: source.appRoot, dataDir: source.dataDir, browser });
  return { case: c, source, frame, before, refs, request, images };
}

/** The screen with a proposal's ops applied. */
export function afterScreen(p: Prepared, ops: readonly Op[]): Screen {
  const frame = applyOps(new Map([[p.frame.id, p.frame]]), ops).get(p.frame.id)!;
  const project: Project = { ...p.source.project, frames: p.source.project.frames.map((f) => (f.id === frame.id ? frame : f)) };
  return new Screen(project, frame);
}

/** A picture of the screen after the proposal (at the case's size). */
export async function afterImage(p: Prepared, after: Screen, browser: Browser): Promise<Uint8Array> {
  // the same part of a long screen as the pictures sent
  return (await designPictures({ project: after.project, request: p.request, appRoot: p.source.appRoot, dataDir: p.source.dataDir, browser })).clean;
}
