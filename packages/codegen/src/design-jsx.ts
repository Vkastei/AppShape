import { parseClasses } from "@appshape/dialect-tailwind";
import {
  type ComponentSource,
  componentSources,
  createId,
  type DesignNode,
  type Frame,
  INPUT_TYPES,
  type InstanceNode,
  indexTree,
  isContainer,
  type JsonValue,
  type Layout,
  type NodeLocation,
  type Project,
  type TextSpan,
  themedTokens,
  type Tokens,
} from "@appshape/ir";
import ts from "typescript";
import { type ClassContext, nodeClasses, styleClasses } from "./classes";
import { pascalCase } from "./names";

/**
 * Draw & describe: a screen as "design JSX" for an AI (or a person) to edit, and the edited JSX
 * back as a design. React + Tailwind as the generator writes it, with a `data-id` on every
 * element: elements that keep their id stay the same element (unchanged ones exactly as they
 * were), the others are new. Classes go through the dialect's class parser with the project's
 * tokens, so a proposal is made of the design system.
 *
 * The format, besides plain JSX and Tailwind classes:
 * - `<Icon name="arrow-right" />`: a Lucide icon by name;
 * - `<PricingCard plan="Pro" />`: a component of the project with its properties; named slots as
 *   `<Slot name="actions">…</Slot>` children (a component with one slot takes plain children);
 * - `href="/pricing"` on a link or a button: going to the screen with that route;
 * - `{[{ … }, { … }].map((item) => (<li>{item.name}</li>))}`: a list of data (`data-list` names it);
 * - `data-name`: the element's name in the layers; `data-scroll="horizontal"`: a scrolling area;
 * - `label` on inputs: the field's label.
 */

const SAFE_TAG = /^[a-z][a-z0-9-]*$/;
const BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "frame", "frameset", "template", "noscript", "html", "head", "body"]);
const INLINE_TAGS = new Set(["span", "a", "button", "label", "strong", "em", "b", "i", "small", "code", "sup", "sub", "mark"]);
const VOID_TAGS = new Set(["img", "input", "br", "hr", "area", "col", "wbr", "source", "track"]);
const ROLE_TAGS: Record<string, string> = {
  nav: "nav", header: "header", main: "main", footer: "footer", section: "section", aside: "aside",
  form: "form", article: "article", list: "ul", listitem: "li", paragraph: "p",
  details: "details", summary: "summary",
};
const TAG_ROLES: Record<string, string> = Object.fromEntries(Object.entries(ROLE_TAGS).map(([role, tag]) => [tag, role]));
/** Roles written as a `role` attribute (no element of their own). */
const ARIA_ROLES = new Set(["tablist", "tab", "tabpanel"]);
/** Elements that hold text (a text element when they hold nothing else). */
const TEXT_TAGS = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "label", "strong", "em", "b", "i", "small", "code", "sup", "sub", "mark", "blockquote", "figcaption", "cite", "q", "div", "li", "dt", "dd", "td", "th", "legend", "caption"]);
/** Inline elements inside a text that become its formatted parts. */
const SPAN_TAGS = new Set(["span", "a", "strong", "b", "em", "i", "small", "code", "mark", "u", "s"]);

type ListNode = Extract<DesignNode, { type: "list" }>;
type TextNode = Extract<DesignNode, { type: "text" }>;

interface Names {
  /** component id → name in the JSX */
  components: Map<string, string>;
  /** name in the JSX → component id */
  byName: Map<string, string>;
  /** frame id → route, and back */
  routes: Map<string, string>;
  frames: Map<string, string>;
}

function names(project: Project, sources: ReadonlyMap<string, ComponentSource>): Names {
  const components = new Map<string, string>();
  const byName = new Map<string, string>();
  const add = (id: string, name: string) => {
    let unique = pascalCase(name);
    for (let i = 2; byName.has(unique) || unique === "Icon" || unique === "Slot"; i++) unique = `${pascalCase(name)}${i}`;
    components.set(id, unique);
    byName.set(unique, id);
  };
  for (const source of sources.values()) add(source.id, source.name);
  for (const component of project.components) if (!components.has(component.id)) add(component.id, component.name);
  const routes = new Map<string, string>();
  const frames = new Map<string, string>();
  for (const frame of project.frames) {
    if (frame.kind === "component" || !frame.target.route) continue;
    routes.set(frame.id, frame.target.route);
    if (!frames.has(frame.target.route)) frames.set(frame.target.route, frame.id);
  }
  return { components, byName, routes, frames };
}

// ════════════════════════════════════════════════════════════════════════════
// Writing
// ════════════════════════════════════════════════════════════════════════════

