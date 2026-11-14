import {
  type ComponentProp,
  type ComponentSource,
  componentSources,
  type DesignNode,
  type Frame,
  type InstanceNode,
  isContainer,
  type JsonValue,
  type Layout,
  type Motion,
  type Project,
  propDefault,
  boundKeys,
  repeatedItems,
  STAGGER_STEPS,
  staggerDelay,
  type Tokens,
  walk,
} from "@appshape/ir";
import { posix } from "node:path";
import { firstFamily } from "@appshape/protocol";
import type { InstalledFont } from "@appshape/store";
import { boxClasses, type ClassContext, layoutClasses, nodeClasses, styleClasses, type VariantClasses } from "./classes";
import { dataModule, overlayClasses, overlayId, scrollTargets, switchedProps } from "./interactions";
import { type MotionPlan, motionStates, motionTransition, objectLiteral, planMotion, triggerAttrs, variantsConst, variantsName } from "./motion";
import { camelCase, codeHash, pascalCase, slugRoute, uniqueName } from "./names";
import { type AppLayout, importPath, motionImports, SCROLL_REVEAL_MODULE, STACKS, type Stack } from "./stacks";
import { appBaseCss, themeBlock, themeClass } from "./theme";

/** A file produced by code generation, with where each design node ended up. */
export interface GeneratedFile {
  path: string;
  /** For assets copied from `.appshape/` (`copyFrom`): a stand-in that changes when the source does. */
  content: string;
  /** Binary asset: copied from this path inside the data folder (e.g. `assets/uploads/1a2b.png`). */
  copyFrom?: string;
  kind: "page" | "component" | "routes" | "css" | "utils" | "asset";
  /** What it is, for the list of changes (helpers and data files). */
  summary?: string;
  frameId?: string;
  /** Design node id → element source range in `content` and a hash of that source. */
  nodes: Record<string, NodeSpan>;
}

export interface NodeSpan {
  start: number;
  end: number;
  hash: string;
}

export interface GenerateInput {
  project: Project;
  layout: AppLayout;
  /** Tailwind's default design system (only differences go into the theme). */
  defaults: Tokens;
  /** Extra JSX to generate for insertion into existing files (new elements on imported pages). */
  snippets?: SnippetRequest[];
  /** Fonts installed in the project (`.appshape/assets/fonts`); the ones the design uses go into the app. */
  fonts?: readonly InstalledFont[];
}

export interface SnippetRequest {
  key: string;
  node: DesignNode;
  /** Layout of the element it goes into (sizing classes depend on it). */
  parent?: Partial<Layout>;
  /** File it goes into (for import paths). */
  path: string;
  inline?: boolean;
}

/** Generated JSX (indented for column 0) with the imports it needs and its node ranges. */
export interface Snippet {
  text: string;
  imports: string[];
  ranges: [string, number, number][];
}

export interface Generated {
  files: Map<string, GeneratedFile>;
  /** Frames that are not generated as code (phone screens, imported pages, sketches). */
  skipped: { frameId: string; reason: string }[];
  /** Screen routes, by frame id (generated pages only). */
  routes: Map<string, string>;
  snippets: Map<string, Snippet>;
  warnings: string[];
  /** Installed fonts the design uses (their files are among `files`). */
  fonts: InstalledFont[];
  /** The design has entrance animations generated as classes (the app's CSS gets the motion part). */
  motion: boolean;
  /** The design opens overlays or scrolls to sections (the app's CSS gets the overlays part). */
  interactions: boolean;
}

/** Text with the source ranges of the design nodes in it. */
interface Code {
  text: string;
  ranges: [string, number, number][];
}

const SAFE_TAG = /^[a-z][a-z0-9-]*$/;
const BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "frame", "frameset", "template", "noscript", "html", "head", "body"]);
const INLINE_TAGS = new Set(["span", "a", "button", "label", "strong", "em", "b", "i", "small", "code", "sup", "sub", "mark"]);
const VOID_TAGS = new Set(["img", "input", "br", "hr", "area", "col", "wbr", "source", "track"]);
const ROLE_TAGS: Record<string, string> = {
  nav: "nav", header: "header", main: "main", footer: "footer", section: "section", aside: "aside",
  form: "form", article: "article", list: "ul", listitem: "li", paragraph: "p",
  details: "details", summary: "summary",
};
/** Roles written as a `role` attribute (no element of their own). */
const ARIA_ROLES = new Set(["tablist", "tab", "tabpanel"]);
const FIELD_CLASSES = "flex flex-col gap-1.5 text-sm font-medium";

/**
 * Which screens become code: designed web pages (not phone screens, imports or sketches), and
 * overlay screens (generated as components the pages that open them show in a popover).
 */
export function generatedScreens(project: Project): { frames: Frame[]; overlays: Frame[]; skipped: Generated["skipped"] } {
  const frames: Frame[] = [];
  const overlays: Frame[] = [];
  const skipped: Generated["skipped"] = [];
  for (const frame of project.frames) {
    if (frame.kind === "component") continue;
    if (frame.kind !== "new") skipped.push({ frameId: frame.id, reason: frame.kind === "imported" ? "existing page (edited in place after import, M5)" : "sketch" });
    else if (frame.platform !== "web") skipped.push({ frameId: frame.id, reason: "phone screen (native code generation comes with M7)" });
    else if (frame.overlay) overlays.push(frame);
    else frames.push(frame);
  }
  return { frames, overlays, skipped };
}

/** Imports a file needs, collected while generating it. */
class Imports {
  private named = new Map<string, Set<string>>();
  private types = new Map<string, Set<string>>();
  private lines = new Set<string>();
  add(module: string, name: string, type = false) {
    const map = type ? this.types : this.named;
    map.set(module, (map.get(module) ?? new Set()).add(name));
  }
  line(text: string) {
    this.lines.add(text);
  }
  render(): string[] {
    const out: string[] = [...this.lines];
    const modules = new Set([...this.named.keys(), ...this.types.keys()]);
    for (const module of modules) {
      const names = [...(this.named.get(module) ?? [])].sort();
      const types = [...(this.types.get(module) ?? [])].sort().map((t) => `type ${t}`);
      if (names.length === 0) out.push(`import type { ${[...(this.types.get(module) ?? [])].sort().join(", ")} } from "${module}";`);
      else out.push(`import { ${[...types, ...names].join(", ")} } from "${module}";`);
    }
    // packages first, then relative paths; by module name
    const module = (line: string) => /from "([^"]+)"/.exec(line)?.[1] ?? line;
    const relative = (line: string) => Number(module(line).startsWith("."));
    return out.sort((a, b) => relative(a) - relative(b) || module(a).localeCompare(module(b)));
  }
}

interface FileCtx {
  path: string;
  imports: Imports;
  stack: Stack;
  /** Set when generating a component's own file. */
  component?: ComponentFileCtx;
  /** Extra classes on a node (a page root's theme class). */
  extraClasses?: { nodeId: string; classes: string[] };
  /** Motion code in the file: Motion elements, and the presets whose variants it declares. */
  motion?: { elements: boolean; variants: Set<Motion["preset"]> };
  /** Elements other elements scroll to → their `id`. */
  scrollIds?: Map<string, string>;
  /** Overlays whose popover element the file has already rendered. */
  overlaysShown?: Set<string>;
  /** Generating an overlay screen: the id of its popover (what its close buttons hide). */
  overlayOf?: string;
  /** Generating a component's root as a plain button that takes a popover target (instead of its link). */
  popoverButton?: boolean;
  /** Inside a list's `.map()`: the item variable, its index, the item design's root (it gets the `key`), and the variables of icons named by the data (by key). */
  list?: { item: string; index: string; rootId: string; key: string; icons?: Map<string, string> };
}

