import { CommandSchema, ProjectSchema } from "@appshape/ir";
import { z } from "zod";
import { LogEntrySchema } from "./log-wire";

/**
 * Messages between the AppShape editor (browser) and the local server over WebSocket.
 * The server is the authority: every accepted command bumps `rev`.
 */

export const ProblemSchema = z.object({
  severity: z.enum(["error", "warning"]),
  file: z.string(),
  message: z.string(),
});
export type WireProblem = z.infer<typeof ProblemSchema>;

export const ProjectSnapshotSchema = z.object({
  rev: z.int().min(0),
  project: ProjectSchema,
  problems: z.array(ProblemSchema),
  location: z.object({ mode: z.enum(["in-repo", "external"]), appRoot: z.string(), dataDir: z.string() }),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), command: CommandSchema, baseRev: z.int().min(0) }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), rev: z.int().min(0) }),
  z.object({ type: z.literal("ack"), commandId: z.string(), rev: z.int().min(0) }),
  z.object({ type: z.literal("reject"), commandId: z.string(), error: z.string(), rev: z.int().min(0) }),
  /** A command accepted from another tab. */
  z.object({ type: z.literal("applied"), rev: z.int().min(0), command: CommandSchema }),
  /** The project changed outside the editor (git, agent, text editor); replace local state. */
  z.object({ type: z.literal("reset"), reason: z.string(), snapshot: ProjectSnapshotSchema }),
  /** Something AppShape did or noticed (see `log-wire.ts`). */
  z.object({ type: z.literal("log"), entry: LogEntrySchema }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const TOKEN_HEADER = "x-appshape-token";
export const UI_STATE_FILE = ".cache/ui.json";

export const UiStateSchema = z.object({
  camera: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
  /** Design check findings this person chose to ignore (their keys). */
  ignoredChecks: z.array(z.string()).optional(),
});
export type UiState = z.infer<typeof UiStateSchema>;