const attr = (name: string, value: string) => (/["\\{}<>\n]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`);
const plainText = (text: string) => (text !== "" && /^[^{}<>&\n\r\t`]*$/.test(text) && text === text.trim() && !text.includes("  ") ? text : `{${JSON.stringify(text)}}`);
const jsxText = (text: string) => (text.includes("\n") ? text.split("\n").map((line) => (line ? plainText(line) : "")).join("<br />") : plainText(text));
const pad = (n: number) => " ".repeat(n);

function jsonValue(value: JsonValue): string {
  return JSON.stringify(value);
}

/** The element a node is written as. */
function tagOf(node: DesignNode, inline: boolean, n: Names): string {
  if (node.type === "instance") return n.components.get(node.componentId) ?? "UnknownComponent";
  if (node.type === "icon") return "Icon";
  if (node.type === "input") return node.inputType === "textarea" ? "textarea" : node.inputType === "select" ? "select" : "input";
  const raw = node.platformRaw?.tag;
  if (raw && SAFE_TAG.test(raw) && !BLOCKED_TAGS.has(raw)) return raw;
  const role = node.semantic?.role;
  switch (node.type) {
    case "text":
      if (role === "heading") return `h${node.semantic?.level ?? 2}`;
      return inline ? "span" : "p";
    case "button":
      return "button";
    case "link":
      return "a";
    case "image":
      return "img";
    default:
      return (role && ROLE_TAGS[role]) || "div";
  }
}

/** The classes of a node as written (its design as Tailwind classes, a picture's fit). */
function classesOf(node: DesignNode, parent: Partial<Layout> | undefined, ctx: ClassContext): string[] {
  const base = nodeClasses(node, parent, ctx).base;
  if (node.type === "image" && node.fit) base.push(`object-${node.fit}`);
  return base;
}

/** A text's content as JSX children. */
function textContent(node: TextNode, ctx: ClassContext, item: string | undefined): string {
  const key = item && node.bind?.text;
  if (key) return `{${item}.${key}}`;
  if (!node.spans?.length) return jsxText(node.text);
  return node.spans
    .map((span) => {
      const classes = styleClasses(span.style, ctx).join(" ");
      const cls = classes ? ` ${attr("className", classes)}` : "";
      if (span.href) return `<a ${attr("href", span.href)}${cls}>${jsxText(span.text)}</a>`;
      return classes ? `<span${cls}>${jsxText(span.text)}</span>` : jsxText(span.text);
    })
    .join("");
}

interface WriteCtx {
  ctx: ClassContext;
  n: Names;
  sources: ReadonlyMap<string, ComponentSource>;
}

function element(tag: string, attrs: string[], children: string[] | string | undefined, indent: number): string {
  const open = `<${[tag, ...attrs].join(" ")}`;
  if (children === undefined || (Array.isArray(children) && children.length === 0)) return VOID_TAGS.has(tag) || /^[A-Z]/.test(tag) ? `${open} />` : `${open}></${tag}>`;
  if (typeof children === "string") return `${open}>${children}</${tag}>`;
  return `${open}>\n${children.map((c) => pad(indent + 2) + c).join("\n")}\n${pad(indent)}</${tag}>`;
}

function propAttr(name: string, value: JsonValue, field: string | undefined, n: Names): string {
  if (field === "target" && typeof value === "string") return attr(name, n.routes.get(value) ?? value);
  if (typeof value === "boolean") return value ? name : `${name}={false}`;
  if (typeof value === "number") return `${name}={${value}}`;
  if (typeof value === "string") return attr(name, value);
  return `${name}={${jsonValue(value)}}`;
}

function write(node: DesignNode, parent: Partial<Layout> | undefined, inline: boolean, indent: number, w: WriteCtx, item?: string): string {
  const tag = tagOf(node, inline, w.n);
  const classes = classesOf(node, parent, w.ctx).join(" ");
  const attrs = [attr("data-id", node.id), ...(node.name ? [attr("data-name", node.name)] : []), ...(classes ? [attr("className", classes)] : [])];
  if (node.semantic?.role && ARIA_ROLES.has(node.semantic.role)) attrs.push(attr("role", node.semantic.role));
  const bound = (field: string) => (item && node.bind?.[field] ? `{${item}.${node.bind[field]}}` : undefined);
  const childInline = inline || INLINE_TAGS.has(tag);
  const children = (list: readonly DesignNode[], layout: Partial<Layout> | undefined, asInline: boolean, at = indent) => list.map((c) => write(c, layout, asInline, at + 2, w, item));
  switch (node.type) {
    case "text":
      return element(tag, attrs, textContent(node, w.ctx, item), indent);
    case "image":
      attrs.push(bound("src") ? `src=${bound("src")}` : attr("src", node.src), ...(bound("alt") ? [`alt=${bound("alt")}`] : node.alt !== undefined ? [attr("alt", node.alt)] : []));
      return element(tag, attrs, undefined, indent);
    case "icon":
      attrs.push(bound("icon") ? `name=${bound("icon")}` : attr("name", node.icon), ...(node.set !== undefined ? [attr("set", node.set)] : []));
      return element(tag, attrs, undefined, indent);
    case "input":
      if (tag === "input") attrs.push(attr("type", node.inputType === "switch" ? "checkbox" : node.inputType), ...(node.inputType === "switch" ? [`role="switch"`] : []));
      if (node.label !== undefined) attrs.push(attr("label", node.label));
      if (node.placeholder !== undefined) attrs.push(attr("placeholder", node.placeholder));
      if (node.value !== undefined) attrs.push(attr("value", node.value));
      return element(tag, attrs, undefined, indent);
    case "button":
    case "link": {
      const href = bound("href") ? `href=${bound("href")}` : hrefOf(node, w.n) !== undefined ? attr("href", hrefOf(node, w.n)!) : undefined;
      if (href) attrs.push(href);
      return element(tag, attrs, children(node.children, node.layout, true), indent);
    }
    case "instance": {
      const source = w.sources.get(node.componentId);
      for (const [name, value] of Object.entries(node.props)) {
        const key = item && node.bind?.[`props.${name}`];
        if (key) attrs.push(`${name}={${item}.${key}}`);
        else attrs.push(propAttr(name, value, source?.def.props.find((p) => p.name === name)?.bindings?.[0]?.field, w.n));
      }
      const fills = node.children.filter((c): c is Extract<DesignNode, { type: "slot" }> => c.type === "slot");
      const slotLayout = (slotName: string) => (source ? findSlot(source.root, slotName)?.layout : undefined);
      const written = fills.map((fill) => {
        const fillClasses = classesOf(fill, undefined, w.ctx).join(" ");
        const fillAttrs = [attr("data-id", fill.id), attr("name", fill.slotName), ...(fill.name ? [attr("data-name", fill.name)] : []), ...(fillClasses ? [attr("className", fillClasses)] : [])];
        return element("Slot", fillAttrs, children(fill.children, { ...slotLayout(fill.slotName), ...fill.layout }, false, indent + 2), indent + 2);
      });
      return element(tag, attrs, written, indent);
    }
    case "scroll":
      attrs.push(attr("data-scroll", node.direction));
      return element(tag, attrs, children(node.children, node.layout, childInline), indent);
    case "list": {
      if (node.dataName) attrs.push(attr("data-list", node.dataName));
      else attrs.push("data-list");
      if (node.items && node.children[0]) {
        const data = node.items.map((it) => `${pad(indent + 4)}${jsonValue(it)},`).join("\n");
        const template = write(node.children[0], node.layout, childInline, indent + 4, w, "item");
        return element(tag, attrs, [`{[\n${data}\n${pad(indent + 2)}].map((item) => (\n${pad(indent + 4)}${template}\n${pad(indent + 2)}))}`], indent);
      }
      return element(tag, attrs, children(node.children, node.layout, childInline), indent);
    }
    case "slot":
      attrs.push(attr("data-slot", node.slotName));
      return element(tag, attrs, children(node.children, node.layout, childInline), indent);
    default:
      return element(tag, attrs, children(node.children, node.layout, childInline), indent);
  }
}

/** Where a button or link goes, as written: the route of its screen, or its URL. */
function hrefOf(node: DesignNode, n: Names): string | undefined {
  if (node.type !== "button" && node.type !== "link") return undefined;
  if (node.targetFrameId) return n.routes.get(node.targetFrameId) ?? `#${node.targetFrameId}`;
  return node.type === "link" ? node.href : undefined;
}

function findSlot(root: DesignNode, slotName: string): DesignNode | undefined {
  let found: DesignNode | undefined;
  const visit = (node: DesignNode) => {
    if (found) return;
    if (node.type === "slot" && node.slotName === slotName) found = node;
    else if (isContainer(node)) node.children.forEach(visit);
  };
  visit(root);
  return found;
}

/** A screen as design JSX (React + Tailwind, a `data-id` on every element). */
export function designJsx(frame: Frame, project: Project): string {
  const sources = componentSources(project.frames);
  const ctx: ClassContext = { tokens: themedTokens(project.tokens, frame.theme), warnings: [] };
  return `${write(frame.current, undefined, false, 0, { ctx, n: names(project, sources), sources })}\n`;
}

/** The components a screen's JSX can use, with their properties (for the AI's instructions). */
export function designComponents(project: Project): { name: string; props: string[]; slots: string[] }[] {
  const sources = componentSources(project.frames);
  const n = names(project, sources);
  return [...sources.values()].map((source) => ({
    name: n.components.get(source.id)!,
    props: source.def.props.map((p) => `${p.name}: ${p.type === "enum" ? (p.options ?? []).map((o) => JSON.stringify(o)).join(" | ") : p.type}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""}`),
    slots: slotNames(source.root),
  }));
}

function slotNames(root: DesignNode): string[] {
  const out: string[] = [];
  const visit = (node: DesignNode) => {
    if (node.type === "slot") out.push(node.slotName);
    if (isContainer(node)) node.children.forEach(visit);
  };
  visit(root);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Reading
// ════════════════════════════════════════════════════════════════════════════

export class DesignJsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignJsxError";
  }
}

export interface ReadDesignJsxResult {
  /** The screen's new tree (its root keeps the screen's root id). */
  root: DesignNode;
  /** What could not be read exactly (unknown components, classes kept as they are, …). */
  warnings: string[];
}

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;

interface ReadCtx {
  /** The parsed parent's layout (sizing classes depend on it). */
  parent: Partial<Layout> | undefined;
  inline: boolean;
  /** Inside a list's item design: the item variable and the items (`bare`: a list of plain values, read as this key). */
  list?: { item: string; items: Record<string, JsonValue>[]; bare?: string };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** JSX text as React sees it: lines trimmed, joined with a space, blank lines dropped. */
function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const parts: string[] = [];
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, " ");
    if (i > 0) text = text.replace(/^ +/, "");
    if (i < lines.length - 1) text = text.replace(/ +$/, "");
    if (text) parts.push(text);
  });
  return decodeEntities(parts.join(" "));
}

