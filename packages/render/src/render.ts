import {
  type Component,
  type ComponentSources,
  type Condition,
  type DesignNode,
  expandInstance,
  fillItem,
  repeatedItems,
  type Override,
  type Tokens,
} from "@appshape/ir";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import {
  boxDecls,
  type Decls,
  declsToCss,
  declsToReactStyle,
  layoutDecls,
  type ParentContext,
  styleDecls,
  transformDecls,
  transformParts,
  ValueResolver,
} from "./css";
import { CONTAINER_NAME, FRAME_CLASS, RESET_CSS, RESET_LAYER } from "./reset";

export interface RenderOptions {
  tokens: Tokens;
  components?: readonly Component[];
  /** Turns `asset:<path>` image sources into URLs. */
  resolveAsset?: (src: string) => string;
  /**
   * Turns other image sources into URLs, e.g. root-relative paths of imported apps (`/images/x.png`
   * is a file in the app's `public/` folder).
   */
  resolveSrc?: (src: string) => string;
  /** URL of an icon's SVG; icons render as placeholders without it. */
  iconUrl?: (set: string, name: string) => string | undefined;
  /** Screen height for `vh` units (on the board the browser window is not the screen). */
  viewportHeight?: number;
  /** Components designed in AppShape; their instances are rendered from them. */
  sources?: ComponentSources;
  /** The frame being rendered, when it is a component (it can't contain itself). */
  frameId?: string;
  /**
   * Cascade layer for the node rules. Imported apps with layered CSS (Tailwind v4) put them in a
   * layer after the app's, so the app's unlayered CSS wins over utilities on the board as in the app.
   */
  layer?: string;
  /** Extra classes on the frame element (an imported app's `<html>` classes, e.g. `dark`). */
  rootClassName?: string;
  /**
   * Render the root on a stage (a vertical flex container), as for a component's main
   * definition: the root sizes itself as it would inside a screen.
   */
  stage?: boolean;
  /**
   * Shows an element in a state (hover, focus, …) as if it were hovered, focused, …: its rules for
   * that state apply without the pseudo-class. `id` is the rendered id (`data-aps` / `data-aps-i`).
   */
  forceState?: { id: string; state: NonNullable<Condition["state"]> };
  /** Rendering for the click-through prototype: disclosures (`details`) start closed, as in the app. */
  prototype?: boolean;
}

export interface RenderResult {
  /** `<div class="aps-frame">…</div>`; give it the viewport width. */
  element: ReactElement;
  /** Reset + one rule per styled node. Scoped to `.aps-frame`. */
  css: string;
  warnings: string[];
}

/** `color: red; --x: 1` → React style object (custom properties kept as they are). */
export function parseInlineStyle(text: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const decl of text.split(/;(?![^(]*\))/)) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const property = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!property || !value || /expression|javascript:/i.test(value)) continue;
    style[property.startsWith("--") ? property : property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return style;
}

/** Text with line breaks (`\n`) as text and `<br>` elements. */
function lines(text: string): ReactNode {
  if (!text.includes("\n")) return text;
  return text.split("\n").flatMap((line, i) => (i === 0 ? [line] : [createElement("br", { key: i }), line]));
}

const SAFE_TAG = /^[a-z][a-z0-9-]*$/;
const BLOCKED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base", "frame", "frameset", "template", "noscript", "html", "head", "body",
]);
const INLINE_TAGS = new Set(["span", "a", "button", "label", "strong", "em", "b", "i", "small", "code", "sup", "sub", "mark"]);
const VOID_TAGS = new Set(["img", "input", "br", "hr", "area", "col", "wbr", "source", "track"]);
const ROLE_TAGS: Record<string, string> = {
  nav: "nav", header: "header", main: "main", footer: "footer", section: "section", aside: "aside",
  form: "form", article: "article", list: "ul", listitem: "li", paragraph: "p",
  details: "details", summary: "summary",
};
/** Roles written as a `role` attribute (no element of their own). */
const ARIA_ROLES = new Set(["tablist", "tab", "tabpanel"]);
const STATE_PSEUDO: Record<NonNullable<Condition["state"]>, string> = {
  hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", active: ":active", disabled: ":disabled", pressed: ":active", "group-hover": "",
};

/** Where a node is rendered: inside instances, ids are scoped and nodes are not selectable. */
interface Scope {
  /** Rendered id of the enclosing instance; undefined for the frame's own nodes. */
  prefix: string | undefined;
  /** Slot fills of the enclosing expansion (real nodes again). */
  fills: ReadonlySet<DesignNode>;
  /** Components being expanded (cycle guard). */
  stack: readonly string[];
}

