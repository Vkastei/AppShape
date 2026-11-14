import { DesignNodeSchema } from "@appshape/ir";
import { z } from "zod";
import { STACK_IDS } from "./stacks";

/**
 * What AppShape generated last time (`.appshape/code/state.json`). Lets later design changes be
 * applied to the code as targeted edits: an element whose source still hashes like this was not
 * edited by anyone and can be regenerated.
 */

export const AppLayoutSchema = z.strictObject({
  stack: z.enum(STACK_IDS),
  srcDir: z.boolean(),
  tailwind: z.union([z.literal(3), z.literal(4)]),
  cssPath: z.string().optional(),
  motion: z.enum(["motion", "framer-motion"]).optional(),
});

export const NodeStateSchema = z.strictObject({
  /** Hash of the generated element (whitespace ignored). */
  hash: z.string(),
  /** The generated opening tag (whole element when self-closing). */
  open: z.string(),
  /** Offset in the generated file (to pick between identical elements). */
  start: z.int().min(0),
  /** Child node ids, to notice structure changes. */
  children: z.array(z.string()).optional(),
});
export type NodeState = z.infer<typeof NodeStateSchema>;

export const FileStateSchema = z.strictObject({
  kind: z.enum(["page", "component", "routes", "css", "utils", "asset"]),
  /** Hash of the whole file as generated (whitespace ignored). */
  hash: z.string(),
  frameId: z.string().optional(),
  /** Import lines of the generated file. */
  imports: z.array(z.string()).optional(),
  nodes: z.record(z.string(), NodeStateSchema).optional(),
});
export type FileState = z.infer<typeof FileStateSchema>;

export const CodeStateSchema = z.strictObject({
  version: z.literal(1),
  layout: AppLayoutSchema,
  appliedAt: z.iso.datetime(),
  files: z.record(z.string(), FileStateSchema),
  /** Annotations ("notes for the AI") already handed to the agent. */
  handedOff: z.array(z.string()),
  /**
   * Imported pages: what their code renders as far as AppShape knows (the capture plus the edits
   * it applied since), with anchors kept up to date. Absent = the capture (the frame's baseline).
   */
  imported: z.record(z.string(), z.strictObject({ tree: DesignNodeSchema })).optional(),
});
export type CodeState = z.infer<typeof CodeStateSchema>;

export const CODE_STATE_FILE = "code/state.json";
