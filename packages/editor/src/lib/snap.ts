/**
 * Snapping, like Canva or PowerPoint: a moving or resized box snaps to the edges and centers of other
 * boxes and of its container, to equal spacing and equal sizes, and otherwise to a grid. Both axes
 * snap independently. The caller works in one coordinate space (board units or screen pixels) and
 * passes the threshold in that space. Pure functions; the editor draws the guides it returns.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Axis = "x" | "y";

/** A guide line: at `at` on `axis` (x: a vertical line), spanning `from`–`to` on the other axis. */
export interface GuideLine {
  axis: Axis;
  at: number;
  from: number;
  to: number;
}

/** Equal spacing or size: a measured span (`from`–`to` on `axis`) drawn at `at` on the other axis. */
export interface Measure {
  axis: Axis;
  from: number;
  to: number;
  at: number;
  /** Shown as a label (px or board units). */
  value: number;
  kind: "gap" | "size";
}

export interface SnapResult {
  /** Correction to add to the proposed position (or size). */
  dx: number;
  dy: number;
  lines: GuideLine[];
  measures: Measure[];
}

export interface SnapOptions {
  /** Snap distance in the caller's units. */
  threshold: number;
  /** Align to the other boxes and the container (smart guides). */
  guides: boolean;
  /** Grid step (0 or undefined: no grid). */
  grid?: number;
  /** Grid origin (e.g. the container's content box corner). */
  origin?: { x: number; y: number };
  /** Content box of the parent: its edges and center are guides too. */
  container?: Box;
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, lines: [], measures: [] };

const start = (b: Box, axis: Axis) => (axis === "x" ? b.x : b.y);
const size = (b: Box, axis: Axis) => (axis === "x" ? b.w : b.h);
const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const anchors = (b: Box, axis: Axis) => [start(b, axis), start(b, axis) + size(b, axis) / 2, start(b, axis) + size(b, axis)];
const overlaps = (a: Box, b: Box, axis: Axis) => start(a, axis) < start(b, axis) + size(b, axis) && start(b, axis) < start(a, axis) + size(a, axis);
const shift = (b: Box, axis: Axis, d: number): Box => (axis === "x" ? { ...b, x: b.x + d } : { ...b, y: b.y + d });

/** Distances between neighbors along `axis` among boxes that share a row (or column). */
function gapsBetween(boxes: Box[], axis: Axis): number[] {
  const gaps: number[] = [];
  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b || !overlaps(a, b, other(axis))) continue;
      const gap = start(b, axis) - (start(a, axis) + size(a, axis));
      if (gap <= 0) continue;
      // only neighbors: nothing in between
      const between = boxes.some((c) => c !== a && c !== b && overlaps(c, a, other(axis)) && start(c, axis) >= start(a, axis) + size(a, axis) && start(c, axis) + size(c, axis) <= start(b, axis));
      if (!between) gaps.push(gap);
    }
  }
  return gaps;
}

interface AxisSnap {
  delta: number;
  /** Positions on the axis where the moved box now aligns (for drawing lines). */
  hits: number[];
  measures: Measure[];
}

