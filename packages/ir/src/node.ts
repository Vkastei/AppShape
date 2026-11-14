import { z } from "zod";
import { IdSchema } from "./ids";
import { type JsonValue, JsonValueSchema } from "./json";
import {
  type Box,
  BoxSchema,
  type Layout,
  LayoutSchema,
  type Override,
  OverrideSchema,
  type Style,
  StyleSchema,
} from "./style";

/** Where a node comes from in the source code (set by the importer's build-time transform). */
export const SourceAnchorSchema = z.strictObject({
  /** Path relative to the adapter root. */
  file: z.string().min(1),
  line: z.int().positive(),
  col: z.int().positive(),
  /** Component function whose JSX contains this element. */
  component: z.string().optional(),
  /** Component that rendered this element (the call site owner). */
  owner: z.string().optional(),
  /** Set when the element is rendered repeatedly from one source location (e.g. `.map()`). */
  repeated: z
    .strictObject({
      count: z.int().positive(),
      index: z.int().min(0),
      key: z.string().optional(),
    })
    .optional(),
});
export type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

/** The node as captured from the platform, kept so edits can be expressed as minimal diffs. */
export const PlatformRawSchema = z.strictObject({
  /** HTML tag on web (`section`, `h1`, …). */
  tag: z.string().optional(),
  /** Native element / component on mobile (`View`, `Pressable`, …). */
  element: z.string().optional(),
  /** Style dialect classes as captured (Tailwind / NativeWind). */
  classes: z.array(z.string()).optional(),
  /**
   * Captured classes the dialect could not express as IR styles (gradients, transforms,
   * `group-hover:` …). Rendered as they are, with the app's own CSS.
   */
  unmapped: z.array(z.string()).optional(),
  props: z.record(z.string(), JsonValueSchema).optional(),
});
export type PlatformRaw = z.infer<typeof PlatformRawSchema>;

export const ANNOTATION_KINDS = ["intent", "data", "behavior", "note", "question"] as const;

/** Intent notes attached to nodes or frames. They become requirements in the agent spec. */
export const AnnotationSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(ANNOTATION_KINDS),
  text: z.string().min(1),
  author: z.enum(["user", "ai"]).optional(),
  createdAt: z.iso.datetime().optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

/** Semantic meaning, independent of the element used (heading level, landmark, …). */
export const SemanticSchema = z.strictObject({
  role: z.string().min(1),
  level: z.int().min(1).max(6).optional(),
});
export type Semantic = z.infer<typeof SemanticSchema>;

export const TextSpanSchema = z.strictObject({
  text: z.string(),
  style: StyleSchema.optional(),
  /** A link on this part of the text (URL or app route). */
  href: z.string().min(1).optional(),
});
export type TextSpan = z.infer<typeof TextSpanSchema>;

/** How an overlay screen is shown: centered over a dimmed page, sliding in from a side, or below the element. */
export const OVERLAY_KINDS = ["modal", "drawer", "dropdown"] as const;

/**
 * What clicking an element does (going to another screen is `targetFrameId`): open an overlay
 * screen, close the overlay it is in, scroll to an element of the screen, or, inside a component,
 * set one of its properties (a menu open, a tab selected).
 */
export const InteractionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("open"),
    /** An overlay screen (`frame.overlay`). */
    frameId: IdSchema,
    as: z.enum(OVERLAY_KINDS),
    /** Drawers: the side it comes from (default right). */
    side: z.enum(["left", "right"]).optional(),
  }),
  z.strictObject({ type: z.literal("close") }),
  z.strictObject({ type: z.literal("scroll"), nodeId: IdSchema }),
  z.strictObject({ type: z.literal("variant"), prop: z.string().min(1), value: z.string() }),
]);
export type Interaction = z.infer<typeof InteractionSchema>;

/**
 * Inside a list's item design: which of the node's fields come from the item (`text`, `src`,
 * `alt`, `href`, or an instance's `props.<name>`) → the item's key.
 */
export const BindSchema = z.record(z.string().regex(/^(text|src|alt|href|icon|props\.[A-Za-z_$][\w$]*)$/), z.string().regex(/^[A-Za-z_$][\w$]*$/));
export type Bind = z.infer<typeof BindSchema>;