/** A literal value (strings, numbers, booleans, null, arrays and objects of them). */
function literal(expr: ts.Expression | undefined): JsonValue | undefined {
  if (!expr) return undefined;
  if (ts.isParenthesizedExpression(expr)) return literal(expr.expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) return -Number(expr.operand.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(expr)) {
    const out: JsonValue[] = [];
    for (const e of expr.elements) {
      const v = literal(e);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const out: Record<string, JsonValue> = {};
    for (const p of expr.properties) {
      if (!ts.isPropertyAssignment(p)) return undefined;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : undefined;
      const v = literal(p.initializer);
      if (key === undefined || v === undefined) return undefined;
      out[key] = v;
    }
    return out;
  }
  return undefined;
}

/** A class string: a literal, or `cn(…)`/`clsx(…)` of literals. */
function classValue(expr: ts.Expression): string | undefined {
  const value = literal(expr);
  if (typeof value === "string") return value;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && ["cn", "clsx", "classNames", "twMerge"].includes(expr.expression.text)) {
    const parts = expr.arguments.map((a) => literal(a));
    if (parts.every((p) => typeof p === "string")) return parts.join(" ");
  }
  return undefined;
}

const tagName = (el: Jsx) => (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText().replace(/^motion\./, "");
const attributesOf = (el: Jsx) => (ts.isJsxElement(el) ? el.openingElement.attributes : el.attributes);
const childrenOf = (el: Jsx): readonly ts.JsxChild[] => (ts.isJsxElement(el) ? el.children : []);

interface Attr {
  name: string;
  /** undefined: written without a value (`disabled`). */
  expr: ts.Expression | undefined;
}

function attrs(el: Jsx): Map<string, Attr> {
  const map = new Map<string, Attr>();
  for (const a of attributesOf(el).properties) {
    if (!ts.isJsxAttribute(a)) continue;
    const name = a.name.getText();
    const init = a.initializer;
    const expr = !init ? undefined : ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) ? init.expression : undefined;
    map.set(name, { name, expr });
  }
  return map;
}

