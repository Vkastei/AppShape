import { BOARD_ORIGIN, boardHtml, boardStyles, type launchBrowser, serveBoard } from "@appshape/capture";
import { componentSources, type DesignNode, type Frame, type MarkupShape, themedTokens } from "@appshape/ir";
import type { EvalCase, Mark } from "./cases";
import type { EvalProject } from "./projects";
import { must, type Screen } from "./tree";

type Browser = Awaited<ReturnType<typeof launchBrowser>>;

/**
 * The drawing of a case, placed on the screen as rendered: each mark is drawn around, over or
 * between the elements it names (measured in the browser), like a person would draw it.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where elements are on the screen at a width (design px from the screen's top left). */
export async function measure(browser: Browser, source: EvalProject, frame: Frame, width: number, ids: string[]): Promise<Map<string, Rect>> {
  const html = boardHtml({
    root: frame.current,
    tokens: themedTokens(source.project.tokens, frame.theme),
    components: source.project.components,
    sources: componentSources(source.project.frames),
    ...(await boardStyles(source.dataDir)),
    width,
    height: 800,
    appRoot: source.appRoot,
    dataDir: source.dataDir,
  });
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce", colorScheme: "light" });
  try {
    await serveBoard(page, html, source);
    await page.goto(`${BOARD_ORIGIN}/`);
    await page.evaluate(() => document.fonts.ready);
    const found = await page.evaluate((ids) => {
      const root = document.getElementById("host")!.shadowRoot!;
      const host = document.getElementById("host")!.getBoundingClientRect();
      const out: [string, { x: number; y: number; w: number; h: number }][] = [];
      for (const id of ids) {
        const el = root.querySelector(`[data-aps="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        out.push([id, { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height }]);
      }
      return out;
    }, ids);
    return new Map(found);
  } finally {
    await page.close();
  }
}

let next = 0;
const shapeId = () => `s_eval${(next++).toString(36).padStart(4, "0")}`;

/** The nodes a case's marks are drawn on. */
export function markNodes(mark: Mark, screen: Screen): DesignNode[] {
  switch (mark.kind) {
    case "cross":
    case "ellipse":
    case "rect":
      return [must(mark.on, screen, mark.kind)];
    case "gap":
      return [must(mark.after, screen, "gap after"), must(mark.before, screen, "gap before"), ...(mark.from ? [must(mark.from, screen, "gap from")] : [])];
    case "arrow":
      return [must(mark.from, screen, "arrow from"), must(mark.to, screen, "arrow to")];
    case "label":
      return [must(mark.near, screen, "label near")];
  }
}

/** The shapes of a case's marks, with the elements each one touches (as the board works them out). */
export function drawMarks(c: EvalCase, screen: Screen, rects: Map<string, Rect>, width: number): MarkupShape[] {
  const rect = (n: DesignNode) => {
    const r = rects.get(n.id);
    if (!r) throw new Error(`${c.id}: element ${n.id} isn't visible at ${width}px`);
    return r;
  };
  const shapes: MarkupShape[] = [];
  for (const mark of c.marks) {
    const nodes = markNodes(mark, screen);
    const color = mark.color ?? (mark.kind === "cross" ? "remove" : mark.kind === "gap" ? "add" : "change");
    switch (mark.kind) {
      case "cross": {
        const r = rect(nodes[0]!);
        const inset = Math.min(r.w, r.h) * 0.1;
        const [l, t, rr, b] = [r.x + inset, r.y + inset, r.x + r.w - inset, r.y + r.h - inset];
        const line = (a: [number, number], z: [number, number]) => Array.from({ length: 9 }, (_, i): [number, number] => [Math.round(a[0] + ((z[0] - a[0]) * i) / 8), Math.round(a[1] + ((z[1] - a[1]) * i) / 8)]);
        shapes.push({ id: shapeId(), kind: "pen", color, points: line([l, t], [rr, b]), targets: [nodes[0]!.id] });
        shapes.push({ id: shapeId(), kind: "pen", color, points: line([rr, t], [l, b]), targets: [nodes[0]!.id] });
        break;
      }
      case "ellipse":
      case "rect": {
        const r = rect(nodes[0]!);
        const pad = mark.kind === "ellipse" ? Math.max(12, Math.min(r.w, r.h) * 0.25) : 8;
        shapes.push({ id: shapeId(), kind: mark.kind, color, x: Math.round(r.x - pad), y: Math.round(r.y - pad), w: Math.round(r.w + 2 * pad), h: Math.round(r.h + 2 * pad), targets: [nodes[0]!.id] });
        break;
      }
      case "gap": {
        const [a, b] = [rect(nodes[0]!), rect(nodes[1]!)];
        // from the end of what's visible above (a section's padding is part of the gap)
        const above = nodes[2] ? rect(nodes[2]) : a;
        const top = above.y + above.h;
        const space = b.y - top;
        const h = Math.max(48, space * 0.7);
        const mid = top + space / 2;
        const x = Math.min(a.x, b.x) + Math.max(a.w, b.w) * 0.2;
        shapes.push({ id: shapeId(), kind: "rect", color, x: Math.round(x), y: Math.round(mid - h / 2), w: Math.round(Math.max(a.w, b.w) * 0.6), h: Math.round(h), targets: [screen.parentOf(nodes[0]!.id)?.id ?? nodes[0]!.id] });
        break;
      }
      case "arrow": {
        const [a, b] = [rect(nodes[0]!), rect(nodes[1]!)];
        // a small element: from its edge facing the target (not over it); a section: from inside it
        const [dx, dy] = [b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)];
        const from: [number, number] =
          a.h > 120 ? [Math.round(a.x + a.w * 0.15), Math.round(a.y + a.h / 2)] : Math.abs(dx) > Math.abs(dy) ? [Math.round(dx > 0 ? a.x + a.w + 6 : a.x - 6), Math.round(a.y + a.h / 2)] : [Math.round(a.x + a.w / 2), Math.round(dy > 0 ? a.y + a.h + 6 : a.y - 6)];
        const to: [number, number] = mark.above ? [Math.round(b.x + b.w * 0.15), Math.round(b.y + 6)] : [Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2)];
        shapes.push({ id: shapeId(), kind: "arrow", color, from, to, targets: [nodes[1]!.id] });
        break;
      }
      case "label": {
        const r = rect(nodes[0]!);
        shapes.push({ id: shapeId(), kind: "label", color, x: Math.round(Math.min(r.x + r.w - 220, width - 230)), y: Math.round(r.y + r.h + 20), text: mark.text, targets: [nodes[0]!.id] });
        break;
      }
    }
  }
  return shapes;
}
