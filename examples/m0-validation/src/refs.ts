import { type DesignNode, findNode, indexTree } from "@appshape/ir";
import type { NodeRef } from "@appshape/protocol";
import { components } from "./pricing";

/** Builds a spec NodeRef from the IR, the way the spec compiler (M4) will. */
export function nodeRef(root: DesignNode, id: string, name?: string): NodeRef {
  const loc = findNode(root, id);
  if (!loc) throw new Error(`unknown node ${id}`);
  const { node } = loc;
  const index = indexTree(root);
  const path: string[] = [];
  for (let parent = index.get(id)?.parent; parent; parent = index.get(parent.id)?.parent) {
    if (parent.name) path.unshift(parent.name);
  }
  const element =
    node.type === "instance"
      ? components.find((c) => c.id === node.componentId)?.name
      : node.platformRaw?.tag;
  return {
    id,
    name: name ?? node.name ?? id,
    ...(path.length > 0 && { path: path.join(" › ") }),
    ...(element && { element }),
    ...(node.source && { source: node.source }),
  };
}
