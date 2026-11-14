import { clone, isPlainObject } from "./deep";
import { CONTAINER_TYPES, type ContainerNode, type DesignNode } from "./node";
import { conditionKey, type Override } from "./style";

const containerTypes: ReadonlySet<string> = new Set(CONTAINER_TYPES);

export function isContainer(node: DesignNode): node is ContainerNode {
  return containerTypes.has(node.type);
}

export interface NodeLocation {
  node: DesignNode;
  parent: ContainerNode | undefined;
  index: number;
}

/** Pre-order walk. Return `"skip"` from the visitor to skip a node's children. */
export function walk(
  root: DesignNode,
  visit: (node: DesignNode, parent: ContainerNode | undefined, index: number) => void | "skip",
): void {
  const visitNode = (node: DesignNode, parent: ContainerNode | undefined, index: number) => {
    if (visit(node, parent, index) === "skip") return;
    if (isContainer(node)) node.children.forEach((child, i) => visitNode(child, node, i));
  };
  visitNode(root, undefined, 0);
}

export function indexTree(root: DesignNode): Map<string, NodeLocation> {
  const index = new Map<string, NodeLocation>();
  walk(root, (node, parent, i) => {
    index.set(node.id, { node, parent, index: i });
  });
  return index;
}

export function collectIds(root: DesignNode): string[] {
  const ids: string[] = [];
  walk(root, (node) => {
    ids.push(node.id);
  });
  return ids;
}

export function findNode(root: DesignNode, id: string): NodeLocation | undefined {
  let found: NodeLocation | undefined;
  walk(root, (node, parent, index) => {
    if (found) return "skip";
    if (node.id === id) {
      found = { node, parent, index };
      return "skip";
    }
  });
  return found;
}

export function containsId(root: DesignNode, id: string): boolean {
  return findNode(root, id) !== undefined;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.values(value).every((v) => v === undefined);
  return false;
}

function normalizeOverride(override: Override): Override | undefined {
  const result: Override = { when: override.when };
  if (!isEmpty(override.layout)) result.layout = override.layout;
  if (!isEmpty(override.box)) result.box = override.box;
  if (!isEmpty(override.style)) result.style = override.style;
  if (override.hidden !== undefined) result.hidden = override.hidden;
  return Object.keys(result).length > 1 ? result : undefined;
}

/**
 * Canonical form used for comparisons: drops empty objects/arrays and `hidden: false`,
 * and sorts overrides by condition.
 */
export function normalizeNode(node: DesignNode): DesignNode {
  const result = clone(node) as unknown as Record<string, unknown>;
  for (const key of ["layout", "box", "style", "annotations", "spans"]) {
    if (isEmpty(result[key])) delete result[key];
  }
  if (result.hidden === false) delete result.hidden;
  if (node.overrides) {
    const overrides = node.overrides
      .map(normalizeOverride)
      .filter((o): o is Override => o !== undefined)
      .sort((a, b) => conditionKey(a.when).localeCompare(conditionKey(b.when)));
    if (overrides.length > 0) result.overrides = overrides;
    else delete result.overrides;
  }
  if (isContainer(node)) result.children = node.children.map(normalizeNode);
  return result as unknown as DesignNode;
}
