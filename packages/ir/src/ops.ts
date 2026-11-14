import { z } from "zod";
import { ComponentDefSchema } from "./component";
import { FrameSchema, FrameTargetSchema, PageMetaSchema, SCREEN_TRANSITIONS, ViewportSchema } from "./frame";
import { IdSchema } from "./ids";
import { JsonValueSchema } from "./json";
import { AnnotationSchema, DesignNodeSchema, TextSpanSchema } from "./node";
import { BoxPatchSchema, ConditionSchema, LayoutPatchSchema, StylePatchSchema } from "./style";
import { ThemeIdSchema } from "./tokens";

/**
 * For nodes inside a component instance or a repeated item: does the edit apply to this
 * one instance only, or to the component / all repeated items?
 */
export const ScopeSchema = z.enum(["instance", "component"]);
export type Scope = z.infer<typeof ScopeSchema>;

const base = { id: IdSchema, frameId: IdSchema };
const nodeBase = { ...base, nodeId: IdSchema, scope: ScopeSchema.optional() };

export const InsertOpSchema = z.strictObject({
  ...base,
  op: z.literal("insert"),
  parentId: IdSchema,
  /** Position among the parent's children. */
  index: z.int().min(0),
  node: DesignNodeSchema,
  scope: ScopeSchema.optional(),
});
export const DeleteOpSchema = z.strictObject({ ...nodeBase, op: z.literal("delete") });
export const MoveOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("move"),
  parentId: IdSchema,
  /** Position among the new parent's children after the node has been removed from its old place. */
  index: z.int().min(0),
});
export const RestyleOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("restyle"),
  style: StylePatchSchema,
  /** Edit the override for this condition instead of the base style. */
  when: ConditionSchema.optional(),
});
export const RelayoutOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("relayout"),
  layout: LayoutPatchSchema.optional(),
  box: BoxPatchSchema.optional(),
  when: ConditionSchema.optional(),
});
export const RetextOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("retext"),
  text: z.string(),
  /** Replaces the spans; absent = plain text. */
  spans: z.array(TextSpanSchema).optional(),
});
export const ReplaceImageOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("replaceImage"),
  src: z.string().min(1),
  alt: z.string().nullable().optional(),
});
export const SetVisibilityOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("setVisibility"),
  /**
   * Without `when`: true hides the node, false/null shows it.
   * With `when`: true/false set the override (false = shown under that condition, e.g. `md:flex`
   * on a node hidden by default), null removes the override's visibility.
   */
  hidden: z.boolean().nullable(),
  when: ConditionSchema.optional(),
});
export const SetLinkOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("setLink"),
  href: z.string().nullable().optional(),
  targetFrameId: IdSchema.nullable().optional(),
});
export const SetPropsOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("setProps"),
  /** Shallow patch of instance props; `null` removes a prop. */
  props: z.record(z.string(), JsonValueSchema),
});
export const SwapComponentOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("swapComponent"),
  componentId: IdSchema,
  /** Replaces all props when given. */
  props: z.record(z.string(), JsonValueSchema).optional(),
});
export const SetAttrsOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("setAttrs"),
  /** Type-specific attributes (see `ATTR_KEYS`); `null` removes an attribute. */
  attrs: z.record(z.string(), JsonValueSchema),
});
/** Classes kept on the element as they are (no design equivalent, e.g. `backdrop-blur-md`). */
export const SetClassesOpSchema = z.strictObject({
  ...nodeBase,
  op: z.literal("setClasses"),
  /** null (or empty) removes them. */
  unmapped: z.array(z.string().min(1)).nullable(),
  /** The element's HTML tag as captured (`h2`, `section`); null removes it, absent leaves it. */
  tag: z.string().min(1).nullable().optional(),
});
export const RenameOpSchema = z.strictObject({
  ...base,
  op: z.literal("rename"),
  nodeId: IdSchema,
  name: z.string().nullable(),
});
export const AnnotateOpSchema = z.strictObject({
  ...base,
  op: z.literal("annotate"),
  /** Absent = annotate the frame itself. */
  nodeId: IdSchema.optional(),
  annotation: AnnotationSchema,
});
export const UnannotateOpSchema = z.strictObject({
  ...base,
  op: z.literal("unannotate"),
  nodeId: IdSchema.optional(),
  annotationId: IdSchema,
});
export const CreateFrameOpSchema = z.strictObject({
  ...base,
  op: z.literal("createFrame"),
  frame: FrameSchema,
});
export const DeleteFrameOpSchema = z.strictObject({ ...base, op: z.literal("deleteFrame") });
export const UpdateFrameOpSchema = z.strictObject({
  ...base,
  op: z.literal("updateFrame"),
  patch: z.strictObject({
    name: z.string().min(1).optional(),
    target: FrameTargetSchema.optional(),
    viewports: z.array(ViewportSchema).min(1).optional(),
    /** Component frames only: replaces the component definition. */
    component: ComponentDefSchema.optional(),
    /** The screen's named theme; null: the project's theme again. */
    theme: ThemeIdSchema.nullable().optional(),
    /** Page settings, replaced as a whole; null removes them. */
    meta: PageMetaSchema.nullable().optional(),
    /** An overlay screen (true) or a page again (null). */
    overlay: z.literal(true).nullable().optional(),
    /** How it arrives in the prototype; null: instantly. */
    transition: z.enum(SCREEN_TRANSITIONS).nullable().optional(),
  }),
});

export const OpSchema = z.discriminatedUnion("op", [
  InsertOpSchema,
  DeleteOpSchema,
  MoveOpSchema,
  RestyleOpSchema,
  RelayoutOpSchema,
  RetextOpSchema,
  ReplaceImageOpSchema,
  SetVisibilityOpSchema,
  SetLinkOpSchema,
  SetPropsOpSchema,
  SwapComponentOpSchema,
  SetAttrsOpSchema,
  SetClassesOpSchema,
  RenameOpSchema,
  AnnotateOpSchema,
  UnannotateOpSchema,
  CreateFrameOpSchema,
  DeleteFrameOpSchema,
  UpdateFrameOpSchema,
]);
export type Op = z.infer<typeof OpSchema>;
export type OpKind = Op["op"];
export type FrameLevelOp = Extract<Op, { op: "createFrame" | "deleteFrame" | "updateFrame" }>;
/** Ops that change a frame's `current` tree or annotations. */
export type TreeOp = Exclude<Op, FrameLevelOp>;

export const SCOPED_OPS = [
  "insert",
  "delete",
  "move",
  "restyle",
  "relayout",
  "retext",
  "replaceImage",
  "setVisibility",
  "setLink",
  "setProps",
  "swapComponent",
  "setAttrs",
  "setClasses",
] as const satisfies readonly OpKind[];
