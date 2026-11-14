import { z } from "zod";
import { IdSchema } from "./ids";
import { type Op, OpSchema } from "./ops";

export const CHANGESET_STATUSES = ["draft", "ready", "in_progress", "applied", "verified", "needs_fix"] as const;
export const ChangesetStatusSchema = z.enum(CHANGESET_STATUSES);
export type ChangesetStatus = z.infer<typeof ChangesetStatusSchema>;

export const CHANGE_STATUSES = ["pending", "applied", "failed", "skipped"] as const;
export const ChangeStatusSchema = z.enum(CHANGE_STATUSES);
export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;

export const ACTORS = ["user", "agent", "verify"] as const;

/**
 * A numbered change as the agent sees it (`c1`, `c2`, …). One change can cover several ops,
 * e.g. the same restyle applied to all instances of a component.
 */
export const ChangeSchema = z.strictObject({
  id: z.string().regex(/^c[0-9]+$/, "change ids look like c1, c2, …"),
  opIds: z.array(IdSchema).min(1),
  title: z.string().optional(),
});
export type Change = z.infer<typeof ChangeSchema>;

export const TASK_KINDS = ["page", "component", "element", "routes", "theme", "note", "screen", "setup"] as const;

/**
 * A code-level task for the agent (M4 handoff): what AppShape could not write to the code itself.
 * Numbered like changes (`c1`, `c2`, …).
 */
export const ChangesetTaskSchema = z.strictObject({
  id: z.string().regex(/^c[0-9]+$/, "task ids look like c1, c2, …"),
  kind: z.enum(TASK_KINDS),
  title: z.string().min(1),
  /** File in the app (relative to the app root) and 1-based line. */
  file: z.string().optional(),
  line: z.int().positive().optional(),
  frameId: IdSchema.optional(),
  nodeId: IdSchema.optional(),
  /** What AppShape would generate here (the target to merge with the existing code). */
  code: z.string().optional(),
  /** More about the task in plain words (a drawing's shapes and the elements they touch). */
  details: z.string().optional(),
  /** A picture for the task (a marked-up screen), relative to the data folder. */
  image: z.string().optional(),
  /**
   * Elements a drawing kept as a note asks to change: the design doesn't show the change, so the
   * check in the app doesn't hold them (or what's inside them) to it.
   */
  drawn: z.array(IdSchema).optional(),
});
export type ChangesetTask = z.infer<typeof ChangesetTaskSchema>;

export const ChangesetSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string().min(1),
    description: z.string().optional(),
    status: ChangesetStatusSchema,
    /** Squashed ops, in apply order. */
    ops: z.array(OpSchema),
    /** Grouping of ops into numbered changes; frozen when the changeset becomes ready. */
    changes: z.array(ChangeSchema).optional(),
    /** Code-level tasks (handoff after direct apply). */
    tasks: z.array(ChangesetTaskSchema).optional(),
    /** Free-form requirements in addition to annotations. */
    requirements: z.array(z.string().min(1)).optional(),
    changeStatus: z
      .record(
        z.string(),
        z.strictObject({ status: ChangeStatusSchema, note: z.string().optional(), at: z.iso.datetime().optional() }),
      )
      .optional(),
    history: z.array(
      z.strictObject({
        status: ChangesetStatusSchema,
        at: z.iso.datetime(),
        by: z.enum(ACTORS),
        note: z.string().optional(),
      }),
    ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((cs, ctx) => {
    const opIds = new Set(cs.ops.map((op) => op.id));
    if (opIds.size !== cs.ops.length) ctx.addIssue({ code: "custom", message: "duplicate op ids", path: ["ops"] });
    const covered = new Set<string>();
    for (const [i, change] of (cs.changes ?? []).entries()) {
      for (const opId of change.opIds) {
        if (!opIds.has(opId)) ctx.addIssue({ code: "custom", message: `unknown op ${opId}`, path: ["changes", i] });
        if (covered.has(opId)) ctx.addIssue({ code: "custom", message: `op ${opId} is in two changes`, path: ["changes", i] });
        covered.add(opId);
      }
    }
    if (cs.status !== "draft" && cs.ops.length > 0) {
      if (!cs.changes) ctx.addIssue({ code: "custom", message: "non-draft changesets need changes", path: ["changes"] });
      else if (covered.size !== opIds.size) ctx.addIssue({ code: "custom", message: "every op must belong to a change", path: ["changes"] });
    }
    const changeIds = new Set((cs.changes ?? []).map((c) => c.id));
    for (const [i, task] of (cs.tasks ?? []).entries()) {
      if (changeIds.has(task.id)) ctx.addIssue({ code: "custom", message: `duplicate change id ${task.id}`, path: ["tasks", i] });
      changeIds.add(task.id);
    }
    for (const id of Object.keys(cs.changeStatus ?? {})) {
      if (!changeIds.has(id)) ctx.addIssue({ code: "custom", message: `status for unknown change ${id}`, path: ["changeStatus", id] });
    }
  });
export type Changeset = z.infer<typeof ChangesetSchema>;

export const CHANGESET_TRANSITIONS: Record<ChangesetStatus, readonly ChangesetStatus[]> = {
  draft: ["ready"],
  ready: ["draft", "in_progress", "verified", "needs_fix"],
  // verify can run before the agent reports "applied", and again after a fix
  in_progress: ["applied", "ready", "needs_fix", "verified"],
  applied: ["verified", "needs_fix", "in_progress"],
  needs_fix: ["in_progress", "ready", "verified", "applied"],
  verified: [],
};

export class TransitionError extends Error {
  constructor(from: ChangesetStatus, to: ChangesetStatus) {
    super(`changeset cannot go from ${from} to ${to}`);
    this.name = "TransitionError";
  }
}

export function transition(
  changeset: Changeset,
  to: ChangesetStatus,
  by: (typeof ACTORS)[number],
  options: { note?: string; at?: string } = {},
): Changeset {
  if (!CHANGESET_TRANSITIONS[changeset.status].includes(to)) throw new TransitionError(changeset.status, to);
  const at = options.at ?? new Date().toISOString();
  return {
    ...changeset,
    status: to,
    updatedAt: at,
    history: [...changeset.history, { status: to, at, by, ...(options.note ? { note: options.note } : {}) }],
  };
}

/** One change per op, in order. The spec compiler replaces this with smarter grouping (M4). */
export function numberChanges(ops: readonly Op[]): Change[] {
  return ops.map((op, i) => ({ id: `c${i + 1}`, opIds: [op.id] }));
}

export function changesetFrameIds(changeset: Changeset): string[] {
  return [...new Set(changeset.ops.map((op) => op.frameId))];
}
