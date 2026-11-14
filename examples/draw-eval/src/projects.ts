import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { createId, DEFAULT_REDACTION, type DesignNode, type Frame, IR_VERSION, type Project } from "@appshape/ir";
import { buildPage, overlayFrame, PAGE_TEMPLATES, type SectionContext, starterComponentFrame, withTheme } from "@appshape/kit";
import { ProjectFiles } from "@appshape/store";
import { landingProject } from "../../codegen-demo/src/landing";

/**
 * The projects the evaluation draws on: the demo landing page, pages of the library (with its
 * starter components), and an imported fixture app. Generated ones get new ids on every run, so
 * cases find their elements by name or text.
 */

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));

export interface EvalProject {
  project: Project;
  /** Where the screen's app lives and its AppShape data (styles, assets); empty for generated ones. */
  appRoot: string;
  dataDir: string;
}

/**
 * Runs `make` with ids from a seeded generator, so a generated project has the same ids on every
 * run (proposals of earlier runs can be scored again, and runs compared element by element).
 */
export async function seeded<T>(seed: number, make: () => T | Promise<T>): Promise<T> {
  const crypto = globalThis.crypto;
  let state = seed >>> 0;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    value: <A extends ArrayBufferView | null>(array: A): A => {
      if (array instanceof Uint8Array) for (let i = 0; i < array.length; i++) array[i] = Math.floor(next() * 256);
      return array;
    },
  });
  try {
    return await make();
  } finally {
    delete (crypto as { getRandomValues?: unknown }).getRandomValues;
  }
}

export async function landing(empty: string): Promise<EvalProject> {
  const tokens = await defaultTokens();
  return { project: await seeded(1, () => landingProject(tokens)), appRoot: empty, dataDir: empty };
}

/** Breakpoints up to a desktop (1280px): their overrides fold into the base. */
const DESKTOP_BREAKPOINTS = ["sm", "md", "lg", "xl"];

/** A node as designed for desktops only: its size overrides folded into the base, so phones get the desktop look. */
function desktopOnly(node: DesignNode): DesignNode {
  const next = { ...node } as DesignNode & { children?: DesignNode[] };
  const overrides = node.overrides ?? [];
  const sizeOnly = (o: (typeof overrides)[number]) => o.when.viewport !== undefined && !o.when.state && !o.when.scheme && !o.when.prop;
  for (const bp of DESKTOP_BREAKPOINTS) {
    for (const o of overrides.filter((o) => sizeOnly(o) && o.when.viewport === bp)) {
      if (o.layout) next.layout = { ...next.layout, ...o.layout } as typeof next.layout;
      if (o.box) next.box = { ...next.box, ...o.box } as typeof next.box;
      if (o.style) next.style = { ...next.style, ...o.style } as typeof next.style;
      if (o.hidden !== undefined) next.hidden = o.hidden;
    }
  }
  if (next.hidden === false) delete next.hidden;
  const rest = overrides.filter((o) => !sizeOnly(o));
  if (rest.length) next.overrides = rest;
  else delete next.overrides;
  if ("children" in node && Array.isArray(node.children)) next.children = (node.children as DesignNode[]).map(desktopOnly);
  return next;
}

/** The landing page's Home as if it had been designed for desktops only: broken on phones (for "make it work on phones"). */
export async function desktopLanding(empty: string): Promise<EvalProject> {
  const source = await landing(empty);
  const frames = source.project.frames.map((f) => (f.name === "Home" ? { ...f, current: desktopOnly(f.current) } : f));
  return { ...source, project: { ...source.project, frames } };
}

/** Library pages as screens (with the starter components and overlays they use). */
export async function library(empty: string, keys: string[]): Promise<EvalProject> {
  const tokens = withTheme(await defaultTokens());
  return seeded(2, () => libraryProject(empty, keys, tokens));
}

function libraryProject(empty: string, keys: string[], tokens: Project["tokens"]): EvalProject {
  const starters = new Map<string, Frame>();
  const overlays = new Map<string, Frame>();
  const ctx: SectionContext = {
    tint: "#4f46e5",
    use: (key, props = {}, fill = []) => {
      let frame = starters.get(key);
      if (!frame) starters.set(key, (frame = starterComponentFrame(key, { adapter: "react-vite" })));
      return { id: createId("n"), type: "instance", origin: "added", componentId: frame.id, props, children: fill };
    },
    overlay: (key) => {
      let frame = overlays.get(key);
      if (!frame) overlays.set(key, (frame = overlayFrame(key, ctx, { adapter: "react-vite" })));
      return frame.id;
    },
  };
  const screens = PAGE_TEMPLATES.filter((t) => keys.includes(t.key)).map(
    (t): Frame => ({ id: createId("f"), name: t.name, kind: "new", platform: "web", target: { adapter: "react-vite", route: `/${t.key}` }, viewports: [{ id: "desktop", width: 1280 }, { id: "mobile", width: 390 }], current: buildPage(t, ctx) }),
  );
  const project: Project = { irVersion: IR_VERSION, name: "Library", adapters: [], tokens, components: [], board: { items: [] }, frames: [...screens, ...overlays.values(), ...starters.values()], changesets: [], redaction: DEFAULT_REDACTION };
  return { project, appRoot: empty, dataDir: empty };
}

/** The imported fixture app (read only: its `.appshape` is never written). */
export async function fixtureApp(): Promise<EvalProject> {
  const appRoot = `${REPO}fixtures/vite-react-router-tw4`;
  const dataDir = `${appRoot}/.appshape`;
  const { project } = await new ProjectFiles({ appRoot, dataDir, mode: "in-repo" }).load();
  return { project, appRoot, dataDir };
}
