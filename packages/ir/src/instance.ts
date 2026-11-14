import type { BindingField, ComponentDef, ComponentProp } from "./component";
import { clone } from "./deep";
import type { Frame } from "./frame";
import type { JsonValue } from "./json";
import type { DesignNode, InstanceNode } from "./node";
import type { Override } from "./style";
import { findNode, isContainer, walk } from "./tree";

/**
 * Components designed in AppShape live in frames of kind `component`. Instances (`instance`
 * nodes with `componentId` = the frame id) are expanded from the component's tree at render time.
 */
export interface ComponentSource {
  /** The component frame's id (what instances reference). */
  id: string;
  name: string;
  root: DesignNode;
  def: ComponentDef;
}

export type ComponentSources = ReadonlyMap<string, ComponentSource>;

const sourceCache = new WeakMap<Frame, ComponentSource>();

/** The component a frame defines (stable object per frame object), or undefined for screens. */
export function componentSource(frame: Frame): ComponentSource | undefined {
  if (frame.kind !== "component" || !frame.component) return undefined;
  let source = sourceCache.get(frame);
  if (!source) {
    source = { id: frame.id, name: frame.name, root: frame.current, def: frame.component };
    sourceCache.set(frame, source);
  }
  return source;
}

export function componentSources(frames: Iterable<Frame>): Map<string, ComponentSource> {
  const sources = new Map<string, ComponentSource>();
  for (const frame of frames) {
    const source = componentSource(frame);
    if (source) sources.set(source.id, source);
  }
  return sources;
}

/** The value a bound field has in a node, or undefined if the field does not apply. */
export function fieldValue(node: DesignNode, field: BindingField): JsonValue | undefined {
  switch (field) {
    case "text":
      return node.type === "text" ? node.text : undefined;
    case "visible":
      return !node.hidden;
    case "src":
      return node.type === "image" ? node.src : undefined;
    case "icon":
      return node.type === "icon" ? node.icon : undefined;
    case "target":
      return node.type === "link" || node.type === "button" ? (node.targetFrameId ?? null) : undefined;
    case "href":
      return node.type === "link" ? (node.href ?? null) : undefined;
    case "placeholder":
      return node.type === "input" ? (node.placeholder ?? null) : undefined;
    case "label":
      return node.type === "input" ? (node.label ?? null) : undefined;
  }
}

/** Sets a bound field in place. Values of the wrong kind are ignored. */
function setField(node: DesignNode, field: BindingField, value: JsonValue): void {
  const text = typeof value === "string" ? value : value === null ? undefined : String(value);
  switch (field) {
    case "text":
      if (node.type === "text") {
        node.text = text ?? "";
        delete node.spans;
      }
      return;
    case "visible":
      if (value === false) node.hidden = true;
      else delete node.hidden;
      return;
    case "src":
      if (node.type === "image" && text) node.src = text;
      return;
    case "icon":
      if (node.type === "icon" && text) node.icon = text;
      return;
    case "target":
      if (node.type === "link" || node.type === "button") {
        if (text) node.targetFrameId = text;
        else delete node.targetFrameId;
      }
      return;
    case "href":
      if (node.type === "link") {
        if (text) node.href = text;
        else delete node.href;
      }
      return;
    case "placeholder":
    case "label":
      if (node.type === "input") {
        if (text) node[field] = text;
        else delete node[field];
      }
      return;
  }
}

/** A property's default: what the component shows itself for bound properties. */
export function propDefault(root: DesignNode, prop: ComponentProp): JsonValue | undefined {
  const binding = prop.bindings?.[0];
  const node = binding && findNode(root, binding.nodeId)?.node;
  const bound = node && fieldValue(node, binding.field);
  if (bound !== undefined) return bound;
  if (prop.default !== undefined) return prop.default;
  if (prop.type === "enum") return prop.options?.[0];
  if (prop.type === "boolean") return true;
  return undefined;
}

/** Every property's value: the given values over the defaults. */
export function propValues(root: DesignNode, def: ComponentDef, values: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const prop of def.props) {
    const value = values[prop.name] ?? propDefault(root, prop);
    if (value !== undefined) result[prop.name] = value;
  }
  return result;
}

const conditionValue = (value: JsonValue | undefined) => (value === undefined || value === null ? "" : String(value));

function mergeObjects<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b && clone(b);
  if (!b) return clone(a);
  const merged = { ...clone(a), ...clone(b) } as Record<string, unknown>;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as T;
}

/** Merges an override's values into a node's base values (in place). */
function mergeOverride(node: DesignNode, override: Override): void {
  const layout = mergeObjects(node.layout, override.layout as DesignNode["layout"]);
  const box = mergeObjects(node.box, override.box as DesignNode["box"]);
  const style = mergeObjects(node.style, override.style as DesignNode["style"]);
  if (layout) node.layout = layout;
  if (box) node.box = box;
  if (style) node.style = style;
  if (override.hidden === true) node.hidden = true;
  if (override.hidden === false) delete node.hidden;
}

