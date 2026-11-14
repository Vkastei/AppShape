import { MOTION_PRESETS, type Motion } from "./style";

/**
 * Entrance animations as CSS, shared by the board (played with the Web Animations API) and the
 * generated app (keyframes in its CSS), so both move the same way. Every preset starts somewhere
 * (transparent, moved, smaller, blurred) and ends at the element's own style: the keyframes have
 * only a start, so an element's own rotation, opacity or blur is where it lands.
 */

/** Default duration (ms) and easing of an entrance. */
export const MOTION_DEFAULTS = { duration: 600, easing: "out" } as const;

/** How far a slide travels (px). */
export const MOTION_DISTANCE = 24;

/** The CSS easing of the format's easings (CSS keywords, also understood by Motion). */
export const MOTION_EASING_CSS: Record<NonNullable<Motion["easing"]>, string> = {
  linear: "linear",
  in: "ease-in",
  out: "ease-out",
  "in-out": "ease-in-out",
};

/** Where a preset starts: CSS properties and values. */
export function motionFrom(preset: Motion["preset"]): Record<string, string> {
  const d = `${MOTION_DISTANCE}px`;
  switch (preset) {
    case "fade":
      return { opacity: "0" };
    case "slide-up":
      return { opacity: "0", translate: `0 ${d}` };
    case "slide-down":
      return { opacity: "0", translate: `0 -${d}` };
    case "slide-left":
      return { opacity: "0", translate: `${d} 0` };
    case "slide-right":
      return { opacity: "0", translate: `-${d} 0` };
    case "scale":
      return { opacity: "0", scale: "0.92" };
    case "blur":
      return { opacity: "0", filter: "blur(8px)" };
  }
}

/** The keyframes' name in CSS (`aps-slide-up`). */
export const motionName = (preset: Motion["preset"]) => `aps-${preset}`;

/** `@keyframes` rules of the presets (all of them, or the ones given). */
export function motionKeyframesCss(presets: readonly Motion["preset"][] = MOTION_PRESETS): string {
  return presets
    .map((preset) => {
      const from = Object.entries(motionFrom(preset))
        .map(([property, value]) => `${property}: ${value};`)
        .join(" ");
      return `@keyframes ${motionName(preset)} { from { ${from} } }`;
    })
    .join("\n");
}

/** The `animation` shorthand for an element (`aps-slide-up 600ms ease-out 100ms both`); without the delay for staggered children. */
export function motionAnimation(motion: Motion, withDelay = true): string {
  const duration = motion.duration ?? MOTION_DEFAULTS.duration;
  const easing = MOTION_EASING_CSS[motion.easing ?? MOTION_DEFAULTS.easing];
  const delay = withDelay && motion.delay ? ` ${motion.delay}ms` : "";
  return `${motionName(motion.preset)} ${duration}ms ${easing}${delay} both`;
}

/** Children that get a step of their own; later ones start with the last (the app's CSS has a rule per step). */
export const STAGGER_STEPS = 12;

/** Delay (ms) of a staggered element's child: the element's delay plus one step per child before it. */
export const staggerDelay = (motion: Motion, index: number) => (motion.delay ?? 0) + (motion.stagger ?? 0) * Math.min(index, STAGGER_STEPS - 1);
