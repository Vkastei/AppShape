import { MOTION_DEFAULTS, MOTION_EASING_CSS, type Motion, motionFrom, staggerDelay } from "@appshape/ir";

/**
 * Entrances on the board, played with the Web Animations API from the same start states as the
 * app's keyframes (`motionFrom`): the board itself stays the end state; Play, the prototype and
 * the inspector's previews run them. Rendered elements carry their entrance in `data-aps-motion`.
 */

const running = new WeakMap<Element, Animation[]>();

function motionOf(element: Element): Motion | undefined {
  try {
    return JSON.parse(element.getAttribute("data-aps-motion") ?? "") as Motion;
  } catch {
    return undefined;
  }
}

/** Starts an element's entrance (its children one after another when staggered). */
function animate(element: Element, motion: Motion): Animation[] {
  stop(element);
  const targets = motion.stagger ? [...element.children] : [element];
  const from = { ...motionFrom(motion.preset), offset: 0 };
  const animations = targets.map((target, i) =>
    target.animate([from], {
      duration: motion.duration ?? MOTION_DEFAULTS.duration,
      easing: MOTION_EASING_CSS[motion.easing ?? MOTION_DEFAULTS.easing],
      delay: motion.stagger ? staggerDelay(motion, i) : (motion.delay ?? 0),
      fill: "backwards",
    }),
  );
  running.set(element, animations);
  return animations;
}

function stop(element: Element): void {
  for (const animation of running.get(element) ?? []) animation.cancel();
  running.delete(element);
}

/** Plays one element's entrance now: its own, or `motion` to try one (the inspector's preview). */
export function previewEntrance(element: Element, motion: Motion | undefined = motionOf(element)): void {
  if (motion) animate(element, motion);
  else stop(element);
}

/** Plays every entrance of a rendered screen at once, wherever it is (Play on the board). */
export function playAll(root: ParentNode): void {
  for (const element of root.querySelectorAll("[data-aps-motion]")) previewEntrance(element);
}

/**
 * Runs a screen's entrances as the app does (the prototype): the page-load ones now, the others
 * waiting at their start until they scroll into view (again each time for "every time").
 */
export function runEntrances(root: ParentNode): () => void {
  const waiting = new Map<Element, { motion: Motion; animations: Animation[] }>();
  const rewind = (animations: Animation[]) => {
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = waiting.get(entry.target);
        if (!item) continue;
        if (entry.isIntersecting) {
          for (const animation of item.animations) animation.play();
          if (item.motion.trigger === "scroll") observer.unobserve(entry.target);
        } else if (item.motion.trigger === "scroll-repeat") rewind(item.animations);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  const elements = [...root.querySelectorAll("[data-aps-motion]")];
  for (const element of elements) {
    const motion = motionOf(element);
    if (!motion) continue;
    const animations = animate(element, motion);
    if (motion.trigger === "load") continue;
    rewind(animations);
    waiting.set(element, { motion, animations });
    observer.observe(element);
  }
  return () => {
    observer.disconnect();
    elements.forEach(stop);
  };
}

/** Event the board's screens listen to: play the entrances of a screen, or preview one element's. */
export const MOTION_EVENT = "appshape:motion";
export interface MotionRequest {
  itemId: string;
  /** One element (its own entrance, or `motion` to try); unset: the whole screen. */
  nodeId?: string;
  motion?: Motion;
}

export function playOnBoard(request: MotionRequest): void {
  window.dispatchEvent(new CustomEvent<MotionRequest>(MOTION_EVENT, { detail: request }));
}

/** Whether a design tree has entrances (Play shows for screens that do). */
export function hasEntrances(node: { style?: { motion?: unknown }; children?: unknown }): boolean {
  if (node.style?.motion) return true;
  return Array.isArray(node.children) && node.children.some((child) => hasEntrances(child as typeof node));
}
