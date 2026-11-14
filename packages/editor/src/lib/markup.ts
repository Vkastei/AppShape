import { type AnyOp, applyOps, createId, type DesignRequest, type Frame, frameVersion, type MarkupShape, pickVariant, type Project, type Proposal, proposalVariants, shapeBounds } from "@appshape/ir";
import { newOpId } from "./board";

/**
 * Draw & describe on the board: drawings on screens (design requests), the elements each shape
 * touches, and the ops that change them. Shapes are in the screen's design pixels.
 */

export type MarkupTool = "pen" | "arrow" | "rect" | "ellipse" | "label" | "eraser";
export const MARKUP_WIDTHS = [2, 4, 8] as const;

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Depth in the screen's tree (the root is 0). */
  depth: number;
}

/** The drawing on a screen at a size (one per screen and size). */
export function requestFor(project: Project, frameId: string, viewportId: string): DesignRequest | undefined {
  return project.requests?.find((r) => r.frameId === frameId && r.viewportId === viewportId);
}

/** The screen and size a board placement shows. */
export function placementTarget(project: Project, itemId: string): { frame: Frame; viewportId: string } | undefined {
  const item = project.board.items.find((i) => i.id === itemId);
  if (item?.type !== "frame") return undefined;
  const frame = project.frames.find((f) => f.id === item.frameId);
  const viewportId = item.viewportId ?? frame?.viewports[0]?.id;
  return frame && viewportId ? { frame, viewportId } : undefined;
}

const set = (request: DesignRequest | null, requestId: string): AnyOp => ({ id: newOpId(), op: "setRequest", requestId, request });

/** Adds a shape to the screen's drawing (a new drawing when it has none). */
export function addShapeOps(project: Project, frameId: string, viewportId: string, shape: MarkupShape, now = new Date().toISOString()): { ops: AnyOp[]; requestId: string } {
  const current = requestFor(project, frameId, viewportId);
  if (current) return { ops: [set({ ...current, shapes: [...current.shapes, shape], updatedAt: now }, current.id)], requestId: current.id };
  const request: DesignRequest = { id: createId("rq"), frameId, viewportId, shapes: [shape], message: "", status: "draft", createdAt: now, updatedAt: now };
  return { ops: [set(request, request.id)], requestId: request.id };
}

/** The screen's phone size (the narrowest below 640px), if it has one. */
export function phoneViewport(frame: Frame): { id: string; width: number } | undefined {
  return [...frame.viewports].filter((v) => v.width < 640).sort((a, b) => a.width - b.width)[0];
}

/** A drawing of a screen size that is in use (drawn on, or with a message or a proposal). */
const inUse = (r: DesignRequest | undefined) => Boolean(r && (r.shapes.length || r.message.trim() || r.proposal || r.status !== "draft"));

/**
 * "Make it work on phones": a request on the screen's phone size with that job (an empty drawing
 * there is reused). Undefined when the phone size already has a drawing of its own.
 */
export function phonesRequestOps(project: Project, frame: Frame, now = new Date().toISOString()): { ops: AnyOp[]; requestId: string } | { problem: string } {
  const phone = phoneViewport(frame);
  if (!phone) return { problem: "This screen has no phone size yet: show it at all sizes first." };
  const current = requestFor(project, frame.id, phone.id);
  if (current?.intent === "phones") return { ops: [], requestId: current.id };
  if (current && inUse(current)) return { problem: "The phone size of this screen already has a drawing: finish or delete it first." };
  const request: DesignRequest = { id: current?.id ?? createId("rq"), frameId: frame.id, viewportId: phone.id, intent: "phones", shapes: [], message: "", status: "draft", createdAt: current?.createdAt ?? now, updatedAt: now };
  return { ops: [set(request, request.id)], requestId: request.id };
}

/**
 * "A section from a sentence": a request with a green box where the new section goes (below
 * `after`, in the screen's design px), waiting for the sentence.
 */
