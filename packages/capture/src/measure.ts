/**
 * Measures a rendered page for verification: every element with its box, text and the styles that
 * make it look the way it does. The same script runs on the board's rendering of the design
 * (elements with `data-aps`/`data-aps-i`, in the shadow root) and on the app, so both sides are
 * measured by the same browser in the same way.
 */

export interface MeasuredElement {
  /** Index of the parent in the list (-1 for roots). Elements are in document order. */
  p: number;
  /** Index of the last descendant (subtree = this index … `end`). */
  end: number;
  /** Board: the design node id (`data-aps`) or the rendered id inside an instance (`data-aps-i`). */
  key?: string;
  tag: string;
  /** Page coordinates: x, y, width, height. */
  r: [number, number, number, number];
  /** Rendered and not hidden (has a box). */
  vis: boolean;
  /** App: it animated while the page was scrolled through (`ANIMATION_MARKER`). */
  anim?: boolean;
  /** Text of the element's own text nodes (normalized whitespace). */
  own: string;
  /** Rendered text of the whole element (`innerText`, normalized, at most 400 characters). */
  text?: string;
  /** Visual styles (colors normalized to rgba). */
  s: Record<string, string>;
  href?: string;
  src?: string;
  /** Board: the screen a link or button opens (`data-aps-target`). */
  target?: string;
  /** Icon: `data-aps-icon` (board) or the lucide class (app). */
  icon?: string;
  /** App: an svg's markup (to recognize icons by their shapes). */
  svg?: string;
  /** The app's `class` list. */
  cls?: string;
}

/** Visual properties compared between design and app. Text properties only matter where there is text. */
export const STYLE_PROPS = [
  "color",
  "background-color",
  "background-image",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration-line",
  "text-transform",
  "text-align",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "opacity",
  "object-fit",
] as const;

export const TEXT_PROPS = new Set(["color", "font-size", "font-weight", "font-style", "text-decoration-line", "text-transform", "text-align"]);

/** Script for `page.evaluate`; `board` measures the design inside `#host`'s shadow root. Marks app elements with `data-aps-m`. */
export function measureScript(mode: "board" | "app"): string {
  return MEASURE.replace("__MODE__", JSON.stringify(mode)).replace("__PROPS__", JSON.stringify(STYLE_PROPS));
}

const MEASURE = String.raw`(() => {
  const MODE = __MODE__;
  const PROPS = __PROPS__;
  const SKIP = new Set(["script", "style", "noscript", "template", "link", "meta", "head", "title", "base", "nextjs-portal", "vite-error-overlay", "next-route-announcer"]);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const colors = new Map();
  const color = (value) => {
    if (!value || value === "transparent") return "rgba(0,0,0,0)";
    let out = colors.get(value);
    if (out) return out;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    out = "rgba(" + r + "," + g + "," + b + "," + Math.round((a / 255) * 100) / 100 + ")";
    colors.set(value, out);
    return out;
  };
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  const out = [];
  // board: the labels of form fields (drawn in a wrapper without an id; the app shows them as text)
  const labels = [];
  const keyOf = (el) => MODE === "board" ? (el.getAttribute("data-aps") ?? el.getAttribute("data-aps-i") ?? undefined) : undefined;

  const visit = (el, parent) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || el.hasAttribute("data-appshape-ui")) return;
    if (MODE === "board" && el.hasAttribute("data-aps-field")) {
      let text = "";
      for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
      if (norm(text)) labels.push(norm(text));
    }
    const key = keyOf(el);
    let index = parent;
    if (MODE === "app" || key !== undefined) {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const vis = cs.display !== "none" && cs.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
      const s = {};
      for (const p of PROPS) {
        let v = cs.getPropertyValue(p);
        if (p.endsWith("color")) v = color(v);
        else if (p === "text-align") v = v === "start" ? "left" : v === "end" ? "right" : v;
        else if (p === "background-image") v = v === "none" ? "none" : v.includes("gradient") ? "gradient" : "image";
        else if (p === "box-shadow" && v !== "none") {
          // layers in normalized colors, without invisible ones (Tailwind's empty ring/inset layers)
          const layers = v.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-f]+/gi, (c) => color(c)).split(/,(?![^(]*\))/).map((l) => l.trim());
          const visible = layers.filter((l) => !/rgba\(\d+,\d+,\d+,0\)/.test(l));
          v = visible.length ? visible.join(", ") : "none";
        }
        s[p] = v;
      }
      let own = "";
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      const entry = { p: parent, end: 0, tag, r: [rect.x + scrollX, rect.y + scrollY, rect.width, rect.height], vis, own: norm(own), s };
      if (key !== undefined) entry.key = key;
      if (MODE === "app" && el.hasAttribute("data-aps-animated")) entry.anim = true;
      if (vis) entry.text = norm(el.innerText).slice(0, 400);
      const link = el.closest("a[href]");
      if (link && (tag === "a" || el === link)) entry.href = link.getAttribute("href");
      if (MODE === "board" && el.hasAttribute("data-href")) entry.href = el.getAttribute("data-href");
      if (MODE === "board" && el.hasAttribute("data-aps-target")) entry.target = el.getAttribute("data-aps-target");
      if (tag === "img") entry.src = el.currentSrc || el.getAttribute("src") || "";
      if (MODE === "board" && el.hasAttribute("data-aps-icon")) entry.icon = el.getAttribute("data-aps-icon");
      if (MODE === "app" && tag === "svg") {
        const m = /(?:^|\s)lucide-([a-z0-9-]+)/.exec(el.getAttribute("class") || "");
        if (m) entry.icon = m[1];
        entry.svg = el.innerHTML.replace(/\s+/g, " ").slice(0, 2000);
      }
      if (MODE === "app") {
        entry.cls = el.getAttribute("class") || "";
        el.setAttribute("data-aps-m", String(out.length));
      }
      index = out.length;
      out.push(entry);
    }
    for (const child of el.children) visit(child, index);
    if (index !== parent) out[index].end = out.length - 1;
  };

  if (MODE === "board") {
    const root = document.getElementById("host").shadowRoot;
    for (const child of root.children) visit(child, -1);
  } else {
    visit(document.body, -1);
  }
  return { elements: out, labels, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
})()`;
