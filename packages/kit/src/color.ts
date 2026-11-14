/**
 * Color math for themes and design checks: CSS colors ⇄ OKLCH (a perceptual space, so a scale's
 * steps look evenly spaced) and WCAG contrast. No dependencies.
 */

export interface Oklch {
  /** Lightness 0–1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

export interface Rgb {
  /** sRGB channels 0–1. */
  r: number;
  g: number;
  b: number;
  /** Opacity 0–1. */
  alpha: number;
}

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** Parses hex, `rgb()`, `oklch()` and white/black. Undefined for anything else (variables, keywords). */
export function parseColor(value: string): Rgb | undefined {
  const text = (NAMED[value.trim().toLowerCase()] ?? value).trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    if (![3, 4, 6, 8].includes(hex.length)) return undefined;
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), alpha: full.length === 8 ? n(6) : 1 };
  }
  const fn = /^(rgba?|oklch)\(([^)]*)\)$/.exec(text);
  if (!fn) return undefined;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  const num = (part: string | undefined, percentOf = 1) => {
    if (part === undefined || part === "none") return 0;
    return part.endsWith("%") ? (parseFloat(part) / 100) * percentOf : parseFloat(part);
  };
  const alpha = parts[3] !== undefined ? num(parts[3]) : 1;
  if (fn[1] === "oklch") {
    const rgb = oklchToRgb({ l: num(parts[0]), c: num(parts[1], 0.4), h: num(parts[2]) });
    return { ...rgb, alpha };
  }
  const channel = (part: string | undefined) => (part?.endsWith("%") ? num(part) : num(part) / 255);
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), alpha };
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: Pick<Rgb, "r" | "g" | "b">): Oklch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  const h = c < 1e-6 ? 0 : (((Math.atan2(bb, a) * 180) / Math.PI) % 360 + 360) % 360;
  return { l: L, c, h };
}

/** The sRGB color, possibly outside 0–1 (see `inGamut`). */
function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (channels: number[]) => channels.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function oklchToRgb(color: Oklch): Pick<Rgb, "r" | "g" | "b"> {
  const [r, g, b] = oklchToLinear(color).map((v) => fromLinear(Math.min(1, Math.max(0, v))));
  return { r: r!, g: g!, b: b! };
}

/** The color with its chroma reduced until it fits sRGB (hue and lightness stay). */
export function toGamut(color: Oklch): Oklch {
  if (inGamut(oklchToLinear(color))) return color;
  let low = 0;
  let high = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ ...color, c: mid }))) low = mid;
    else high = mid;
  }
  return { ...color, c: low };
}

export function toHex(color: Oklch): string {
  const { r, g, b } = oklchToRgb(toGamut(color));
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Pick<Rgb, "r" | "g" | "b">): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Puts a translucent color over a background. */
export function composite(top: Rgb, bottom: Rgb): Rgb {
  const mix = (a: number, b: number) => a * top.alpha + b * (1 - top.alpha);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha: 1 };
}

/** WCAG contrast ratio (1–21) of two colors; a translucent foreground is put over the background first. */
export function contrast(foreground: string | Rgb, background: string | Rgb): number | undefined {
  const bg = typeof background === "string" ? parseColor(background) : background;
  const fgRaw = typeof foreground === "string" ? parseColor(foreground) : foreground;
  if (!bg || !fgRaw) return undefined;
  const fg = fgRaw.alpha < 1 ? composite(fgRaw, bg) : fgRaw;
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}
