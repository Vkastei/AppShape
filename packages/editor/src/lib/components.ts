import {
  type AnyOp,
  applyCommandToProject,
  type BindingField,
  type BoardItem,
  canPlaceInstance,
  type ComponentDef,
  type ComponentProp,
  type ComponentSource,
  type ComponentSources,
  componentSources,
  createId,
  type DesignNode,
  expandInstance,
  findNode,
  type Frame,
  type InstanceNode,
  instancesOf,
  isContainer,
  type JsonValue,
  type Op,
  type Project,
  walk,
} from "@appshape/ir";
import { framesById, newItemId, newOpId } from "./board";
import { itemBounds, type Sizes, unionRects } from "./geometry";
import { cloneWithNewIds, type NodeContext } from "./nodes";

/** Pure helpers for components: making them, instances, detaching, properties. */

const sourceCache = new WeakMap<readonly Frame[], Map<string, ComponentSource>>();

/** Components designed in the project, by component (frame) id. Cached per frames array. */
export function sourcesOf(project: Project): Map<string, ComponentSource> {
  let sources = sourceCache.get(project.frames);
  if (!sources) {
    sources = componentSources(project.frames);
    sourceCache.set(project.frames, sources);
  }
  return sources;
}

/** Name of a component: designed in AppShape, or from the code catalog. */
export function componentName(project: Project, id: string): string | undefined {
  return sourcesOf(project).get(id)?.name ?? project.components.find((c) => c.id === id)?.name;
}

/** The components a tree renders (transitively), for memoizing renders. */
export function usedSources(root: DesignNode, sources: ComponentSources): Map<string, ComponentSource> {
  const used = new Map<string, ComponentSource>();
  const visit = (node: DesignNode) =>
    walk(node, (n) => {
      if (n.type !== "instance" || used.has(n.componentId)) return;
      const source = sources.get(n.componentId);
      if (!source) return;
      used.set(source.id, source);
      visit(source.root);
    });
  visit(root);
  return used;
}

export function newInstance(componentId: string): InstanceNode {
  return { id: createId("n"), type: "instance", origin: "added", componentId, props: {}, children: [] };
}

const TYPE_NAMES: Partial<Record<DesignNode["type"], string>> = { text: "Text", button: "Button", link: "Link", image: "Image", input: "Input", icon: "Icon", list: "List" };

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function camelName(value: string): string {
  const words = value.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const name = words.map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1))).join("");
  return /^[a-z]/.test(name) ? name : `prop${name}`;
}

function uniqueProp(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
  taken.add(name);
  return name;
}

/** Properties made automatically: every text (outside nested instances), plus the link target of a link/button root. */
export function autoProps(root: DesignNode): ComponentProp[] {
  const texts: Extract<DesignNode, { type: "text" }>[] = [];
  walk(root, (node) => {
    if (node !== root && node.type === "instance") return "skip";
    if (node.type === "text") texts.push(node);
  });
  const taken = new Set<string>();
  const props: ComponentProp[] = texts.map((node) => {
    const base = node.name
      ? camelName(node.name)
      : texts.length === 1
        ? root.type === "button" || root.type === "link"
          ? "label"
          : "text"
        : node.semantic?.role === "heading"
          ? "title"
          : "text";
    return { name: uniqueProp(base, taken), type: "string", bindings: [{ nodeId: node.id, field: "text" }] };
  });
  if (root.type === "button" || root.type === "link") {
    props.push({ name: uniqueProp("opens", taken), type: "string", description: "Screen it opens", bindings: [{ nodeId: root.id, field: "target" }] });
  }
  return props;
}

/** A free spot for a new component: below the other components, or right of everything. */
export function componentSpot(project: Project, sizes: Sizes): { x: number; y: number } {
  const frames = framesById(project);
  const placements = project.board.items.filter((i) => i.type === "frame" && frames.get(i.frameId)?.kind === "component");
  const components = unionRects(placements.map((p) => itemBounds(p, frames, sizes)).filter((r) => r !== undefined));
  if (components) return { x: Math.round(components.x), y: Math.round(components.y + components.h + 80) };
  const all = unionRects(project.board.items.map((i) => itemBounds(i, frames, sizes)).filter((r) => r !== undefined));
  return all ? { x: Math.round(all.x + all.w + 200), y: Math.round(all.y) } : { x: 0, y: 0 };
}

export interface MadeComponent {
  ops: AnyOp[];
  componentId: string;
  instanceId: string;
  placementId: string;
  name: string;
}