export function sectionRequestOps(project: Project, frame: Frame, viewportId: string, after: { id: string; bottom: number; width: number }, now = new Date().toISOString()): { ops: AnyOp[]; requestId: string } | { problem: string } {
  const current = requestFor(project, frame.id, viewportId);
  if (current && inUse(current) && current.intent !== "section") return { problem: "This screen size already has a drawing: finish or delete it first." };
  const box: MarkupShape = { id: createId("s"), kind: "rect", color: "add", x: Math.round(after.width * 0.1), y: Math.round(after.bottom - 24), w: Math.round(after.width * 0.8), h: 48, targets: [after.id] };
  const request: DesignRequest = { id: current?.id ?? createId("rq"), frameId: frame.id, viewportId, intent: "section", shapes: [box], message: current?.intent === "section" ? current.message : "", status: "draft", createdAt: current?.createdAt ?? now, updatedAt: now };
  return { ops: [set(request, request.id)], requestId: request.id };
}

/**
 * "3 variants of this section": a request with a blue box around the section and three designs to
 * compare (the person can add what should differ).
 */
export function variantsRequestOps(project: Project, frame: Frame, viewportId: string, section: { id: string; box: { x: number; y: number; w: number; h: number } }, now = new Date().toISOString()): { ops: AnyOp[]; requestId: string } | { problem: string } {
  const current = requestFor(project, frame.id, viewportId);
  if (current && inUse(current)) return { problem: "This screen size already has a drawing: finish or delete it first." };
  const box: MarkupShape = { id: createId("s"), kind: "rect", color: "change", x: Math.round(section.box.x), y: Math.round(section.box.y), w: Math.round(section.box.w), h: Math.round(section.box.h), targets: [section.id] };
  const request: DesignRequest = { id: current?.id ?? createId("rq"), frameId: frame.id, viewportId, shapes: [box], message: "Three different takes on this section: try other layouts, keep its content.", variants: 3, status: "draft", createdAt: current?.createdAt ?? now, updatedAt: now };
  return { ops: [set(request, request.id)], requestId: request.id };
}

/** "Review this page": a request for findings in plain words (an empty review is reused). */
export function reviewRequestOps(project: Project, frame: Frame, viewportId: string, now = new Date().toISOString()): { ops: AnyOp[]; requestId: string } | { problem: string } {
  const current = requestFor(project, frame.id, viewportId);
  if (current?.intent === "review" && !current.review) return { ops: [], requestId: current.id };
  if (current && inUse(current) && current.intent !== "review") return { problem: "This screen size already has a drawing: finish or delete it first." };
  const request: DesignRequest = { id: current?.id ?? createId("rq"), frameId: frame.id, viewportId, intent: "review", shapes: [], message: "", status: "draft", createdAt: current?.createdAt ?? now, updatedAt: now };
  return { ops: [set(request, request.id)], requestId: request.id };
}

/** The review again, as it was before a fix (the fixed finding ticked off when `done`). */
function backToReview(request: DesignRequest, done: boolean, now: string): DesignRequest {
  const { proposal: _p, alternatives: _a, fixing, error: _e, variants: _v, route: _r, history: _h, ...rest } = request;
  const findings = request.review!.findings.map((f) => (done && f.id === fixing ? { ...f, done: true } : f));
  return { ...rest, intent: "review", shapes: [], message: "", status: "proposed", review: { ...request.review!, findings }, updatedAt: now };
}

/**
 * Fixing a finding of a review: the request becomes a change request (the finding's fix as the
 * message, a blue box around what it's about) and goes back to the review once accepted or discarded.
 */
export function fixFindingOps(request: DesignRequest, findingId: string, box?: { x: number; y: number; w: number; h: number }, now = new Date().toISOString()): AnyOp[] {
  const finding = request.review?.findings.find((f) => f.id === findingId);
  if (!finding) return [];
  const shapes: MarkupShape[] = box ? [{ id: createId("s"), kind: "rect", color: "change", x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), ...(finding.targets?.length && { targets: finding.targets }) }] : [];
  const { intent: _i, proposal: _p, alternatives: _a, error: _e, ...rest } = request;
  return [set({ ...rest, shapes, message: finding.fix, status: "draft", fixing: finding.id, updatedAt: now }, request.id)];
}

