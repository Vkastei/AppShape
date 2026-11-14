/**
 * What the in-page walker reports. Kept compact: stacks and owners are shared tables, nodes refer
 * to them by index.
 */

export interface WalkedNode {
  /** Lowercase tag, or `#text` for a text run. */
  t: string;
  text?: string;
  attrs?: Record<string, string>;
  cls?: string[];
  /** Inline `style` attribute. */
  style?: string;
  /** [x, y, width, height] in page coordinates. */
  rect?: [number, number, number, number];
  /** A few computed styles, for fidelity checks. */
  cs?: Record<string, string>;
  /** Index into `stacks`: where React created this element. */
  s?: number;
  /** Index into `owners`: the component instance that created this element. */
  o?: number;
  key?: string;
  /** `display: none` at capture time. */
  hidden?: boolean;
  /** Markup of SVGs that aren't icons. */
  svg?: string;
  /** Matches a redaction selector. */
  redact?: boolean;
  kids?: WalkedNode[];
}

export interface WalkedOwner {
  name: string;
  /** Server Component (Next App Router). */
  server?: boolean;
  /** Index into `stacks`: where the owner itself was created (its call site). */
  s?: number;
  /** The owner's own owner. */
  parent?: number;
  key?: string;
}

export interface WalkResult {
  url: string;
  title: string;
  /** Classes on `<html>` (e.g. `dark`). */
  htmlClasses: string[];
  htmlAttrs: Record<string, string>;
  viewport: { width: number; height: number };
  pageHeight: number;
  root: WalkedNode;
  stacks: string[];
  owners: WalkedOwner[];
  /** Every readable stylesheet, in document order (`href` for linked sheets). */
  css: Array<{ href?: string; text: string }>;
  /** React was found on the page (fibers on DOM nodes). */
  react: boolean;
}

/**
 * The walker, as plain JavaScript (it runs in the page, so it must not depend on bundler helpers).
 * Evaluated as an expression that returns a `WalkResult`.
 */
export function walkScript(options: { redactSelectors?: readonly string[] } = {}): string {
  return WALK_SCRIPT.replace("__REDACT__", JSON.stringify(options.redactSelectors ?? []));
}

