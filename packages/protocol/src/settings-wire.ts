import { ProjectSettingsSchema, RedactionConfigSchema } from "@appshape/ir";
import type { ProjectSettings, RedactionConfig } from "@appshape/ir";
import { z } from "zod";

/** Project settings in the board (`/api/settings`, `/api/agents/*`). */

export const AGENT_IDS = ["claude", "cursor", "codex", "generic"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentStatus {
  id: AgentId;
  name: string;
  description: string;
  /** Set up completely (MCP server and instructions). */
  connected: boolean;
  mcp: boolean;
  instructions: boolean;
  /** Files AppShape writes for it (absolute). */
  files: string[];
}

export interface SettingsResponse {
  name: string;
  settings: ProjectSettings;
  redaction: RedactionConfig;
  location: { mode: "in-repo" | "external"; appRoot: string; dataDir: string };
  agents: AgentStatus[];
  /** How agents start AppShape's MCP server for this project. */
  mcp: { command: string; args: string[]; env?: Record<string, string> };
  /** Viewport ids the project's screens use (for the checks). */
  viewports: string[];
}

export const SettingsUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).optional(),
  settings: ProjectSettingsSchema.optional(),
  redaction: RedactionConfigSchema.optional(),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
