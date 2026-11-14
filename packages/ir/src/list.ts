import { clone } from "./deep";
import type { JsonValue } from "./json";
import type { DesignNode } from "./node";
import { walk } from "./tree";

/**
 * Repeated content: a list's first child is the design of one item; its nodes bind fields to the
 * item's keys (`bind`). The board shows it once per item, the code maps over a data file.
 */

/** The list's item design and items, when it repeats one design over data. */
export function repeatedItems(node: DesignNode): { template: DesignNode; items: Record<string, JsonValue>[] } | undefined {
  if (node.type !== "list" || !node.items || !node.children[0]) return undefined;
  return { template: node.children[0], items: node.items };
}

/** A copy of the item design with an item's values in its bound fields. */
export function fillItem(template: DesignNode, item: Record<string, JsonValue> | undefined): DesignNode {
  const copy = clone(template);
  if (!item) return copy;
  walk(copy, (node) => {
    for (const [field, key] of Object.entries(node.bind ?? {})) {
      const value = item[key];
      if (value === undefined || value === null) continue;
      const text = typeof value === "string" ? value : String(value);
      if (field === "text" && node.type === "text") {
        node.text = text;
        delete node.spans;
      } else if (field === "src" && node.type === "image") node.src = text;
      else if (field === "alt" && node.type === "image") node.alt = text;
      else if (field === "href" && node.type === "link") node.href = text;
      else if (field === "icon" && node.type === "icon") node.icon = text;
      else if (field.startsWith("props.") && node.type === "instance") node.props = { ...node.props, [field.slice(6)]: value };
    }
  });
  return copy;
}

/** Keys the item design uses, in order of appearance. */
export function boundKeys(template: DesignNode): string[] {
  const keys: string[] = [];
  walk(template, (node) => {
    for (const key of Object.values(node.bind ?? {})) if (!keys.includes(key)) keys.push(key);
  });
  return keys;
}
