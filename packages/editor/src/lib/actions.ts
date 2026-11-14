import { dispatch, notify, selectedNodes, selectNode, useEditor } from "../store";
import { componentSpot, deleteComponentOps, detachOps, makeComponentOps, newInstance, placementError } from "./components";
import { frameHandle } from "./frames";
import { forCopies } from "./linked";
import { deleteOps, insertOps, nodeContext } from "./nodes";
import { fitCamera } from "./view";

/** Editor actions on components (used by the inspector, shortcuts and the library). */

/** Turns the selected element into a component. */
export function makeComponent(): void {
  const { project, node, camera, sizes } = useEditor.getState();
  const ctx = project && node && nodeContext(project, node);
  if (!project || !node || !ctx) return;
  const rect = frameHandle(node.itemId)?.nodeRect(node.nodeId);
  const made = makeComponentOps(project, ctx, rect ? rect.w / camera.zoom : 240, componentSpot(project, sizes));
  if ("error" in made) {
    notify(made.error);
    return;
  }
  if (dispatch(made.ops)) {
    selectNode({ ...node, nodeId: made.instanceId });
    notify(`Created component ${made.name}. Edit it on the board; every instance follows.`);
  }
}

/** Replaces the selected instance by plain elements. */
export function detachInstance(): void {
  const { project, node } = useEditor.getState();
  if (!project || !node) return;
  const { ops, newId } = detachOps(project, node.frameId, node.nodeId);
  if (dispatch(ops) && newId) selectNode({ ...node, nodeId: newId });
}

/** Shows a component's main definition and selects its root. */
export function editComponent(componentId: string): void {
  const { project } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === componentId);
  const placement = project?.board.items.find((i) => i.type === "frame" && i.frameId === componentId);
  if (!frame || !placement) {
    notify("This component is not placed on the board.");
    return;
  }
  const camera = fitCamera([placement]);
  if (camera) useEditor.setState({ camera: { ...camera, zoom: Math.min(camera.zoom, 1) } });
  selectNode({ itemId: placement.id, frameId: frame.id, nodeId: frame.current.id });
}

/** Where new elements go: the selected element, or a selected screen's root. */
export function insertionContext() {
  const { project, node, selection } = useEditor.getState();
  if (!project) return undefined;
  if (node) return { ctx: nodeContext(project, node), itemId: node.itemId };
  const placement = selection.length === 1 ? project.board.items.find((i) => i.id === selection[0]) : undefined;
  if (placement?.type !== "frame") return undefined;
  const frame = project.frames.find((f) => f.id === placement.frameId);
  return frame ? { ctx: nodeContext(project, { frameId: frame.id, nodeId: frame.current.id }), itemId: placement.id } : undefined;
}

/** Inserts an instance of a component into the selection. */
export function insertComponent(componentId: string): void {
  const target = insertionContext();
  const project = useEditor.getState().project;
  if (!target?.ctx || !project) {
    notify("Select a screen or an element to insert into.");
    return;
  }
  const error = placementError(project, target.ctx.frame.id, componentId);
  if (error) {
    notify(error);
    return;
  }
  const instance = newInstance(componentId);
  if (dispatch(insertOps(target.ctx, instance))) selectNode({ itemId: target.itemId, frameId: target.ctx.frame.id, nodeId: instance.id });
}

/** Deletes a component; its instances become plain elements (undoable). */
export function deleteComponent(componentId: string): void {
  const { project } = useEditor.getState();
  const frame = project?.frames.find((f) => f.id === componentId);
  if (!project || !frame) return;
  if (!window.confirm(`Delete the component "${frame.name}"? Its instances become plain elements. (Undo with Ctrl+Z)`)) return;
  if (dispatch(deleteComponentOps(project, componentId))) useEditor.setState({ node: undefined, selection: [] });
}

/** Deletes every selected element (a screen's root stays); one undo step. */
export function deleteSelected(): void {
  const state = useEditor.getState();
  const project = state.project;
  if (!project) return;
  const seen = new Set<string>();
  const ops = selectedNodes(state).flatMap((sel) => {
    const key = `${sel.frameId}/${sel.nodeId}`;
    const ctx = nodeContext(project, sel);
    if (seen.has(key) || !ctx?.parent) return [];
    seen.add(key);
    return deleteOps(ctx);
  });
  if (ops.length > 0 && dispatch(forCopies(project, ops, state.codeScope))) useEditor.setState({ node: undefined, extraNodes: [] });
}