/** Skipping a finding (ticked off without a change). */
export function skipFindingOps(request: DesignRequest, findingId: string, now = new Date().toISOString()): AnyOp[] {
  if (!request.review) return [];
  return [set({ ...request, review: { ...request.review, findings: request.review.findings.map((f) => (f.id === findingId ? { ...f, done: true } : f)) }, updatedAt: now }, request.id)];
}

/** Leaving a fix without a proposal: back to the review, the finding still open. */
export function backToReviewOps(request: DesignRequest, now = new Date().toISOString()): AnyOp[] {
  return request.review ? [set(backToReview(request, false, now), request.id)] : [];
}

/** Takes shapes out of a drawing. */
export function removeShapesOps(request: DesignRequest, shapeIds: readonly string[], now = new Date().toISOString()): AnyOp[] {
  const shapes = request.shapes.filter((s) => !shapeIds.includes(s.id));
  return shapes.length === request.shapes.length ? [] : [set({ ...request, shapes, updatedAt: now }, request.id)];
}

/** Changes fields of a drawing (message, route, status). `undefined` values are removed. */
export function updateRequestOps(request: DesignRequest, patch: Partial<DesignRequest>, now = new Date().toISOString()): AnyOp[] {
  const next = { ...request, ...patch, updatedAt: now } as Record<string, unknown>;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return [set(next as DesignRequest, request.id)];
}

export function deleteRequestOps(request: DesignRequest): AnyOp[] {
  return [set(null, request.id)];
}

/** Drawings of screens that are being deleted go with them. */
export function requestsOfFrames(project: Project, frameIds: readonly string[]): AnyOp[] {
  return (project.requests ?? []).filter((r) => frameIds.includes(r.frameId)).map((r) => set(null, r.id));
}

// ── shapes ──────────────────────────────────────────────────────────────────

/** Fewer points for a freehand stroke (Ramer–Douglas–Peucker), rounded to tenths. */
export function simplify(points: readonly [number, number][], tolerance = 1.5): [number, number][] {
  if (points.length < 3) return points.map(round);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i]!, points[a]!, points[b]!);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (best > tolerance) {
      keep[index] = true;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map(round);
}

const round = (p: readonly [number, number]): [number, number] => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

function segmentDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The shape under a point (the eraser), the most recent first. */
export function shapeAt(shapes: readonly MarkupShape[], x: number, y: number, tolerance = 8): MarkupShape | undefined {
  const p: [number, number] = [x, y];
  for (const shape of [...shapes].reverse()) {
    const t = tolerance + (shape.width ?? 4) / 2;
    switch (shape.kind) {
      case "pen":
        if (shape.points.length === 1 ? Math.hypot(x - shape.points[0]![0], y - shape.points[0]![1]) <= t : shape.points.some((q, i) => i > 0 && segmentDistance(p, shape.points[i - 1]!, q) <= t)) return shape;
        break;
      case "arrow":
        if (segmentDistance(p, shape.from, shape.to) <= t) return shape;
        break;
      case "rect": {
        const corners: [number, number][] = [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]];
        if (corners.some((c, i) => segmentDistance(p, c, corners[(i + 1) % 4]!) <= t)) return shape;
        break;
      }
      case "ellipse": {
        const rx = shape.w / 2;
        const ry = shape.h / 2;
        if (rx <= 0 || ry <= 0) break;
        const nx = (x - shape.x - rx) / rx;
        const ny = (y - shape.y - ry) / ry;
        // distance from the outline, roughly, in px
        if (Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= t) return shape;
        break;
      }
      case "label": {
        const b = shapeBounds(shape);
        if (x >= b.x - t && x <= b.x + b.w + t && y >= b.y - t && y <= b.y + b.h + t) return shape;
        break;
      }
    }
  }
  return undefined;
}

// ── what a shape touches ────────────────────────────────────────────────────

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const area = (b: { w: number; h: number }) => b.w * b.h;

/** The deepest (then smallest) element at a point. */
function deepestAt(boxes: readonly Box[], x: number, y: number): Box | undefined {
  let best: Box | undefined;
  for (const b of boxes) {
    if (!inside(b, x, y) || b.w <= 0 || b.h <= 0) continue;
    if (!best || b.depth > best.depth || (b.depth === best.depth && area(b) < area(best))) best = b;
  }
  return best;
}

