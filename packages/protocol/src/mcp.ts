import {
  CHANGE_STATUSES,
  ChangesetStatusSchema,
  ComponentSchema,
  DesignNodeSchema,
  FRAME_KINDS,
  FrameTargetSchema,
  IdSchema,
  REQUEST_ROUTES,
  REQUEST_STATUSES,
  TokensSchema,
} from "@appshape/ir";
import { z } from "zod";
import { SpecDocumentSchema } from "./spec";
import { VerifyReportSchema } from "./verify";

/**
 * The MCP contract between AppShape and coding agents. The server (M4) registers exactly these
 * tools; every tool has a CLI equivalent so agents without MCP can do the same through a shell.
 */

export const MCP_SERVER_NAME = "appshape";

export interface ToolContract<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> {
  description: string;
  input: I;
  output: O;
  /** Equivalent CLI command for agents without MCP. */
  cli: string;
  readOnly: boolean;
}

function tool<I extends z.ZodObject, O extends z.ZodType>(contract: ToolContract<I, O>): ToolContract<I, O> {
  return contract;
}

export const ChangesetSummarySchema = z.strictObject({
  id: IdSchema,
  title: z.string(),
  status: ChangesetStatusSchema,
  frames: z.array(z.strictObject({ id: IdSchema, name: z.string(), route: z.string().optional() })),
  changeCount: z.int().min(0),
  updatedAt: z.iso.datetime(),
});

export const FrameSummarySchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(FRAME_KINDS),
  platform: z.enum(["web", "mobile"]),
  target: FrameTargetSchema,
});

const ImageResultSchema = z.strictObject({
  mimeType: z.enum(["image/png", "image/webp"]),
  /** Base64; MCP servers return this as image content. */
  data: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
});

export const DesignRequestSummarySchema = z.strictObject({
  id: IdSchema,
  screen: z.string(),
  frameId: IdSchema,
  viewport: z.string(),
  status: z.enum(REQUEST_STATUSES),
  route: z.enum(REQUEST_ROUTES).optional(),
  marks: z.int().min(0),
  message: z.string(),
  updatedAt: z.iso.datetime(),
});