interface ComponentFileCtx {
  source: ComponentSource;
  /** node id → bound property and field. */
  bindings: Map<string, { prop: ComponentProp; field: string }[]>;
  /** node id → name of its cva function and the properties it takes. */
  variantFns: Map<string, { name: string; props: string[] }>;
  /** slot name → prop name. */
  slotProps: Map<string, string>;
  /** Properties its own elements switch (a tab): state, with their setters. */
  state: Map<string, string>;
}

export function generateApp(input: GenerateInput): Generated {
  const { project, layout, defaults } = input;
  const stack = STACKS[layout.stack];
  const warnings: string[] = [];
  const ctx: ClassContext = { tokens: project.tokens, warnings };
  const sources = componentSources(project.frames);
  const files = new Map<string, GeneratedFile>();
  const { frames: screens, overlays, skipped } = generatedScreens(project);
  const overlayFrames = new Map(overlays.map((f) => [f.id, f]));

  // ---------- Interactions ----------
  // components that open or close an overlay somewhere: their root button takes the popover target
  const popoverComponents = new Set<string>();
  let usesInteractions = false;
  for (const root of [...screens, ...overlays].map((f) => f.current).concat([...sources.values()].map((s) => s.root))) {
    walk(root, (node) => {
      if (node.interaction?.type === "open" || node.interaction?.type === "scroll") usesInteractions = true;
      if (node.type === "instance" && (node.interaction?.type === "open" || node.interaction?.type === "close")) {
        const source = sources.get(node.componentId);
        if (source?.root.type === "button") popoverComponents.add(source.id);
      }
    });
  }
  // slots that instances fill with their own layout: the component takes classes for them
  const slotClassProps = new Set<string>();
  for (const root of [...screens, ...overlays].map((f) => f.current).concat([...sources.values()].map((s) => s.root))) {
    walk(root, (node) => {
      if (node.type !== "instance") return;
      const source = sources.get(node.componentId);
      for (const fill of node.children) {
        if (fill.type !== "slot" || !fill.layout || !source) continue;
        const slot = findSlot(source.root, fill.slotName);
        if (slot && JSON.stringify(layoutClasses(fill.layout, ctx)) !== JSON.stringify(layoutClasses(slot.layout, ctx))) slotClassProps.add(`${source.id}:${fill.slotName}`);
      }
    });
  }
  const slotClassProp = (slotName: string) => `${camelCase(slotName)}ClassName`;

  // lists of data: one data file each (`src/data/testimonials.ts`)
  const dataFiles = new Map<string, GeneratedFile>();
  const dataNames = new Map<string, string>();
  const takenData = new Set<string>();
  const dataNameOf = (node: Extract<DesignNode, { type: "list" }>): string => {
    let name = dataNames.get(node.id);
    if (!name) {
      name = uniqueName(node.dataName ?? (camelCase(node.name ?? "items") || "items"), takenData);
      dataNames.set(node.id, name);
    }
    return name;
  };
  const dataPath = (name: string) => posix.join(posix.dirname(posix.dirname(stack.utilsPath(layout))), "data", `${name}.ts`).replace(/^\.\//, "");

  // ---------- Motion ----------
  // Apps with Motion get entrances as Motion code where Motion can play them; the rest (and every
  // other app) as CSS classes, with keyframes in the CSS and ScrollReveal for scroll-ins.
  const motionPlan: MotionPlan | undefined = layout.motion ? planMotion(screens.map((f) => f.current), sources) : undefined;
  const motionRoots = new Set([...(motionPlan?.components ?? [])].map((id) => sources.get(id)!.root.id));
  /** How a node's entrance is Motion code: its own, as a staggered child, or as a component root taking variants. */
  const motionKind = (node: DesignNode): "own" | "child" | "root" | undefined => {
    if (!motionPlan) return undefined;
    if (motionPlan.children.has(node.id)) return "child";
    if (motionRoots.has(node.id)) return "root";
    const motion = node.style?.motion;
    if (!motion) return undefined;
    if (motion.stagger) return motionPlan.staggers.has(node.id) ? "own" : undefined;
    return motionPlan.able(node) ? "own" : undefined;
  };
  ctx.skipMotion = (node) => motionKind(node) !== undefined;
  /** Walks a screen with the components it uses (each once). */
  const walkWithComponents = (root: DesignNode, visit: (node: DesignNode) => void) => {
    const seen = new Set<string>();
    const walk = (node: DesignNode) => {
      visit(node);
      if (node.type === "instance") {
        const source = sources.get(node.componentId);
        if (source && !seen.has(source.id)) {
          seen.add(source.id);
          walk(source.root);
        }
      }
      if (isContainer(node)) node.children.forEach(walk);
    };
    walk(root);
  };
  /** What a screen needs for its entrances: ScrollReveal (CSS scroll-ins), Motion's config (Motion code). */
  const motionNeeds = (root: DesignNode) => {
    let reveal = false;
    let motion = false;
    walkWithComponents(root, (node) => {
      if (motionKind(node)) motion = true;
      else if (node.style?.motion && node.style.motion.trigger !== "load") reveal = true;
    });
    return { reveal, motion };
  };
  // entrances generated as classes need the motion part of the CSS
  let cssMotion = false;
  for (const root of [...screens.map((f) => f.current), ...[...sources.values()].map((s) => s.root), ...(input.snippets ?? []).map((s) => s.node)]) {
    walkWithComponents(root, (node) => {
      if (node.style?.motion && !motionKind(node)) cssMotion = true;
    });
  }

  // Names: unique across pages and components (a page can import any component).
  const taken = new Set<string>(["Link", "Route", "Routes", "App", "AppRoutes", "ScrollReveal", "MotionConfig"]);
  const componentNames = new Map<string, string>();
  for (const source of sources.values()) componentNames.set(source.id, uniqueName(pascalCase(source.name), taken));
  // overlay screens are components too (their pages show them in a popover)
  const overlayNames = new Map<string, string>();
  for (const frame of overlays) overlayNames.set(frame.id, uniqueName(pascalCase(frame.name), taken));
  const pageNames = new Map<string, string>();
  for (const frame of screens) pageNames.set(frame.id, uniqueName(pascalCase(frame.name), taken));

  // Routes of every screen (links may point at screens that aren't generated).
  const routes = new Map<string, string>();
  const allRoutes = new Map<string, string>();
  for (const frame of project.frames) allRoutes.set(frame.id, frame.target.route ?? slugRoute(frame.name));
  for (const frame of screens) routes.set(frame.id, allRoutes.get(frame.id)!);
  // Imported pages exist in the app: links to them use their routes.
  const linkRoutes = new Map(routes);
  for (const frame of project.frames) if (frame.kind === "imported" && frame.target.route) linkRoutes.set(frame.id, frame.target.route);
  const routeOf = (frameId: string | undefined): string | undefined => {
    if (!frameId) return undefined;
    const route = linkRoutes.get(frameId);
    if (!route && allRoutes.has(frameId)) warnings.push(`link to a screen that isn't generated (${allRoutes.get(frameId)}): left to the agent`);
    return route;
  };

  const assets = new Map<string, GeneratedFile>();
  const imageSrc = (src: string): string => {
    if (src.startsWith("asset:")) {
      // the design's own files go to public/images/ (copied when applied)
      const from = src.slice("asset:".length);
      const name = from.split("/").pop()!;
      let path = `public/images/${name}`;
      if (assets.has(path) && assets.get(path)!.copyFrom !== `assets/${from}`) path = `public/images/${from.replace(/\//g, "-")}`;
      assets.set(path, { path, content: `asset:${from}`, copyFrom: `assets/${from}`, kind: "asset", nodes: {} });
      return `/${path.slice("public/".length)}`;
    }
    const svg = /^data:image\/svg\+xml(;charset=utf-8|;utf8)?,(.*)$/s.exec(src);
    if (!svg) return src;
    const content = decodeURIComponent(svg[2]!);
    const path = `public/images/${codeHash(content)}.svg`;
    assets.set(path, { path, content, kind: "asset", nodes: {} });
    return `/${path.slice("public/".length)}`;
  };
  ctx.image = imageSrc;

  // ---------- JSX emission ----------
  const attr = (name: string, value: string) => (/["\\{}<>\n]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`);
  const plainText = (text: string) =>
    text !== "" && /^[^{}<>&\n\r\t`]*$/.test(text) && text === text.trim() && !text.includes("  ") ? text : `{${JSON.stringify(text)}}`;
  // Line breaks in a text become `<br />`.
  const jsxText = (text: string) => (text.includes("\n") ? text.split("\n").map((line) => (line ? plainText(line) : "")).join("<br />") : plainText(text));
  const pad = (n: number) => " ".repeat(n);

  /** An element with children on their own lines; ranges of children are shifted. */
  const element = (id: string | undefined, tag: string, attrs: string[], children: Code[] | string | undefined, indent: number): Code => {
    const open = `<${[tag, ...attrs].join(" ")}`;
    let text: string;
    const ranges: Code["ranges"] = [];
    if (children === undefined || (Array.isArray(children) && children.length === 0)) {
      text = VOID_TAGS.has(tag.replace(/^motion\./, "")) || /^[A-Z]/.test(tag) ? `${open} />` : `${open}></${tag}>`;
    } else if (typeof children === "string") {
      text = `${open}>${children}</${tag}>`;
    } else {
      text = `${open}>`;
      for (const child of children) {
        text += `\n${pad(indent + 2)}`;
        for (const [cid, s, e] of child.ranges) ranges.push([cid, text.length + s, text.length + e]);
        text += child.text;
      }
      text += `\n${pad(indent)}</${tag}>`;
    }
    if (id) ranges.push([id, 0, text.length]);
    return { text, ranges };
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

  /** The className attribute (with cva / cn inside components). */
  const classAttr = (node: DesignNode, parent: Partial<Layout> | undefined, file: FileCtx, extra: string[] = []): string | undefined => {
    const bound = file.component?.bindings.get(node.id) ?? [];
    const visibleBound = bound.some((b) => b.field === "visible");
    const classes = nodeClasses(visibleBound ? { ...node, hidden: undefined } : node, parent, ctx);
    const own = file.extraClasses?.nodeId === node.id ? file.extraClasses.classes : [];
    const base = [...own, ...classes.base, ...extra].join(" ");
    const isRoot = file.component && node.id === file.component.source.root.id;
    // a slot whose fills bring their own layout somewhere: the instance's classes for it win
    const slotClass = node.type === "slot" && file.component && slotClassProps.has(`${file.component.source.id}:${node.slotName}`) ? slotClassProp(node.slotName) : undefined;
    const outer = [...(isRoot ? ["className"] : []), ...(slotClass ? [slotClass] : [])];
    const fn = file.component?.variantFns.get(node.id);
    const cn = (args: string[]) => {
      file.imports.add(importPath(file.path, stack.utilsPath(layout)), "cn");
      return `className={cn(${args.join(", ")})}`;
    };
    if (fn) {
      const call = `${fn.name}({ ${fn.props.join(", ")} })`;
      const more = extra.length ? [JSON.stringify(extra.join(" "))] : [];
      // hidden unless a variant shows it: cn() lets the variant's display win over `hidden`
      if (outer.length || more.length || node.hidden) return cn([call, ...more, ...outer]);
      return `className={${call}}`;
    }
    if (outer.length) return cn([JSON.stringify(base), ...outer]);
    return base ? attr("className", base) : undefined;
  };

  /** An expression for a node's field: an item's value inside a list (`item.quote`), or a component property (`label`). */
  const boundExpr = (node: DesignNode, field: string, file: FileCtx): string | undefined => {
    if (field === "target" && file.popoverButton && node.id === file.component?.source.root.id) return undefined;
    const key = file.list && node.bind?.[field];
    if (key) return `${file.list!.item}.${key}`;
    return file.component?.bindings.get(node.id)?.find((b) => b.field === field)?.prop.name;
  };

  const emit = (node: DesignNode, parent: Partial<Layout> | undefined, inline: boolean, indent: number, file: FileCtx): Code => {
    const visible = boundExpr(node, "visible", file);
    let code = emitElement(node, parent, inline, indent + (visible ? 2 : 0), file);
    if (visible) {
      const prefix = `{${visible} && (\n${pad(indent + 2)}`;
      code = {
        text: `${prefix}${code.text}\n${pad(indent)})}`,
        ranges: code.ranges.map(([id, s, e]) => [id, s + prefix.length, e + prefix.length]),
      };
    }
    // an element that opens an overlay: the overlay's popover right after it (once per file)
    const open = node.interaction?.type === "open" ? node.interaction : undefined;
    const overlay = open && overlayFrames.get(open.frameId);
    if (open && overlay && !file.overlaysShown?.has(overlay.id)) {
      (file.overlaysShown ??= new Set()).add(overlay.id);
      const name = overlayNames.get(overlay.id)!;
      file.imports.add(importPath(file.path, stack.componentPath(name, layout)), name);
      const role = open.as === "dropdown" ? [] : [`role="dialog"`];
      const popover = element(undefined, "div", [`id="${overlayId(overlay)}"`, `popover="auto"`, ...role, attr("aria-label", overlay.name), attr("className", overlayClasses(open, overlay).join(" "))], [{ text: `<${name} />`, ranges: [] }], indent);
      code = { text: `${code.text}\n${pad(indent)}${popover.text}`, ranges: code.ranges };
    } else if (open && !overlay) warnings.push(`an element opens a screen that isn't an overlay (${open.frameId}): left to the agent`);
    return code;
  };

  const emitChildren = (node: DesignNode, inline: boolean, indent: number, file: FileCtx, parentLayout = node.layout): Code[] =>
    isContainer(node) ? node.children.map((child) => emit(child, parentLayout, inline, indent + 2, file)) : [];

  /** Motion props of an element, and whether it becomes a Motion element (`motion.div`). */
  const motionAttrs = (node: DesignNode, file: FileCtx): { element: boolean; attrs: string[] } => {
    const kind = motionKind(node);
    if (!kind) return { element: false, attrs: [] };
    const use = (file.motion ??= { elements: false, variants: new Set() });
    if (kind === "root") {
      use.elements = true;
      return { element: true, attrs: ["variants={variants}", "transition={transition}"] };
    }
    if (kind === "child") {
      const { motion, index } = motionPlan!.children.get(node.id)!;
      use.variants.add(motion.preset);
      if (node.type !== "instance") use.elements = true;
      // a list's items: one step per item (`i`)
      const transition =
        file.list?.rootId === node.id
          ? motionTransition(motion, 0).replace(/ }$/, `, delay: ${motion.delay ? `${motion.delay / 1000} + ` : ""}Math.min(${file.list.index}, ${STAGGER_STEPS - 1}) * ${(motion.stagger ?? 0) / 1000} }`)
          : motionTransition(motion, staggerDelay(motion, index));
      return { element: node.type !== "instance", attrs: [`variants={${variantsName(motion.preset)}}`, `transition={${transition}}`] };
    }
    const motion = node.style!.motion!;
    use.elements = true;
    if (motion.stagger) return { element: true, attrs: [`initial="hidden"`, ...triggerAttrs(motion, `"show"`)] };
    const { hidden, show } = motionStates(motion.preset);
    // it ends at the element's own opacity
    const opacity = Number(node.style?.opacity);
    if (node.style?.opacity !== undefined && Number.isFinite(opacity)) show.opacity = opacity;
    return { element: true, attrs: [`initial={${objectLiteral(hidden)}}`, ...triggerAttrs(motion, `{${objectLiteral(show)}}`), `transition={${motionTransition(motion)}}`] };
  };

  /** Imports for a file's Motion code, and the variants it declares (module level). */
  const motionModule = (file: FileCtx): string[] => {
    if (!file.motion) return [];
    const { components, module } = motionImports(layout);
    if (file.motion.elements) {
      if (components.startsWith("import { motion }")) file.imports.add(module, "motion");
      else file.imports.line(components);
    }
    if (file.motion.variants.size > 0) file.imports.add(module, "Variants", true);
    return [...file.motion.variants].sort().map(variantsConst);
  };

  /**
   * What clicking an element does, as attributes: a button toggling an overlay's popover (or hiding
   * the overlay it is in), a link to the id of the element it scrolls to, a button switching a
   * component's property. The element becomes a `<button>` or an `<a>`.
   */
  const actionAttrs = (node: DesignNode, file: FileCtx): { tag: "button" | "a"; attrs: string[]; classes: string[] } | undefined => {
    const action = node.interaction;
    if (!action) return undefined;
    switch (action.type) {
      case "open": {
        const overlay = overlayFrames.get(action.frameId);
        if (!overlay) return undefined;
        const id = overlayId(overlay);
        return { tag: "button", attrs: [`type="button"`, `popoverTarget="${id}"`, ...(action.as === "dropdown" ? [] : [`aria-haspopup="dialog"`])], classes: action.as === "dropdown" ? [`[anchor-name:--${id}]`] : [] };
      }
      case "close":
        if (!file.overlayOf) {
          warnings.push(`a close button outside an overlay screen: left to the agent`);
          return undefined;
        }
        return { tag: "button", attrs: [`type="button"`, `popoverTarget="${file.overlayOf}"`, `popoverTargetAction="hide"`], classes: [] };
      case "scroll": {
        const id = file.scrollIds?.get(action.nodeId);
        if (!id) {
          warnings.push(`an element scrolls to one that isn't on its screen: left to the agent`);
          return undefined;
        }
        return { tag: "a", attrs: [`href="#${id}"`], classes: [] };
      }
      case "variant": {
        const setter = file.component?.state.get(action.prop);
        const prop = file.component?.source.def.props.find((p) => p.name === action.prop);
        if (!setter || !prop) {
          warnings.push(`switching "${action.prop}" works inside components: left to the agent`);
          return undefined;
        }
        const toggle = prop.type === "boolean" && action.value === "toggle";
        const value = toggle ? `(on) => !on` : prop.type === "boolean" ? String(action.value === "true") : prop.type === "number" ? String(Number(action.value)) : JSON.stringify(action.value);
        const current = prop.type === "boolean" || prop.type === "number" ? value : JSON.stringify(action.value);
        const aria = toggle ? `aria-expanded={${prop.name}}` : node.semantic?.role === "tab" ? `aria-selected={${prop.name} === ${current}}` : `aria-pressed={${prop.name} === ${current}}`;
        return { tag: "button", attrs: [`type="button"`, aria, `onClick={() => ${setter}(${value})}`], classes: [] };
      }
    }
  };

  /** A text node's content: its bound expression, formatted parts, or the text. */
  const textContent = (node: Extract<DesignNode, { type: "text" }>, file: FileCtx): string => {
    const bound = boundExpr(node, "text", file);
    if (bound) return `{${bound}}`;
    if (node.spans?.length) {
      return node.spans
        .map((span) => {
          const classes = styleClasses(span.style, ctx).join(" ");
          const cls = classes ? ` ${attr("className", classes)}` : "";
          if (span.href) return `<a ${attr("href", span.href)}${cls}>${jsxText(span.text)}</a>`;
          return classes ? `<span${cls}>${jsxText(span.text)}</span>` : jsxText(span.text);
        })
        .join("");
    }
    return jsxText(node.text);
  };

  const emitElement = (node: DesignNode, parent: Partial<Layout> | undefined, inline: boolean, indent: number, file: FileCtx): Code => {
    if (node.type === "instance") return emitInstance(node, parent, indent, file);
    const action = node.type === "image" || node.type === "icon" || node.type === "input" || node.type === "slot" ? undefined : actionAttrs(node, file);
    // an element that becomes a <button> keeps the design's text alignment (buttons center theirs)
    const align = action?.tag === "button" && node.type !== "button" && !node.style?.textAlign ? ["text-left"] : [];
    const className = classAttr(node, parent, file, [...(action?.classes ?? []), ...align]);
    const anchor = file.scrollIds?.get(node.id);
    const role = node.semantic?.role && ARIA_ROLES.has(node.semantic.role) ? [attr("role", node.semantic.role)] : [];
    // a component that opens overlays: its root button passes the popover target on
    const popover = file.component && node.id === file.component.source.root.id && popoverComponents.has(file.component.source.id) && (file.popoverButton || !rootLinks(file.component.source)) ? ["popoverTarget={popoverTarget}", "popoverTargetAction={popoverTargetAction}"] : [];
    const attrs = [...(file.list?.rootId === node.id ? [`key={${file.list.key}}`] : []), ...(anchor ? [`id="${anchor}"`] : []), ...(className ? [className] : []), ...role, ...popover];
    const motion = motionAttrs(node, file);
    const mt = (tag: string) => (motion.element ? `motion.${tag}` : tag);
    if (action) {
      // a clickable element: a <button> (or an <a> to scroll), with its content; named when it has no text (an icon)
      const content = node.type === "text" ? textContent(node, file) : emitChildren(node, true, indent, file);
      const label = !hasText(node) && node.name ? [attr("aria-label", node.name)] : [];
      return element(node.id, mt(action.tag), [...attrs, ...label, ...action.attrs, ...motion.attrs], content.length ? content : "", indent);
    }
    // a carousel: reachable with the keyboard (arrow keys scroll it)
    if (node.style?.snap) attrs.push("tabIndex={0}", `role="region"`, `aria-roledescription="carousel"`, attr("aria-label", node.name ?? "Carousel"));
    attrs.push(...motion.attrs);
    switch (node.type) {
      case "text":
        return element(node.id, mt(tagFor(node, inline)), attrs, textContent(node, file), indent);
      case "image": {
        const src = boundExpr(node, "src", file);
        const fit = node.fit ? [`object-${node.fit === "none" ? "none" : node.fit}`] : [];
        const cls = classAttr(node, parent, file, fit);
        const alt = boundExpr(node, "alt", file);
        const lead = attrs.filter((a) => a.startsWith("key=") || a.startsWith("id="));
        return element(node.id, mt("img"), [...lead, src ? `src={${src}}` : attr("src", imageSrc(node.src)), alt ? `alt={${alt}}` : attr("alt", node.alt ?? ""), ...(cls ? [cls] : []), ...motion.attrs], undefined, indent);
      }
      case "icon": {
        // named by the list's data: the variable the item's icon was picked into
        const bound = file.list && node.bind?.icon ? file.list.icons?.get(node.bind.icon) : undefined;
        const name = bound ?? pascalCase(node.icon);
        if (!bound) file.imports.add("lucide-react", name);
        const sized = node.box?.width || node.box?.height ? [] : ["size-[1em]"];
        const cls = classAttr(node, parent, file, sized);
        return element(node.id, name, [...(cls ? [cls] : []), `aria-hidden`], undefined, indent);
      }
      case "input":
        return emitInput(node, attrs, indent, file);
      case "button":
      case "link": {
        const target = boundExpr(node, "target", file);
        const route = target ? undefined : routeOf(node.targetFrameId);
        const childInline = true;
        const children = emitChildren(node, childInline, indent, file);
        if (target || route) {
          file.imports.line(stack.linkImport);
          // a button as a link: like a <button>, its text is centered
          const block = [...(node.layout?.mode ? [] : node.type === "button" ? ["inline-block"] : []), ...(node.type === "button" && !node.style?.textAlign ? ["text-center"] : [])];
          const cls = classAttr(node, parent, file, block);
          const to = target ? `${stack.linkAttr}={${target}}` : attr(stack.linkAttr, route!);
          return element(node.id, "Link", [to, ...(cls ? [cls] : [])], children.length ? children : "", indent);
        }
        if (node.type === "button") return element(node.id, mt("button"), [`type="button"`, ...attrs], children.length ? children : "", indent);
        const href = boundExpr(node, "href", file);
        return element(node.id, mt("a"), [href ? `href={${href}}` : attr("href", node.href ?? "#"), ...attrs], children.length ? children : "", indent);
      }
      case "slot": {
        const prop = file.component?.slotProps.get(node.slotName);
        const tag = tagFor(node, inline);
        const defaults = emitChildren(node, inline || INLINE_TAGS.has(tag), indent + 4, file);
        if (!prop) return element(node.id, tag, attrs, emitChildren(node, inline || INLINE_TAGS.has(tag), indent, file), indent);
        if (defaults.length === 0) return element(node.id, tag, attrs, `{${prop}}`, indent);
        const fragment = element(undefined, "", [], defaults, indent + 4);
        const fallback: Code = { text: `{${prop} ?? (\n${pad(indent + 4)}${fragment.text.replace(/^< ?>/, "<>")}\n${pad(indent + 2)})}`, ranges: [] };
        const offset = `{${prop} ?? (\n${pad(indent + 4)}`.length;
        fallback.ranges = fragment.ranges.map(([id, s, e]) => [id, s + offset, e + offset]);
        return element(node.id, tag, attrs, [fallback], indent);
      }
      default: {
        const tag = tagFor(node, inline);
        if (VOID_TAGS.has(tag)) return element(node.id, mt(tag), attrs, undefined, indent);
        const repeated = repeatedItems(node);
        if (repeated && !file.list) return element(node.id, mt(tag), attrs, [emitRepeated(node as Extract<DesignNode, { type: "list" }>, repeated, inline || INLINE_TAGS.has(tag), indent, file)], indent);
        return element(node.id, mt(tag), attrs, emitChildren(node, inline || INLINE_TAGS.has(tag), indent, file), indent);
      }
    }
  };

  /** A list of data: `{testimonials.map((item) => (<item design>))}` and the data file. */
  const emitRepeated = (node: Extract<DesignNode, { type: "list" }>, repeated: NonNullable<ReturnType<typeof repeatedItems>>, inline: boolean, indent: number, file: FileCtx): Code => {
    const name = dataNameOf(node);
    const path = dataPath(name);
    // icons named by the data: a map in the data file, picked per item
    const iconKeys: string[] = [];
    walk(repeated.template, (n) => {
      const key = n.type === "icon" ? n.bind?.icon : undefined;
      if (key && !iconKeys.includes(key)) iconKeys.push(key);
    });
    const iconMap = iconKeys.length ? `${name}Icons` : undefined;
    const iconNames = [...new Set(iconKeys.flatMap((k) => repeated.items.map((item) => item[k]).filter((v): v is string => typeof v === "string" && v !== "")))];
    if (!dataFiles.has(path)) {
      const value = (_key: string, v: JsonValue) => (typeof v === "string" && (v.startsWith("asset:") || v.startsWith("data:image/svg")) ? imageSrc(v) : v);
      const icons = iconMap ? { map: iconMap, names: iconNames.map((n) => ({ name: n, component: pascalCase(n) })) } : undefined;
      dataFiles.set(path, { path, content: dataModule(name, node.name ?? name, repeated.items, value, icons), kind: "utils", nodes: {}, summary: `Data of ${node.name ?? name}` });
    }
    file.imports.add(importPath(file.path, path), name);
    if (iconMap) file.imports.add(importPath(file.path, path), iconMap);
    // the key: a field whose values are all different, else the index
    const keyField = boundKeys(repeated.template).find((k) => new Set(repeated.items.map((item) => JSON.stringify(item[k]))).size === repeated.items.length && repeated.items.every((item) => typeof item[k] === "string" || typeof item[k] === "number"));
    const staggered = motionPlan?.children.has(repeated.template.id) ?? false;
    const index = !keyField || staggered;
    const before = file.list;
    const icons = new Map(iconKeys.map((k, i) => [k, i ? `Icon${i + 1}` : "Icon"]));
    file.list = { item: "item", index: "i", rootId: repeated.template.id, key: keyField ? `item.${keyField}` : "i", ...(iconMap && { icons }) };
    const inner = emit(repeated.template, node.layout, inline, indent + (iconMap ? 6 : 4), file);
    file.list = before;
    const args = `item${index ? ", i" : ""}`;
    if (iconMap) {
      // a component per item: `const Icon = featuresIcons[item.icon]` (the first one when the data names none it knows)
      const fallback = iconNames[0] ? ` ?? ${iconMap}[${JSON.stringify(iconNames[0])}]` : "";
      const picks = [...icons].map(([key, variable]) => `${pad(indent + 4)}const ${variable} = ${iconMap}[item.${key} as keyof typeof ${iconMap}]${fallback};\n`).join("");
      const head = `{${name}.map((${args}) => {\n${picks}${pad(indent + 4)}return (\n${pad(indent + 6)}`;
      return { text: `${head}${inner.text}\n${pad(indent + 4)});\n${pad(indent + 2)}})}`, ranges: inner.ranges.map(([id, s, e]) => [id, s + head.length, e + head.length]) };
    }
    const head = `{${name}.map((${args}) => (\n${pad(indent + 4)}`;
    return { text: `${head}${inner.text}\n${pad(indent + 2)}))}`, ranges: inner.ranges.map(([id, s, e]) => [id, s + head.length, e + head.length]) };
  };

  const emitInput = (node: Extract<DesignNode, { type: "input" }>, attrs: string[], indent: number, file: FileCtx): Code => {
    const placeholder = boundExpr(node, "placeholder", file);
    const label = boundExpr(node, "label", file);
    const labelled = Boolean(node.label || label);
    const at = labelled ? indent + 2 : indent;
    const common = [...(placeholder ? [`placeholder={${placeholder}}`] : node.placeholder ? [attr("placeholder", node.placeholder)] : []), ...attrs];
    const value = node.value ? [attr("defaultValue", node.value)] : [];
    let control: Code;
    switch (node.inputType) {
      case "textarea":
        control = element(node.id, "textarea", [...value, ...common], undefined, at);
        break;
      case "checkbox":
      case "switch":
      case "radio":
        control = element(node.id, "input", [`type="${node.inputType === "radio" ? "radio" : "checkbox"}"`, ...attrs], undefined, at);
        break;
      case "select":
        control = element(node.id, "select", attrs, [element(undefined, "option", [], jsxText(node.value ?? node.placeholder ?? ""), at + 2)], at);
        break;
      default:
        control = element(node.id, "input", [`type="${node.inputType}"`, ...value, ...common], undefined, at);
    }
    if (!labelled) return control;
    const text: Code = { text: label ? `{${label}}` : jsxText(node.label!), ranges: [] };
    return element(undefined, "label", [`className="${FIELD_CLASSES}"`], [text, control], indent);
  };

  const propValue = (prop: ComponentProp, value: JsonValue): string | undefined => {
    if (prop.bindings?.[0]?.field === "target") {
      const route = routeOf(typeof value === "string" ? value : undefined);
      return route === undefined ? undefined : attr(prop.name, route);
    }
    if (typeof value === "boolean") return value ? prop.name : `${prop.name}={false}`;
    if (typeof value === "number") return `${prop.name}={${value}}`;
    if (typeof value === "string") return attr(prop.name, value);
    return undefined;
  };

  const emitInstance = (node: InstanceNode, parent: Partial<Layout> | undefined, indent: number, file: FileCtx): Code => {
    const source = sources.get(node.componentId);
    const name = source && componentNames.get(source.id);
    if (!source || !name) {
      const catalog = project.components.find((c) => c.id === node.componentId)?.name ?? node.componentId;
      warnings.push(`component ${catalog} is not designed in AppShape: left to the agent`);
      return { text: `{/* ${catalog}: component from the app's code (see the spec) */}`, ranges: [[node.id, 0, `{/* ${catalog}: component from the app's code (see the spec) */}`.length]] };
    }
    file.imports.add(importPath(file.path, stack.componentPath(name, layout)), name);
    const attrs: string[] = file.list?.rootId === node.id ? [`key={${file.list.key}}`] : [];
    for (const prop of source.def.props) {
      // inside a list: the item's value
      const key = file.list && node.bind?.[`props.${prop.name}`];
      if (key) {
        attrs.push(`${prop.name}={${file.list!.item}.${key}}`);
        continue;
      }
      const value = node.props[prop.name];
      if (value === undefined) continue;
      const a = propValue(prop, value);
      if (a) attrs.push(a);
    }
    // a component that opens (or closes) an overlay: its root button gets the popover target
    const action = node.interaction;
    let anchorClass: string[] = [];
    if (action?.type === "open" || action?.type === "close") {
      const id = action.type === "open" ? (overlayFrames.get(action.frameId) ? overlayId(overlayFrames.get(action.frameId)!) : undefined) : file.overlayOf;
      if (id && popoverComponents.has(source.id)) {
        attrs.push(`popoverTarget="${id}"`, ...(action.type === "close" ? [`popoverTargetAction="hide"`] : []));
        if (action.type === "open" && action.as === "dropdown") anchorClass = [`[anchor-name:--${id}]`];
      } else warnings.push(`${source.name} can't open or close an overlay (its root isn't a button): left to the agent`);
    } else if (action) warnings.push(`${action.type === "scroll" ? "scrolling" : "switching a property"} from a component (${source.name}): left to the agent`);
    // Placement: the instance's own classes, plus the root's sizing for this parent (the
    // component sizes itself for a vertical stack; cn() lets these win).
    const own = nodeClasses(node, parent, ctx).base;
    const rootBox = source.root.box;
    const sizing = rootBox && (rootBox.width || rootBox.height) ? boxClasses({ width: node.box?.width ? undefined : rootBox.width, height: node.box?.height ? undefined : rootBox.height }, parent, ctx) : [];
    const stage = rootBox ? boxClasses({ width: rootBox.width, height: rootBox.height }, { mode: "flex", direction: "column" }, ctx) : [];
    const placement = [...own, ...sizing.filter((c) => !stage.includes(c)), ...anchorClass];
    if (placement.length) attrs.push(attr("className", placement.join(" ")));
    attrs.push(...motionAttrs(node, file).attrs);

    const slots = slotNames(source.root);
    const fills = node.children.filter((c): c is Extract<DesignNode, { type: "slot" }> => c.type === "slot");
    const slotLayout = (slotName: string) => findSlot(source.root, slotName)?.layout;
    // fills with their own layout (another gap): classes for the component's slot
    for (const fill of fills) {
      if (slotClassProps.has(`${source.id}:${fill.slotName}`) && fill.layout) {
        const classes = layoutClasses(fill.layout, ctx).join(" ");
        if (classes) attrs.push(attr(slotClassProp(fill.slotName), classes));
      }
    }
    if (slots.length === 1 && fills.length === 1) {
      const fill = fills[0]!;
      const children = fill.children.map((child) => emit(child, { ...slotLayout(fill.slotName), ...fill.layout }, false, indent + 2, file));
      return element(node.id, name, attrs, children, indent);
    }
    for (const fill of fills) {
      const children = fill.children.map((child) => emit(child, { ...slotLayout(fill.slotName), ...fill.layout }, false, indent + 4, file));
      const fragment = element(undefined, "", [], children, indent + 2);
      attrs.push(`${camelCase(fill.slotName)}={\n${pad(indent + 2)}${fragment.text.replace(/^< ?>/, "<>")}\n${pad(indent)}}`);
    }
    return element(node.id, name, attrs, undefined, indent);
  };

  // ---------- Page settings ----------
  interface Head {
    title?: string;
    description?: string;
    image?: string;
    favicon?: string;
  }
  const favicon = project.settings?.site?.favicon;
  const pageHead = (frame: Frame): Head | undefined => {
    const meta = frame.meta;
    const head: Head = {
      ...(meta?.title && { title: meta.title }),
      ...(meta?.description && { description: meta.description }),
      ...(meta?.image && { image: imageSrc(meta.image) }),
      ...(favicon && { favicon: imageSrc(favicon) }),
    };
    return Object.keys(head).length ? head : undefined;
  };
  const headTags = (head: Head): string[] => [
    ...(head.title ? [`<title>${jsxText(head.title)}</title>`] : []),
    ...(head.description ? [`<meta name="description" ${attr("content", head.description)} />`] : []),
    ...(head.title ? [`<meta property="og:title" ${attr("content", head.title)} />`] : []),
    ...(head.description ? [`<meta property="og:description" ${attr("content", head.description)} />`] : []),
    ...(head.image ? [`<meta property="og:image" ${attr("content", head.image)} />`] : []),
    ...(head.favicon ? [`<link rel="icon" ${attr("href", head.favicon)} />`] : []),
  ];
  const metadataObject = (head: Head): string => {
    const lines: string[] = [];
    if (head.title) lines.push(`title: ${JSON.stringify(head.title)},`);
    if (head.description) lines.push(`description: ${JSON.stringify(head.description)},`);
    if (head.title || head.description || head.image) {
      const og = [
        ...(head.title ? [`title: ${JSON.stringify(head.title)},`] : []),
        ...(head.description ? [`description: ${JSON.stringify(head.description)},`] : []),
        ...(head.image ? [`images: [${JSON.stringify(head.image)}],`] : []),
      ];
      lines.push(`openGraph: {`, ...og.map((l) => `  ${l}`), `},`);
    }
    if (head.favicon) lines.push(`icons: { icon: ${JSON.stringify(head.favicon)} },`);
    return `{\n${lines.map((l) => `  ${l}`).join("\n")}\n}`;
  };

  // ---------- Files ----------
  const finish = (file: GeneratedFile, code: Code, content: string): GeneratedFile => {
    const at = content.indexOf(code.text);
    for (const [id, s, e] of code.ranges) {
      const start = at + s;
      const end = at + e;
      file.nodes[id] = { start, end, hash: codeHash(content.slice(start, end)) };
    }
    file.content = content;
    return file;
  };

  const revealPath = stack.componentPath("ScrollReveal", layout);
  let revealUsed = false;
  for (const frame of screens) {
    const name = pageNames.get(frame.id)!;
    const path = stack.pagePath(routes.get(frame.id)!, name, layout);
    // a screen with its own theme: the theme's class redefines the design system's variables
    const theme = frame.theme && project.tokens.themes?.[frame.theme] ? { extraClasses: { nodeId: frame.current.id, classes: [themeClass(frame.theme)] } } : {};
    const file: FileCtx = { path, imports: new Imports(), stack, ...theme, scrollIds: scrollTargets(frame.current) };
    // page settings: Next.js App Router exports `metadata`; the others render head tags (React 19
    // moves <title>, <meta> and <link> into the document head; Next.js Pages Router uses next/head)
    const head = pageHead(frame);
    const tags = head && layout.stack !== "next-app" ? headTags(head) : [];
    const pagesRouter = layout.stack === "next-pages";
    if (tags.length && pagesRouter) file.imports.line(`import Head from "next/head";`);
    if (head && layout.stack === "next-app") file.imports.add("next", "Metadata", true);
    // entrances: ScrollReveal plays the CSS scroll-ins; Motion code turns off with reduced motion
    const needs = motionNeeds(frame.current);
    if (needs.reveal) {
      revealUsed = true;
      file.imports.add(importPath(path, revealPath), "ScrollReveal");
    }
    const before = [...(pagesRouter && tags.length ? ["<Head>", ...tags.map((t) => `  ${t}`), "</Head>"] : tags), ...(needs.reveal ? ["<ScrollReveal />"] : [])];
    const level = before.length ? 6 : 4;
    const rootIndent = needs.motion ? level + 2 : level;
    const code = emit(frame.current, undefined, false, rootIndent, file);
    let body = `${pad(rootIndent)}${code.text}`;
    if (needs.motion) {
      file.imports.add(motionImports(layout).module, "MotionConfig");
      body = `${pad(level)}<MotionConfig reducedMotion="user">\n${body}\n${pad(level)}</MotionConfig>`;
    }
    const jsx = before.length ? [`${pad(4)}<>`, ...before.map((line) => `${pad(6)}${line}`), body, `${pad(4)}</>`].join("\n") : body;
    const preambles = [...motionModule(file), ...(head && layout.stack === "next-app" ? [`export const metadata: Metadata = ${metadataObject(head)};`] : [])];
    const preamble = preambles.length ? preambles.join("\n\n") : undefined;
    const content = stack.pageModule({ name, route: routes.get(frame.id)!, imports: file.imports.render(), jsx, ...(preamble && { preamble }) });
    files.set(path, finish({ path, content: "", kind: "page", frameId: frame.id, nodes: {} }, code, content));
  }

  for (const source of sources.values()) {
    const name = componentNames.get(source.id)!;
    const path = stack.componentPath(name, layout);
    const file: FileCtx = { path, imports: new Imports(), stack, component: componentCtx(source, ctx), scrollIds: scrollTargets(source.root) };
    const code = emit(source.root, { mode: "flex", direction: "column" }, false, 4, file);
    // a link-like button that opens an overlay somewhere: a plain button when it is given a popover target
    let alternate: string | undefined;
    if (popoverComponents.has(source.id) && rootLinks(source)) {
      file.popoverButton = true;
      alternate = `${pad(6)}${emit(source.root, { mode: "flex", direction: "column" }, false, 6, file).text}`;
      file.popoverButton = false;
    }
    const content = componentModule(name, source, file, `${pad(4)}${code.text}`, routeOf, alternate);
    files.set(path, finish({ path, content: "", kind: "component", frameId: source.id, nodes: {} }, code, content));
  }
  // overlay screens: components without properties; their close buttons hide their popover
  for (const frame of overlays) {
    const name = overlayNames.get(frame.id)!;
    const path = stack.componentPath(name, layout);
    const source: ComponentSource = { id: frame.id, name: frame.name, root: frame.current, def: { props: [], description: `${frame.name} (shown over the page; see the pages that open it)` } };
    const file: FileCtx = { path, imports: new Imports(), stack, component: componentCtx(source, ctx), scrollIds: scrollTargets(frame.current), overlayOf: overlayId(frame) };
    const code = emit(frame.current, { mode: "flex", direction: "column" }, false, 4, file);
    const content = componentModule(name, source, file, `${pad(4)}${code.text}`, routeOf);
    files.set(path, finish({ path, content: "", kind: "component", frameId: frame.id, nodes: {} }, code, content));
  }

  if (stack.routesPath && stack.routesModule) {
    const path = stack.routesPath(layout);
    const pages = screens.map((f) => ({ name: pageNames.get(f.id)!, route: routes.get(f.id)!, importPath: importPath(path, stack.pagePath(routes.get(f.id)!, pageNames.get(f.id)!, layout)) }));
    files.set(path, { path, content: stack.routesModule(pages), kind: "routes", nodes: {} });
  }

  const cssPath = stack.cssPath(layout);
  const fonts = usedFonts(project, input.fonts ?? []);
  for (const font of fonts) {
    for (const file of font.files) {
      const name = file.split("/").pop()!;
      const path = `public/fonts/${font.slug}/${name}`;
      files.set(path, { path, content: `font:${font.slug}/${name}`, copyFrom: `assets/fonts/${font.slug}/${file}`, kind: "asset", nodes: {} });
    }
  }
  files.set(cssPath, { path: cssPath, content: `@import "tailwindcss";\n\n${themeBlock(project.tokens, defaults, fonts, cssMotion, usesInteractions)}\n\n${appBaseCss(project.tokens)}\n`, kind: "css", nodes: {} });
  if (revealUsed) files.set(revealPath, { path: revealPath, content: SCROLL_REVEAL_MODULE, kind: "utils", nodes: {}, summary: "Plays the scroll-in animations" });
  for (const [path, data] of dataFiles) files.set(path, data);
  for (const [path, asset] of assets) files.set(path, asset);

  const snippets = new Map<string, Snippet>();
  for (const request of input.snippets ?? []) {
    const file: FileCtx = { path: request.path, imports: new Imports(), stack };
    const code = emit(request.node, request.parent, request.inline ?? false, 0, file);
    motionModule(file);
    snippets.set(request.key, { text: code.text, imports: file.imports.render(), ranges: code.ranges });
  }

  return { files, skipped, routes, snippets, warnings: [...new Set(warnings)], fonts, motion: cssMotion, interactions: usesInteractions };

  // ---------- Component modules ----------
  function componentModule(name: string, source: ComponentSource, file: FileCtx, jsx: string, route: (id: string | undefined) => string | undefined, alternate?: string): string {
    const comp = file.component!;
    const lines: string[] = [];
    const fns: string[] = [];
    for (const [nodeId, fn] of comp.variantFns) {
      const node = findNode(source.root, nodeId)!;
      const classes = nodeClasses(node, nodeId === source.root.id ? { mode: "flex", direction: "column" } : parentLayoutOf(source.root, nodeId), ctx);
      fns.push(cvaCall(fn.name, classes.base.join(" "), classes.variants, source));
    }
    if (fns.length) file.imports.add("class-variance-authority", "cva");
    const props: string[] = [];
    const params: string[] = [];
    for (const prop of source.def.props) {
      const type = prop.bindings?.[0]?.field === "target" ? stack.linkPropType : prop.type === "enum" ? (prop.options ?? []).map((o) => JSON.stringify(o)).join(" | ") : prop.type === "boolean" ? "boolean" : prop.type === "number" ? "number" : "string";
      if (type.startsWith("LinkProps") && stack.linkPropImport) file.imports.line(stack.linkPropImport);
      props.push(`${prop.description ? `  /** ${prop.description} */\n` : ""}  ${prop.name}?: ${type};`);
      let fallback = propDefault(source.root, prop);
      if (prop.bindings?.[0]?.field === "target") fallback = route(typeof fallback === "string" ? fallback : undefined) ?? stack.emptyTarget;
      // a property its own elements switch: the prop is where it starts, the state what it is
      const param = comp.state.has(prop.name) ? `${prop.name}: initial${pascalCase(prop.name)}` : prop.name;
      params.push(fallback === undefined || fallback === null ? param : `${param} = ${JSON.stringify(fallback)}`);
    }
    for (const [slotName, propName] of comp.slotProps) {
      file.imports.add("react", "ReactNode", true);
      props.push(`  ${propName}?: ReactNode;`);
      params.push(propName);
      if (slotClassProps.has(`${source.id}:${slotName}`)) {
        props.push(`  /** Classes for the ${slotName} slot (its layout where it is used). */`, `  ${slotClassProp(slotName)}?: string;`);
        params.push(slotClassProp(slotName));
      }
    }
    props.push("  className?: string;");
    params.push("className");
    if (popoverComponents.has(source.id)) {
      props.push("  /** The popover (an overlay's id) it opens or closes. */", "  popoverTarget?: string;", `  popoverTargetAction?: "toggle" | "show" | "hide";`);
      params.push("popoverTarget", "popoverTargetAction");
    }
    if (motionPlan?.components.has(source.id)) {
      // staggered somewhere: the root plays the entrance it is given
      const { module } = motionImports(layout);
      file.imports.add(module, "Transition", true);
      file.imports.add(module, "Variants", true);
      props.push("  /** Entrance (Motion variants), when it is one of a staggered group. */", "  variants?: Variants;", "  transition?: Transition;");
      params.push("variants", "transition");
    }
    const variants = motionModule(file);
    const state = [...comp.state].map(([prop, setter]) => `  const [${prop}, ${setter}] = useState(initial${pascalCase(prop)});`);
    if (state.length) {
      file.imports.add("react", "useState");
      lines.push(`"use client";`, "");
    }
    lines.push(...file.imports.render(), "");
    if (variants.length) lines.push(...variants, "");
    if (fns.length) lines.push(...fns, "");
    lines.push(`export interface ${name}Props {`, ...props, "}", "");
    if (source.def.description) lines.push(`/** ${source.def.description} */`);
    const popoverBranch = alternate ? ["  if (popoverTarget) {", "    return (", alternate, "    );", "  }"] : [];
    lines.push(`export function ${name}({ ${params.join(", ")} }: ${name}Props) {`, ...state, ...(state.length ? [""] : []), ...popoverBranch, "  return (", jsx, "  );", "}", "");
    return lines.join("\n");
  }

  function cvaCall(fnName: string, base: string, variants: VariantClasses, source: ComponentSource): string {
    const entries: string[] = [];
    for (const prop of source.def.props) {
      const values = variants[prop.name];
      if (!values) continue;
      const options = prop.type === "enum" ? (prop.options ?? []) : prop.type === "boolean" ? ["true", "false"] : Object.keys(values);
      const body = options.map((o) => `      ${/^[A-Za-z_$][\w$]*$/.test(o) ? o : JSON.stringify(o)}: ${JSON.stringify((values[o] ?? []).join(" "))},`);
      entries.push(`    ${prop.name}: {\n${body.join("\n")}\n    },`);
    }
    return `const ${fnName} = cva(${JSON.stringify(base)}, {\n  variants: {\n${entries.join("\n")}\n  },\n});`;
  }
}

function componentCtx(source: ComponentSource, ctx: ClassContext): ComponentFileCtx {
  const bindings = new Map<string, { prop: ComponentProp; field: string }[]>();
  for (const prop of source.def.props) {
    for (const binding of prop.bindings ?? []) {
      bindings.set(binding.nodeId, [...(bindings.get(binding.nodeId) ?? []), { prop, field: binding.field }]);
    }
  }
  const variantFns = new Map<string, { name: string; props: string[] }>();
  const taken = new Set<string>();
  const visit = (node: DesignNode, parent: Partial<Layout> | undefined) => {
    const { variants } = nodeClasses(node, parent, ctx);
    const names = Object.keys(variants);
    if (names.length > 0) {
      const base = node.id === source.root.id ? source.name : (node.name ?? node.type);
      variantFns.set(node.id, { name: uniqueName(`${camelCase(base)}Variants`, taken), props: names });
    }
    if (node.type !== "instance" && isContainer(node)) for (const child of node.children) visit(child, node.layout);
  };
  visit(source.root, { mode: "flex", direction: "column" });
  const slots = slotNames(source.root);
  const slotProps = new Map(slots.map((s) => [s, slots.length === 1 ? "children" : camelCase(s)]));
  const state = new Map([...switchedProps(source.root)].filter((p) => source.def.props.some((d) => d.name === p)).map((p) => [p, `set${pascalCase(p)}`]));
  return { source, bindings, variantFns, slotProps, state };
}

/** Whether a component's root is a link to a screen it is given (a property bound to its target). */
function rootLinks(source: ComponentSource): boolean {
  return source.def.props.some((p) => p.bindings?.some((b) => b.nodeId === source.root.id && b.field === "target"));
}

function hasText(node: DesignNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === "text" || (n.type === "instance" && Object.keys(n.props).length > 0)) found = true;
  });
  return found;
}

