import { type AnyOp, type Frame, type Project, resolveToken } from "@appshape/ir";
import { missingThemeOps, parseColor, rgbToOklch, starterComponent, starterComponentFrame, toHex } from "@appshape/kit";
import { dispatch, notify, selectNode, useEditor } from "../store";
import { insertionContext } from "./actions";
import { newItemId, newOpId } from "./board";
import { componentSpot, newInstance } from "./components";
import type { Sizes } from "./geometry";
import { insertOps } from "./nodes";

/** The project's own copy of a starter component, if it has one. */
export function starterIn(project: Project, key: string): Frame | undefined {
  return project.frames.find((f) => f.kind === "component" && f.component?.kit === key);
}

/** The project's brand color as hex (for drawn placeholder pictures). */
export function projectTint(project: Project): string {
  const value = resolveToken(project.tokens, "$color.primary");
  const color = typeof value === "string" ? parseColor(value) : undefined;
  return color ? toHex(rgbToOklch(color)) : "#71717a";
}

/**
 * Ops that give the project a starter component (once): the theme tokens it needs, the component,
 * its placement next to the other components, and previews of its variants beside it.
 */
export function ensureStarterOps(project: Project, key: string, sizes: Sizes, at?: { x: number; y: number }): { ops: AnyOp[]; componentId: string } {
  const existing = starterIn(project, key);
  if (existing) return { ops: [], componentId: existing.id };
  const starter = starterComponent(key)!;
  const taken = new Set(project.frames.map((f) => f.name));
  let name = starter.name;
  for (let i = 2; taken.has(name); i++) name = `${starter.name} ${i}`;
  const frame = starterComponentFrame(key, { adapter: project.adapters[0]?.id ?? "react-vite", name, tint: projectTint(project) });
  const spot = at ?? componentSpot(project, sizes);
  const ops: AnyOp[] = [...missingThemeOps(project.tokens), { id: newOpId(), frameId: frame.id, op: "createFrame", frame }];
  ops.push({ id: newOpId(), op: "addItem", item: { type: "frame", id: newItemId(), frameId: frame.id, x: spot.x, y: spot.y } });
  starter.previews?.values.forEach((value, i) => {
    const x = spot.x + (starter.width + 48) * (i + 1);
    ops.push({ id: newOpId(), op: "addItem", item: { type: "frame", id: newItemId(), frameId: frame.id, x, y: spot.y, props: { [starter.previews!.prop]: value === "true" ? true : value } } });
  });
  return { ops, componentId: frame.id };
}

/** Inserts a starter component into the selection, adding it to the project first if needed. */
export function insertStarter(key: string): void {
  const { project, sizes } = useEditor.getState();
  const target = insertionContext();
  if (!project || !target?.ctx) {
    notify("Select a screen or an element to insert into.");
    return;
  }
  const { ops, componentId } = ensureStarterOps(project, key, sizes);
  const instance = newInstance(componentId);
  const isNew = ops.length > 0;
  if (dispatch([...ops, ...insertOps(target.ctx, instance)])) {
    selectNode({ itemId: target.itemId, frameId: target.ctx.frame.id, nodeId: instance.id });
    if (isNew) notify(`Added the ${starterComponent(key)!.name} component to your project. Change it once on the board and every use follows.`);
  }
}
