import { designJsx } from "@appshape/codegen";
import { componentSources, type DesignNode, type Frame, type Project } from "@appshape/ir";

/**
 * Finding elements of a screen without their ids (generated screens get new ids on every run)
 * and asking questions about a screen after a proposal (the checks of a case).
 */

const kids = (node: DesignNode): DesignNode[] => ("children" in node && Array.isArray(node.children) ? (node.children as DesignNode[]) : []);

export function* nodes(root: DesignNode): Generator<DesignNode> {
  yield root;
  for (const child of kids(root)) yield* nodes(child);
}

/** All text inside an element, including the props of components (labels, questions, …). */
export function textOf(node: DesignNode): string {
  const parts: string[] = [];
  for (const n of nodes(node)) {
    if (n.type === "text") parts.push(n.text);
    if (n.type === "instance") for (const v of Object.values(n.props ?? {})) if (typeof v === "string") parts.push(v);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** A way to pick one element of a screen. */
export type Finder = (screen: Screen) => DesignNode | undefined;

export class Screen {
  readonly sources: ReturnType<typeof componentSources>;
  private readonly parents = new Map<string, DesignNode>();
  constructor(
    readonly project: Project,
    readonly frame: Frame,
  ) {
    this.sources = componentSources(project.frames);
    for (const n of nodes(frame.current)) for (const c of kids(n)) this.parents.set(c.id, n);
  }
  get root(): DesignNode {
    return this.frame.current;
  }
  byId(id: string): DesignNode | undefined {
    for (const n of nodes(this.root)) if (n.id === id) return n;
    return undefined;
  }
  parentOf(id: string): DesignNode | undefined {
    return this.parents.get(id);
  }
  /** The element's ancestors, nearest first. */
  ancestors(id: string): DesignNode[] {
    const out: DesignNode[] = [];
    for (let p = this.parents.get(id); p; p = this.parents.get(p.id)) out.push(p);
    return out;
  }
  childIds(id: string): string[] {
    const node = this.byId(id);
    return node ? kids(node).map((c) => c.id) : [];
  }
  componentName(node: DesignNode): string | undefined {
    if (node.type !== "instance") return undefined;
    return this.sources.get(node.componentId)?.name ?? this.project.components.find((c) => c.id === node.componentId)?.name;
  }
  /** Instances of a component inside an element, by its name as JSX writes it (`AccordionItem` for "Accordion item"). */
  instances(name: string, within: DesignNode = this.root): DesignNode[] {
    const key = (n: string) => n.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return [...nodes(within)].filter((n) => key(this.componentName(n) ?? "") === key(name));
  }
  all(test: (n: DesignNode) => boolean, within: DesignNode = this.root): DesignNode[] {
    return [...nodes(within)].filter(test);
  }
  /** The element (or the whole screen) as design JSX: classes, components and props as written. */
  jsx(node: DesignNode = this.root): string {
    return designJsx({ ...this.frame, current: node }, this.project);
  }
  /** The `className` of the element itself (the first tag of its JSX). */
  classes(node: DesignNode): string[] {
    const first = this.jsx(node).match(/^<[^>]*?className="([^"]*)"/);
    return first ? first[1]!.split(/\s+/) : [];
  }
}

// --- finders -------------------------------------------------------------------------------------

/** The first element with this name (layer name, `data-name`). */
export const named =
  (name: string, within?: Finder): Finder =>
  (s) =>
    s.all((n) => n.name === name, within?.(s) ?? s.root)[0];

/** The innermost element whose own text matches (a heading, a paragraph). */
export const withText =
  (text: string | RegExp, within?: Finder): Finder =>
  (s) => {
    const test = (t: string) => (typeof text === "string" ? t.includes(text) : text.test(t));
    const found = s.all((n) => n.type === "text" && test(n.text), within?.(s) ?? s.root)[0];
    // a text node's element: its parent when that is a plain text block
    return found;
  };

/** The first instance of a component, optionally with a prop's value. */
export const instance =
  (component: string, prop?: [string, string | RegExp], within?: Finder): Finder =>
  (s) =>
    s.instances(component, within?.(s) ?? s.root).find((n) => {
      if (!prop || n.type !== "instance") return true;
      const v = n.props?.[prop[0]];
      return typeof v === "string" && (typeof prop[1] === "string" ? v === prop[1] : prop[1].test(v));
    });

/** The nth (0-based) instance of a component. */
export const nthInstance =
  (component: string, index: number, within?: Finder): Finder =>
  (s) =>
    s.instances(component, within?.(s) ?? s.root)[index];

/** The element with this id (imported screens keep their ids). */
export const id =
  (value: string): Finder =>
  (s) =>
    s.byId(value);

/** The parent of what another finder finds. */
export const parent =
  (of: Finder): Finder =>
  (s) => {
    const n = of(s);
    return n && s.parentOf(n.id);
  };

/** The first element of a type inside what another finder finds. */
export const first =
  (type: DesignNode["type"], within: Finder): Finder =>
  (s) => {
    const w = within(s);
    return w && s.all((n) => n.type === type && n.id !== w.id, w)[0];
  };

export function must(finder: Finder, s: Screen, what: string): DesignNode {
  const n = finder(s);
  if (!n) throw new Error(`case element not found: ${what}`);
  return n;
}
