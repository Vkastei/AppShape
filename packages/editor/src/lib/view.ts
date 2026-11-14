import type { BoardItem } from "@appshape/ir";
import { useEditor } from "../store";
import { framesById, newItemId, newOpId } from "./board";
import { type Camera, clampZoom, fitRect, frameViewport, itemBounds, type Point, type Rect, screenToWorld, unionRects, zoomAt } from "./geometry";

/** Size of the canvas element (the camera's viewport). */
export function canvasSize(): { w: number; h: number } {
  const el = document.querySelector<HTMLElement>("[data-testid=canvas]");
  return { w: el?.clientWidth ?? window.innerWidth, h: el?.clientHeight ?? window.innerHeight };
}

function boundsOf(items: readonly BoardItem[]) {
  const { project, sizes } = useEditor.getState();
  if (!project) return undefined;
  const frames = framesById(project);
  return unionRects(items.map((i) => itemBounds(i, frames, sizes)).filter((r) => r !== undefined));
}

export function fitCamera(items?: readonly BoardItem[]): Camera | undefined {
  const all = useEditor.getState().project?.board.items ?? [];
  const rect = boundsOf(items ?? all);
  return rect ? fitRect(rect, canvasSize()) : undefined;
}

export function zoomToFit(): void {
  const camera = fitCamera();
  if (camera) useEditor.setState({ camera });
}

export function zoomToSelection(): void {
  const { project, selection } = useEditor.getState();
  const items = project?.board.items.filter((i) => selection.includes(i.id)) ?? [];
  const camera = items.length > 0 ? fitCamera(items) : undefined;
  if (camera) useEditor.setState({ camera });
}

let animation = 0;

/** Moves the camera to `target` in a short ease-out animation. */
export function animateCamera(target: Camera, ms = 280): void {
  cancelAnimationFrame(animation);
  const start = useEditor.getState().camera;
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = 1 - (1 - t) ** 3;
    // zoom interpolates geometrically so the motion feels even
    useEditor.setState({
      camera: {
        zoom: start.zoom * (target.zoom / start.zoom) ** k,
        x: start.x + (target.x - start.x) * k,
        y: start.y + (target.y - start.y) * k,
      },
    });
    if (t < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

/**
 * A camera showing `rect`: whole if it fits at a readable zoom, else fitted to its width from the
 * top (long pages).
 */
export function focusCamera(rect: Rect, size = canvasSize(), padding = 64): Camera {
  const fit = fitRect(rect, size, padding);
  const readable = Math.min(1, (size.w - padding * 2) / Math.max(rect.w, 1));
  if (fit.zoom >= readable * 0.6) return fit;
  const zoom = clampZoom(readable * 0.8);
  return { zoom, x: size.w / 2 - (rect.x + rect.w / 2) * zoom, y: padding - rect.y * zoom };
}

/** Shows a board item (selected) or a point: where an arrow or a link points. */
export function goTo(target: { itemId: string } | Point): void {
  const { project, sizes, camera } = useEditor.getState();
  if (!project) return;
  if ("itemId" in target) {
    const item = project.board.items.find((i) => i.id === target.itemId);
    const rect = item && itemBounds(item, framesById(project), sizes);
    if (!rect) return;
    useEditor.setState({ selection: [target.itemId], node: undefined });
    animateCamera(focusCamera(rect));
    return;
  }
  const size = canvasSize();
  animateCamera({ zoom: camera.zoom, x: size.w / 2 - target.x * camera.zoom, y: size.h / 2 - target.y * camera.zoom });
}

export function zoomBy(factor: number): void {
  const { camera } = useEditor.getState();
  const size = canvasSize();
  useEditor.setState({ camera: zoomAt(camera, { x: size.w / 2, y: size.h / 2 }, camera.zoom * factor) });
}

export function setZoom(zoom: number): void {
  const { camera } = useEditor.getState();
  const size = canvasSize();
  useEditor.setState({ camera: zoomAt(camera, { x: size.w / 2, y: size.h / 2 }, zoom) });
}

/** Command ops that place `frameId` at the center of the view. */
export function placeFrameOps(frameId: string, viewportId?: string) {
  const { project, camera } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === frameId);
  const viewport = frameViewport(frame, viewportId);
  const size = canvasSize();
  const middle = screenToWorld(camera, { x: size.w / 2, y: size.h / 2 });
  const item: BoardItem = {
    type: "frame",
    id: newItemId(),
    frameId,
    x: Math.round(middle.x - (viewport?.width ?? 1280) / 2),
    y: Math.round(middle.y - 300),
    ...(viewport && { viewportId: viewport.id }),
  };
  return { item, ops: [{ id: newOpId(), op: "addItem" as const, item }] };
}