/**
 * Turns an element into a component: a new component frame with a copy of the element (texts
 * exposed as properties), the element replaced by an instance, and the component placed on the
 * board. `width` is the element's rendered width.
 */
export function makeComponentOps(project: Project, ctx: NodeContext, width: number, spot: { x: number; y: number }): MadeComponent | { error: string } {
  if (!ctx.parent) return { error: "The root of a screen can't become a component." };
  if (ctx.node.type === "instance") return { error: "This is already a component instance." };
  const root = cloneWithNewIds(ctx.node);
  const taken = new Set(project.frames.map((f) => f.name));
  const base = ctx.node.name ?? TYPE_NAMES[ctx.node.type] ?? "Component";
  const name = uniqueName(base, taken);
  const component: Frame = {
    id: createId("f"),
    name,
    kind: "component",
    platform: ctx.frame.platform,
    target: { adapter: ctx.frame.target.adapter },
    viewports: [{ id: "component", width: Math.max(40, Math.ceil(width)) }],
    current: root,
    component: { props: autoProps(root) },
  };
  const instance = newInstance(component.id);
  const placement: BoardItem = { type: "frame", id: newItemId(), frameId: component.id, x: spot.x, y: spot.y };
  const ops: AnyOp[] = [
    { id: newOpId(), frameId: component.id, op: "createFrame", frame: component },
    { id: newOpId(), frameId: ctx.frame.id, op: "delete", nodeId: ctx.node.id },
    { id: newOpId(), frameId: ctx.frame.id, op: "insert", parentId: ctx.parent.id, index: ctx.index, node: instance },
    { id: newOpId(), op: "addItem", item: placement },
  ];
  return { ops, componentId: component.id, instanceId: instance.id, placementId: placement.id, name };
}

/** The instance as plain elements (fresh ids); nested instances stay instances. */
export function detachedTree(instance: InstanceNode, source: ComponentSource): DesignNode {
  const tree = cloneWithNewIds(expandInstance(instance, source).root);
  walk(tree, (node) => {
    if (!isContainer(node)) return;
    // Slots only mean something inside a component.
    node.children = node.children.map((child) => {
      if (child.type !== "slot") return child;
      const { slotName: _slotName, ...rest } = child;
      return { ...rest, type: "box" } as DesignNode;
    });
  });
  if (tree.type === "slot") {
    const { slotName: _slotName, ...rest } = tree;
    return { ...rest, type: "box" } as DesignNode;
  }
  return tree;
}

export function detachOps(project: Project, frameId: string, instanceId: string): { ops: Op[]; newId?: string } {
  const frame = project.frames.find((f) => f.id === frameId);
  const loc = frame && findNode(frame.current, instanceId);
  if (!loc?.parent || loc.node.type !== "instance") return { ops: [] };
  const source = sourcesOf(project).get(loc.node.componentId);
  if (!source) return { ops: [] };
  const tree = detachedTree(loc.node, source);
  return {
    ops: [
      { id: newOpId(), frameId, op: "delete", nodeId: instanceId },
      { id: newOpId(), frameId, op: "insert", parentId: loc.parent.id, index: loc.index, node: tree },
    ],
    newId: tree.id,
  };
}

/**
 * Deletes a component: its instances everywhere are detached first (so screens keep looking the
 * same), then its placements and the frame are removed.
 */
export function deleteComponentOps(project: Project, componentId: string): AnyOp[] {
  const ops: AnyOp[] = [];
  let work = project;
  for (let guard = 0; guard < 1000; guard++) {
    const next = instancesOf(work.frames, componentId).find((i) => i.frameId !== componentId);
    if (!next) break;
    const detach = detachOps(work, next.frameId, next.node.id).ops;
    if (detach.length === 0) break;
    ops.push(...detach);
    work = applyCommandToProject(work, detach);
  }
  const doomed = new Set(project.board.items.filter((i) => i.type === "frame" && i.frameId === componentId).map((i) => i.id));
  for (const item of project.board.items) {
    const linked = item.type === "arrow" && [item.from, item.to].some((end) => "itemId" in end && doomed.has(end.itemId));
    const attached = item.type === "note" && item.attachedTo?.frameId === componentId;
    if (linked || attached) doomed.add(item.id);
  }
  for (const id of doomed) ops.push({ id: newOpId(), op: "removeItem", itemId: id });
  ops.push({ id: newOpId(), frameId: componentId, op: "deleteFrame" });
  return ops;
}