const WALK_SCRIPT = String.raw`(() => {
  const REDACT = __REDACT__.filter((s) => { try { document.querySelector(s); return true; } catch { return false; } }).join(", ");
  const SKIP = new Set(["script", "style", "noscript", "template", "link", "meta", "head", "title", "base", "nextjs-portal", "vite-error-overlay", "next-route-announcer"]);
  const ATTRS = ["id", "href", "src", "alt", "type", "placeholder", "role", "aria-label", "name", "value", "for", "target", "rel", "title", "data-aps-redact", "data-aps-m", "data-testid", "srcset", "width", "height", "disabled", "checked", "rows"];
  const COMPUTED = ["display", "position", "color", "background-color", "font-size", "font-weight", "line-height", "font-family", "padding-top", "padding-left", "margin-top", "border-radius", "gap", "opacity", "text-align"];
  const stacks = [];
  const stackIndex = new Map();
  const owners = [];
  const ownerIndex = new Map();
  let fiberKey;
  let react = false;

  const stackOf = (error) => {
    const text = error && typeof error.stack === "string" ? error.stack : typeof error === "string" ? error : undefined;
    if (!text) return undefined;
    const lines = text.split("\n");
    const kept = [];
    for (const line of lines.slice(1)) {
      kept.push(line);
      if (line.includes("react_stack_bottom_frame") || kept.length >= 24) break;
    }
    const value = kept.join("\n");
    let index = stackIndex.get(value);
    if (index === undefined) {
      index = stacks.length;
      stacks.push(value);
      stackIndex.set(value, index);
    }
    return index;
  };

  const nameOf = (type) => {
    if (!type) return undefined;
    if (typeof type === "string") return type;
    return type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) || (type.type && nameOf(type.type)) || undefined;
  };

  const ownerOf = (owner, depth) => {
    if (!owner || depth > 60) return undefined;
    const known = ownerIndex.get(owner) ?? (owner.alternate ? ownerIndex.get(owner.alternate) : undefined);
    if (known !== undefined) return known;
    const index = owners.length;
    ownerIndex.set(owner, index);
    const isFiber = typeof owner.tag === "number" && "return" in owner;
    const entry = {
      name: (isFiber ? nameOf(owner.type) : owner.name) || "Anonymous",
    };
    owners.push(entry);
    if (!isFiber && owner.env) entry.server = owner.env === "Server";
    const s = stackOf(owner._debugStack || owner.debugStack || owner.stack);
    if (s !== undefined) entry.s = s;
    if (owner.key != null) entry.key = String(owner.key);
    const parent = ownerOf(owner._debugOwner || owner.owner, depth + 1);
    if (parent !== undefined) entry.parent = parent;
    return index;
  };

  const fiberOf = (el) => {
    if (fiberKey === undefined) {
      fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$")) || null;
    }
    if (fiberKey) return el[fiberKey];
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (key) {
      fiberKey = key;
      return el[key];
    }
    return undefined;
  };

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    const node = { t: tag };
    const fiber = fiberOf(el);
    if (fiber) {
      react = true;
      const s = stackOf(fiber._debugStack);
      if (s !== undefined) node.s = s;
      const o = ownerOf(fiber._debugOwner, 0);
      if (o !== undefined) node.o = o;
      if (fiber.key != null) node.key = String(fiber.key);
    }
    const cls = el.getAttribute("class");
    if (cls && cls.trim()) node.cls = cls.trim().split(/\s+/);
    if (REDACT && el.matches(REDACT)) node.redact = true;
    const style = el.getAttribute("style");
    if (style) node.style = style;
    const attrs = {};
    let hasAttrs = false;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) {
        attrs[name] = value;
        hasAttrs = true;
      }
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (el.value) attrs.value = String(el.value);
      if (tag === "input" && el.type) attrs.type = el.type;
      hasAttrs = true;
    }
    if (hasAttrs) node.attrs = attrs;
    const r = el.getBoundingClientRect();
    node.rect = [Math.round((r.x + scrollX) * 10) / 10, Math.round((r.y + scrollY) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
    const computed = getComputedStyle(el);
    if (computed.display === "none") node.hidden = true;
    const cs = {};
    for (const prop of COMPUTED) cs[prop] = computed.getPropertyValue(prop);
    node.cs = cs;
    if (tag === "svg") {
      // Icons too: an icon the board's icon set lacks is shown from its markup.
      const markup = el.outerHTML;
      if (markup.length < 40000) node.svg = markup;
      return node;
    }
    if (tag === "select") return node;
    const kids = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const text = child.textContent;
        if (text && text.trim()) kids.push({ t: "#text", text });
      } else if (child.nodeType === 1) {
        const childTag = child.tagName.toLowerCase();
        if (SKIP.has(childTag) || child.hasAttribute("data-appshape-ui")) continue;
        if (childTag.includes("-") && !fiberOf(child) && !child.children.length) continue;
        if (childTag.includes("-") && child.shadowRoot && !fiberOf(child)) continue;
        kids.push(walk(child));
      }
    }
    if (kids.length) node.kids = kids;
    return node;
  };

  const css = [];
  const readSheet = (sheet) => {
    try {
      const entry = { text: Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n") };
      if (sheet.href) entry.href = sheet.href;
      css.push(entry);
    } catch {
      // cross-origin stylesheet
    }
  };
  for (const sheet of document.styleSheets) if (!(sheet.ownerNode && sheet.ownerNode.hasAttribute && sheet.ownerNode.hasAttribute("data-aps-capture"))) readSheet(sheet);
  for (const sheet of document.adoptedStyleSheets || []) readSheet(sheet);

  const htmlAttrs = {};
  for (const attr of document.documentElement.attributes) if (attr.name !== "class") htmlAttrs[attr.name] = attr.value;

  return {
    url: location.href,
    title: document.title,
    htmlClasses: (document.documentElement.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean),
    htmlAttrs,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pageHeight: document.documentElement.scrollHeight,
    root: walk(document.body),
    stacks,
    owners,
    css,
    react,
  };
})()`;
