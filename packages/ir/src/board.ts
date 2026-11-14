import { z } from "zod";
import { IdSchema } from "./ids";
import { JsonValueSchema } from "./json";

const PointSchema = { x: z.number(), y: z.number() };
const RectSchema = { ...PointSchema, w: z.number().positive(), h: z.number().positive() };

export const EndpointSchema = z.union([
  z.strictObject({ itemId: IdSchema, nodeId: IdSchema.optional() }),
  z.strictObject(PointSchema),
]);

export const BoardItemSchema = z.discriminatedUnion("type", [
  /**
   * Placement of a frame; frame content lives in `Project.frames`. A frame can be placed several
   * times, e.g. once per viewport. Width comes from the viewport, height from the content.
   */
  z.strictObject({
    type: z.literal("frame"),
    id: IdSchema,
    frameId: IdSchema,
    ...PointSchema,
    /** Viewport id from the frame; defaults to the frame's first viewport. */
    viewportId: z.string().optional(),
    /** Component frames: property values to preview (e.g. one placement per variant). */
    props: z.record(z.string(), JsonValueSchema).optional(),
  }),
  z.strictObject({
    type: z.literal("note"),
    id: IdSchema,
    ...PointSchema,
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    text: z.string(),
    color: z.string().optional(),
    attachedTo: z.strictObject({ frameId: IdSchema, nodeId: IdSchema.optional() }).optional(),
  }),
  z.strictObject({
    type: z.literal("arrow"),
    id: IdSchema,
    from: EndpointSchema,
    to: EndpointSchema,
    label: z.string().optional(),
    /** navigation arrows mirror `link.targetFrameId`; flow arrows are free planning. */
    kind: z.enum(["flow", "navigation"]),
  }),
  z.strictObject({ type: z.literal("section"), id: IdSchema, name: z.string(), ...RectSchema, color: z.string().optional() }),
  z.strictObject({ type: z.literal("text"), id: IdSchema, ...PointSchema, text: z.string(), size: z.number().positive().optional() }),
  z.strictObject({ type: z.literal("image"), id: IdSchema, ...RectSchema, src: z.string().min(1) }),
]);
export type BoardItem = z.infer<typeof BoardItemSchema>;

/** Exactly one board per project. */
export const BoardSchema = z.strictObject({
  items: z.array(BoardItemSchema),
});
export type Board = z.infer<typeof BoardSchema>;
