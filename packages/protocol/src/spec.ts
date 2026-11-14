import {
  ChangesetStatusSchema,
  FRAME_KINDS,
  FrameTargetSchema,
  IdSchema,
  JsonValueSchema,
  ScopeSchema,
  SourceAnchorSchema,
} from "@appshape/ir";
import { z } from "zod";

export const SPEC_VERSION = 1;

/**
 * The agent-facing description of a changeset. Produced by the spec compiler from the IR,
 * served as JSON (`get_changeset` with `format: "json"`) or rendered as Markdown.
 */

export const NodeRefSchema = z.strictObject({
  id: IdSchema,
  /** Human name, e.g. "PricingCard root", "Hero title". */
  name: z.string().optional(),
  /** Readable path from the frame root, e.g. "Pricing › Plans grid › PricingCard". */
  path: z.string().optional(),
  /** Element as written in source, e.g. `div`, `h1`, `Button`. */
  element: z.string().optional(),
  source: SourceAnchorSchema.optional(),
});
export type NodeRef = z.infer<typeof NodeRefSchema>;

export const ClassDiffSchema = z.strictObject({
  remove: z.array(z.string()),
  add: z.array(z.string()),
});

export const SPEC_CHANGE_KINDS = [
  "restyle",
  "relayout",
  "retext",
  "insert",
  "delete",
  "move",
  "replaceImage",
  "setVisibility",
  "setLink",
  "setProps",
  "swapComponent",
  "setAttrs",
  "setClasses",
  "createFrame",
  "updateFrame",
  "deleteFrame",
  "annotate",
  // handoff tasks (code-level)
  "page",
  "component",
  "element",
  "routes",
  "theme",
  "note",
  "screen",
  "setup",
] as const;

export const SpecChangeSchema = z.strictObject({
  /** Stable id within the changeset: c1, c2, … */
  id: z.string().regex(/^c[0-9]+$/),
  /** Design ops behind the change (empty for handoff tasks). */
  opIds: z.array(IdSchema),
  kind: z.enum(SPEC_CHANGE_KINDS),
  /** One-line summary, imperative. */
  title: z.string().min(1),
  /** Design intent in plain language. */
  details: z.string().optional(),
  node: NodeRefSchema.optional(),
  scope: ScopeSchema.optional(),
  /** For repeated items / component instances: how many exist and which one is meant. */
  instances: z.strictObject({ count: z.int().positive(), which: z.string().optional() }).optional(),
  classes: ClassDiffSchema.optional(),
  text: z.strictObject({ from: z.string().optional(), to: z.string() }).optional(),
  position: z
    .strictObject({
      parent: NodeRefSchema,
      after: NodeRefSchema.optional(),
      before: NodeRefSchema.optional(),
    })
    .optional(),
  /** JSX-like snippet for inserted content, using project components and dialect classes. */
  tree: z.string().optional(),
  props: z.record(z.string(), JsonValueSchema).optional(),
  link: z.strictObject({ route: z.string(), frameId: IdSchema.optional() }).optional(),
  annotations: z.array(z.string()).optional(),
  /** A picture for the change (a marked-up screen), relative to the app root. */
  image: z.string().optional(),
});
export type SpecChange = z.infer<typeof SpecChangeSchema>;

export const SpecFrameSchema = z.strictObject({
  frameId: IdSchema,
  name: z.string().min(1),
  kind: z.enum(FRAME_KINDS),
  platform: z.enum(["web", "mobile"]),
  target: FrameTargetSchema,
  /** e.g. "desktop 1280", "iphone-15 393×852". */
  viewports: z.array(z.string()).min(1),
  screenshots: z
    .strictObject({ before: z.string().optional(), after: z.string().optional() })
    .optional(),
  /** Frame-level design intent (frame annotations). */
  notes: z.array(z.string()).optional(),
  changes: z.array(SpecChangeSchema),
});
export type SpecFrame = z.infer<typeof SpecFrameSchema>;

export const SpecDocumentSchema = z
  .strictObject({
    specVersion: z.literal(SPEC_VERSION),
    generatedAt: z.iso.datetime(),
    /**
     * change = a redesign of existing code (changes describe design ops);
     * handoff = what is left after AppShape wrote the code it could (tasks with target code).
     */
    mode: z.enum(["change", "handoff"]).optional(),
    changeset: z.strictObject({
      id: IdSchema,
      title: z.string().min(1),
      description: z.string().optional(),
      status: ChangesetStatusSchema,
    }),
    project: z.strictObject({
      name: z.string().min(1),
      /** App root relative to the repository root. */
      root: z.string(),
      /** Human-readable stack, e.g. ["React 19", "Vite", "React Router 7", "Tailwind CSS v4"]. */
      stack: z.array(z.string()).min(1),
      adapter: z.string().min(1),
      styleDialect: z.string().min(1),
    }),
    /** Short token overview; full tokens via `get_tokens`. */
    tokens: z.array(z.string()).optional(),
    /** Existing components the agent should reuse. */
    components: z.array(
      z.strictObject({
        name: z.string(),
        file: z.string(),
        kind: z.enum(["project", "ui-kit", "page-local", "user"]),
        usage: z.string().optional(),
      }),
    ),
    frames: z.array(SpecFrameSchema),
    /** Tasks that belong to no single screen (routes, theme, setup). */
    general: z.array(SpecChangeSchema).optional(),
    requirements: z.array(z.string()),
    acceptance: z.array(z.strictObject({ changeId: z.string().optional(), text: z.string().min(1) })),
    /** Stack-specific guidance from the adapter. */
    hints: z.array(z.string()),
  })
  .superRefine((doc, ctx) => {
    const ids = [...doc.frames.flatMap((f) => f.changes.map((c) => c.id)), ...(doc.general ?? []).map((c) => c.id)];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `duplicate change id ${id}`, path: ["frames"] });
      seen.add(id);
    }
    for (const [i, item] of doc.acceptance.entries()) {
      if (item.changeId && !seen.has(item.changeId)) {
        ctx.addIssue({ code: "custom", message: `acceptance refers to unknown change ${item.changeId}`, path: ["acceptance", i] });
      }
    }
  });
export type SpecDocument = z.infer<typeof SpecDocumentSchema>;
