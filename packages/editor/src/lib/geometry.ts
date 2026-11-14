import type { BoardItem, Frame } from "@appshape/ir";

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** screen = world * zoom + (x, y) */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
export const DEFAULT_NOTE_SIZE = { w: 220, h: 160 };
export const DEFAULT_FRAME_HEIGHT = 900;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}

/** Zooms so that the world point under `screenPoint` stays where it is. */
export function zoomAt(camera: Camera, screenPoint: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = screenToWorld(camera, screenPoint);
  return { zoom: next, x: screenPoint.x - world.x * next, y: screenPoint.y - world.y * next };
}

/** Camera that shows `rect` centered in a viewport of `size`, with padding. */
export function fitRect(rect: Rect, size: { w: number; h: number }, padding = 64, maxZoom = 1): Camera {
  const zoom = clampZoom(
    Math.min(maxZoom, (size.w - padding * 2) / Math.max(rect.w, 1), (size.h - padding * 2) / Math.max(rect.h, 1)),
  );
  return { zoom, x: size.w / 2 - (rect.x + rect.w / 2) * zoom, y: size.h / 2 - (rect.y + rect.h / 2) * zoom };
}

export function visibleWorldRect(camera: Camera, size: { w: number; h: number }): Rect {
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, w: size.w / camera.zoom, h: size.h / camera.zoom };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function containsPoint(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export function unionRects(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Measured sizes of auto-sized items (frames, text labels), keyed by item id. */
export type Sizes = Record<string, { w: number; h: number }>;

export function frameViewport(frame: Frame | undefined, viewportId: string | undefined) {
  return frame?.viewports.find((v) => v.id === viewportId) ?? frame?.viewports[0];
}

/** World bounds of a board item, or undefined for arrows. */
export function itemBounds(item: BoardItem, frames: ReadonlyMap<string, Frame>, sizes: Sizes): Rect | undefined {
  switch (item.type) {
    case "frame": {
      const frame = frames.get(item.frameId);
      const viewport = frameViewport(frame, item.viewportId);
      const fallback = frame?.kind === "component" ? 80 : DEFAULT_FRAME_HEIGHT;
      return { x: item.x, y: item.y, w: viewport?.width ?? 1280, h: sizes[item.id]?.h ?? fallback };
    }
    case "note":
      return { x: item.x, y: item.y, w: item.w ?? DEFAULT_NOTE_SIZE.w, h: item.h ?? DEFAULT_NOTE_SIZE.h };
    case "section":
    case "image":
      return { x: item.x, y: item.y, w: item.w, h: item.h };
    case "text":
      return { x: item.x, y: item.y, w: sizes[item.id]?.w ?? 120, h: sizes[item.id]?.h ?? (item.size ?? 24) * 1.3 };
    case "arrow":
      return undefined;
  }
}

/** Where the line from the rect's center towards `toward` leaves the rect. */
export function clipToRect(rect: Rect, toward: Point): Point {
  const c = center(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy, 1);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
