import { z } from "zod";

/**
 * What AppShape does, as the editor shows it: steps and problems as toasts, everything in the log
 * panel. The server keeps recent entries (`GET /api/logs`) and sends new ones over the WebSocket.
 */

export const LOG_LEVELS = [
  /** Start or result of something that takes a while (starting the app, importing, …). */
  "step",
  "info",
  "warn",
  "error",
  /** Output of the user's app (dev server, install): log panel only. */
  "output",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ["server", "app", "import", "apply", "verify", "agent", "editor"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LogEntrySchema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  level: z.enum(LOG_LEVELS),
  source: z.enum(LOG_SOURCES),
  text: z.string(),
  /** More lines (an error's output, a list of files). */
  detail: z.string().optional(),
  /** Entries of one running step share it; the editor shows the latest as one toast. */
  task: z.string().optional(),
  /** The step with this `task` has finished (its result). */
  done: z.boolean().optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

/** Levels that pop up as toasts (the rest only in the log panel). */
export const TOAST_LEVELS: ReadonlySet<LogLevel> = new Set(["step", "warn", "error"]);