/** Why an instance of `componentId` can't go into `frameId`, or undefined if it can. */
export function placementError(project: Project, frameId: string, componentId: string): string | undefined {
  return canPlaceInstance(sourcesOf(project), frameId, componentId) ? undefined : "A component can't contain itself.";
}

/** The binding field an element exposes by default, or undefined. */
export function defaultField(node: DesignNode): BindingField | undefined {
  switch (node.type) {
    case "text":
      return "text";
    case "image":
      return "src";
    case "icon":
      return "icon";
    case "link":
    case "button":
      return "target";
    case "input":
      return "placeholder";
    default:
      return "visible";
  }
}

/** Fields a node can expose, for the "Expose as property" menu. */
export function exposableFields(node: DesignNode): BindingField[] {
  const fields: BindingField[] = [];
  const own = defaultField(node);
  if (own && own !== "visible") fields.push(own);
  if (node.type === "link") fields.push("href");
  if (node.type === "input") fields.push("label");
  fields.push("visible");
  return fields;
}

export const FIELD_LABELS: Record<BindingField, string> = {
  text: "Text",
  visible: "Visible",
  src: "Image",
  icon: "Icon",
  target: "Opens screen",
  href: "URL",
  placeholder: "Placeholder",
  label: "Label",
};

/** The property bound to a node's field, if any. */
export function boundProp(def: ComponentDef, nodeId: string, field?: BindingField): ComponentProp | undefined {
  return def.props.find((p) => p.bindings?.some((b) => b.nodeId === nodeId && (field === undefined || b.field === field)));
}

export function updateDefOp(frameId: string, def: ComponentDef): Op {
  return { id: newOpId(), frameId, op: "updateFrame", patch: { component: def } };
}

/** Adds a property bound to `field` of `node`. */
export function exposeDef(def: ComponentDef, node: DesignNode, field: BindingField): ComponentDef {
  const taken = new Set(def.props.map((p) => p.name));
  const base = field === "visible" ? `show${node.name ? camelName(node.name).replace(/^./, (c) => c.toUpperCase()) : ""}` : node.name ? camelName(node.name) : field === "target" ? "opens" : field;
  const prop: ComponentProp = { name: uniqueProp(base || "prop", taken), type: field === "visible" ? "boolean" : "string", bindings: [{ nodeId: node.id, field }] };
  return { ...def, props: [...def.props, prop] };
}

/** Removes a binding (and the property, when it was its only binding). */
export function unexposeDef(def: ComponentDef, propName: string, nodeId: string): ComponentDef {
  const props = def.props.flatMap((p) => {
    if (p.name !== propName) return [p];
    const bindings = (p.bindings ?? []).filter((b) => b.nodeId !== nodeId);
    return bindings.length > 0 ? [{ ...p, bindings }] : [];
  });
  return { ...def, props };
}

/** Renames a property; instances' values and variant overrides keep working. */
export function renamePropOps(project: Project, componentId: string, from: string, to: string): Op[] {
  const frame = project.frames.find((f) => f.id === componentId);
  if (!frame?.component || from === to || frame.component.props.some((p) => p.name === to)) return [];
  const ops: Op[] = [updateDefOp(componentId, { ...frame.component, props: frame.component.props.map((p) => (p.name === from ? { ...p, name: to } : p)) })];
  for (const { frameId, node } of instancesOf(project.frames, componentId)) {
    if (node.props[from] === undefined) continue;
    ops.push({ id: newOpId(), frameId, op: "setProps", nodeId: node.id, props: { [from]: null, [to]: node.props[from]! } });
  }
  walk(frame.current, (node) => {
    for (const override of node.overrides ?? []) {
      if (override.when.prop?.name !== from) continue;
      // Move the override to the new condition: clear the old one, set the new one.
      const oldWhen = override.when;
      const newWhen = { ...oldWhen, prop: { name: to, value: oldWhen.prop!.value } };
      const base = { frameId: componentId, nodeId: node.id };
      const clear = <T extends object>(o: T | undefined) => (o ? Object.fromEntries(Object.keys(o).map((k) => [k, null])) : undefined);
      if (override.style) ops.push({ id: newOpId(), ...base, op: "restyle", style: clear(override.style)!, when: oldWhen }, { id: newOpId(), ...base, op: "restyle", style: override.style, when: newWhen });
      if (override.layout || override.box) {
        ops.push(
          { id: newOpId(), ...base, op: "relayout", ...(override.layout && { layout: clear(override.layout) }), ...(override.box && { box: clear(override.box) }), when: oldWhen },
          { id: newOpId(), ...base, op: "relayout", ...(override.layout && { layout: override.layout }), ...(override.box && { box: override.box }), when: newWhen },
        );
      }
      if (override.hidden !== undefined) {
        ops.push({ id: newOpId(), ...base, op: "setVisibility", hidden: null, when: oldWhen }, { id: newOpId(), ...base, op: "setVisibility", hidden: override.hidden, when: newWhen });
      }
    }
  });
  return ops;
}