/** A string attribute (`x="…"`, `x={"…"}`), decoded. */
function stringAttr(a: Map<string, Attr>, name: string): string | undefined {
  const at = a.get(name);
  if (!at?.expr) return undefined;
  const v = literal(at.expr);
  return typeof v === "string" ? (ts.isStringLiteral(at.expr) && at.expr.parent && ts.isJsxAttribute(at.expr.parent) ? decodeEntities(v) : v) : typeof v === "number" ? String(v) : undefined;
}

/** `{item.key}` inside a list: the key. */
function itemKey(expr: ts.Expression | undefined, list: ReadCtx["list"]): string | undefined {
  if (!expr || !list) return undefined;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === list.item) return expr.name.text;
  // `{name}` in `["Acme", …].map((name) => …)`
  if (list.bare && ts.isIdentifier(expr) && expr.text === list.item) return list.bare;
  return undefined;
}

/** `[…].map((item) => <…/>)`: the items, the variable and the item's element. */
function mapCall(expr: ts.Expression): { items: JsonValue | undefined; item: string; body: Jsx | undefined } | undefined {
  if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== "map") return undefined;
  const fn = expr.arguments[0];
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return undefined;
  const param = fn.parameters[0]?.name;
  const item = param && ts.isIdentifier(param) ? param.text : "item";
  let body: ts.Node | undefined = fn.body;
  if (body && ts.isBlock(body)) body = body.statements.find(ts.isReturnStatement)?.expression;
  while (body && ts.isParenthesizedExpression(body)) body = body.expression;
  return { items: literal(expr.expression.expression), item, body: body && (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body)) ? body : undefined };
}

