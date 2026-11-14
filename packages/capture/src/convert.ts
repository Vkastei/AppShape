import { parseClasses } from "@appshape/dialect-tailwind";
import {
  type DesignNode,
  INPUT_TYPES,
  type Layout,
  type PlatformRaw,
  type SourceAnchor,
  type Style,
  type Tokens,
} from "@appshape/ir";
import type { CapturedNode, CapturedPage } from "./capture";
import { type Redactor, placeholderImage } from "./redact";

/**
 * A captured page → design IR. Elements keep their tag, their source anchor and their classes:
 * what the dialect understands becomes IR style, the rest stays as passthrough classes.
 */

export interface ConvertOptions {
  tokens: Tokens;
  /** Prefix for node ids, unique per frame (e.g. `n_home_`). */
  idPrefix: string;
  redactor: Redactor;
  /** Image path (see `imagePath`) → what the frame should use (undefined: a placeholder). */
  mapImage?: (src: string) => string | undefined;
  /** Whether the board can draw this icon; others are kept as the captured SVG. */
  hasIcon?: (set: string, name: string) => boolean;
}

export interface ConvertResult {
  root: DesignNode;
  warnings: string[];
  /** Same-origin paths of links, for flows between imported pages. */
  links: Array<{ nodeId: string; path: string }>;
  /** Where each element was in the app (page coordinates), for fidelity checks. */
  rects: Map<string, [number, number, number, number]>;
  stats: { nodes: number; text: number; unmappedClasses: number; mappedClasses: number; redacted: number };
}

const HEADING = /^h([1-6])$/;
const TEXT_CONTAINERS = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "label", "strong", "em", "b", "i", "small", "li", "td", "th", "dt", "dd", "blockquote", "figcaption", "code", "pre", "div", "a", "button", "time", "abbr", "mark", "sup", "sub", "legend", "caption", "summary", "q", "cite", "u", "s", "del", "ins"]);
const MEDIA = new Set(["video", "iframe", "canvas", "object", "embed", "audio", "picture"]);
const FIT: Record<string, NonNullable<Extract<DesignNode, { type: "image" }>["fit"]>> = {
  "object-cover": "cover",
  "object-contain": "contain",
  "object-fill": "fill",
  "object-none": "none",
};

