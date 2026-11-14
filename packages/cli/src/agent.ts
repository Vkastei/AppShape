import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Changeset,
  type ChangesetStatus,
  type ChangeStatus,
  changesetFrameIds,
  type Project,
  transition,
} from "@appshape/ir";
import type { ChangesetVerification, VerifyService } from "@appshape/capture";
import type { DataLocation } from "@appshape/store";
import { ProjectFiles } from "@appshape/store";

/** Changeset operations shared by the CLI and the MCP server (what agents use). */

export interface ChangesetSummary {
  id: string;
  title: string;
  status: ChangesetStatus;
  frames: { id: string; name: string; route?: string }[];
  changeCount: number;
  updatedAt: string;
}

export async function loadProject(location: DataLocation): Promise<{ files: ProjectFiles; project: Project }> {
  const files = new ProjectFiles(location);
  const { project } = await files.load();
  return { files, project };
}

export function summarize(project: Project, changeset: Changeset): ChangesetSummary {
  const frameIds = new Set([...changesetFrameIds(changeset), ...(changeset.tasks ?? []).flatMap((t) => (t.frameId ? [t.frameId] : []))]);
  const frames = project.frames
    .filter((f) => frameIds.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, ...(f.target.route && { route: f.target.route }) }));
  return {
    id: changeset.id,
    title: changeset.title,
    status: changeset.status,
    frames,
    changeCount: (changeset.changes?.length ?? 0) + (changeset.tasks?.length ?? 0),
    updatedAt: changeset.updatedAt,
  };
}

export async function listChangesets(location: DataLocation, statuses?: ChangesetStatus[]): Promise<ChangesetSummary[]> {
  const { project } = await loadProject(location);
  return project.changesets.filter((c) => !statuses?.length || statuses.includes(c.status)).map((c) => summarize(project, c));
}

/** The spec written when the changeset was created (`.appshape/specs/<id>.md|json`). */
export async function readSpec(location: DataLocation, id: string, format: "markdown" | "json"): Promise<string> {
  try {
    return await readFile(join(location.dataDir, "specs", `${id}.${format === "json" ? "json" : "md"}`), "utf8");
  } catch {
    throw new Error(`No spec for changeset ${id}. Specs are written when the design is applied (Apply to code / appshape apply).`);
  }
}

async function update(location: DataLocation, id: string, change: (changeset: Changeset) => Changeset): Promise<ChangesetSummary> {
  const { files, project } = await loadProject(location);
  const changeset = project.changesets.find((c) => c.id === id);
  if (!changeset) throw new Error(`Unknown changeset ${id}`);
  const next = change(changeset);
  await files.save({ ...project, changesets: project.changesets.map((c) => (c.id === id ? next : c)) });
  return summarize(project, next);
}

/** in_progress / applied (and back), with the history entry. */
export function setChangesetStatus(location: DataLocation, id: string, status: ChangesetStatus, note?: string): Promise<ChangesetSummary> {
  return update(location, id, (changeset) => transition(changeset, status, "agent", note ? { note } : {}));
}

/**
 * Verifies a changeset against the running app and saves its new status (verified / needs_fix).
 * The service is passed in so the MCP server can keep the dev server running between calls.
 */
export async function verifyChangesetAt(
  location: DataLocation,
  service: VerifyService,
  id: string,
  options: { url?: string; changeIds?: string[]; log?: (line: string) => void } = {},
): Promise<ChangesetVerification> {
  const { project } = await loadProject(location);
  const result = await service.verifyChangeset(project, id, options);
  if (result.changeset !== project.changesets.find((c) => c.id === id)) await update(location, id, () => result.changeset);
  return result;
}

/** A verification report as text: per change its checks, then the visual comparison. */
export function formatVerification(result: ChangesetVerification, project: Project): string {
  const mark = { pass: "✓", fail: "✗", skipped: "–" } as const;
  const lines = [`${result.report.changesetId}: ${result.report.status === "verified" ? "verified" : "needs fix"}`];
  const titles = new Map((result.changeset.tasks ?? []).map((t) => [t.id, t.title]));
  for (const r of result.report.results) {
    lines.push(`${mark[r.status]} ${r.changeId} ${titles.get(r.changeId) ?? ""}`.trimEnd());
    for (const c of r.checks) lines.push(`    ${mark[c.status]} ${c.text}${c.detail ? `: ${c.detail}` : ""}`);
  }
  const names = new Map(project.frames.map((f) => [f.id, f.name]));
  for (const v of result.report.visual) {
    lines.push(`  ${names.get(v.frameId) ?? v.frameId} (${v.viewport}): ${(v.mismatchRatio * 100).toFixed(1)}% of pixels differ${v.diffImage ? ` · ${v.diffImage}` : ""}`);
  }
  if (result.rebaselined.length) lines.push(`Verified pages are the new code baseline: ${result.rebaselined.map((id) => names.get(id) ?? id).join(", ")}`);
  return lines.join("\n");
}

/** Status of one change or task (c1, c2, …). */
export function setChangeStatus(location: DataLocation, id: string, changeId: string, status: ChangeStatus, note?: string): Promise<ChangesetSummary> {
  return update(location, id, (changeset) => {
    const known = new Set([...(changeset.changes ?? []).map((c) => c.id), ...(changeset.tasks ?? []).map((t) => t.id)]);
    if (!known.has(changeId)) throw new Error(`Changeset ${id} has no change ${changeId}`);
    const at = new Date().toISOString();
    return { ...changeset, updatedAt: at, changeStatus: { ...changeset.changeStatus, [changeId]: { status, at, ...(note && { note }) } } };
  });
}