/**
 * The component tree with property values applied: bound fields take the given values, and
 * overrides with a property condition are resolved (merged into the base when they match and have
 * no other condition, kept without the property part when they do, dropped when they don't match).
 * Node ids are kept. The input is not mutated.
 */
export function resolveProps(root: DesignNode, def: ComponentDef, values: Readonly<Record<string, JsonValue>>): DesignNode {
  const all = propValues(root, def, values);
  const tree = clone(root);
  for (const prop of def.props) {
    // Unset bound properties already show their default (the tree's own value).
    if (values[prop.name] === undefined) continue;
    for (const binding of prop.bindings ?? []) {
      const node = findNode(tree, binding.nodeId)?.node;
      if (node) setField(node, binding.field, values[prop.name]!);
    }
  }
  walk(tree, (node) => {
    if (!node.overrides?.some((o) => o.when.prop)) return;
    const kept: Override[] = [];
    const narrowed: Override[] = [];
    for (const override of node.overrides) {
      const cond = override.when.prop;
      if (!cond) {
        kept.push(override);
        continue;
      }
      if (conditionValue(all[cond.name]) !== cond.value) continue;
      const { prop: _prop, ...rest } = override.when;
      if (Object.keys(rest).length === 0) mergeOverride(node, override);
      else narrowed.push({ ...override, when: rest });
    }
    // Variant-specific overrides come after the shared ones for the same condition, so they win.
    const overrides = [...kept, ...narrowed];
    if (overrides.length > 0) node.overrides = overrides;
    else delete node.overrides;
  });
  return tree;
}

export interface Expansion {
  /** The component's tree for this instance; the root carries the instance's id. */
  root: DesignNode;
  /**
   * Filled slots: nodes standing for the instance's own `slot` children (real nodes of the
   * instance's frame, with the same id and children), styled by the component's slot.
   */
  fills: ReadonlySet<DesignNode>;
}

/**
 * Expands an instance: the component's tree with the instance's property values, its slot fills,
 * and the instance's own layout/box/style/overrides merged onto the root.
 */
export function expandInstance(instance: InstanceNode, source: ComponentSource): Expansion {
  let tree = resolveProps(source.root, source.def, instance.props);
  const fills = new Set<DesignNode>();
  const fillsByName = new Map<string, DesignNode>();
  for (const child of instance.children) if (child.type === "slot") fillsByName.set(child.slotName, child);

  const fillSlot = (slot: DesignNode): DesignNode => {
    if (slot.type !== "slot") return slot;
    const fill = fillsByName.get(slot.slotName);
    if (!fill || fill.type !== "slot") return slot;
    const merged = mergeRoot(slot, fill);
    fills.add(merged);
    return merged;
  };
  if (fillsByName.size > 0) {
    tree = fillSlot(tree);
    walk(tree, (node) => {
      if (fills.has(node)) return "skip";
      if (isContainer(node)) node.children = node.children.map(fillSlot);
    });
  }

  const root = mergeRoot(tree, instance);
  if (fills.has(tree)) fills.add(root);
  return { root, fills };
}

/**
 * `base` with the identity and own values of `top` (an instance on its component's root, or a
 * slot fill on the component's slot). Children come from `top` when it is a slot fill.
 */
function mergeRoot(base: DesignNode, top: DesignNode): DesignNode {
  const merged = {
    ...base,
    id: top.id,
    origin: top.origin,
    ...(top.type === "slot" && { children: (top as Extract<DesignNode, { type: "slot" }>).children }),
  } as DesignNode;
  const name = top.name ?? base.name;
  if (name !== undefined) merged.name = name;
  else delete merged.name;
  const layout = mergeObjects(base.layout, top.layout);
  const box = mergeObjects(base.box, top.box);
  const style = mergeObjects(base.style, top.style);
  for (const [key, value] of [["layout", layout], ["box", box], ["style", style]] as const) {
    if (value) (merged as unknown as Record<string, unknown>)[key] = value;
    else delete (merged as unknown as Record<string, unknown>)[key];
  }
  const overrides = [...(base.overrides ?? []), ...(top.overrides ?? [])];
  if (overrides.length > 0) merged.overrides = overrides;
  else delete merged.overrides;
  if (top.hidden || base.hidden) merged.hidden = true;
  else delete merged.hidden;
  if (top.annotations) merged.annotations = top.annotations;
  else delete merged.annotations;
  return merged;
}

/**
 * Walks a tree as it is rendered: instances of known components are expanded (their expanded root
 * is visited in place of the instance). `renderedId` is the node id for real nodes and
 * `<instance rendered id>/<node id>` inside instances, as in the renderer's `data-aps-i`.
 */
