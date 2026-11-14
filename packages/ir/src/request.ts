import { z } from "zod";
import { IdSchema } from "./ids";
import type { Frame } from "./frame";
import type { DesignNode } from "./node";
import { OpSchema } from "./ops";
import { findNode } from "./tree";

/**
 * Design requests (Draw & describe): a screen marked up the way people mark up a printout (crossed
 * out, boxed, arrows, short labels) plus a sentence about the change. AppShape's AI or the coding
 * agent turns it into a proposal; without either it goes to the coding agent as a note.
 * Stored as `.appshape/requests/<id>.json` (committed, so a drawing can be shared through git).
 */

/** The legend: colors with a meaning the AI reads. Other colors are free (no meaning). */
export const MARKUP_LEGEND = {
  remove: { color: "#e5484d", label: "Remove", hint: "Cross out what should go" },
  add: { color: "#30a46c", label: "Add", hint: "Mark where something new belongs" },
  change: { color: "#0d74ce", label: "Change", hint: "Circle what should change or move" },
} as const;
export type LegendColor = keyof typeof MARKUP_LEGEND;
/** Free colors: no meaning, for anything else. */
export const FREE_MARKUP_COLORS = ["#f5a524", "#8e4ec6", "#1f1b2e"] as const;

const ColorSchema = z.union([z.enum(["remove", "add", "change"]), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
const PointSchema = z.tuple([z.number(), z.number()]);

const shapeBase = {
  id: IdSchema,
  color: ColorSchema,
  /** Stroke width in design px. */
  width: z.number().positive().max(64).optional(),
  /** Elements of the screen it crosses, encloses or points at (worked out when it was drawn). */
  targets: z.array(IdSchema).optional(),
};

/**
 * A shape in the screen's design pixels at the request's screen size (independent of zoom):
 * freehand pen strokes, arrows (from → to), rectangles, ellipses and short text labels.
 */
export const MarkupShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...shapeBase, kind: z.literal("pen"), points: z.array(PointSchema).min(1) }),
  z.strictObject({ ...shapeBase, kind: z.literal("arrow"), from: PointSchema, to: PointSchema }),
  z.strictObject({ ...shapeBase, kind: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) }),
  z.strictObject({ ...shapeBase, kind: z.literal("ellipse"), x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) }),
  z.strictObject({ ...shapeBase, kind: z.literal("label"), x: z.number(), y: z.number(), text: z.string().min(1).max(200) }),
]);
export type MarkupShape = z.infer<typeof MarkupShapeSchema>;

export const REQUEST_STATUSES = ["draft", "designing", "proposed"] as const;
/** ai = AppShape's AI (own key), agent = the coding agent over MCP, note = no design, a note for the agent. */
export const REQUEST_ROUTES = ["ai", "agent", "note"] as const;

/**
 * What a request is for, beyond the drawing: `phones` makes a screen work on phones (larger screens
 * stay as they are), `section` adds one new section where the drawing marks it, `review` asks for a
 * review of the screen in plain words (findings, each of which can become a change).
 */
export const REQUEST_INTENTS = ["phones", "section", "review"] as const;
export type RequestIntent = (typeof REQUEST_INTENTS)[number];