export const mcpTools = {
  list_changesets: tool({
    description:
      "List AppShape changesets. Agents normally only work on changesets with status 'ready' (or 'needs_fix').",
    input: z.object({ status: z.array(ChangesetStatusSchema).optional() }),
    output: z.object({ changesets: z.array(ChangesetSummarySchema) }),
    cli: "appshape changesets [--status ready]",
    readOnly: true,
  }),
  get_changeset: tool({
    description:
      "Get the implementation spec for a changeset: numbered changes with source locations, class diffs, " +
      "inserted trees, requirements and acceptance criteria.",
    input: z.object({ changesetId: IdSchema, format: z.enum(["markdown", "json"]).optional() }),
    output: z.union([z.object({ markdown: z.string() }), z.object({ spec: SpecDocumentSchema })]),
    cli: "appshape spec <changesetId> [--json]",
    readOnly: true,
  }),
  get_frame: tool({
    description:
      "Get a frame's design tree (baseline = as imported, current = as designed). " +
      "Format 'jsx' is compact and readable; 'json' is the full IR.",
    input: z.object({
      frameId: IdSchema,
      version: z.enum(["baseline", "current"]).optional(),
      format: z.enum(["jsx", "json"]).optional(),
      /** Limit to a subtree. */
      nodeId: IdSchema.optional(),
    }),
    output: z.object({ frame: FrameSummarySchema, tree: z.union([z.string(), DesignNodeSchema]) }),
    cli: "appshape frame <frameId> [--baseline] [--json] [--node <nodeId>]",
    readOnly: true,
  }),
  get_screenshot: tool({
    description:
      "Get an image of a frame: 'baseline' (captured app), 'current' (the design) or 'live' (capture the running app now).",
    input: z.object({
      frameId: IdSchema,
      version: z.enum(["baseline", "current", "live"]),
      viewport: z.string().optional(),
      /** Crop to a node and outline it. */
      nodeId: IdSchema.optional(),
    }),
    output: ImageResultSchema,
    cli: "appshape screenshot <frameId> --version <baseline|current|live> [--viewport <id>] [--out file.png]",
    readOnly: true,
  }),
  get_tokens: tool({
    description: "Get the project's design tokens (from the Tailwind/NativeWind theme) and the style dialect.",
    input: z.object({}),
    output: z.object({ styleDialect: z.string(), tokens: TokensSchema }),
    cli: "appshape tokens [--json]",
    readOnly: true,
  }),
  list_components: tool({
    description: "List components detected in the project (to reuse instead of writing new markup).",
    input: z.object({ platform: z.enum(["web", "mobile"]).optional() }),
    output: z.object({
      components: z.array(ComponentSchema.pick({ id: true, name: true, kind: true, platform: true, source: true, library: true })),
    }),
    cli: "appshape components [--platform web|mobile]",
    readOnly: true,
  }),
  get_component: tool({
    description: "Get one component: source location, props and a preview tree.",
    input: z.object({ componentId: IdSchema }),
    output: z.object({ component: ComponentSchema }),
    cli: "appshape component <componentId> [--json]",
    readOnly: true,
  }),
  set_changeset_status: tool({
    description:
      "Mark a changeset as in_progress when you start and applied when every change is implemented. " +
      "Use verify_changeset afterwards.",
    input: z.object({
      changesetId: IdSchema,
      status: z.enum(["in_progress", "applied"]),
      note: z.string().optional(),
    }),
    output: z.object({ changeset: ChangesetSummarySchema }),
    cli: "appshape status <changesetId> <in_progress|applied> [--note text]",
    readOnly: false,
  }),
  set_change_status: tool({
    description: "Report the status of one change (c1, c2, …). Add a note when a change was skipped or failed.",
    input: z.object({
      changesetId: IdSchema,
      changeId: z.string().regex(/^c[0-9]+$/),
      status: z.enum(CHANGE_STATUSES),
      note: z.string().optional(),
    }),
    output: z.object({ changeset: ChangesetSummarySchema }),
    cli: "appshape status <changesetId> <changeId> <applied|failed|skipped> [--note text]",
    readOnly: false,
  }),
  verify_changeset: tool({
    description:
      "Recapture the running app and compare it with the design. Returns per-change pass/fail with details. " +
      "Fix failures and call again until the status is 'verified'.",
    input: z.object({
      changesetId: IdSchema,
      changeIds: z.array(z.string()).optional(),
      /** A dev server that is already running; otherwise AppShape starts the app's own. */
      url: z.string().optional(),
    }),
    output: VerifyReportSchema,
    cli: "appshape verify <changesetId> [--change c1,c2] [--url <url>]",
    readOnly: false,
  }),
  list_design_requests: tool({
    description:
      "List the design requests: screens someone marked up on the AppShape board with a message about the change. " +
      "Requests with route 'agent' and status 'designing' are waiting for you.",
    input: z.object({ waiting: z.boolean().optional() }),
    output: z.object({ requests: z.array(DesignRequestSummarySchema) }),
    cli: "appshape requests",
    readOnly: true,
  }),
  get_design_request: tool({
    description:
      "Get a design request: the message, the drawing in words (with the elements each mark touches), the rules of the answer, " +
      "the components and tokens, the screen as design JSX (an id on every element), and a picture of the screen with the drawing.",
    input: z.object({ requestId: IdSchema }),
    output: z.object({ brief: z.string() }),
    cli: "appshape request <requestId> [--image file.png]",
    readOnly: true,
  }),
  submit_review: tool({
    description:
      "Answer a review request (its job says \"review this screen\"): a one-sentence summary and at most 5 findings, each with a title, " +
      "why it matters (one sentence, no jargon), the fix (one sentence), the data-ids it's about and a severity. Change nothing: " +
      "the person turns findings into changes on the board.",
    input: z.object({
      requestId: IdSchema,
      summary: z.string().max(500).optional(),
      findings: z
        .array(z.object({ title: z.string().min(1), why: z.string().min(1), fix: z.string().min(1), targets: z.array(z.string()).optional(), severity: z.enum(["important", "nice"]).optional() }))
        .max(8),
    }),
    output: z.object({ findings: z.number() }),
    cli: "appshape review <requestId> <findings.json>",
    readOnly: false,
  }),
  propose_design: tool({
    description:
      "Propose a design for a request: the whole screen as design JSX, changed as asked (keep the data-id of every element you keep). " +
      "When the request asks for variants, send them together in `variants` (each the whole screen, with its idea in a few words) instead of `jsx`. " +
      "AppShape reads it into a proposal the person reviews on the board (accept, try again, discard; with variants, pick one); nothing changes before that. " +
      "Returns the changes AppShape read and warnings; fix the JSX and propose again when it can't be read.",
    input: z.object({
      requestId: IdSchema,
      /** The whole screen (one design). */
      jsx: z.string().min(1).optional(),
      /** 2–3 different designs, each the whole screen. */
      variants: z.array(z.object({ jsx: z.string().min(1), idea: z.string().min(1).max(120).optional() })).min(2).max(3).optional(),
      /** Anything the person should know: assumptions, open questions. */
      notes: z.array(z.string().min(1)).optional(),
    }),
    output: z.object({ summary: z.array(z.string()), warnings: z.array(z.string()) }),
    cli: "appshape propose <requestId> <file.tsx> [variant2.tsx variant3.tsx] --by agent",
    readOnly: false,
  }),
} as const;

export type McpToolName = keyof typeof mcpTools;

export const mcpResources = {
  tokens: { uri: "appshape://tokens", description: "Design tokens (same as get_tokens)." },
  components: { uri: "appshape://components", description: "Component catalog (same as list_components)." },
  spec: { uriTemplate: "appshape://changesets/{changesetId}/spec.md", description: "Changeset spec as Markdown." },
} as const;

export const mcpPrompts = {
  implement_changeset: {
    description: "Implement an AppShape changeset end to end: read the spec, apply, report, verify.",
    arguments: [{ name: "changesetId", required: true }],
  },
  design_request: {
    description: "Design an AppShape request: read the drawing and the message, change the screen's JSX, propose it for review.",
    arguments: [{ name: "requestId", required: true }],
  },
} as const;