/** Elements inside a rectangle, outermost only (not their children). */
function enclosed(boxes: readonly Box[], r: { x: number; y: number; w: number; h: number }, slack = 4): Box[] {
  const within = boxes.filter((b) => b.w > 0 && b.h > 0 && b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack);
  return within.filter((b) => !within.some((a) => a !== b && a.depth < b.depth && a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h));
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const shared = w * h;
  return shared / (area(a) + area(b) - shared);
}

/**
 * The elements a shape means: what a rectangle or a loop encloses (or the element around an
 * empty spot), what an arrow points at, what a line or a cross crosses. At most three; the
 * screen itself only when nothing else fits.
 */
export function shapeTargets(shape: MarkupShape, boxes: readonly Box[]): string[] {
  const root = boxes.find((b) => b.depth === 0);
  const content = boxes.filter((b) => b.depth > 0);
  const result = (list: (Box | undefined)[]) => {
    const ids = [...new Set(list.filter((b): b is Box => b !== undefined).map((b) => b.id))].slice(0, 3);
    return ids.length ? ids : root ? [root.id] : [];
  };
  const bounds = shapeBounds(shape);
  const enclosing = () => {
    const list = enclosed(content, bounds);
    if (list.length) return result(list.sort((a, b) => area(b) - area(a)));
    // an empty spot (where something new goes): the element around it
    return result([deepestAt(content, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)]);
  };
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return enclosing();
    case "arrow":
      return result([deepestAt(content, shape.to[0], shape.to[1])]);
    case "label":
      return result([deepestAt(content, shape.x, shape.y - 6)]);
    case "pen": {
      const [first, last] = [shape.points[0]!, shape.points.at(-1)!];
      const size = Math.max(bounds.w, bounds.h);
      const loop = shape.points.length > 4 && size > 24 && Math.hypot(last[0] - first[0], last[1] - first[1]) < size * 0.3;
      if (loop) return enclosing();
      // a cross or a scribble over an element: the one it covers best
      const best = content.map((b) => ({ b, score: overlap(bounds, b) })).filter((c) => c.score >= 0.3).sort((a, b) => b.score - a.score || b.b.depth - a.b.depth)[0];
      if (best) return result([best.b]);
      // a line through elements: the ones its points lie on, most hits first
      const hits = new Map<Box, number>();
      for (const p of shape.points) {
        const b = deepestAt(content, p[0], p[1]);
        if (b) hits.set(b, (hits.get(b) ?? 0) + 1);
      }
      // the deepest ones (a line overshooting a link also crosses its header)
      const contains = (a: Box, b: Box) => a !== b && a.depth < b.depth && a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
      const deepest = [...hits].filter(([b]) => ![...hits.keys()].some((other) => contains(b, other)));
      return result(deepest.sort((a, b) => b[1] - a[1]).map(([b]) => b));
    }
  }
}

