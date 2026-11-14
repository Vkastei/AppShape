/**
 * Rendered screens register here so the canvas can hit-test elements and measure them.
 * Screens are rendered into shadow roots and are not interactive themselves.
 */

export interface ClientRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameHandle {
  /** Deepest element under a client (screen) point, as a node id. */
  nodeAt(clientX: number, clientY: number, exclude?: (nodeId: string) => boolean): string | undefined;
  /** Client rect of a node or a rendered id inside an instance (union of its rendered boxes). */
  nodeRect(nodeId: string): ClientRect | undefined;
  /** The element inside an instance under a client point, as a scoped id (`instance/inner`). */
  innerAt(clientX: number, clientY: number): string | undefined;
  /** The rendered element of a node id or scoped id. */
  element(id: string): Element | undefined;
}

const handles = new Map<string, FrameHandle>();

export function registerFrame(itemId: string, handle: FrameHandle): () => void {
  handles.set(itemId, handle);
  return () => {
    if (handles.get(itemId) === handle) handles.delete(itemId);
  };
}

export function frameHandle(itemId: string): FrameHandle | undefined {
  return handles.get(itemId);
}

function boxesOf(element: Element): DOMRect[] {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return [rect];
  // display: contents (component instances) → use the children's boxes
  return [...element.children].flatMap(boxesOf);
}

export function createHandle(root: ShadowRoot): FrameHandle {
  const element = (id: string) => root.querySelector(`[${id.includes("/") ? "data-aps-i" : "data-aps"}="${CSS.escape(id)}"]`) ?? undefined;
  return {
    element,
    innerAt(clientX, clientY) {
      let best: { id: string; area: number } | undefined;
      for (const el of root.querySelectorAll("[data-aps-i]")) {
        for (const rect of boxesOf(el)) {
          if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
          const area = rect.width * rect.height;
          if (!best || area <= best.area) best = { id: el.getAttribute("data-aps-i")!, area };
        }
      }
      return best?.id;
    },
    nodeAt(clientX, clientY, exclude) {
      let best: { id: string; area: number } | undefined;
      for (const element of root.querySelectorAll("[data-aps]")) {
        const id = element.getAttribute("data-aps")!;
        if (exclude?.(id)) continue;
        for (const rect of boxesOf(element)) {
          if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
          const area = rect.width * rect.height;
          // Smallest box wins; on ties the later (deeper) element wins.
          if (!best || area <= best.area) best = { id, area };
        }
      }
      return best?.id;
    },
    nodeRect(nodeId) {
      const el = element(nodeId);
      if (!el) return undefined;
      const boxes = boxesOf(el);
      if (boxes.length === 0) return undefined;
      const left = Math.min(...boxes.map((b) => b.left));
      const top = Math.min(...boxes.map((b) => b.top));
      const right = Math.max(...boxes.map((b) => b.right));
      const bottom = Math.max(...boxes.map((b) => b.bottom));
      return { x: left, y: top, w: right - left, h: bottom - top };
    },
  };
}