interface Rule {
  selector: string;
  decls: Decls;
  /** Sort key for overrides: base rules first, then by breakpoint, then states. */
  order: number;
  media?: string;
}

/** Renders a frame's design tree. Pure: no DOM access, works on the server too. */
export function renderFrame(root: DesignNode, options: RenderOptions): RenderResult {
  const resolver = new ValueResolver(options.tokens, options.viewportHeight, (src) =>
    src.startsWith("asset:") ? (options.resolveAsset?.(src) ?? "") : (options.resolveSrc?.(src) ?? src),
  );
  const components = new Map((options.components ?? []).map((c) => [c.id, c]));
  const rules: Rule[] = [];
  const instanceRules: Rule[] = [];
  const warnings: string[] = [];
  const breakpointOrder = (name: string) => Object.keys(options.tokens.groups.breakpoint ?? {}).indexOf(name);

  /** `[data-aps="id"]` for the frame's nodes, `[data-aps-i="instance/id"]` inside instances. */
  const selectorFor = (attr: string, when: Condition | undefined, suffix = "") => {
    const scheme = when?.scheme === "dark" ? `.aps-dark ` : when?.scheme === "light" ? `.${FRAME_CLASS}:not(.aps-dark) ` : "";
    const forced = options.forceState && when?.state === options.forceState.state && attr.endsWith(`="${options.forceState.id}"]`);
    const state = when?.state && !forced ? STATE_PSEUDO[when.state] : "";
    // group-hover: while an ancestor marked as hover group is hovered
    const group = when?.state === "group-hover" && !forced ? "[data-aps-group]:hover " : "";
    return `${scheme}${group}${attr}${state}${suffix}`;
  };

  // Named styles in use (their CSS goes into a layer below the elements' own rules, as in the app)
  const usedText = new Set<string>();
  const usedEffect = new Set<string>();

  const addRules = (node: DesignNode, parent: ParentContext, target: Rule[], attr: string, suffix = "") => {
    let own = node.style;
    // a ring of the element's own composes with its effect style's shadow (the app's shadow variables do)
    const effect = own?.effectStyle ? options.tokens.effectStyles?.[own.effectStyle] : undefined;
    if (own && effect?.shadow !== undefined && own.ring && own.shadow === undefined) own = { ...own, shadow: effect.shadow, ...(own.shadowColor === undefined && effect.shadowColor !== undefined && { shadowColor: effect.shadowColor }) };
    const base: Decls = {
      ...layoutDecls(node.layout, resolver),
      ...boxDecls(node.box, parent, resolver),
      ...styleDecls(own, resolver),
    };
    if (node.hidden) base.display = "none";
    if (own?.snap) {
      // a carousel: the row (or column) snaps its children into place
      base["scroll-snap-type"] = `${node.layout?.direction === "column" ? "y" : "x"} mandatory`;
      target.push({ selector: selectorFor(attr, undefined, `${suffix} > *`), decls: { "scroll-snap-align": own.snap }, order: 0 });
    }
    if (Object.keys(base).length > 0) target.push({ selector: selectorFor(attr, undefined, suffix), decls: base, order: 0 });
    for (const override of node.overrides ?? []) {
      // Property (variant) conditions are resolved before rendering; leftovers don't apply.
      if (override.when.prop) continue;
      const decls = overrideDecls(node, override, parent);
      if (Object.keys(decls).length === 0) continue;
      const viewport = override.when.viewport;
      target.push({
        selector: selectorFor(attr, override.when, suffix),
        decls,
        order: 1 + (viewport ? 1 + Math.max(0, breakpointOrder(viewport)) : 0) * 10 + (override.when.state ? 1 : 0),
        ...(viewport && { media: `@container ${CONTAINER_NAME} (min-width: ${resolver.breakpoint(viewport)})` }),
      });
    }
  };

  const overrideDecls = (node: DesignNode, override: Override, parent: ParentContext): Decls => {
    // Only what the override sets, so overrides for different breakpoints/states compose.
    const decls: Decls = {
      ...layoutDecls(override.layout, resolver),
      ...boxDecls(override.box, parent, resolver),
      ...styleDecls(override.style, resolver),
    };
    if (override.style && ("shadow" in override.style || "ring" in override.style || "shadowColor" in override.style)) {
      // shadow and ring share box-shadow, so combine with the base value of the other one
      const combined = {
        shadow: override.style.shadow ?? node.style?.shadow,
        ring: override.style.ring ?? node.style?.ring,
        shadowColor: override.style.shadowColor ?? node.style?.shadowColor,
      };
      decls["box-shadow"] = styleDecls(combined, resolver)["box-shadow"] ?? "none";
    }
    if (override.style && ("rotate" in override.style || "scale" in override.style || "translate" in override.style || "skew" in override.style)) {
      // a hover lift adds to the element's own rotation (the app composes them through variables)
      const base = transformParts(node.style);
      const own = transformParts(override.style);
      const merged = { ...base, ...own, ...((base.translate || own.translate) && { translate: { ...base.translate, ...own.translate } }), ...((base.skew || own.skew) && { skew: { ...base.skew, ...own.skew } }) };
      Object.assign(decls, transformDecls(merged, resolver));
    }
    if (override.style?.fontSize !== undefined && override.style.lineHeight === undefined && node.style?.lineHeight !== undefined) {
      // An explicit line height wins over the font size's default (Tailwind: `leading-*` beats `md:text-*`).
      const lineHeight = resolver.value(node.style.lineHeight, "raw");
      if (lineHeight) decls["line-height"] = lineHeight;
    }
    if (override.hidden === true) decls.display = "none";
    if (override.hidden === false) {
      decls.display = layoutDecls({ mode: override.layout?.mode ?? node.layout?.mode }, resolver).display ?? "revert";
    }
    return decls;
  };

  const tagFor = (node: DesignNode, inline: boolean): string => {
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
  };

  const render = (node: DesignNode, parent: ParentContext, inline: boolean, outer: Scope): ReactNode => {
    const scope = outer.fills.has(node) ? { ...outer, prefix: undefined } : outer;
    const renderedId = scope.prefix === undefined ? node.id : `${scope.prefix}/${node.id}`;
    const idAttr = scope.prefix === undefined ? "data-aps" : "data-aps-i";
    const attrSelector = `[${idAttr}="${renderedId}"]`;

    if (node.type === "instance") {
      const source = options.sources?.get(node.componentId);
      if (source && !scope.stack.includes(source.id)) {
        // Rendered from the component: the root stands for the instance, the rest is scoped.
        const { root: expanded, fills } = expandInstance(node, source);
        const inner: Scope = { prefix: renderedId, fills, stack: [...scope.stack, source.id] };
        return renderElement(expanded, parent, inline, scope, renderedId, idAttr, attrSelector, inner);
      }
      if (source) warnings.push(`component ${source.name} contains itself`);
    }
    if (node.type === "instance" && node.children.length > 0) {
      // Captured instance: no DOM element of its own; its box/style apply to its rendered root(s).
      addRules(node, parent, instanceRules, attrSelector, " > *");
      return createElement(
        "div",
        { key: node.id, [idAttr]: renderedId, style: { display: "contents" } },
        node.children.map((child) => render(child, parent, inline, scope)),
      );
    }
    return renderElement(node, parent, inline, scope, renderedId, idAttr, attrSelector, scope);
  };

  const renderElement = (
    node: DesignNode,
    parent: ParentContext,
    inline: boolean,
    scope: Scope,
    renderedId: string,
    idAttr: string,
    attrSelector: string,
    childScope: Scope,
  ): ReactNode => {
    addRules(node, parent, rules, attrSelector);
    const props: Record<string, unknown> = { key: node.id, [idAttr]: renderedId };
    const childParent: ParentContext = { layout: node.layout };
    if ((node.type === "link" || node.type === "button") && node.targetFrameId) props["data-aps-target"] = node.targetFrameId;
    // what clicking it does, for the prototype
    if (node.interaction) props["data-aps-action"] = JSON.stringify(node.interaction);
    if (node.semantic?.role && ARIA_ROLES.has(node.semantic.role)) props.role = node.semantic.role;
    if (node.style?.hoverGroup) props["data-aps-group"] = "";
    // entrances are played by the editor (the rendering itself is the end state)
    if (node.style?.motion) props["data-aps-motion"] = JSON.stringify(node.style.motion);
    // Imported elements: classes without an IR equivalent, rendered with the app's CSS.
    const unmapped = node.platformRaw?.unmapped;
    const named: string[] = [];
    if (node.style?.textStyle && options.tokens.textStyles?.[node.style.textStyle]) {
      usedText.add(node.style.textStyle);
      named.push(`${TEXT_STYLE_CLASS}${node.style.textStyle}`);
    }
    if (node.style?.effectStyle && options.tokens.effectStyles?.[node.style.effectStyle]) {
      usedEffect.add(node.style.effectStyle);
      named.push(`${EFFECT_STYLE_CLASS}${node.style.effectStyle}`);
    }
    if (unmapped?.length || named.length) props.className = [...named, ...(unmapped ?? [])].join(" ");
    const inlineStyle = node.platformRaw?.props?.style;
    if (typeof inlineStyle === "string" && inlineStyle.trim()) props.style = parseInlineStyle(inlineStyle);

    switch (node.type) {
      case "text": {
        const tag = tagFor(node, inline);
        const content = node.spans?.length
          ? node.spans.map((span, i) =>
              createElement(span.href ? "a" : "span", { key: i, style: declsToReactStyle(styleDecls(span.style, resolver)), ...(span.href && { href: span.href }) }, lines(span.text)),
            )
          : lines(node.text);
        return createElement(tag, props, content);
      }
      case "image": {
        const src = node.src.startsWith("asset:") ? (options.resolveAsset?.(node.src) ?? "") : (options.resolveSrc?.(node.src) ?? node.src);
        // Captured `width`/`height` attributes: size hints CSS can override, as in the app.
        const hints = node.platformRaw?.props;
        const size = { ...(typeof hints?.width === "number" && { width: hints.width }), ...(typeof hints?.height === "number" && { height: hints.height }) };
        return createElement("img", { ...props, ...size, src, alt: node.alt ?? "", ...(node.fit && { style: { ...(props.style as object | undefined), objectFit: node.fit } }) });
      }
      case "icon": {
        const url = options.iconUrl?.(node.set ?? "lucide", node.icon);
        if (!url) return createElement("span", { ...props, "data-aps-icon": node.icon, "aria-hidden": true });
        // An empty <svg> painted through the icon as a mask: CSS for svg elements (the app's) applies.
        props.style = { ...(props.style as object | undefined), "--aps-icon": `url("${url}")` };
        return createElement("svg", { ...props, "data-aps-icon": node.icon, "data-aps-icon-src": "", xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true });
      }
      case "input":
        return renderInput(node, props);
      case "instance": {
        const name = options.sources?.get(node.componentId)?.name ?? components.get(node.componentId)?.name ?? node.componentId;
        return createElement("div", { ...props, "data-aps-placeholder": "" }, name);
      }
      default: {
        const tag = tagFor(node, inline);
        if (node.type === "button") props.type = "button";
        if (node.type === "link" && node.href) props["data-href"] = node.href;
        // the board shows a disclosure's content; the prototype starts closed like the app
        if (tag === "details" && !options.prototype) props.open = true;
        if (VOID_TAGS.has(tag)) return createElement(tag, props);
        const childInline = inline || INLINE_TAGS.has(tag);
        const repeated = repeatedItems(node);
        if (repeated) {
          // repeated content: the item design (editable) with the first item, then the other items
          const first = fillItem(repeated.template, repeated.items[0]);
          const copies = repeated.items.slice(1).map((item, i) => render(fillItem(repeated.template, item), childParent, childInline, { ...childScope, prefix: `${renderedId}~${i + 1}`, fills: new Set() }));
          return createElement(tag, props, [render(first, childParent, childInline, childScope), ...copies].map((element, i) => createElement(Fragment, { key: i }, element)));
        }
        return createElement(tag, props, node.children.map((child) => render(child, childParent, childInline, childScope)));
      }
    }
  };

  const renderInput = (node: Extract<DesignNode, { type: "input" }>, props: Record<string, unknown>): ReactNode => {
    const { key: rawKey, ...rest } = props;
    const key = rawKey as string;
    let control: ReactElement;
    switch (node.inputType) {
      case "textarea":
        control = createElement("textarea", { ...rest, placeholder: node.placeholder, defaultValue: node.value, readOnly: true });
        break;
      case "checkbox":
      case "switch":
      case "radio":
        control = createElement("input", { ...rest, type: node.inputType === "radio" ? "radio" : "checkbox", readOnly: true });
        break;
      case "select":
        control = createElement("select", rest, createElement("option", null, node.value ?? node.placeholder ?? ""));
        break;
      default:
        control = createElement("input", { ...rest, type: node.inputType, placeholder: node.placeholder, defaultValue: node.value, readOnly: true });
    }
    if (!node.label) return createElement("span", { key, style: { display: "contents" } }, control);
    return createElement("label", { key, "data-aps-field": "" }, node.label, control);
  };

  const stageLayout = { mode: "flex", direction: "column" } as const;
  const body = render(root, { layout: options.stage ? stageLayout : undefined }, false, {
    prefix: undefined,
    fills: new Set(),
    stack: options.frameId ? [options.frameId] : [],
  });
  const element = createElement(
    "div",
    { className: options.rootClassName ? `${FRAME_CLASS} ${options.rootClassName}` : FRAME_CLASS, ...(options.stage && { style: { display: "flex", flexDirection: "column" } }) },
    body,
  );

  const ordered = [...rules.filter((r) => r.order === 0), ...instanceRules.filter((r) => r.order === 0)];
  const overrides = [...rules, ...instanceRules].filter((r) => r.order > 0).sort((a, b) => a.order - b.order);
  const nodeRules = [...ordered, ...overrides].map(formatRule);
  // The theme's page defaults sit with the reset (lowest priority: an imported app's CSS wins).
  const base = resolver.themeBase();
  const themeBase = Object.keys(base).length > 0 ? [`@layer ${RESET_LAYER} { :where(.${FRAME_CLASS}) { ${declsToCss(base)} } }`] : [];
  const schemeTokens = resolver.schemeTokenCss(FRAME_CLASS);
  const styles = namedStyleCss(options.tokens, usedText, usedEffect, resolver, breakpointOrder);
  const css = [RESET_CSS, ...themeBase, ...(schemeTokens ? [schemeTokens] : []), ...(styles ? [styles] : []), ...(options.layer ? [`@layer ${options.layer} {`, ...nodeRules, "}"] : nodeRules)].join("\n");
  return { element, css, warnings: [...resolver.warnings, ...new Set(warnings)] };
}

