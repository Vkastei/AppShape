import { proposal, proposeFromJsx, proposeOptionsFor, type RawReview, requestBrief, reviewFrom } from "@appshape/codegen";
import type { DesignRequest } from "@appshape/ir";
import type { DataLocation } from "@appshape/store";
import { loadProject } from "./agent";

/**
 * Design requests (Draw & describe) for the CLI and the coding agent: list them, read one with
 * everything needed to design it, and propose a design for it (JSX) that the board shows for review.
 */

export interface RequestSummary {
  id: string;
  screen: string;
  frameId: string;
  viewport: string;
  status: DesignRequest["status"];
  route?: DesignRequest["route"];
  /** A preset job: `review` asks for findings (submit_review), the others for a design. */
  intent?: DesignRequest["intent"];
  marks: number;
  message: string;
  updatedAt: string;
}

export async function listRequests(location: DataLocation): Promise<RequestSummary[]> {
  const { project } = await loadProject(location);
  return (project.requests ?? []).map((r) => ({
    id: r.id,
    screen: project.frames.find((f) => f.id === r.frameId)?.name ?? r.frameId,
    frameId: r.frameId,
    viewport: r.viewportId,
    status: r.status,
    ...(r.route && { route: r.route }),
    ...(r.intent && { intent: r.intent }),
    marks: r.shapes.length,
    message: r.message,
    updatedAt: r.updatedAt,
  }));
}

/** Waiting for the coding agent: sent to it from the board and not designed yet. */
export const isWaiting = (r: Pick<DesignRequest, "route" | "status">) => r.route === "agent" && r.status === "designing";

/** A request with everything needed to design it (Markdown). */
export async function readRequest(location: DataLocation, id: string): Promise<{ request: DesignRequest; brief: string }> {
  const { project } = await loadProject(location);
  const request = project.requests?.find((r) => r.id === id);
  if (!request) throw new Error(`No design request ${id}. List them with: appshape requests`);
  return { request, brief: requestBrief(project, request) };
}

/** A review for a request (its job is `review`): stored on it, the board shows the findings. */
export async function submitReview(location: DataLocation, id: string, raw: RawReview, by: string): Promise<{ findings: number }> {
  const { files, project } = await loadProject(location);
  const request = project.requests?.find((r) => r.id === id);
  if (!request) throw new Error(`No design request ${id}. List them with: appshape requests`);
  if (request.intent !== "review") throw new Error(`Request ${id} asks for a design, not a review: use propose_design.`);
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new Error(`The screen of request ${id} doesn't exist any more.`);
  const now = new Date().toISOString();
  const review = reviewFrom(frame, raw, by, now);
  const next: DesignRequest = { ...request, status: "proposed", review, updatedAt: now };
  await files.save({ ...project, requests: (project.requests ?? []).map((r) => (r.id === id ? next : r)) });
  return { findings: review.findings.length };
}

/** A design for a request: the whole screen as JSX, and with variants the idea in a few words. */
export interface ProposedDesign {
  jsx: string;
  idea?: string;
}

/**
 * A design for a request (the screen as JSX), or 2–3 variants of it: saved as the request's
 * proposal, which the board shows for review (accept, try again, discard; with variants, pick one
 * first). Nothing changes in the design until it's accepted.
 */
export async function proposeDesign(location: DataLocation, id: string, design: string | ProposedDesign[], by: string, notes: string[] = []): Promise<{ summary: string[]; warnings: string[] }> {
  const { files, project } = await loadProject(location);
  const request = project.requests?.find((r) => r.id === id);
  if (!request) throw new Error(`No design request ${id}. List them with: appshape requests`);
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new Error(`The screen of request ${id} doesn't exist any more.`);
  const designs = typeof design === "string" ? [{ jsx: design }] : design;
  if (designs.length < 1 || designs.length > 3) throw new Error("Propose one design, or two or three variants.");
  const several = designs.length > 1;
  const now = new Date().toISOString();
  const drafts = designs.map((d, i) => {
    try {
      return proposeFromJsx(project, frame.id, d.jsx, proposeOptionsFor(project, request));
    } catch (error) {
      throw several ? Object.assign(error as Error, { message: `Variant ${i + 1}: ${(error as Error).message}` }) : error;
    }
  });
  const made = drafts.map((draft, i) => ({
    ...proposal(frame, draft, by, now),
    ...(several && { variant: i + 1, ...(designs[i]!.idea?.trim() && { idea: designs[i]!.idea!.trim().slice(0, 120) }) }),
    ...(notes.length && { questions: notes }),
  }));
  const { alternatives: _alternatives, ...rest } = request;
  const next: DesignRequest = { ...rest, status: "proposed", proposal: made[0]!, ...(several && { alternatives: made.slice(1) }), updatedAt: now };
  await files.save({ ...project, requests: (project.requests ?? []).map((r) => (r.id === id ? next : r)) });
  const label = (i: number, line: string) => (several ? `Variant ${i + 1}: ${line}` : line);
  return { summary: drafts.flatMap((d, i) => d.summary.map((s) => label(i, s))), warnings: drafts.flatMap((d, i) => d.warnings.map((w) => label(i, w))) };
}
