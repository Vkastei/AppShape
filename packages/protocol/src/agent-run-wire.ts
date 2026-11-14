import { z } from "zod";

/**
 * AppShape starting the coding agent itself (Claude Code, headless, in the app's folder): after
 * *Apply to code* and for drawings sent to the agent, instead of the person pasting a sentence.
 */

export const AGENT_RUN_STATES = ["running", "done", "failed", "stopped"] as const;

export const AgentRunSchema = z.strictObject({
  id: z.string(),
  /** What the agent was asked ("Implement the AppShape changeset cs_…"). */
  prompt: z.string(),
  state: z.enum(AGENT_RUN_STATES),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** The agent's last words (clipped), or why it failed. */
  summary: z.string().optional(),
  /** What the agent reported it cost (usage on the person's plan). */
  costUsd: z.number().optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const AgentRunStatusSchema = z.strictObject({
  /** Claude Code is installed and connected to this app (its MCP config is there). */
  available: z.boolean(),
  /** Why not, when it isn't. */
  reason: z.string().optional(),
  /** Start it on its own (after Apply to code, for drawings sent to it): the person said yes once. */
  autoStart: z.boolean(),
  /** This session's runs, newest last. */
  runs: z.array(AgentRunSchema),
});
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRunStartSchema = z.strictObject({ prompt: z.string().min(1).max(500) });
export const AgentRunSettingsSchema = z.strictObject({ autoStart: z.boolean() });
