import { type AnyOp, type DesignNode, type EffectStyle, type TextStyle, findNode, type InstanceNode, isContainer, parseTokenRef, type Project, type Style, type StylePatch, type TokenGroup, walk } from "@appshape/ir";
import { dispatch, notify, selectNode, useEditor } from "../store";
import { insertionContext } from "./actions";
import { assetUrl, uploadAsset } from "./api";
import { newOpId } from "./board";
import { detachedTree, placementError, sourcesOf } from "./components";
import { addBoardImages, imageFiles, insertImages, replaceImage } from "./images";
import { cloneWithNewIds, deleteOps, insertTarget, nodeContext } from "./nodes";
import { screenToWorld } from "./geometry";

/**
 * Copy and paste of elements, through the system clipboard: the HTML form carries the elements (with
 * the tokens they use, their components' content and, for other projects, their images) in a data
 * attribute; the text form is their texts. Pasting reads the browser's paste event, so no permission
 * prompt is needed.
 */
interface Payload {
  v: 1;
  /** The board it came from (`location.origin`): same origin, same project. */
  origin: string;
  /** Ids the elements had (pasting onto the copied element itself puts the copy after it). */
  sourceIds: string[];
  nodes: DesignNode[];
  /** Tokens the elements use, with their values. */
  tokens: { group: TokenGroup; name: string; value: string | number }[];
  /** Instance id → the instance as plain elements, for projects without that component. */
  detached: Record<string, DesignNode>;
  /** `asset:` path → data URL (for other projects). */
  assets: Record<string, string>;
  /** Named text and effect styles the elements use (added where the project lacks them). */
  styles?: { text: Record<string, TextStyle>; effect: Record<string, EffectStyle> };
}

const ATTRIBUTE = "data-appshape-clipboard";
let lastCopy: { text: string; payload: Payload } | undefined;
/** A copy still being written to the clipboard (Ctrl+V right after Ctrl+C waits for it). */
let pendingCopy: Promise<void> | undefined;
let copiedStyle: Style | undefined;

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const fromBase64 = (data: string) => new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function textsOf(nodes: DesignNode[]): string {
  const texts: string[] = [];
  for (const node of nodes) walk(node, (n) => void (n.type === "text" && n.text.trim() && texts.push(n.text.trim())));
  return texts.join("\n") || "AppShape elements";
}

/** Every string value in a tree, for token and asset references. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

async function dataUrl(src: string): Promise<string | undefined> {
  const token = useEditor.getState().token;
  if (!token) return undefined;
  const response = await fetch(assetUrl(token, src));
  if (!response.ok) return undefined;
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

async function buildPayload(project: Project, nodes: DesignNode[]): Promise<Payload> {
  // named styles the elements use come along, with the tokens they refer to
  const styles: NonNullable<Payload["styles"]> = { text: {}, effect: {} };
  for (const node of nodes) {
    walk(node, (n) => {
      const text = n.style?.textStyle && project.tokens.textStyles?.[n.style.textStyle];
      if (text) styles.text[n.style!.textStyle!] = text;
      const effect = n.style?.effectStyle && project.tokens.effectStyles?.[n.style.effectStyle];
      if (effect) styles.effect[n.style!.effectStyle!] = effect;
    });
  }
  const refs = strings([nodes, styles]);
  const tokens: Payload["tokens"] = [];
  for (const value of new Set(refs)) {
    const ref = parseTokenRef(value);
    const tokenValue = ref && project.tokens.groups[ref.group]?.[ref.name];
    if (ref && tokenValue !== undefined) tokens.push({ group: ref.group, name: ref.name, value: tokenValue });
  }
  const sources = sourcesOf(project);
  const detached: Payload["detached"] = {};
  for (const node of nodes) {
    walk(node, (n) => {
      const source = n.type === "instance" ? sources.get(n.componentId) : undefined;
      if (source) detached[n.id] = detachedTree(n as InstanceNode, source);
    });
  }
  const assets: Payload["assets"] = {};
  for (const src of new Set(strings([nodes, detached]).filter((s) => s.startsWith("asset:")))) {
    const data = await dataUrl(src).catch(() => undefined);
    if (data && data.length < 8_000_000) assets[src] = data;
  }
  return { v: 1, origin: location.origin, sourceIds: nodes.map((n) => n.id), nodes, tokens, detached, assets, styles };
}

/** Ctrl+C / Ctrl+X on a selected element. */
export function copySelection(cut = false): void {
  const { project, node } = useEditor.getState();
  if (!project || !node) return;
  const ctx = nodeContext(project, node);
  if (!ctx) return;
  if (cut && !ctx.parent) {
    notify("A screen's root can't be cut; copy it instead.");
    return;
  }
  const nodes = [structuredClone(ctx.node)];
  const text = textsOf(nodes);
  const payload = buildPayload(project, nodes);
  void payload.then((p) => (lastCopy = { text, payload: p }));
  const html = payload.then((p) => new Blob([`<meta charset="utf-8"><span ${ATTRIBUTE}="${toBase64(JSON.stringify(p))}">${escapeHtml(text)}</span>`], { type: "text/html" }));
  const written = navigator.clipboard?.write
    ? navigator.clipboard.write([new ClipboardItem({ "text/html": html, "text/plain": new Blob([text], { type: "text/plain" }) })]).catch(() => undefined)
    : Promise.resolve();
  const done = written.then(() => {
    if (cut && dispatch(deleteOps(ctx))) selectNode(ctx.parent ? { ...node, nodeId: ctx.parent.id } : undefined);
  });
  pendingCopy = done;
  void done.finally(() => {
    if (pendingCopy === done) pendingCopy = undefined;
  });
}

