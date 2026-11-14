import type { Gradient, GradientStop, Shadow, StyleValue } from "./style";

/**
 * CSS for gradients and shadow lists, shared by the board (colors resolved) and the code (colors as
 * the app's CSS variables), so both write the same CSS. Written like Tailwind v4 does (`in oklab`,
 * explicit stop positions) unless `oklab` is off (Tailwind v3).
 */

const AXIS: Record<number, string> = { 0: "to top", 90: "to right", 180: "to bottom", 270: "to left" };
const CORNER: Record<string, string> = { "to-tr": "to top right", "to-br": "to bottom right", "to-bl": "to bottom left", "to-tl": "to top left" };

/** The direction part of a linear gradient: `to right`, `to top right` or `30deg`. */
export function gradientDirection(angle: Gradient["angle"]): string {
  if (angle === undefined) return "to bottom";
  if (typeof angle === "string") return CORNER[angle]!;
  const normalized = ((angle % 360) + 360) % 360;
  return AXIS[normalized] ?? `${normalized}deg`;
}

/** Where stops sit when the design doesn't say: from 0 %, via 50 %, to 100 % (as Tailwind). */
export function stopPositions(stops: readonly GradientStop[]): number[] {
  return stops.map((s, i) => s.at ?? (i === 0 ? 0 : i === stops.length - 1 ? 100 : 50));
}

export function gradientCss(gradient: Gradient, color: (value: StyleValue) => string, oklab = true): string {
  const at = stopPositions(gradient.stops);
  const stops = gradient.stops.map((s, i) => `${color(s.color)} ${at[i]}%`).join(", ");
  if (gradient.type === "radial") return `radial-gradient(${oklab ? "in oklab, " : ""}${stops})`;
  return `linear-gradient(${gradientDirection(gradient.angle)}${oklab ? " in oklab" : ""}, ${stops})`;
}

export function shadowListCss(shadows: readonly Shadow[], color: (value: StyleValue) => string): string {
  const px = (n: number) => (n === 0 ? "0" : `${n}px`);
  return shadows.map((s) => `${s.inset ? "inset " : ""}${px(s.x)} ${px(s.y)} ${px(s.blur)}${s.spread !== undefined ? ` ${px(s.spread)}` : ""} ${color(s.color)}`).join(", ");
}