function snapAxis(moving: Box, candidates: Box[], axis: Axis, options: SnapOptions): AxisSnap | undefined {
  let best: { delta: number; distance: number } | undefined;
  const consider = (delta: number) => {
    const distance = Math.abs(delta);
    if (distance <= options.threshold && (!best || distance < best.distance - 1e-6)) best = { delta, distance };
  };

  if (options.guides) {
    const targets = candidates.flatMap((c) => anchors(c, axis));
    if (options.container) targets.push(...anchors(options.container, axis));
    for (const a of anchors(moving, axis)) for (const t of targets) consider(t - a);

    // equal spacing: the gap to the nearest neighbor in the same row/column matches a gap between others
    const row = candidates.filter((c) => overlaps(c, moving, other(axis)));
    const before = row.filter((c) => start(c, axis) + size(c, axis) <= start(moving, axis) + options.threshold).sort((a, b) => start(b, axis) + size(b, axis) - (start(a, axis) + size(a, axis)))[0];
    const after = row.filter((c) => start(c, axis) >= start(moving, axis) + size(moving, axis) - options.threshold).sort((a, b) => start(a, axis) - start(b, axis))[0];
    const known = gapsBetween(candidates, axis);
    if (before) for (const gap of known) consider(start(before, axis) + size(before, axis) + gap - start(moving, axis));
    if (after) for (const gap of known) consider(start(after, axis) - gap - (start(moving, axis) + size(moving, axis)));
    // centered between both neighbors
    if (before && after) {
      const free = start(after, axis) - (start(before, axis) + size(before, axis)) - size(moving, axis);
      if (free > 0) consider(start(before, axis) + size(before, axis) + free / 2 - start(moving, axis));
    }
  }

  if (!best && options.grid && options.grid > 0) {
    const origin = options.origin ? start({ x: options.origin.x, y: options.origin.y, w: 0, h: 0 }, axis) : 0;
    const position = start(moving, axis) - origin;
    const snapped = Math.round(position / options.grid) * options.grid;
    if (Math.abs(snapped - position) > 1e-6) best = { delta: snapped - position, distance: Math.abs(snapped - position) };
    else best = { delta: 0, distance: 0 };
    return { delta: best.delta, hits: [], measures: [] };
  }
  if (!best) return undefined;

  // what the box aligns with after the correction
  const moved = shift(moving, axis, best.delta);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const targets = [...candidates, ...(options.container ? [options.container] : [])];
  const hits = new Set<number>();
  for (const a of anchors(moved, axis)) for (const c of targets) for (const t of anchors(c, axis)) if (close(a, t)) hits.add(t);

  const measures: Measure[] = [];
  const row = candidates.filter((c) => overlaps(c, moved, other(axis)));
  const before = row.filter((c) => start(c, axis) + size(c, axis) <= start(moved, axis) + 0.5).sort((a, b) => start(b, axis) + size(b, axis) - (start(a, axis) + size(a, axis)))[0];
  const after = row.filter((c) => start(c, axis) >= start(moved, axis) + size(moved, axis) - 0.5).sort((a, b) => start(a, axis) - start(b, axis))[0];
  const gapBefore = before ? start(moved, axis) - (start(before, axis) + size(before, axis)) : undefined;
  const gapAfter = after ? start(after, axis) - (start(moved, axis) + size(moved, axis)) : undefined;
  const known = gapsBetween(candidates, axis);
  const at = (a: Box, b: Box) => {
    const lo = Math.max(start(a, other(axis)), start(b, other(axis)));
    const hi = Math.min(start(a, other(axis)) + size(a, other(axis)), start(b, other(axis)) + size(b, other(axis)));
    return (lo + hi) / 2;
  };
  const equal = (gap: number | undefined) => gap !== undefined && gap > 0 && (known.some((k) => close(k, gap)) || (gapBefore !== undefined && gapAfter !== undefined && close(gapBefore, gapAfter)));
  if (before && equal(gapBefore)) measures.push({ axis, from: start(before, axis) + size(before, axis), to: start(moved, axis), at: at(before, moved), value: Math.round(gapBefore!), kind: "gap" });
  if (after && equal(gapAfter)) measures.push({ axis, from: start(moved, axis) + size(moved, axis), to: start(after, axis), at: at(moved, after), value: Math.round(gapAfter!), kind: "gap" });
  // the same gap elsewhere, so it's clear what it matches
  if (measures.length) {
    const value = measures[0]!.value;
    for (const a of candidates) {
      for (const b of candidates) {
        if (a === b || !overlaps(a, b, other(axis))) continue;
        const gap = start(b, axis) - (start(a, axis) + size(a, axis));
        if (close(gap, value) && !(a === before || b === after)) measures.push({ axis, from: start(a, axis) + size(a, axis), to: start(b, axis), at: at(a, b), value, kind: "gap" });
      }
    }
  }
  return { delta: best.delta, hits: [...hits], measures };
}

