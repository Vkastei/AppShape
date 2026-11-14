/**
 * Drawn placeholder pictures for starter components and sections: plain SVG, tinted with a color
 * at low opacity, so they suit light and dark pages alike and are clearly meant to be replaced
 * (drop a photo onto them).
 */

export type PlaceholderKind = "photo" | "portrait" | "abstract" | "logo";

const SIZES: Record<PlaceholderKind, [number, number]> = {
  photo: [800, 500],
  portrait: [400, 400],
  abstract: [800, 600],
  logo: [160, 48],
};

function svg(kind: PlaceholderKind, tint: string): string {
  const [w, h] = SIZES[kind];
  const fill = (opacity: number) => `fill="${tint}" fill-opacity="${opacity}"`;
  switch (kind) {
    case "photo":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" ${fill(0.12)}/><circle cx="590" cy="150" r="54" ${fill(0.3)}/><path d="M0 500 L230 250 L400 420 L520 310 L800 500Z" ${fill(0.28)}/><path d="M0 500 L170 360 L330 500Z" ${fill(0.2)}/></svg>`;
    case "portrait":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" ${fill(0.16)}/><circle cx="200" cy="160" r="76" ${fill(0.34)}/><path d="M60 400 C60 300 120 255 200 255 C280 255 340 300 340 400Z" ${fill(0.34)}/></svg>`;
    case "abstract":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" ${fill(0.1)}/><circle cx="250" cy="230" r="190" ${fill(0.18)}/><circle cx="560" cy="380" r="220" ${fill(0.14)}/><rect x="160" y="160" width="480" height="300" rx="24" fill="none" stroke="${tint}" stroke-opacity="0.35" stroke-width="3"/><rect x="200" y="210" width="220" height="20" rx="10" ${fill(0.35)}/><rect x="200" y="250" width="320" height="14" rx="7" ${fill(0.2)}/><rect x="200" y="278" width="280" height="14" rx="7" ${fill(0.2)}/><rect x="200" y="330" width="120" height="40" rx="12" ${fill(0.45)}/></svg>`;
    case "logo":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="4" y="10" width="28" height="28" rx="8" ${fill(0.55)}/><rect x="42" y="16" width="100" height="16" rx="8" ${fill(0.4)}/></svg>`;
  }
}

/** A placeholder picture as an image source, with its natural size. */
export function placeholderImage(kind: PlaceholderKind, tint = "#71717a"): { src: string; width: number; height: number } {
  const [width, height] = SIZES[kind];
  return { src: `data:image/svg+xml;utf8,${encodeURIComponent(svg(kind, tint))}`, width, height };
}

/** Whether an image source is one of these placeholders (design checks ask to replace them). */
export function isPlaceholderImage(src: string): boolean {
  return src.startsWith("data:image/svg+xml") && /fill-opacity%3D%22/.test(src);
}