/** Depth of every node of a screen (for `Box.depth`). */
export function nodeDepths(root: Frame["current"]): Map<string, number> {
  const depths = new Map<string, number>();
  const visit = (node: Frame["current"], depth: number) => {
    depths.set(node.id, depth);
    if ("children" in node) for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return depths;
}

/**
 * The shape a drag draws (design px): a freehand stroke (Shift: a straight line), an arrow
 * (Shift: in 45° steps), a rectangle or an ellipse (Shift: square/circle).
 */
export function dragShape(
  draw: { tool: MarkupTool; color: string; width: number },
  id: string,
  points: readonly [number, number][],
  shift: boolean,
): MarkupShape | undefined {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return undefined;
  const base = { id, color: draw.color, width: draw.width };
  switch (draw.tool) {
    case "pen":
      return { ...base, kind: "pen", points: shift ? [start, end] : [...points] };
    case "arrow": {
      let to = end;
      if (shift) {
        const angle = Math.round(Math.atan2(end[1] - start[1], end[0] - start[0]) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        to = [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length];
      }
      return { ...base, kind: "arrow", from: start, to };
    }
    case "rect":
    case "ellipse": {
      let w = end[0] - start[0];
      let h = end[1] - start[1];
      if (shift) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      return { ...base, kind: draw.tool, x: Math.min(start[0], start[0] + w), y: Math.min(start[1], start[1] + h), w: Math.abs(w), h: Math.abs(h) };
    }
    default:
      return undefined;
  }
}

/** A drawn shape cleaned up for keeping (fewer points, rounded); undefined when it's too small to mean anything. */
export function finishShape(shape: MarkupShape): MarkupShape | undefined {
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (shape.kind) {
    case "pen":
      return { ...shape, points: simplify(shape.points) };
    case "arrow":
      return Math.hypot(shape.to[0] - shape.from[0], shape.to[1] - shape.from[1]) < 6 ? undefined : { ...shape, from: [r(shape.from[0]), r(shape.from[1])], to: [r(shape.to[0]), r(shape.to[1])] };
    case "rect":
    case "ellipse":
      return shape.w < 4 && shape.h < 4 ? undefined : { ...shape, x: r(shape.x), y: r(shape.y), w: r(shape.w), h: r(shape.h) };
    default:
      return shape;
  }
}

// ── proposals ───────────────────────────────────────────────────────────────

/** The screen as a proposal (or one of its variants) would make it (its ops on a copy), or undefined when they don't fit any more. */
export function proposedFrame(project: Project, request: DesignRequest, proposal: Proposal | undefined = request.proposal): Frame | undefined {
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame || !proposal) return undefined;
  try {
    return applyOps(new Map([[frame.id, frame]]), proposal.ops).get(frame.id);
  } catch {
    return undefined;
  }
}

/** Picking variant `n` of a proposal: it becomes the one shown and accepted. */
export function pickVariantOps(request: DesignRequest, n: number): AnyOp[] {
  const patch = pickVariant(request, n);
  return patch ? updateRequestOps(request, patch) : [];
}

/** The variants that aren't picked, as screens (undefined where they don't fit any more), by number. */
export function otherVariants(project: Project, request: DesignRequest): { proposal: Proposal; frame: Frame | undefined }[] {
  return proposalVariants(request)
    .filter((p) => p !== request.proposal)
    .map((proposal) => ({ proposal, frame: proposedFrame(project, request, proposal) }));
}

/** The placement the variants show next to: the screen at the size it was drawn on (else its first placement). */
export function variantsPlacement(project: Project, request: DesignRequest): string | undefined {
  const frame = project.frames.find((f) => f.id === request.frameId);
  const placements = project.board.items.filter((i) => i.type === "frame" && i.frameId === request.frameId);
  const drawn = placements.find((i) => i.type === "frame" && (i.viewportId ?? frame?.viewports[0]?.id) === request.viewportId);
  return (drawn ?? placements[0])?.id;
}

/** Space between a screen and its variants on the board (design px). */
export const VARIANT_GAP = 120;

/** The screen changed since the proposal was made (accepting applies its changes on top). */
export function isStale(project: Project, request: DesignRequest): boolean {
  const frame = project.frames.find((f) => f.id === request.frameId);
  return Boolean(frame && request.proposal && frameVersion(frame) !== request.proposal.baseVersion);
}

/** Accepting: the proposal's changes and the drawing gone (or, fixing a review's finding, back to the review), as one step. */
export function acceptOps(request: DesignRequest, now = new Date().toISOString()): AnyOp[] {
  if (request.review && request.fixing) return [...(request.proposal?.ops ?? []), set(backToReview(request, true, now), request.id)];
  return [...(request.proposal?.ops ?? []), set(null, request.id)];
}

/** Back to the drawing (Discard), or again with a follow-up message (Try again: the coding agent is asked again). */
export function reopenOps(request: DesignRequest, followUp?: string, now = new Date().toISOString()): AnyOp[] {
  const again = followUp !== undefined;
  // discarding a fix of a review's finding: back to the review
  if (!again && request.review && request.fixing) return backToReviewOps(request, now);
  return updateRequestOps(
    request,
    {
      // asked again: the coding agent designs it again (it reads the follow-up and the earlier messages)
      status: again && request.route === "agent" ? "designing" : "draft",
      error: undefined,
      proposal: undefined,
      alternatives: undefined,
      ...(again && { history: [...(request.history ?? []), { message: request.message, at: now }], message: followUp.trim() || request.message }),
    },
    now,
  );
}