function readPayload(data: DataTransfer | null): Payload | undefined {
  const html = data?.getData("text/html") ?? "";
  const match = new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (match) {
    try {
      const payload = JSON.parse(fromBase64(match[1]!)) as Payload;
      if (payload.v === 1 && Array.isArray(payload.nodes)) return payload;
    } catch {
      // not ours after all
    }
  }
  // the clipboard couldn't take the HTML (older browsers): this tab's last copy, if the clipboard still holds it
  const text = data?.getData("text/plain");
  return lastCopy && text === lastCopy.text ? lastCopy.payload : undefined;
}

/** The paste event: our elements, else image files. Returns true when handled. */
export function handlePaste(e: ClipboardEvent): boolean {
  if (pendingCopy) {
    // the clipboard doesn't hold the copy yet: paste it once it's done
    e.preventDefault();
    void pendingCopy.then(() => lastCopy && pasteElements(lastCopy.payload));
    return true;
  }
  const payload = readPayload(e.clipboardData);
  if (payload) {
    e.preventDefault();
    void pasteElements(payload);
    return true;
  }
  const files = imageFiles(e.clipboardData?.files);
  if (files.length > 0) {
    e.preventDefault();
    void pasteImages(files);
    return true;
  }
  return false;
}

async function pasteElements(payload: Payload): Promise<void> {
  const { project, node } = useEditor.getState();
  const target = insertionContext();
  if (!project || !target?.ctx) {
    notify("Select a screen or an element to paste into.");
    return;
  }
  const { ctx, itemId } = target;
  // onto the copied element itself (or anything that holds no children): after it; into containers: at the end
  const into = node && payload.sourceIds.includes(ctx.node.id) && ctx.parent ? { parentId: ctx.parent.id, index: ctx.index + 1 } : insertTarget(ctx);
  if (!into) return;

  const ops: AnyOp[] = [];
  for (const t of payload.tokens) {
    if (project.tokens.groups[t.group]?.[t.name] === undefined) ops.push({ id: newOpId(), op: "setToken", group: t.group, name: t.name, value: t.value });
  }
  for (const [style, value] of Object.entries(payload.styles?.text ?? {})) if (!project.tokens.textStyles?.[style]) ops.push({ id: newOpId(), op: "setTextStyle", style, value });
  for (const [style, value] of Object.entries(payload.styles?.effect ?? {})) if (!project.tokens.effectStyles?.[style]) ops.push({ id: newOpId(), op: "setEffectStyle", style, value });
  // components this project doesn't have arrive as plain elements
  const sources = sourcesOf(project);
  let detachedCount = 0;
  const resolve = (n: DesignNode): DesignNode => {
    if (n.type === "instance" && !sources.has(n.componentId) && payload.detached[n.id]) {
      detachedCount++;
      return resolve(payload.detached[n.id]!);
    }
    return isContainer(n) ? { ...n, children: n.children.map(resolve) } : n;
  };
  let nodes = payload.nodes.map(resolve);
  for (const n of nodes) {
    let blocked: string | undefined;
    walk(n, (inner) => void (inner.type === "instance" && (blocked ??= placementError(project, ctx.frame.id, inner.componentId))));
    if (blocked) {
      notify(blocked);
      return;
    }
  }
  // images from another project are stored in this one
  if (payload.origin !== location.origin && Object.keys(payload.assets).length > 0) {
    const token = useEditor.getState().token!;
    const moved = new Map<string, string>();
    for (const [src, data] of Object.entries(payload.assets)) {
      try {
        const blob = await (await fetch(data)).blob();
        moved.set(src, await uploadAsset(token, blob, src.split("/").pop()!));
      } catch {
        // keep the old reference; it shows as a missing image
      }
    }
    nodes = JSON.parse(JSON.stringify(nodes), (_, v: unknown) => (typeof v === "string" && moved.has(v) ? moved.get(v) : v)) as DesignNode[];
  }

  const copies = nodes.map(cloneWithNewIds);
  copies.forEach((copy, i) => ops.push({ id: newOpId(), frameId: ctx.frame.id, op: "insert", parentId: into.parentId, index: into.index + i, node: copy }));
  if (dispatch(ops)) {
    selectNode({ itemId, frameId: ctx.frame.id, nodeId: copies[0]!.id });
    if (detachedCount > 0) notify(`${detachedCount === 1 ? "A component" : `${detachedCount} components`} from the other project ${detachedCount === 1 ? "was" : "were"} pasted as plain elements.`);
  }
}

