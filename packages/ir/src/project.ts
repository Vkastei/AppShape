import { z } from "zod";
import { BoardSchema } from "./board";
import { ChangesetSchema } from "./changeset";
import { ComponentSchema } from "./component";
import { FrameSchema } from "./frame";
import { JsonValueSchema } from "./json";
import { DesignRequestSchema } from "./request";
import { TokensSchema } from "./tokens";

export const IR_VERSION = 1;

export const AdapterConfigSchema = z.strictObject({
  /** Adapter id, e.g. `react-vite`, `next`, `expo`. */
  id: z.string().min(1),
  platform: z.enum(["web", "mobile"]),
  /** App root relative to the repository root. */
  root: z.string(),
  /** Style dialect id, e.g. `tailwind-v4`, `tailwind-v3`, `nativewind`. */
  styleDialect: z.string().min(1),
  devCommand: z.string().optional(),
  devUrl: z.string().optional(),
  options: z.record(z.string(), JsonValueSchema).optional(),
});
export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

export const RedactionConfigSchema = z.strictObject({
  /** strict = redact before anything is persisted; local-only = raw data only in `.appshape/.cache`. */
  mode: z.enum(["strict", "local-only", "off"]),
  detectors: z.strictObject({
    email: z.boolean(),
    phone: z.boolean(),
    longDigits: z.boolean(),
    secrets: z.boolean(),
  }),
  /** Extra regular expressions (JavaScript syntax, no slashes). */
  patterns: z.array(z.string()),
  /** CSS selectors / test ids whose content is always redacted. */
  selectors: z.array(z.string()),
});
export type RedactionConfig = z.infer<typeof RedactionConfigSchema>;

export const DEFAULT_REDACTION: RedactionConfig = {
  mode: "strict",
  detectors: { email: true, phone: true, longDigits: true, secrets: true },
  patterns: [],
  selectors: [],
};

/**
 * How AppShape works with this project, for everyone on it (`project.json`). Every value is
 * optional: absent = AppShape's default. The CLI flags of a command override them.
 */
export const ProjectSettingsSchema = z.strictObject({
  /** The user's app and its dev server. */
  app: z
    .strictObject({
      /** package.json script that starts the dev server (default `dev`). */
      devScript: z.string().min(1).optional(),
      /** Default: from the lockfile. */
      packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional(),
      /** Fixed dev server port (default: a free one). */
      port: z.int().min(1).max(65535).optional(),
      /** Use a dev server that is already running instead of starting one. */
      devUrl: z.url().optional(),
    })
    .optional(),
  /** Sending the design to the code. */
  code: z
    .strictObject({
      /** Stack for a new app (`vite-react-router`, `next-app`, `next-pages`, `vite-tanstack`). */
      stack: z.string().min(1).optional(),
      /** Install dependencies after the code needs new ones (default true). */
      install: z.boolean().optional(),
    })
    .optional(),
  /** Checking the app against the design. */
  verify: z
    .strictObject({
      /** Viewport ids to check (default: all of a screen's). */
      viewports: z.array(z.string().min(1)).optional(),
      /** Allowed difference in px for sizes and positions (default 3). */
      tolerance: z.number().min(0).max(50).optional(),
    })
    .optional(),
  /** The website as a whole. */
  site: z
    .strictObject({
      /** Icon in browser tabs: `asset:` path (copied to the app's public folder) or URL. */
      favicon: z.string().min(1).optional(),
    })
    .optional(),
  /** `appshape dev`: the board. */
  board: z
    .strictObject({
      /** Port of the board (default 4590, or a free one). */
      port: z.int().min(1).max(65535).optional(),
      /** Open the browser when the board starts (default true). */
      open: z.boolean().optional(),
    })
    .optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** The whole project in memory. On disk it is split into files under `.appshape/`. */
export const ProjectSchema = z.strictObject({
  irVersion: z.literal(IR_VERSION),
  name: z.string().min(1),
  adapters: z.array(AdapterConfigSchema),
  tokens: TokensSchema,
  components: z.array(ComponentSchema),
  board: BoardSchema,
  frames: z.array(FrameSchema),
  changesets: z.array(ChangesetSchema),
  /** Design requests (drawings on screens, `requests/`); absent = none. */
  requests: z.array(DesignRequestSchema).optional(),
  redaction: RedactionConfigSchema,
  settings: ProjectSettingsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