/** Class prefixes of named styles on the board (the code uses `type-` and `effect-`). */
export const TEXT_STYLE_CLASS = "aps-type-";
export const EFFECT_STYLE_CLASS = "aps-effect-";
/** The layer of named styles: above the reset, below the elements' own rules. */
export const STYLES_LAYER = "aps-styles";

/** CSS of the named text and effect styles in use; text sizes per screen size as container queries. */
function namedStyleCss(tokens: RenderOptions["tokens"], text: Set<string>, effect: Set<string>, resolver: ValueResolver, order: (bp: string) => number): string | undefined {
  const rules: string[] = [];
  const rule = (selector: string, decls: Decls) => (Object.keys(decls).length ? `.${FRAME_CLASS} ${selector} { ${declsToCss(decls)} }` : "");
  for (const id of [...text].sort()) {
    const s = tokens.textStyles![id]!;
    const { name: _name, sizes, ...base } = s;
    rules.push(rule(`.${TEXT_STYLE_CLASS}${id}`, styleDecls(base, resolver)));
    for (const [bp, part] of Object.entries(sizes ?? {}).sort(([a], [b]) => order(a) - order(b))) {
      const decls = styleDecls(part, resolver);
      // a new size brings its own line height, unless the style (or this size) sets one
      if (part.fontSize !== undefined && part.lineHeight === undefined) {
        const lineHeight = s.lineHeight === undefined ? resolver.defaultLineHeight(part.fontSize) : undefined;
        if (lineHeight) decls["line-height"] = lineHeight;
        else delete decls["line-height"];
      }
      if (Object.keys(decls).length) rules.push(`@container ${CONTAINER_NAME} (min-width: ${resolver.breakpoint(bp)}) { ${rule(`.${TEXT_STYLE_CLASS}${id}`, decls)} }`);
    }
  }
  for (const id of [...effect].sort()) {
    const { name: _name, ...e } = tokens.effectStyles![id]!;
    rules.push(rule(`.${EFFECT_STYLE_CLASS}${id}`, styleDecls(e, resolver)));
  }
  const body = rules.filter(Boolean);
  return body.length ? `@layer ${STYLES_LAYER} {\n${body.join("\n")}\n}` : undefined;
}

function formatRule(rule: Rule): string {
  const scoped = rule.selector.startsWith(".aps-dark") || rule.selector.startsWith(`.${FRAME_CLASS}`)
    ? rule.selector
    : `.${FRAME_CLASS} ${rule.selector}`;
  const body = `${scoped} { ${declsToCss(rule.decls)} }`;
  return rule.media ? `${rule.media} { ${body} }` : body;
}