export function convertPage(page: CapturedPage, options: ConvertOptions): ConvertResult {
  const warnings: string[] = [];
  const links: ConvertResult["links"] = [];
  const rects: ConvertResult["rects"] = new Map();
  const stats = { nodes: 0, text: 0, unmappedClasses: 0, mappedClasses: 0, redacted: 0 };
  const origin = new URL(page.url).origin;
  let counter = 0;
  const nextId = () => `${options.idPrefix}${(counter++).toString(36)}`;

  // How often each anchor is rendered on this page (`.map()` items, repeated components).
  const anchorCount = new Map<string, number>();
  const anchorKey = (node: CapturedNode) => (node.anchor ? `${node.anchor.file}:${node.anchor.line}:${node.anchor.col}` : undefined);
  const countAnchors = (node: CapturedNode) => {
    const key = anchorKey(node);
    if (key) anchorCount.set(key, (anchorCount.get(key) ?? 0) + 1);
    for (const kid of node.kids ?? []) countAnchors(kid);
  };
  countAnchors(page.root);
  const anchorSeen = new Map<string, number>();

  const sourceOf = (node: CapturedNode): SourceAnchor | undefined => {
    const a = node.anchor;
    if (!a) return undefined;
    const key = anchorKey(node)!;
    const count = anchorCount.get(key) ?? 1;
    const index = anchorSeen.get(key) ?? 0;
    anchorSeen.set(key, index + 1);
    const owner = node.owner !== undefined ? page.owners[node.owner]?.name : undefined;
    return {
      file: a.file,
      line: a.line,
      col: a.col,
      ...(a.component && { component: a.component }),
      ...(owner && owner !== a.component && { owner }),
      ...(count > 1 && { repeated: { count, index, ...(node.key !== undefined && { key: node.key }) } }),
    };
  };

  /** Text of a run, with HTML whitespace collapsing (kept in `pre`). */
  // `<br>` inside text runs is kept as a line break (BR marks it until whitespace is collapsed).
  const runText = (text: string, pre: boolean) => (pre ? text : text.replace(/\s+/g, " ")).replace(/ ?\u0001 ?/g, "\n");

  const convert = (node: CapturedNode, parentLayout: Partial<Layout> | undefined, redacted: boolean, pre: boolean): DesignNode | undefined => {
    if (node.t === "#text") {
      const text = runText(node.text ?? "", pre);
      if (!text.trim()) return undefined;
      stats.nodes++;
      stats.text++;
      const red = options.redactor.text(text, redacted);
      if (red.redacted) stats.redacted++;
      return {
        id: nextId(),
        type: "text",
        origin: "imported",
        text: red.text,
        platformRaw: { tag: "span", element: "#text" },
        ...(red.redacted && { redacted: true }),
      };
    }
    const tag = node.t;
    if (node.framework || (tag === "input" && node.attrs?.type === "hidden")) return undefined;
    stats.nodes++;
    const isRedacted = redacted || node.attrs?.["data-aps-redact"] !== undefined || node.redact === true;
    const isPre = pre || tag === "pre" || tag === "textarea" || (node.cls ?? []).some((c) => /^whitespace-pre/.test(c));
    let classes = node.cls ?? [];

    // Element-specific classes the parser doesn't know about.
    let fit: Extract<DesignNode, { type: "image" }>["fit"];
    let icon: string | undefined;
    if (tag === "img" || tag === "video") {
      const fitClass = classes.find((c) => FIT[c]);
      if (fitClass) {
        fit = FIT[fitClass];
        classes = classes.filter((c) => c !== fitClass);
      }
    }
    if (tag === "svg") {
      icon = classes.find((c) => c.startsWith("lucide-"))?.slice("lucide-".length);
      if (icon && options.hasIcon && !options.hasIcon("lucide", icon)) icon = undefined;
      // lucide's classes name the icon (no styling), also for icons drawn as pictures
      classes = classes.filter((c) => c !== "lucide" && !c.startsWith("lucide-"));
    }

    const parsed = parseClasses(classes, { tokens: options.tokens, ...(parentLayout && { parent: parentLayout }) });
    stats.unmappedClasses += parsed.unmapped.length;
    stats.mappedClasses += classes.length - parsed.unmapped.length;
    const raw: PlatformRaw = { tag };
    if (node.cls?.length) raw.classes = node.cls;
    if (parsed.unmapped.length) raw.unmapped = parsed.unmapped;
    if (node.anchor && node.anchor.element !== tag) raw.element = node.anchor.element;

    // Inline styles: colors become IR styles (editable), the rest is kept and rendered as is.
    let style: Style | undefined = parsed.style;
    if (node.style) {
      const { mapped, rest } = splitInlineStyle(node.style);
      if (Object.keys(mapped).length) style = { ...style, ...mapped };
      if (rest) raw.props = { style: rest };
    }

    const id = nextId();
    if (node.rect) rects.set(id, node.rect);
    const base = {
      id,
      origin: "imported" as const,
      ...(parsed.layout && { layout: parsed.layout }),
      ...(parsed.box && { box: parsed.box }),
      ...(style && { style }),
      ...(parsed.overrides && { overrides: parsed.overrides }),
      ...((parsed.hidden || (node.hidden && !hiddenByClasses(parsed))) && { hidden: true }),
      ...(() => {
        const source = sourceOf(node);
        return source ? { source } : {};
      })(),
      platformRaw: raw,
    };
    const heading = HEADING.exec(tag);
    const semantic = heading ? { semantic: { role: "heading", level: Number(heading[1]) } } : {};
    const markRedacted = (n: DesignNode): DesignNode => {
      if (isRedacted) {
        n.redacted = true;
        stats.redacted++;
      }
      return n;
    };

    if (tag === "svg") {
      if (icon) {
        // lucide's 24×24 size comes from svg attributes, which the board renders too
        return { ...base, type: "icon", icon, set: "lucide" };
      }
      const markup = node.svg ? node.svg.replace(/currentColor/g, node.cs?.color ?? "currentColor") : undefined;
      const src = markup && !isRedacted ? `data:image/svg+xml;utf8,${encodeURIComponent(markup)}` : placeholderImage(node.rect);
      return markRedacted({ ...base, type: "image", src, alt: "", ...sizeFromRect(base, node) });
    }
    if (tag === "img") {
      const src = node.attrs?.src;
      const mapped = !isRedacted && src ? imageSrc(src, origin, options) : undefined;
      if (src && !mapped) {
        stats.redacted++;
        warnings.push(`image replaced by a placeholder: ${src.slice(0, 80)}`);
      }
      const image: DesignNode = {
        ...base,
        type: "image",
        src: mapped ?? placeholderImage(node.rect),
        alt: node.attrs?.alt ?? "",
        ...(fit && { fit }),
        ...(!mapped && src && { redacted: true }),
      };
      // `width`/`height` attributes are size hints that CSS overrides (`height: auto`): kept as attributes.
      const w = Number(node.attrs?.width);
      const h = Number(node.attrs?.height);
      if (w > 0 || h > 0) raw.props = { ...raw.props, ...(w > 0 && { width: w }), ...(h > 0 && { height: h }) };
      return markRedacted(image);
    }
    if (MEDIA.has(tag)) {
      warnings.push(`<${tag}> shown as a placeholder`);
      return { ...base, type: "image", src: placeholderImage(node.rect), alt: tag, ...sizeFromRect(base, node) };
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const type = tag === "textarea" ? "textarea" : tag === "select" ? "select" : (node.attrs?.type ?? "text");
      const inputType = (INPUT_TYPES as readonly string[]).includes(type) ? (type as (typeof INPUT_TYPES)[number]) : "text";
      const value = node.attrs?.value ? options.redactor.text(node.attrs.value, true).text : undefined;
      return markRedacted({
        ...base,
        type: "input",
        inputType,
        ...(node.attrs?.placeholder && { placeholder: node.attrs.placeholder }),
        ...(value && { value }),
      });
    }

    let kids = node.kids ?? [];
    const isBreak = (k: CapturedNode) => k.t === "br" && !k.cls?.length;
    // Only text (and line breaks) inside: a text node with the element's tag.
    if (kids.some((k) => k.t === "#text") && kids.every((k) => k.t === "#text" || isBreak(k)) && TEXT_CONTAINERS.has(tag) && tag !== "a" && tag !== "button") {
      const text = runText(kids.map((k) => (k.t === "#text" ? (k.text ?? "") : BR)).join(""), isPre).trim();
      if (text) {
        stats.text++;
        const red = options.redactor.text(text, isRedacted);
        if (red.redacted) stats.redacted++;
        return { ...base, ...semantic, type: "text", text: red.text, ...(red.redacted && { redacted: true }) };
      }
    }

    // In flex and grid containers, text next to `<br>` forms one item (as the browser groups it).
    if (/flex|grid/.test(node.cs?.display ?? "")) {
      const merged: CapturedNode[] = [];
      for (const kid of kids) {
        const last = merged.at(-1);
        const run = kid.t === "#text" || isBreak(kid);
        const piece = kid.t === "#text" ? (kid.text ?? "") : BR;
        if (run && last?.t === "#text") last.text = `${last.text ?? ""}${piece}`;
        else merged.push(run ? { t: "#text", text: piece } : kid);
      }
      kids = merged;
    }
    const layout = parsed.layout;
    const children: DesignNode[] = [];
    for (const [i, kid] of kids.entries()) {
      let child = kid;
      if (kid.t === "#text" && !isPre) {
        // Whitespace at the edges of an element doesn't render.
        let text = kid.text ?? "";
        if (i === 0) text = text.trimStart();
        if (i === kids.length - 1) text = text.trimEnd();
        child = { ...kid, text };
      }
      const converted = convert(child, layout, isRedacted, isPre);
      if (converted) children.push(converted);
    }
    if (tag === "a") {
      const href = node.attrs?.href;
      const red = href ? options.redactor.href(href) : undefined;
      const link: DesignNode = { ...base, type: "link", ...(red && { href: red }), children };
      if (href) {
        const path = sameOriginPath(href, origin);
        if (path) links.push({ nodeId: link.id, path });
      }
      return markRedacted(link);
    }
    if (tag === "button") return markRedacted({ ...base, type: "button", children });
    return markRedacted({ ...base, ...semantic, type: VOID.has(tag) ? "element" : "box", children } as DesignNode);
  };

  const root = convert(page.root, undefined, false, false) ?? { id: nextId(), type: "box", origin: "imported", children: [] };
  return { root, warnings: [...new Set(warnings)], links, rects, stats };
}