async function pasteImages(files: File[]): Promise<void> {
  const { project, node, camera } = useEditor.getState();
  if (!project) return;
  const target = insertionContext();
  if (target?.ctx) {
    if (node && target.ctx.node.type === "image" && files.length === 1) {
      await replaceImage(files[0]!, node.frameId, node.nodeId);
      return;
    }
    const into = insertTarget(target.ctx);
    if (into) await insertImages(files, { itemId: target.itemId, frameId: target.ctx.frame.id, ...into });
    return;
  }
  // nothing selected: onto the board, in the middle of the view
  const canvas = document.querySelector('[data-testid="canvas"]')?.getBoundingClientRect();
  await addBoardImages(files, screenToWorld(camera, { x: (canvas?.width ?? 800) / 2, y: (canvas?.height ?? 600) / 2 }));
}

/** Ctrl+Alt+C: remembers the selected element's look. */
export function copyStyle(): void {
  const { project, node } = useEditor.getState();
  const found = project && node ? findNode(project.frames.find((f) => f.id === node.frameId)!.current, node.nodeId)?.node : undefined;
  if (!found) return;
  copiedStyle = structuredClone(found.style ?? {});
  notify("Style copied: Ctrl+Alt+V gives another element the same look.");
}

/** Ctrl+Alt+V: the copied look replaces the selected element's (its layout and size stay). */
export function pasteStyle(): void {
  const { project, node } = useEditor.getState();
  if (!copiedStyle) {
    notify("Copy a style first (Ctrl+Alt+C on an element).");
    return;
  }
  const found = project && node ? findNode(project.frames.find((f) => f.id === node.frameId)!.current, node.nodeId)?.node : undefined;
  if (!found || !node) return;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(found.style ?? {})) patch[key] = null;
  Object.assign(patch, structuredClone(copiedStyle));
  dispatch([{ id: newOpId(), frameId: node.frameId, nodeId: node.nodeId, op: "restyle", style: patch as StylePatch }]);
}