/** The design JSX of an answer: the outermost element (in a `return`, an export or on its own). */
function rootElement(sf: ts.SourceFile): Jsx | undefined {
  let best: Jsx | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (!best || node.getWidth() > best.getWidth()) best = node;
      return;
    }
    if (ts.isJsxFragment(node)) {
      const elements = node.children.filter((c): c is Jsx => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      if (elements.length === 1 && (!best || elements[0]!.getWidth() > best.getWidth())) best = elements[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return best;
}

/**
 * Reads design JSX back into the screen's design. Elements with the `data-id` of an element of
 * the screen are that element (unchanged when what's written for it is unchanged); everything
 * else is new. Throws `DesignJsxError` when there is no JSX or its outermost element can't be
 * the screen.
 */
export function readDesignJsx(source: string, frame: Frame, project: Project): ReadDesignJsxResult {
  const sf = ts.createSourceFile("design.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const root = rootElement(sf);
  if (!root) throw new DesignJsxError("The answer has no JSX element.");
  const sources = componentSources(project.frames);
  const tokens: Tokens = themedTokens(project.tokens, frame.theme);
  const n = names(project, sources);
  const warnings: string[] = [];
  const ctx: ClassContext = { tokens, warnings: [] };
  const base = indexTree(frame.current);
  const used = new Set<string>();
  /** Containers whose kinds can stand in for each other (a div is a box, a list, a scroll area…). */
  const CONTAINERS = new Set<string>(["box", "element", "scroll", "list", "slot"]);
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  /** The base element for a `data-id` (each one once; a copy with the same id is new). */
  const baseOf = (a: Map<string, Attr>): NodeLocation | undefined => {
    const id = stringAttr(a, "data-id");
    if (!id || used.has(id)) return undefined;
    const loc = base.get(id);
    if (loc) used.add(id);
    return loc;
  };

  /** Applies classes: unchanged → the base's design; else parsed (with the parent's layout). */
  const applyClasses = (node: DesignNode, written: string[], classes: string[] | undefined, parent: Partial<Layout> | undefined, was?: DesignNode) => {
    if (classes === undefined) return;
    const same = written.length === classes.length && [...written].sort().join(" ") === [...classes].sort().join(" ");
    if (same) return;
    let list = classes;
    if (node.type === "image") {
      const fit = list.map((c) => /^object-(cover|contain|fill|none)$/.exec(c)?.[1]).find(Boolean) as "cover" | "contain" | "fill" | "none" | undefined;
      if (fit) node.fit = fit;
      else delete node.fit;
      list = list.filter((c) => !/^object-(cover|contain|fill|none)$/.test(c));
    }
    const parsed = parseClasses(list, { tokens, ...(parent && { parent }) });
    for (const key of ["layout", "box", "style", "overrides"] as const) {
      if (parsed[key] && (!Array.isArray(parsed[key]) || parsed[key].length)) (node as unknown as Record<string, unknown>)[key] = parsed[key];
      else delete (node as unknown as Record<string, unknown>)[key];
    }
    if (parsed.hidden) node.hidden = true;
    else delete node.hidden;
    // a part that writes the same classes as before stays as it was (`flex` is a row either way)
    if (was) {
      const key = (n: DesignNode) => [...classesOf(n, parent, ctx)].sort().join(" ");
      for (const part of ["layout", "box", "style", "overrides", "hidden"] as const) {
        const record = node as unknown as Record<string, unknown>;
        const before = (was as unknown as Record<string, unknown>)[part];
        if (JSON.stringify(record[part]) === JSON.stringify(before)) continue;
        const candidate = { ...record, [part]: before } as unknown as DesignNode;
        if (before === undefined) delete (candidate as unknown as Record<string, unknown>)[part];
        if (key(candidate) === key(node)) {
          if (before === undefined) delete record[part];
          else record[part] = before;
        }
      }
    }
    const raw = { ...node.platformRaw };
    if (parsed.unmapped.length) {
      raw.unmapped = parsed.unmapped;
      warn(`Classes kept as they are (no design equivalent): ${parsed.unmapped.join(" ")}`);
    } else delete raw.unmapped;
    if (Object.keys(raw).length) node.platformRaw = raw;
    else delete node.platformRaw;
  };

  const classesAttr = (a: Map<string, Attr>): string[] | undefined => {
    const at = a.get("className") ?? a.get("class");
    if (!at) return [];
    if (!at.expr) return [];
    const value = classValue(at.expr);
    if (value === undefined) {
      warn("A className that isn't a plain string was ignored.");
      return undefined;
    }
    return value.split(/\s+/).filter(Boolean);
  };

  /** Is everything inside an element text (text, `{"…"}`, `{item.x}`, `<br />`, formatted parts)? */
  const textOnly = (children: readonly ts.JsxChild[], list: ReadCtx["list"], bare = false): boolean =>
    (!bare || children.some((c) => (ts.isJsxText(c) && jsxTextValue(c.text) !== "") || (ts.isJsxExpression(c) && c.expression !== undefined && (typeof literal(c.expression) === "string" || itemKey(c.expression, list) !== undefined)))) &&
    children.every((c) => {
      if (ts.isJsxText(c)) return true;
      if (ts.isJsxExpression(c)) return !c.expression || typeof literal(c.expression) === "string" || typeof literal(c.expression) === "number" || itemKey(c.expression, list) !== undefined;
      if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
        const tag = tagName(c);
        if (tag === "br") return true;
        const id = stringAttr(attrs(c), "data-id");
        if (id && base.has(id) && !used.has(id)) return false;
        return SPAN_TAGS.has(tag) && textOnly(childrenOf(c), list) && !childrenOf(c).some((g) => ts.isJsxExpression(g) && itemKey(g.expression, list));
      }
      return false;
    });

  /** The text and formatted parts of text-only children. */
  const readText = (children: readonly ts.JsxChild[], list: ReadCtx["list"]): { text: string; spans?: TextSpan[]; bind?: string } => {
    const single = children.filter((c) => !(ts.isJsxText(c) && jsxTextValue(c.text) === ""));
    if (single.length === 1 && ts.isJsxExpression(single[0]!)) {
      const key = itemKey(single[0].expression, list);
      if (key) return { text: String(list!.items[0]?.[key] ?? ""), bind: key };
    }
    const spans: TextSpan[] = [];
    const push = (text: string, extra: Omit<TextSpan, "text"> = {}) => {
      if (!text) return;
      const last = spans.at(-1);
      if (last && !last.style && !last.href && !extra.style && !extra.href) last.text += text;
      else spans.push({ text, ...extra });
    };
    const visit = (list2: readonly ts.JsxChild[], extra: Omit<TextSpan, "text">) => {
      for (const c of list2) {
        if (ts.isJsxText(c)) {
          const raw = c.text;
          // a space between parts on one line stays (JSX keeps it)
          push(raw.includes("\n") ? jsxTextValue(raw) : decodeEntities(raw), extra);
        } else if (ts.isJsxExpression(c)) {
          const v = literal(c.expression);
          if (typeof v === "string" || typeof v === "number") push(String(v), extra);
        } else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
          const tag = tagName(c);
          if (tag === "br") {
            push("\n", extra);
            continue;
          }
          const a = attrs(c);
          const classes = (() => {
            const at = a.get("className");
            const value = at?.expr ? classValue(at.expr) : undefined;
            return value ? value.split(/\s+/).filter(Boolean) : [];
          })();
          const style = { ...extra.style, ...parseClasses(classes, { tokens }).style };
          if (tag === "strong" || tag === "b") style.fontWeight = tokens.groups.fontWeight?.bold !== undefined ? "$fontWeight.bold" : 700;
          if (tag === "em" || tag === "i") style.fontStyle = "italic";
          const href = tag === "a" ? stringAttr(a, "href") : extra.href;
          visit(childrenOf(c), { ...(Object.keys(style).length && { style }), ...(href && { href }) });
        }
      }
    };
    visit(children, {});
    const kept = spans.filter((s) => s.text !== "");
    const text = kept.map((s) => s.text).join("");
    return kept.some((s) => s.style || s.href) ? { text, spans: kept } : { text };
  };

  /** The design node an element kind is, for new elements. */
  const kindOf = (tag: string, el: Jsx, list: ReadCtx["list"], baseType?: DesignNode["type"]): DesignNode["type"] | "slot-fill" | "unknown" => {
    if (tag === "Icon") return "icon";
    if (tag === "Slot") return "slot-fill";
    if (/^[A-Z]/.test(tag)) return n.byName.has(tag) ? "instance" : "unknown";
    if (tag === "img") return "image";
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input" || tag === "textarea" || tag === "select") return "input";
    // an element of the screen keeps its kind where the tag allows it
    if (baseType && CONTAINERS.has(baseType)) return baseType === "element" || baseType === "slot" ? "box" : baseType;
    const bare = baseType !== "text";
    if (/^h[1-6]$/.test(tag)) return textOnly(childrenOf(el), list, bare) ? "text" : "box";
    if (TEXT_TAGS.has(tag) && childrenOf(el).length > 0 && textOnly(childrenOf(el), list, bare) && childrenOf(el).some((c) => !(ts.isJsxText(c) && jsxTextValue(c.text) === ""))) return "text";
    const a = attrs(el);
    if (a.has("data-scroll")) return "scroll";
    if (a.has("data-list") || childrenOf(el).some((c) => ts.isJsxExpression(c) && c.expression && mapCall(c.expression))) return "list";
    return "box";
  };

  const compatible = (baseType: DesignNode["type"], kind: string) => baseType === kind || (CONTAINERS.has(baseType) && (kind === "box" || kind === "list" || kind === "scroll")) || (baseType === "text" && kind === "text");

  /** Tag-level meaning of an element: heading level, landmark role, the element itself. */
  const applyTag = (node: DesignNode, tag: string, inline: boolean, a: Map<string, Attr>) => {
    if (tagOf(node, inline, n) === tag) return;
    if (node.platformRaw?.tag) {
      const { tag: _tag, ...raw } = node.platformRaw;
      if (Object.keys(raw).length) node.platformRaw = raw;
      else delete node.platformRaw;
    }
    const heading = /^h([1-6])$/.exec(tag);
    const role = stringAttr(a, "role");
    if (heading) node.semantic = { role: "heading", level: Number(heading[1]) };
    else if (role && ARIA_ROLES.has(role)) node.semantic = { role };
    else if (TAG_ROLES[tag] && node.type !== "text") node.semantic = { role: TAG_ROLES[tag]! };
    else if (node.semantic && !ARIA_ROLES.has(node.semantic.role)) delete node.semantic;
    if (tagOf(node, inline, n) !== tag && SAFE_TAG.test(tag) && !BLOCKED_TAGS.has(tag) && !["div", "p", "span"].includes(tag)) node.platformRaw = { ...node.platformRaw, tag };
  };

  const read = (el: Jsx, rc: ReadCtx): DesignNode[] => {
    const tag = tagName(el);
    const a = attrs(el);
    const peek = stringAttr(a, "data-id");
    const peekBase = peek && !used.has(peek) ? base.get(peek)?.node.type : undefined;
    const kind = kindOf(tag, el, rc.list, peekBase);
    if (kind === "slot-fill") {
      warn("A <Slot> outside a component was read as its children.");
      return readChildren(childrenOf(el), rc);
    }
    if (kind === "unknown") {
      warn(`<${tag}> is not a component of this project: read as a plain element.`);
    }
    if (tag === "svg") {
      warn("An <svg> was left out: use <Icon name=\"…\" /> for icons.");
      return [];
    }
    const found = baseOf(a);
    const fresh = !found || !compatible(found.node.type, kind === "unknown" ? "box" : kind) || (found.node.type === "instance" && kind !== "instance");
    const type: DesignNode["type"] = !fresh ? found!.node.type : kind === "unknown" ? "box" : kind;
    const node = (fresh ? { id: createId("n"), type, origin: "added" } : { ...structuredClone({ ...found!.node, ...(isContainer(found!.node) && { children: [] }) }) }) as DesignNode;
    // a text read from a box-like element (or the other way round) is a new element
    const written = fresh ? [] : classesOf(found!.node, rc.parent, ctx);
    const name = stringAttr(a, "data-name");
    if (name !== undefined) node.name = name;
    if (node.type === "text" || CONTAINERS.has(node.type)) applyTag(node, tag, rc.inline, a);
    const childInline = rc.inline || INLINE_TAGS.has(tag) || node.type === "button" || node.type === "link";
    const classes = classesAttr(a);
    if (fresh && classes === undefined) {
      // nothing to read the design from
    }
    applyClasses(node, written, fresh ? (classes ?? []) : classes, rc.parent, fresh ? undefined : found!.node);
    const bindOf = (field: string, key: string | undefined) => {
      if (!rc.list) return;
      const bind = { ...node.bind };
      if (key) bind[field] = key;
      else delete bind[field];
      if (Object.keys(bind).length) node.bind = bind;
      else delete node.bind;
    };

    switch (node.type) {
      case "text": {
        const content = readText(childrenOf(el), rc.list);
        const before = fresh ? undefined : textContent(found!.node as TextNode, ctx, rc.list?.item);
        const candidate = { ...(node as TextNode), text: content.text, spans: content.spans, bind: content.bind ? { text: content.bind } : undefined } as TextNode;
        const after = textContent(candidate, ctx, rc.list?.item);
        if (before !== after) {
          node.text = content.text;
          if (content.spans) node.spans = content.spans;
          else delete node.spans;
          bindOf("text", content.bind);
        }
        return [node];
      }
      case "image": {
        const srcKey = itemKey(a.get("src")?.expr, rc.list);
        const altKey = itemKey(a.get("alt")?.expr, rc.list);
        const src = srcKey ? String(rc.list!.items[0]?.[srcKey] ?? node.src) : stringAttr(a, "src");
        if (src) node.src = src;
        else if (fresh) {
          warn("An <img> without a src got a placeholder.");
          node.src = "https://placehold.co/600x400";
        }
        const alt = altKey ? (node.alt ?? String(rc.list!.items[0]?.[altKey] ?? "")) : stringAttr(a, "alt");
        if (alt !== undefined) node.alt = alt;
        else delete node.alt;
        bindOf("src", srcKey);
        bindOf("alt", altKey);
        return [node];
      }
      case "icon": {
        // a name from the list's data (`name={item.icon}`): the first item's, bound to the key
        const iconKey = itemKey(a.get("name")?.expr, rc.list);
        const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        const icon = iconKey ? rc.list!.items.map((it) => it[iconKey]).find((v): v is string => typeof v === "string" && v.trim() !== "") : stringAttr(a, "name");
        if (iconKey && icon) {
          // the data's names as AppShape writes them (lucide's kebab-case)
          for (const it of rc.list!.items) if (typeof it[iconKey] === "string") it[iconKey] = kebab(it[iconKey] as string);
        }
        if (icon) node.icon = kebab(icon);
        else if (fresh) {
          warn(iconKey ? "An <Icon> whose name comes from the list's data has no names in the data: left out." : "An <Icon> without a name was left out.");
          return [];
        }
        bindOf("icon", icon ? iconKey : undefined);
        const set = stringAttr(a, "set");
        if (set !== undefined) node.set = set;
        else delete node.set;
        return [node];
      }
      case "input": {
        const typeAttr = stringAttr(a, "type");
        const inputType = tag === "textarea" ? "textarea" : tag === "select" ? "select" : typeAttr === "checkbox" && stringAttr(a, "role") === "switch" ? "switch" : (INPUT_TYPES as readonly string[]).includes(typeAttr ?? "text") ? (typeAttr ?? "text") : "text";
        node.inputType = inputType as typeof node.inputType;
        for (const [field, ...names2] of [["label", "label", "aria-label"], ["placeholder", "placeholder"], ["value", "value", "defaultValue"]] as const) {
          const value = names2.map((x) => stringAttr(a, x)).find((v) => v !== undefined);
          if (value !== undefined) node[field] = value;
          else delete node[field];
        }
        return [node];
      }
      case "button":
      case "link": {
        const hrefKey = itemKey(a.get("href")?.expr, rc.list);
        const href = stringAttr(a, "href") ?? stringAttr(a, "to");
        const target = href?.startsWith("#f_") ? href.slice(1) : href !== undefined ? n.frames.get(href) : undefined;
        if (!fresh && hrefOf(found!.node, n) === href && found!.node.type === node.type) {
          // unchanged
        } else if (target) {
          node.targetFrameId = target;
          if (node.type === "link") delete node.href;
        } else {
          delete node.targetFrameId;
          if (node.type === "link") {
            if (href !== undefined) node.href = href;
            else delete node.href;
          } else if (href !== undefined) warn(`A button goes to ${href}, which is no screen's route: left out.`);
        }
        if (hrefKey) bindOf("href", hrefKey);
        (node as Extract<DesignNode, { type: "button" }>).children = readChildren(childrenOf(el), { parent: node.layout, inline: true, ...(rc.list && { list: rc.list }) });
        return [node];
      }
      case "instance":
        return [readInstance(el, tag, a, node as InstanceNode, fresh ? undefined : (found!.node as InstanceNode), rc)];
      default: {
        const container = node as Extract<DesignNode, { children: DesignNode[] }>;
        if (node.type === "scroll") node.direction = stringAttr(a, "data-scroll") === "horizontal" ? "horizontal" : "vertical";
        if (node.type === "slot") {
          // a component's own slot (not edited in proposals)
        }
        const children = childrenOf(el);
        const map = children.map((c) => (ts.isJsxExpression(c) && c.expression ? mapCall(c.expression) : undefined)).find(Boolean);
        if (node.type === "list") {
          const dataName = stringAttr(a, "data-list");
          if (dataName && /^[a-z][A-Za-z0-9]*$/.test(dataName)) node.dataName = dataName;
          if (map) return [readList(node as ListNode, map, { ...rc, inline: childInline })];
          // plain children: no data any more
          delete (node as ListNode).items;
        } else if (map) {
          warn("A .map() inside an element that isn't a list was read as a list.");
        }
        container.children = readChildren(children, { parent: node.layout, inline: childInline, ...(rc.list && { list: rc.list }) });
        return [container];
      }
    }
  };

  const readList = (node: ListNode, map: NonNullable<ReturnType<typeof mapCall>>, rc: ReadCtx): DesignNode => {
    // a list of plain values (`["Acme", "Globex"]`) is read as objects with one key, `value`
    const plain = Array.isArray(map.items) && map.items.length > 0 && map.items.every((i) => typeof i === "string" || typeof i === "number");
    const values = plain ? (map.items as (string | number)[]).map((value) => ({ value })) : map.items;
    const items = Array.isArray(values) && values.every((i) => i && typeof i === "object" && !Array.isArray(i)) ? (values as Record<string, JsonValue>[]) : undefined;
    if (!items) warn("A list's data isn't a plain array of objects: its items were kept.");
    const list = { item: map.item, items: items ?? node.items ?? [], ...(plain && { bare: "value" }) };
    if (items) node.items = items;
    if (!map.body) {
      warn("A list's item design wasn't JSX: the list was kept empty.");
      node.children = [];
      return node;
    }
    node.children = read(map.body, { parent: node.layout, inline: rc.inline, list }).slice(0, 1);
    return node;
  };

  const readInstance = (el: Jsx, tag: string, a: Map<string, Attr>, node: InstanceNode, was: InstanceNode | undefined, rc: ReadCtx): DesignNode => {
    const fresh = !was;
    const componentId = n.byName.get(tag)!;
    if (node.componentId !== componentId) {
      node.componentId = componentId;
      if (!fresh) node.props = {};
    }
    if (fresh) node.props = {};
    const source = sources.get(componentId);
    const props: Record<string, JsonValue> = {};
    const boundProps: Record<string, string> = {};
    for (const at of a.values()) {
      if (["data-id", "data-name", "className", "class", "key"].includes(at.name)) continue;
      const key = itemKey(at.expr, rc.list);
      const def = source?.def.props.find((p) => p.name === at.name);
      if (source && !def) {
        warn(`${tag} has no property "${at.name}": left out.`);
        continue;
      }
      if (key) {
        props[at.name] = node.props[at.name] ?? rc.list!.items[0]?.[key] ?? null;
        boundProps[`props.${at.name}`] = key;
        continue;
      }
      const value = at.expr === undefined ? true : literal(at.expr);
      if (value === undefined) {
        warn(`${tag}'s property "${at.name}" isn't a plain value: left out.`);
        continue;
      }
      // a property that goes to a screen: the route names the screen
      props[at.name] = def?.bindings?.[0]?.field === "target" && typeof value === "string" ? (n.frames.get(value) ?? value) : value;
    }
    if (JSON.stringify(props) !== JSON.stringify(node.props)) node.props = props;
    if (rc.list) {
      const bind = Object.fromEntries(Object.entries(node.bind ?? {}).filter(([field]) => !field.startsWith("props.")));
      Object.assign(bind, boundProps);
      if (Object.keys(bind).length) node.bind = bind;
      else delete node.bind;
    }
    if (!node.children) node.children = [];
    // a component from the app's code: what it renders was captured (not written, kept as it was)
    if (!source) {
      node.children = was && was.componentId === componentId ? was.children : [];
      return node;
    }
    // slot fills: <Slot name="…"> children, or plain children for a component with one slot
    const slots = source ? slotNames(source.root) : [];
    const children = childrenOf(el).filter((c) => !(ts.isJsxText(c) && jsxTextValue(c.text) === ""));
    const fills: DesignNode[] = [];
    const slotLayout = (slotName: string) => (source ? findSlot(source.root, slotName)?.layout : undefined);
    const readFill = (slotName: string, fillEl: Jsx | undefined, content: readonly ts.JsxChild[]) => {
      const fa = fillEl ? attrs(fillEl) : new Map<string, Attr>();
      const foundFill = baseOf(fa);
      const fill = (foundFill && foundFill.node.type === "slot" ? { ...structuredClone({ ...foundFill.node, children: [] }) } : { id: createId("n"), type: "slot", origin: "added", slotName, children: [] }) as Extract<DesignNode, { type: "slot" }>;
      fill.slotName = slotName;
      const fillName = stringAttr(fa, "data-name");
      if (fillName !== undefined) fill.name = fillName;
      applyClasses(fill, foundFill && foundFill.node.type === "slot" ? classesOf(foundFill.node, undefined, ctx) : [], classesAttr(fa), undefined);
      fill.children = readChildren(content, { parent: { ...slotLayout(slotName), ...fill.layout }, inline: false, ...(rc.list && { list: rc.list }) });
      fills.push(fill);
    };
    const slotElements = children.filter((c): c is Jsx => (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && tagName(c) === "Slot");
    if (slotElements.length) {
      for (const s of slotElements) {
        const slotName = stringAttr(attrs(s), "name");
        if (slotName && (slots.includes(slotName) || !source)) readFill(slotName, s, childrenOf(s));
        else warn(`${tag} has no slot "${slotName ?? ""}": its content was left out.`);
      }
    } else if (children.length) {
      if (slots.length === 1) readFill(slots[0]!, undefined, children);
      else warn(`${tag} takes no children here${slots.length ? ` (use <Slot name="${slots[0]}">)` : ""}: they were left out.`);
    }
    node.children = fills;
    return node;
  };

  const readChildren = (children: readonly ts.JsxChild[], rc: ReadCtx): DesignNode[] => {
    const out: DesignNode[] = [];
    for (const c of children) {
      // spaces between elements of a container are layout, not text (JSX written on one line has them)
      if (ts.isJsxText(c)) {
        const text = jsxTextValue(c.text);
        if (text.trim()) out.push({ id: createId("n"), type: "text", origin: "added", text });
      } else if (ts.isJsxExpression(c)) {
        if (!c.expression) continue;
        const v = literal(c.expression);
        if (typeof v === "string" && !v.trim()) continue;
        if (typeof v === "string" || typeof v === "number") {
          out.push({ id: createId("n"), type: "text", origin: "added", text: String(v) });
          continue;
        }
        const map = mapCall(c.expression);
        if (map) {
          out.push(readList({ id: createId("n"), type: "list", origin: "added", children: [] }, map, rc));
          continue;
        }
        if (ts.isBinaryExpression(c.expression) && c.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          let right: ts.Expression = c.expression.right;
          while (ts.isParenthesizedExpression(right)) right = right.expression;
          if (ts.isJsxElement(right) || ts.isJsxSelfClosingElement(right)) {
            warn("A condition (`&&`) was left out: the element is always shown.");
            out.push(...read(right, rc));
            continue;
          }
        }
        warn(`An expression was left out: {${c.expression.getText().slice(0, 40)}}`);
      } else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
        if (tagName(c) === "br") continue;
        out.push(...read(c, rc));
      } else if (ts.isJsxFragment(c)) {
        out.push(...readChildren(c.children, rc));
      }
    }
    return out;
  };

  const [top, ...rest] = read(root, { parent: undefined, inline: false });
  if (!top || rest.length) throw new DesignJsxError("The answer's outermost element has to be the screen.");
  if (top.id !== frame.current.id) {
    if (top.type !== frame.current.type && !(CONTAINERS.has(top.type) && CONTAINERS.has(frame.current.type))) {
      throw new DesignJsxError("The answer's outermost element has to stay the screen (keep its data-id).");
    }
    // the outermost element is the screen, whatever its id
    (top as { id: string }).id = frame.current.id;
    if (top.type !== frame.current.type) (top as { type: string }).type = frame.current.type;
    top.origin = frame.current.origin;
  }
  return { root: top, warnings };
}