export function walkRendered(
  root: DesignNode,
  sources: ComponentSources,
  visit: (node: DesignNode, renderedId: string, inInstance: boolean) => void | "skip",
  /** The frame being walked, when it is a component frame (its own instances are not expanded). */
  frameId?: string,
): void {
  const go = (node: DesignNode, scope: string | undefined, fills: ReadonlySet<DesignNode>, stack: readonly string[]) => {
    if (fills.has(node)) scope = undefined;
    const id = scope === undefined ? node.id : `${scope}/${node.id}`;
    if (node.type === "instance") {
      const source = sources.get(node.componentId);
      if (source && !stack.includes(source.id)) {
        const expansion = expandInstance(node, source);
        if (visit(expansion.root, id, scope !== undefined) === "skip") return;
        if (isContainer(expansion.root)) {
          for (const child of expansion.root.children) go(child, id, expansion.fills, [...stack, source.id]);
        }
        return;
      }
    }
    if (visit(node, id, scope !== undefined) === "skip") return;
    if (isContainer(node)) for (const child of node.children) go(child, scope, fills, stack);
  };
  go(root, undefined, new Set(), frameId ? [frameId] : []);
}

export interface NavTarget {
  /** Rendered id of the link/button (see `walkRendered`). */
  elementId: string;
  targetFrameId: string;
  /**
   * Identifies the same link on other screens: its source location (imported pages) or its
   * element inside a component. Undefined for links of this screen only.
   */
  sharedKey?: string;
}

/** Links and buttons that open another screen, including those inside instances. */
export function navTargets(root: DesignNode, sources: ComponentSources, frameId?: string): NavTarget[] {
  const targets: NavTarget[] = [];
  walkRendered(root, sources, (node, elementId) => {
    if ((node.type === "link" || node.type === "button") && node.targetFrameId) {
      const source = node.source;
      const sharedKey = source
        ? `src:${source.file}:${source.line}:${source.col}:${source.repeated?.index ?? 0}`
        : elementId.includes("/")
          ? `cmp:${elementId.slice(elementId.lastIndexOf("/") + 1)}`
          : undefined;
      targets.push({ elementId, targetFrameId: node.targetFrameId, ...(sharedKey && { sharedKey }) });
    }
  }, frameId);
  return targets;
}

/** Whether component `componentId` contains (at any depth) an instance of `targetId`, or is it. */
export function componentUses(sources: ComponentSources, componentId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const source = sources.get(id);
    if (!source) return false;
    let found = false;
    walk(source.root, (node) => {
      if (found) return "skip";
      if (node.type === "instance" && visit(node.componentId)) found = true;
    });
    return found;
  };
  return visit(componentId);
}

/** An instance of `componentId` may go into frame `frameId` unless that creates a cycle. */
export function canPlaceInstance(sources: ComponentSources, frameId: string, componentId: string): boolean {
  return !componentUses(sources, componentId, frameId);
}

/** All instances of a component across frames. */
export function instancesOf(frames: Iterable<Frame>, componentId: string): { frameId: string; node: InstanceNode }[] {
  const result: { frameId: string; node: InstanceNode }[] = [];
  for (const frame of frames) {
    walk(frame.current, (node) => {
      if (node.type === "instance" && node.componentId === componentId) result.push({ frameId: frame.id, node });
    });
  }
  return result;
}

export interface ComponentProblem {
  frameId: string;
  message: string;
}

/**
 * Broken component references: instances of unknown components (`catalogIds` are components
 * from the code catalog), property bindings to missing nodes, and components that contain
 * themselves.
 */
export function findComponentProblems(frames: readonly Frame[], catalogIds: ReadonlySet<string> = new Set()): ComponentProblem[] {
  const problems: ComponentProblem[] = [];
  const sources = componentSources(frames);
  for (const frame of frames) {
    walk(frame.current, (node) => {
      if (node.type === "instance" && !sources.has(node.componentId) && !catalogIds.has(node.componentId)) {
        problems.push({ frameId: frame.id, message: `instance ${node.id} uses unknown component ${node.componentId}` });
      }
    });
    const source = sources.get(frame.id);
    if (!source) continue;
    for (const prop of source.def.props) {
      for (const binding of prop.bindings ?? []) {
        const node = findNode(source.root, binding.nodeId)?.node;
        if (!node) problems.push({ frameId: frame.id, message: `property ${prop.name} is bound to missing node ${binding.nodeId}` });
        else if (fieldValue(node, binding.field) === undefined) {
          problems.push({ frameId: frame.id, message: `property ${prop.name}: ${node.type} node ${node.id} has no field ${binding.field}` });
        }
      }
    }
    let selfUse = false;
    walk(source.root, (node) => {
      if (node.type === "instance" && componentUses(sources, node.componentId, frame.id)) selfUse = true;
    });
    if (selfUse) problems.push({ frameId: frame.id, message: `component ${frame.name} contains itself` });
  }
  return problems;
}
