import { type MarkupShape, markupColor } from "@appshape/ir";

/**
 * Draw & describe: drawings as SVG, the same on the board and in the pictures the AI and the
 * coding agent get. Coordinates are the screen's design pixels.
 */

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An arrowhead at `to`, pointing away from `from`. */
function arrowHead(from: readonly [number, number], to: readonly [number, number], size: number): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const point = (a: number) => `${to[0] - size * Math.cos(angle + a)},${to[1] - size * Math.sin(angle + a)}`;
  return `${point(-0.45)} ${to[0]},${to[1]} ${point(0.45)}`;
}

/** One shape as SVG (design px). */
export function shapeSvg(shape: MarkupShape): string {
  const color = markupColor(shape.color);
  const width = shape.width ?? 4;
  const stroke = `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (shape.kind) {
    case "pen":
      return shape.points.length === 1
        ? `<circle cx="${shape.points[0]![0]}" cy="${shape.points[0]![1]}" r="${width / 2}" fill="${color}"/>`
        : `<polyline points="${shape.points.map((p) => p.join(",")).join(" ")}" ${stroke}/>`;
    case "arrow":
      return `<line x1="${shape.from[0]}" y1="${shape.from[1]}" x2="${shape.to[0]}" y2="${shape.to[1]}" ${stroke}/><polyline points="${arrowHead(shape.from, shape.to, 10 + width * 2)}" ${stroke}/>`;
    case "rect":
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${width}" ${stroke}/>`;
    case "ellipse":
      return `<ellipse cx="${shape.x + shape.w / 2}" cy="${shape.y + shape.h / 2}" rx="${shape.w / 2}" ry="${shape.h / 2}" ${stroke}/>`;
    case "label":
      return `<text x="${shape.x}" y="${shape.y}" fill="${color}" font-family="system-ui, sans-serif" font-size="16" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round">${escape(shape.text)}</text>`;
  }
}

/** The whole drawing as an SVG the size of the screen. */
export function markupSvg(shapes: readonly MarkupShape[], width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;left:0;top:0;pointer-events:none;overflow:visible">${shapes.map(shapeSvg).join("")}</svg>`;
}
