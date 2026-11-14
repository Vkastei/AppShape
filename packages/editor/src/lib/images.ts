import { createId, type DesignNode, findNode } from "@appshape/ir";
import { IMAGE_EXTENSIONS } from "@appshape/protocol";
import { dispatch, notify, selectNode, useEditor } from "../store";
import { assetUrl, uploadAsset } from "./api";
import { newItemId, newOpId } from "./board";

/** Image files among dropped or pasted files (by type, or by extension when the type is missing). */
export function imageFiles(files: FileList | readonly File[] | null | undefined): File[] {
  return [...(files ?? [])].filter((f) => f.type.startsWith("image/") || (IMAGE_EXTENSIONS as readonly string[]).includes(f.name.split(".").pop()?.toLowerCase() ?? ""));
}

/** Opens the system file dialog for one image. */
export function chooseImageFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((e) => `.${e}`).join(",");
    input.onchange = () => resolve(imageFiles(input.files)[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export interface AddedImage {
  src: string;
  width: number;
  height: number;
  /** A starting alt text from the file name ("team-photo.jpg" → "Team photo"). */
  alt: string;
}

/** Stores the file in the project and measures it. */
export async function addImageFile(file: File): Promise<AddedImage> {
  const token = useEditor.getState().token!;
  const name = file.name || `pasted.${file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`;
  const src = await uploadAsset(token, file, name);
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = assetUrl(token, src);
  });
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const alt = /^(pasted|image|img|screenshot|untitled)\b/i.test(base) ? "" : base.charAt(0).toUpperCase() + base.slice(1);
  return { src, width, height, alt };
}

/** An image element: full width with the picture's proportions; small pictures (logos) keep their size. */
export function imageNode(image: AddedImage): DesignNode {
  const small = image.width < 320;
  return {
    id: createId("n"),
    type: "image",
    origin: "added",
    src: image.src,
    alt: image.alt,
    fit: "cover",
    box: small ? { width: { mode: "fixed", value: image.width }, height: { mode: "fixed", value: image.height } } : { width: { mode: "fill" }, aspectRatio: `${image.width} / ${image.height}` },
  };
}

const failed = (e: unknown) => notify(`Couldn't add the image: ${(e as Error).message}`, "error");

/** Inserts image files into a screen at a position (a drop, or after the selection). */
export async function insertImages(files: File[], at: { itemId: string; frameId: string; parentId: string; index: number }): Promise<void> {
  try {
    let index = at.index;
    let last: string | undefined;
    for (const file of files) {
      const node = imageNode(await addImageFile(file));
      if (dispatch([{ id: newOpId(), frameId: at.frameId, op: "insert", parentId: at.parentId, index: index++, node }])) last = node.id;
    }
    if (last) selectNode({ itemId: at.itemId, frameId: at.frameId, nodeId: last });
  } catch (e) {
    failed(e);
  }
}

/** Replaces the picture of an image element. */
export async function replaceImage(file: File, frameId: string, nodeId: string): Promise<void> {
  try {
    const image = await addImageFile(file);
    const project = useEditor.getState().project;
    const node = project && findNode(project.frames.find((f) => f.id === frameId)!.current, nodeId)?.node;
    const keepAlt = node?.type === "image" && node.alt;
    dispatch([{ id: newOpId(), frameId, nodeId, op: "replaceImage", src: image.src, ...(!keepAlt && image.alt && { alt: image.alt }) }]);
  } catch (e) {
    failed(e);
  }
}

/** Puts image files on the board (references, mood boards), side by side from a point. */
export async function addBoardImages(files: File[], world: { x: number; y: number }): Promise<void> {
  try {
    let x = world.x;
    const ids: string[] = [];
    for (const file of files) {
      const image = await addImageFile(file);
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const w = Math.round(image.width * scale);
      const h = Math.round(image.height * scale);
      const id = newItemId();
      if (dispatch([{ id: newOpId(), op: "addItem", item: { type: "image", id, x: Math.round(x), y: Math.round(world.y), w, h, src: image.src } }])) ids.push(id);
      x += w + 24;
    }
    if (ids.length) useEditor.setState({ selection: ids, node: undefined });
  } catch (e) {
    failed(e);
  }
}