/** Removes a property: its values on instances and its variant overrides go too. */
export function removePropOps(project: Project, componentId: string, name: string): Op[] {
  const frame = project.frames.find((f) => f.id === componentId);
  if (!frame?.component) return [];
  const ops: Op[] = [updateDefOp(componentId, { ...frame.component, props: frame.component.props.filter((p) => p.name !== name) })];
  for (const { frameId, node } of instancesOf(project.frames, componentId)) {
    if (node.props[name] !== undefined) ops.push({ id: newOpId(), frameId, op: "setProps", nodeId: node.id, props: { [name]: null } });
  }
  walk(frame.current, (node) => {
    for (const override of node.overrides ?? []) {
      if (override.when.prop?.name !== name) continue;
      const base = { id: "", frameId: componentId, nodeId: node.id, when: override.when };
      const clear = <T extends object>(o: T | undefined) => (o ? Object.fromEntries(Object.keys(o).map((k) => [k, null])) : undefined);
      if (override.style) ops.push({ ...base, id: newOpId(), op: "restyle", style: clear(override.style)! });
      if (override.layout || override.box) ops.push({ ...base, id: newOpId(), op: "relayout", ...(override.layout && { layout: clear(override.layout) }), ...(override.box && { box: clear(override.box) }) });
      if (override.hidden !== undefined) ops.push({ ...base, id: newOpId(), op: "setVisibility", hidden: null });
    }
  });
  return ops;
}

/** The variant (enum) properties of a component. */
export function variantProps(def: ComponentDef | undefined): ComponentProp[] {
  return def?.props.filter((p) => p.type === "enum") ?? [];
}

/**
 * Adds a `variant` property (options from `options`, first = default) and a board preview per
 * other option, stacked below the component's first placement.
 */
export function addVariantOps(project: Project, componentId: string, sizes: Sizes, options = ["primary", "secondary"]): AnyOp[] {
  const frame = project.frames.find((f) => f.id === componentId);
  if (!frame?.component) return [];
  const taken = new Set(frame.component.props.map((p) => p.name));
  const name = uniqueProp("variant", taken);
  const def: ComponentDef = { ...frame.component, props: [...frame.component.props, { name, type: "enum", options, default: options[0]! }] };
  return [updateDefOp(componentId, def), ...variantPreviewOps(project, componentId, name, options.slice(1), sizes)];
}

/** Board previews of a component for the given values of a variant property. */
export function variantPreviewOps(project: Project, componentId: string, propName: string, values: readonly string[], sizes: Sizes): AnyOp[] {
  const frames = framesById(project);
  const placements = project.board.items.filter((i): i is Extract<BoardItem, { type: "frame" }> => i.type === "frame" && i.frameId === componentId);
  const first = placements[0];
  if (!first) return [];
  const shown = new Set(placements.map((p) => String(p.props?.[propName] ?? "")));
  const bounds = unionRects(placements.map((p) => itemBounds(p, frames, sizes)).filter((r) => r !== undefined))!;
  let y = bounds.y + bounds.h + 48;
  const ops: AnyOp[] = [];
  for (const value of values) {
    if (shown.has(value)) continue;
    ops.push({ id: newOpId(), op: "addItem", item: { type: "frame", id: newItemId(), frameId: componentId, x: first.x, y: Math.round(y), props: { [propName]: value } } });
    y += (sizes[first.id]?.h ?? 60) + 48;
  }
  return ops;
}

/** Props an instance shows in the inspector, with current and default values. */
export function instanceProps(source: ComponentSource, instance: InstanceNode): { prop: ComponentProp; value: JsonValue | undefined; set: boolean }[] {
  return source.def.props.map((prop) => ({ prop, value: instance.props[prop.name], set: instance.props[prop.name] !== undefined }));
}

let draggedComponent: string | undefined;
/** The component being dragged from the library (drag events don't expose data while dragging). */
export function setDraggedComponent(id: string | undefined): void {
  draggedComponent = id;
}
export function getDraggedComponent(): string | undefined {
  return draggedComponent;
}