export const NODE_TYPES = [
  "box",
  "text",
  "image",
  "icon",
  "button",
  "link",
  "input",
  "scroll",
  "list",
  "instance",
  "slot",
  "element",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const CONTAINER_TYPES = [
  "box",
  "button",
  "link",
  "scroll",
  "list",
  "instance",
  "slot",
  "element",
] as const satisfies readonly NodeType[];

export const INPUT_TYPES = [
  "text",
  "email",
  "password",
  "number",
  "search",
  "tel",
  "url",
  "textarea",
  "checkbox",
  "radio",
  "select",
  "switch",
] as const;

export interface NodeBase {
  id: string;
  name?: string;
  layout?: Layout;
  box?: Box;
  style?: Style;
  overrides?: Override[];
  hidden?: boolean;
  semantic?: Semantic;
  source?: SourceAnchor;
  platformRaw?: PlatformRaw;
  /** `imported` = captured from the running app, `added` = created in AppShape. */
  origin: "imported" | "added";
  annotations?: Annotation[];
  /** Content was replaced by placeholder data during capture (see redaction). */
  redacted?: boolean;
  /** What clicking it does (see `InteractionSchema`). */
  interaction?: Interaction;
  /** Inside a list's item design: fields that come from the item. */
  bind?: Bind;
}

export interface BoxNode extends NodeBase {
  type: "box";
  children: DesignNode[];
}
export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  /** Rich text; when present, the concatenated span texts equal `text`. */
  spans?: TextSpan[];
}
export interface ImageNode extends NodeBase {
  type: "image";
  /** URL, or `asset:<path>` for files in `.appshape/assets`. */
  src: string;
  alt?: string;
  fit?: "cover" | "contain" | "fill" | "none";
}
export interface IconNode extends NodeBase {
  type: "icon";
  /** Icon name within the set, e.g. `check`. */
  icon: string;
  /** Icon set, e.g. `lucide`. */
  set?: string;
}
export interface ButtonNode extends NodeBase {
  type: "button";
  /** Navigation target inside the board (what the button opens). */
  targetFrameId?: string;
  children: DesignNode[];
}
export interface LinkNode extends NodeBase {
  type: "link";
  href?: string;
  /** Navigation target inside the board. */
  targetFrameId?: string;
  children: DesignNode[];
}
export interface InputNode extends NodeBase {
  type: "input";
  inputType: (typeof INPUT_TYPES)[number];
  placeholder?: string;
  value?: string;
  label?: string;
}
export interface ScrollNode extends NodeBase {
  type: "scroll";
  direction: "vertical" | "horizontal";
  children: DesignNode[];
}
export interface ListNode extends NodeBase {
  type: "list";
  /** Where the items come from, e.g. "plans array in src/data/plans.ts". */
  dataHint?: string;
  /**
   * Repeated content: the first child is the item's design, shown once per item with the fields
   * its nodes bind (`bind`). Generated as a data file (`dataName`) and a `.map()`.
   */
  items?: Record<string, JsonValue>[];
  /** Name of the data (`testimonials`): the data file and its export. */
  dataName?: string;
  children: DesignNode[];
}
export interface InstanceNode extends NodeBase {
  type: "instance";
  componentId: string;
  props: Record<string, JsonValue>;
  /** Rendered output of the component. Empty when not rendered yet. */
  children: DesignNode[];
}
export interface SlotNode extends NodeBase {
  type: "slot";
  slotName: string;
  children: DesignNode[];
}
export interface ElementNode extends NodeBase {
  type: "element";
  children: DesignNode[];
}

export type DesignNode =
  | BoxNode
  | TextNode
  | ImageNode
  | IconNode
  | ButtonNode
  | LinkNode
  | InputNode
  | ScrollNode
  | ListNode
  | InstanceNode
  | SlotNode
  | ElementNode;

export type ContainerNode = Extract<DesignNode, { children: DesignNode[] }>;

/** Type-specific attributes changeable through the `setAttrs` op (`semantic` is allowed on all types). */
export const ATTR_KEYS: Record<NodeType, readonly string[]> = {
  box: [],
  text: [],
  image: ["fit"],
  icon: ["icon", "set"],
  button: [],
  link: [],
  input: ["inputType", "placeholder", "value", "label"],
  scroll: ["direction"],
  list: ["dataHint", "items", "dataName"],
  instance: [],
  slot: ["slotName"],
  element: [],
};
export const COMMON_ATTR_KEYS = ["semantic", "interaction", "bind"] as const;

const nodeBaseShape = {
  id: IdSchema,
  name: z.string().optional(),
  layout: LayoutSchema.optional(),
  box: BoxSchema.optional(),
  style: StyleSchema.optional(),
  overrides: z.array(OverrideSchema).optional(),
  hidden: z.boolean().optional(),
  semantic: SemanticSchema.optional(),
  source: SourceAnchorSchema.optional(),
  platformRaw: PlatformRawSchema.optional(),
  origin: z.enum(["imported", "added"]),
  annotations: z.array(AnnotationSchema).optional(),
  redacted: z.boolean().optional(),
  interaction: InteractionSchema.optional(),
  bind: BindSchema.optional(),
};

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() => {
  const children = z.array(DesignNodeSchema);
  return z.discriminatedUnion("type", [
    z.strictObject({ ...nodeBaseShape, type: z.literal("box"), children }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("text"),
      text: z.string(),
      spans: z.array(TextSpanSchema).optional(),
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("image"),
      src: z.string().min(1),
      alt: z.string().optional(),
      fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("icon"),
      icon: z.string().min(1),
      set: z.string().optional(),
    }),
    z.strictObject({ ...nodeBaseShape, type: z.literal("button"), targetFrameId: IdSchema.optional(), children }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("link"),
      href: z.string().optional(),
      targetFrameId: IdSchema.optional(),
      children,
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("input"),
      inputType: z.enum(INPUT_TYPES),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      label: z.string().optional(),
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("scroll"),
      direction: z.enum(["vertical", "horizontal"]),
      children,
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("list"),
      dataHint: z.string().optional(),
      items: z.array(z.record(z.string(), JsonValueSchema)).optional(),
      dataName: z.string().regex(/^[a-z][A-Za-z0-9]*$/).optional(),
      children,
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("instance"),
      componentId: IdSchema,
      props: z.record(z.string(), JsonValueSchema),
      children,
    }),
    z.strictObject({
      ...nodeBaseShape,
      type: z.literal("slot"),
      slotName: z.string().min(1),
      children,
    }),
    z.strictObject({ ...nodeBaseShape, type: z.literal("element"), children }),
  ]);
});