function linesFor(moving: Box, candidates: Box[], container: Box | undefined, axis: Axis, hits: number[]): GuideLine[] {
  const lines: GuideLine[] = [];
  const o = other(axis);
  for (const at of hits) {
    const touching = [...candidates, ...(container ? [container] : [])].filter((c) => anchors(c, axis).some((t) => Math.abs(t - at) < 0.5));
    const all = [moving, ...touching];
    const from = Math.min(...all.map((b) => start(b, o)));
    const to = Math.max(...all.map((b) => start(b, o) + size(b, o)));
    lines.push({ axis, at, from, to });
  }
  return lines;
}

/** Where a moved box should go: the correction for its proposed position, and what to draw. */
export function snapMove(moving: Box, candidates: Box[], options: SnapOptions, lock?: Axis): SnapResult {
  const x = lock === "y" ? undefined : snapAxis(moving, candidates, "x", options);
  const y = lock === "x" ? undefined : snapAxis(moving, candidates, "y", options);
  const moved = { ...moving, x: moving.x + (x?.delta ?? 0), y: moving.y + (y?.delta ?? 0) };
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    lines: [...linesFor(moved, candidates, options.container, "x", x?.hits ?? []), ...linesFor(moved, candidates, options.container, "y", y?.hits ?? [])],
    measures: [...(x?.measures ?? []), ...(y?.measures ?? [])],
  };
}

/** The edges a resize moves: -1 the left/top edge, 1 the right/bottom edge, 0 none. */
export interface ResizeEdges {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

/**
 * Snapping for a resize: the moving edges snap to the other boxes' edges and centers, the container
 * and the grid; widths and heights snap to the sizes of the others (equal size). Returns the
 * correction for the size (dx/dy: positive grows the box).
 */
export function snapResize(box: Box, edges: ResizeEdges, candidates: Box[], options: SnapOptions): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, lines: [], measures: [] };
  for (const axis of ["x", "y"] as const) {
    const dir = edges[axis];
    if (!dir) continue;
    const edge = dir === 1 ? start(box, axis) + size(box, axis) : start(box, axis);
    let best: { delta: number; distance: number; line?: number; size?: number } | undefined;
    const consider = (delta: number, extra: { line?: number; size?: number }) => {
      const distance = Math.abs(delta);
      if (distance <= options.threshold && (!best || distance < best.distance - 1e-6)) best = { delta, distance, ...extra };
    };
    if (options.guides) {
      const targets = candidates.flatMap((c) => anchors(c, axis));
      if (options.container) targets.push(...anchors(options.container, axis));
      for (const t of targets) consider(t - edge, { line: t });
      for (const c of candidates) consider((size(c, axis) - size(box, axis)) * dir, { size: size(c, axis) });
    }
    if (!best && options.grid) {
      const origin = options.origin ? (axis === "x" ? options.origin.x : options.origin.y) : 0;
      const snapped = Math.round((edge - origin) / options.grid) * options.grid + origin;
      best = { delta: snapped - edge, distance: Math.abs(snapped - edge) };
    }
    if (!best) continue;
    const grow = best.delta * dir;
    if (axis === "x") result.dx = grow;
    else result.dy = grow;
    const resized = dir === 1 ? (axis === "x" ? { ...box, w: box.w + grow } : { ...box, h: box.h + grow }) : axis === "x" ? { ...box, x: box.x - grow, w: box.w + grow } : { ...box, y: box.y - grow, h: box.h + grow };
    if (best.line !== undefined) result.lines.push(...linesFor(resized, candidates, options.container, axis, [best.line]));
    if (best.size !== undefined) {
      const o = other(axis);
      const same = candidates.filter((c) => Math.abs(size(c, axis) - best!.size!) < 0.5);
      for (const b of [resized, ...same]) result.measures.push({ axis, from: start(b, axis), to: start(b, axis) + size(b, axis), at: start(b, o) + size(b, o) + 0, value: Math.round(best.size), kind: "size" });
    }
  }
  return result;
}
