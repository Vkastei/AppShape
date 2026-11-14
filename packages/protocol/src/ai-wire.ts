import { z } from "zod";

/** AppShape's own AI (Draw & describe) between the board and its server. */

export const AiStatusSchema = z.strictObject({
  /** A key was found (the AI route can run). */
  available: z.boolean(),
  /** Where the chosen model's key comes from: the environment (ANTHROPIC_API_KEY, …), the OS keychain (desktop app), or none. */
  keySource: z.enum(["env", "keychain", "none"]),
  /** A key can be saved from the board (the desktop app's keychain); otherwise only ANTHROPIC_API_KEY. */
  canSaveKey: z.boolean(),
  model: z.string(),
  /** The models to choose from; `provider` is who runs it (anthropic, later others), `note` what it's good for. */
  models: z.array(z.strictObject({ id: z.string(), label: z.string(), provider: z.string(), note: z.string() })),
  /** The person has seen what is sent and to whom (asked once). */
  consented: z.boolean(),
  last: z.strictObject({ model: z.string(), costUsd: z.number(), at: z.iso.datetime() }).optional(),
  month: z.strictObject({ month: z.string(), costUsd: z.number(), requests: z.int().min(0) }),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const AiUpdateSchema = z.strictObject({
  model: z.string().min(1).optional(),
  consented: z.boolean().optional(),
  /** A key to save (null removes it); only where `canSaveKey`. */
  key: z.string().min(1).max(500).nullable().optional(),
});
export type AiUpdate = z.infer<typeof AiUpdateSchema>;

/** The expected cost with the chosen model, and with each of the others (for the picker). */
export const AiEstimateSchema = z.strictObject({ model: z.string(), costUsd: z.number(), byModel: z.record(z.string(), z.number()) });
export type AiEstimate = z.infer<typeof AiEstimateSchema>;