const VOID = new Set(["br", "hr", "wbr"]);
const BR = "\u0001";

function hiddenByClasses(parsed: ReturnType<typeof parseClasses>): boolean {
  if (parsed.hidden) return true;
  return (parsed.overrides ?? []).some((o) => o.hidden === true);
}

function sizeFromRect(base: { box?: DesignNode["box"] }, node: CapturedNode): { box?: DesignNode["box"] } {
  if (base.box?.width || !node.rect) return base.box ? { box: base.box } : {};
  return { box: { ...base.box, width: { mode: "fixed", value: Math.round(node.rect[2]) }, height: { mode: "fixed", value: Math.round(node.rect[3]) } } };
}

/** Same-origin path of a URL (`/pricing`), or undefined for other origins and non-http links. */
export function sameOriginPath(href: string, origin: string): string | undefined {
  if (/^(mailto|tel|javascript|data):/i.test(href) || href.startsWith("#")) return undefined;
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

/**
 * The image a captured `src` refers to: a same-origin path (`/images/x.png`, with `next/image`
 * URLs unwrapped), an external URL, or a data URI.
 */
export function imagePath(src: string, origin: string): string | undefined {
  if (src.startsWith("data:")) return src;
  let url: URL;
  try {
    url = new URL(src, origin);
  } catch {
    return undefined;
  }
  if (url.origin === origin && url.pathname === "/_next/image") {
    const original = url.searchParams.get("url");
    if (original) return imagePath(original, origin);
  }
  return url.origin === origin ? url.pathname : url.href;
}

function imageSrc(src: string, origin: string, options: ConvertOptions): string | undefined {
  const path = imagePath(src, origin);
  if (!path) return undefined;
  if (path.startsWith("data:")) return path.length < 200_000 ? path : undefined;
  if (options.mapImage) return options.mapImage(path);
  return path.startsWith("/") ? path : undefined;
}

/** Image paths used by a captured page (for copying them before conversion). */
export function capturedImages(page: CapturedPage): string[] {
  const origin = new URL(page.url).origin;
  const out = new Set<string>();
  const visit = (node: CapturedNode) => {
    if (node.t === "img" && node.attrs?.src) {
      const path = imagePath(node.attrs.src, origin);
      if (path && !path.startsWith("data:")) out.add(path);
    }
    for (const kid of node.kids ?? []) visit(kid);
  };
  visit(page.root);
  return [...out];
}

/** Inline style → IR colors (editable) and the declarations that stay inline. */
function splitInlineStyle(text: string): { mapped: Style; rest: string } {
  const mapped: Style = {};
  const rest: string[] = [];
  for (const decl of text.split(/;(?![^(]*\))/)) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const property = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!property || !value) continue;
    if ((property === "background-color" || property === "background") && !/(gradient|url)\(/.test(value)) mapped.background = value;
    else if (property === "color") mapped.color = value;
    else rest.push(`${property}: ${value}`);
  }
  return { mapped, rest: rest.join("; ") };
}