/** A proposed design for the request: ops against the screen as it was, reviewed before they apply. */
export const ProposalSchema = z.strictObject({
  /** Hash of the screen the ops were made from (`frameVersion`); a different one means the screen changed since. */
  baseVersion: z.string().min(1),
  /** Frame ops of the request's screen. */
  ops: z.array(OpSchema),
  /** The changes in plain words ("Added a search field"). */
  summary: z.array(z.string().min(1)),
  /** The elements each change is about (by index of `summary`), to point them out. */
  targets: z.array(z.array(IdSchema)).optional(),
  /** Where the proposal left the design system or could not be read exactly. */
  warnings: z.array(z.string().min(1)).optional(),
  /** Who made it: a model id, `agent`, or `file` (`appshape propose`). */
  by: z.string().min(1),
  /** One of several variants: its number (1, 2, 3) and its idea in a few words. */
  variant: z.int().min(1).max(3).optional(),
  idea: z.string().min(1).max(120).optional(),
  /** The answer's questions, if any (what it was unsure about). */
  questions: z.array(z.string().min(1)).optional(),
  usage: z.strictObject({ inputTokens: z.int().min(0), outputTokens: z.int().min(0), costUsd: z.number().min(0).optional() }).optional(),
  at: z.iso.datetime(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** One thing a review found: what to improve, why, how, and the elements it's about. */
export const ReviewFindingSchema = z.strictObject({
  id: z.string().regex(/^f[0-9]+$/),
  /** What to improve, in a few words ("One main button in the hero"). */
  title: z.string().min(1).max(160),
  /** Why it matters to the people using the app (one sentence, no jargon). */
  why: z.string().min(1).max(500),
  /** What to change, concrete enough to design it (becomes the message of the fix). */
  fix: z.string().min(1).max(500),
  severity: z.enum(["important", "nice"]),
  targets: z.array(IdSchema).optional(),
  /** Fixed or skipped. */
  done: z.boolean().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/** A review of a screen (a request with `intent: "review"`). */
export const ReviewSchema = z.strictObject({
  /** The screen as a whole, in one sentence (what works first). */
  summary: z.string().max(500).optional(),
  findings: z.array(ReviewFindingSchema).max(8),
  /** Who reviewed: a model id or `agent`. */
  by: z.string().min(1),
  at: z.iso.datetime(),
  usage: z.strictObject({ inputTokens: z.int().min(0), outputTokens: z.int().min(0), costUsd: z.number().min(0).optional() }).optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const DesignRequestSchema = z.strictObject({
  id: IdSchema,
  frameId: IdSchema,
  /** The screen size it was drawn on. */
  viewportId: z.string().min(1),
  shapes: z.array(MarkupShapeSchema),
  /** "What should change?" */
  message: z.string(),
  status: z.enum(REQUEST_STATUSES),
  /** Chosen when it was sent; `note` keeps it as a note for the coding agent's next handoff. */
  route: z.enum(REQUEST_ROUTES).optional(),
  /** A preset job (absent: whatever the drawing and the message say). */
  intent: z.enum(REQUEST_INTENTS).optional(),
  /** How many different designs to propose (absent: one). */
  variants: z.int().min(2).max(3).optional(),
  /** The proposal to review and accept; with variants, the picked one. */
  proposal: ProposalSchema.optional(),
  /** The other variants (picking one swaps it with `proposal`). */
  alternatives: z.array(ProposalSchema).max(2).optional(),
  /** A review's findings (intent `review`); kept while one of them is being fixed. */
  review: ReviewSchema.optional(),
  /** The finding being fixed (the request is a change request meanwhile; afterwards back to the review). */
  fixing: z.string().optional(),
  /** Earlier messages (each *Try again* adds one), oldest first. */
  history: z.array(z.strictObject({ message: z.string(), at: z.iso.datetime() })).optional(),
  /** Why the last design attempt failed (shown until the next one). */
  error: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DesignRequest = z.infer<typeof DesignRequestSchema>;

/** All variants of a request's proposal, by number (one when there are none). */
export function proposalVariants(request: DesignRequest): Proposal[] {
  if (!request.proposal) return [];
  return [request.proposal, ...(request.alternatives ?? [])].sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0));
}

/** Picking variant `n`: it becomes the proposal, the one before goes back to the others. */
export function pickVariant(request: DesignRequest, n: number): Pick<DesignRequest, "proposal" | "alternatives"> | undefined {
  const all = proposalVariants(request);
  const picked = all.find((p) => p.variant === n);
  if (!picked || picked === request.proposal) return undefined;
  return { proposal: picked, alternatives: all.filter((p) => p !== picked) };
}

/** The color of a shape (legend keys resolved). */
export function markupColor(color: string): string {
  return color in MARKUP_LEGEND ? MARKUP_LEGEND[color as LegendColor].color : color;
}

/** What a shape's color means, for the AI and the coding agent. */
export function markupMeaning(color: string): string | undefined {
  return color in MARKUP_LEGEND ? color : undefined;
}

/** The bounding box of a shape (design px). */
export function shapeBounds(shape: MarkupShape): { x: number; y: number; w: number; h: number } {
  switch (shape.kind) {
    case "pen": {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case "arrow":
      return { x: Math.min(shape.from[0], shape.to[0]), y: Math.min(shape.from[1], shape.to[1]), w: Math.abs(shape.to[0] - shape.from[0]), h: Math.abs(shape.to[1] - shape.from[1]) };
    case "label":
      // about 8 px per character at the label size
      return { x: shape.x, y: shape.y - 16, w: shape.text.length * 8, h: 20 };
    default:
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
}

/** A short description of a shape ("red line", "green rectangle"), for specs and prompts. */
export function describeShape(shape: MarkupShape): string {
  const color = shape.color in MARKUP_LEGEND ? { remove: "red (remove)", add: "green (add)", change: "blue (change)" }[shape.color as LegendColor] : shape.color;
  const what = { pen: "stroke", arrow: "arrow", rect: "rectangle", ellipse: "ellipse", label: "label" }[shape.kind];
  const b = shapeBounds(shape);
  const where = shape.kind === "arrow" ? `from (${Math.round(shape.from[0])}, ${Math.round(shape.from[1])}) to (${Math.round(shape.to[0])}, ${Math.round(shape.to[1])})` : `at (${Math.round(b.x)}, ${Math.round(b.y)}), ${Math.round(b.w)}×${Math.round(b.h)}`;
  return `${color} ${what}${shape.kind === "label" ? ` "${shape.text}"` : ""} ${where}`;
}

/** A short label for an element a shape touches ("Hero title", "the text \"Compare all\"", "image"). */
export function elementLabel(node: DesignNode, componentName?: (id: string) => string | undefined): string {
  if (node.name) return node.name;
  if (node.type === "instance") return componentName?.(node.componentId) ?? "component";
  if (node.type === "text") {
    const text = node.text.trim().replace(/\s+/g, " ");
    return text ? `text "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"` : "text";
  }
  return node.platformRaw?.tag && node.platformRaw.tag !== "div" ? `${node.type} <${node.platformRaw.tag}>` : node.type;
}

/**
 * The drawing in words, one line per shape with the elements it touches: what the AI and the
 * coding agent read next to the picture, so they don't have to guess which element a stroke means.
 */
export function describeMarkup(request: DesignRequest, frame: Frame | undefined, componentName?: (id: string) => string | undefined): string[] {
  return request.shapes.map((shape) => {
    const targets = (shape.targets ?? [])
      .map((id) => {
        const node = frame && findNode(frame.current, id)?.node;
        return node ? `${elementLabel(node, componentName)} (\`${id}\`)` : undefined;
      })
      .filter((t): t is string => t !== undefined);
    return `${describeShape(shape)}${targets.length ? ` — touches ${targets.join(", ")}` : ""}`;
  });
}

/**
 * A short hash of a JSON value, the same in Node and in the browser. Key order doesn't matter: the
 * server's copy (read through the schema) and the board's can list the same keys differently.
 */
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value, (_key, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v)) ?? "";
  // two 32-bit FNV-1a hashes with different seeds
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The version of a screen's design a proposal is made from (its tree). */
export function frameVersion(frame: Frame): string {
  return contentHash(frame.current);
}
