import { z } from "zod";
import { ComponentDefSchema } from "./component";
import { IdSchema } from "./ids";
import { AnnotationSchema, DesignNodeSchema } from "./node";
import { ThemeIdSchema } from "./tokens";
import { collectIds } from "./tree";

export const ViewportSchema = z.strictObject({
  /** e.g. `desktop`, `mobile`, `iphone-15`. */
  id: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive().optional(),
  /** Device preset for mobile frames. */
  device: z.string().optional(),
  /** Breakpoint (token name) that is active at this width, e.g. `md`. */
  breakpoint: z.string().optional(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const FrameTargetSchema = z.strictObject({
  /** Adapter id from the project config, e.g. `react-vite`, `next`, `expo`. */
  adapter: z.string().min(1),
  /** Route or screen path, e.g. `/pricing`. */
  route: z.string().optional(),
  /** File that implements (or should implement) this page, relative to the adapter root. */
  file: z.string().optional(),
});
export type FrameTarget = z.infer<typeof FrameTargetSchema>;

export const CaptureInfoSchema = z.strictObject({
  at: z.iso.datetime(),
  url: z.string().optional(),
  commit: z.string().optional(),
  redaction: z.enum(["strict", "local-only", "off"]),
});

export const FRAME_KINDS = ["imported", "new", "sketch", "component"] as const;

/** What a page tells browsers and link previews: its title, description and share image. */
export const PageMetaSchema = z.strictObject({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  /** Share image (Open Graph): `asset:` path or URL. */
  image: z.string().min(1).optional(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

/** Prototype transitions between screens. */
export const SCREEN_TRANSITIONS = ["instant", "fade", "slide", "push"] as const;

export const FrameBaseSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  /**
   * imported = captured page, new = designed page/screen, sketch = freeform idea board,
   * component = main definition of a component (its root is the component's root element).
   */
  kind: z.enum(FRAME_KINDS),
  platform: z.enum(["web", "mobile"]),
  target: FrameTargetSchema,
  viewports: z.array(ViewportSchema).min(1),
  /** Immutable capture result. Only imported frames have a baseline. */
  baseline: DesignNodeSchema.optional(),
  current: DesignNodeSchema,
  capture: CaptureInfoSchema.optional(),
  annotations: z.array(AnnotationSchema).optional(),
  /** Properties and description; only on component frames. */
  component: ComponentDefSchema.optional(),
  /** A named theme (`tokens.themes`) this screen uses instead of the project's look. */
  theme: ThemeIdSchema.optional(),
  /** Page settings (web screens): title, description, share image. */
  meta: PageMetaSchema.optional(),
  /**
   * Shown over other screens when an element opens it (a menu, a dialog): generated with the pages
   * that open it, without a route of its own.
   */
  overlay: z.boolean().optional(),
  /** How the screen arrives when a link opens it in the prototype (default instant). */
  transition: z.enum(SCREEN_TRANSITIONS).optional(),
});

/** Frame metadata without the trees (stored as `frame.json`). */
export const FrameMetaSchema = FrameBaseSchema.omit({ baseline: true, current: true });
export type FrameMeta = z.infer<typeof FrameMetaSchema>;

export const FrameSchema = FrameBaseSchema.superRefine((frame, ctx) => {
  if (frame.kind === "imported" && !frame.baseline) {
    ctx.addIssue({ code: "custom", message: "imported frames need a baseline", path: ["baseline"] });
  }
  if (frame.kind !== "imported" && frame.baseline) {
    ctx.addIssue({ code: "custom", message: "only imported frames have a baseline", path: ["baseline"] });
  }
  if ((frame.kind === "component") !== (frame.component !== undefined)) {
    ctx.addIssue({ code: "custom", message: "component frames (and only they) have a component definition", path: ["component"] });
  }
  if (frame.baseline && frame.baseline.id !== frame.current.id) {
    ctx.addIssue({ code: "custom", message: "baseline and current must share the root id", path: ["current", "id"] });
  }
  for (const key of ["baseline", "current"] as const) {
    const root = frame[key];
    if (!root) continue;
    const seen = new Set<string>();
    for (const id of collectIds(root)) {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `duplicate node id ${id}`, path: [key] });
      seen.add(id);
    }
  }
});
export type Frame = z.infer<typeof FrameSchema>;