function slotNames(root: DesignNode): string[] {
  const names: string[] = [];
  const visit = (node: DesignNode) => {
    if (node.type === "slot") names.push(node.slotName);
    if (node !== root && node.type === "instance") return;
    if (isContainer(node)) node.children.forEach(visit);
  };
  visit(root);
  return names;
}

function findSlot(root: DesignNode, slotName: string): DesignNode | undefined {
  if (root.type === "slot" && root.slotName === slotName) return root;
  if (!isContainer(root) || root.type === "instance") return undefined;
  for (const child of root.children) {
    const found = findSlot(child, slotName);
    if (found) return found;
  }
  return undefined;
}

function findNode(root: DesignNode, id: string): DesignNode | undefined {
  if (root.id === id) return root;
  if (!isContainer(root)) return undefined;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function parentLayoutOf(root: DesignNode, id: string): Partial<Layout> | undefined {
  const find = (node: DesignNode): { layout: Partial<Layout> | undefined } | undefined => {
    if (!isContainer(node)) return undefined;
    for (const child of node.children) {
      if (child.id === id) return { layout: node.layout };
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  return find(root)?.layout;
}

/** A complete new app: the stack's scaffold plus the generated code (generated files win). */
export function newAppFiles(input: GenerateInput, appName: string): { files: Map<string, string>; generated: Generated } {
  const generated = generateApp(input);
  const files = new Map(Object.entries(STACKS[input.layout.stack].scaffold(appName, input.layout)));
  for (const [path, file] of generated.files) files.set(path, file.content);
  return { files, generated };
}

/** Installed fonts the design uses: named first in a font token or in an element's own font. */
export function usedFonts(project: Project, fonts: readonly InstalledFont[]): InstalledFont[] {
  if (fonts.length === 0) return [];
  const families = new Set<string>();
  for (const value of Object.values(project.tokens.groups.fontFamily ?? {})) if (typeof value === "string") families.add(firstFamily(value));
  for (const theme of Object.values(project.tokens.themes ?? {})) {
    for (const value of Object.values(theme.groups.fontFamily ?? {})) if (typeof value === "string") families.add(firstFamily(value));
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "fontFamily" && typeof inner === "string" && !inner.startsWith("$")) families.add(firstFamily(inner));
        else visit(inner);
      }
    }
  };
  visit(project.frames.map((f) => f.current));
  return fonts.filter((f) => families.has(f.cssFamily));
}
