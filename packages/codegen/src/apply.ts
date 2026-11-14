import { type Annotation, componentSources, type DesignNode, type DesignRequest, describeMarkup, type Frame, isContainer, type Project, type Tokens, walk } from "@appshape/ir";
import type { InstalledFont } from "@appshape/store";
import { generateApp, type GeneratedFile } from "./generate";
import { diffImported, planImported } from "./imported";
import { codeHash } from "./names";
import { describeNode } from "./proposal";
import { columnOf, importLines, type JsxElementInfo, jsxElements, lineOf, parsesCleanly, reindent } from "./source";
import { type AppLayout, STACKS, UTILS_MODULE } from "./stacks";
import type { CodeState, FileState, NodeState } from "./state";
import { darkDeclarations, tailwind3Extend, THEME_START, themeBlock, themeBlockRange, themeDeclarations } from "./theme";

/**
 * Plans how the current design reaches the code: direct file changes (shown as a diff before
 * anything is written) and agent tasks for what can't be applied safely.
 */

export interface AppFiles {
  read(path: string): Promise<string | undefined>;
  /** The app's source files (relative paths), for finding where data lives. */
  list?(): Promise<string[]>;
}

export interface PlanInput {
  project: Project;
  layout: AppLayout;
  defaults: Tokens;
  /** What was generated last time (undefined before the first apply). */
  state: CodeState | undefined;
  files: AppFiles;
  /** No app in the folder yet: create one with this name. */
  scaffold?: { appName: string };
  now?: string;
  /** Fonts installed in the project (`.appshape/assets/fonts`). */
  fonts?: readonly InstalledFont[];
}

export interface FileChange {
  path: string;
  before: string | undefined;
  /** undefined = delete the file. For a copied file (`copyFrom`), a stand-in naming the source. */
  after: string | undefined;
  summary: string;
  /** A binary file copied from this path inside the data folder (images, fonts). */
  copyFrom?: string;
}

export type TaskKind = "page" | "component" | "element" | "routes" | "theme" | "note" | "screen" | "setup";

export interface AgentTask {
  /** Stable key: a task isn't handed off twice while the design stays the same. */
  key: string;
  kind: TaskKind;
  /** What to do, imperative. */
  summary: string;
  file?: string;
  line?: number;
  frameId?: string;
  nodeId?: string;
  /** What AppShape would generate here now (the target to merge with the existing code). */
  code?: string;
  /** More about the task in plain words. */
  details?: string;
  note?: Annotation;
  /** A design request kept as a note (Draw & describe): the drawing goes with the task as a picture. */
  request?: DesignRequest;
  /** The elements the drawing touches (they will look different from the design afterwards). */
  drawn?: string[];
}

export interface ApplyPlan {
  changes: FileChange[];
  tasks: AgentTask[];
  /** The code state after the changes are written. */
  state: CodeState;
  warnings: string[];
  /** Screens whose code changes or that have tasks (what to verify afterwards). */
  frameIds: string[];
  /** Dependencies to install after writing (package.json changed). */
  install: boolean;
}

const REQUIRED_DEPS: Record<string, string> = {
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  "lucide-react": "^1.52.0",
  "tailwind-merge": "^3.7.0",
};

export async function planApply(input: PlanInput): Promise<ApplyPlan> {
  const { project, layout, defaults, files } = input;
  const stack = STACKS[layout.stack];
  const prev = input.state?.layout.stack === layout.stack ? input.state : undefined;
  // Imported pages are edited in place; new elements on them are generated as snippets.
  const importedDiff = diffImported(project, input.state?.imported);
  const generated = generateApp({ project, layout, defaults, snippets: importedDiff.snippets, ...(input.fonts && { fonts: input.fonts }) });
  const warnings = [...generated.warnings];
  const changes: FileChange[] = [];
  const tasks: AgentTask[] = [];
  const nextFiles: Record<string, FileState> = {};
  const handedOff = new Set(prev?.handedOff ?? []);
  let install = false;

  const frames = new Map(project.frames.map((f) => [f.id, f]));
  const write = (path: string, before: string | undefined, after: string | undefined, summary: string, copyFrom?: string) => {
    if (before !== after) changes.push({ path, before, after, summary, ...(copyFrom && { copyFrom }) });
  };
  const task = (t: AgentTask) => tasks.push(t);

  // ---- New app
  if (input.scaffold) {
    for (const [path, content] of Object.entries(stack.scaffold(input.scaffold.appName, layout))) {
      if (generated.files.has(path)) continue;
      const existing = await files.read(path);
      if (existing === undefined) write(path, undefined, content, "New app");
      else warnings.push(`${path} already exists and was kept`);
    }
    install = true;
  }

  // ---- Generated files
  for (const file of generated.files.values()) {
    const disk = await files.read(file.path);
    const before = prev?.files[file.path];
    switch (file.kind) {
      case "asset":
        if (disk === undefined) write(file.path, undefined, file.content, file.copyFrom?.startsWith("assets/fonts/") ? "Font from the design" : "Image from the design", file.copyFrom);
        nextFiles[file.path] = { kind: "asset", hash: codeHash(file.content) };
        continue;
      case "css":
        await applyCss(file, disk, before);
        continue;
      case "routes":
        applyRoutes(file, disk, before);
        continue;
      case "utils":
        // a file AppShape owns (ScrollReveal, a list's data): written when missing, updated while untouched
        nextFiles[file.path] = { kind: "utils", hash: codeHash(file.content) };
        if (disk === undefined) write(file.path, undefined, file.content, file.summary ?? "Helper");
        else if (before && codeHash(disk) === before.hash) write(file.path, disk, file.content, file.summary ?? "Helper");
        else if (codeHash(disk) !== codeHash(file.content)) {
          task({ key: `utils:${file.path}:${codeHash(file.content)}`, kind: "setup", summary: `${file.path} isn't AppShape's (or was changed); update it like the code below (${(file.summary ?? "helper").toLowerCase()}).`, file: file.path, code: file.content });
          delete nextFiles[file.path]; // not ours: never overwritten
        }
        continue;
      default:
        break;
    }
    const frame = file.frameId ? frames.get(file.frameId) : undefined;
    const what = file.kind === "component" ? `component ${frame?.name}` : `page ${frame?.name}`;
    nextFiles[file.path] = fileState(file, frame);
    if (disk === undefined) {
      if (before) {
        task({ key: `missing:${file.path}:${codeHash(file.content)}`, kind: file.kind === "component" ? "component" : "page", summary: `${file.path} was generated before but is gone. Recreate the ${what} (or tell AppShape where it moved).`, file: file.path, frameId: file.frameId, code: file.content });
      } else {
        write(file.path, undefined, file.content, `New ${what}`);
      }
    } else if (!before) {
      task({ key: `exists:${file.path}:${codeHash(file.content)}`, kind: file.kind === "component" ? "component" : "page", summary: `${file.path} already exists and wasn't written by AppShape. Implement the ${what} there (or merge it), following the generated code.`, file: file.path, frameId: file.frameId, code: file.content });
    } else if (codeHash(disk) === before.hash) {
      write(file.path, disk, file.content, `Update ${what}`);
    } else {
      applyTargeted(file, disk, before, frame, what);
    }
  }

  // ---- Files no longer generated (screen or component deleted or renamed)
  for (const [path, before] of Object.entries(prev?.files ?? {})) {
    if (generated.files.has(path) || before.kind === "css" || before.kind === "routes" || before.kind === "utils" || before.kind === "asset") continue;
    const disk = await files.read(path);
    if (disk === undefined) continue;
    if (codeHash(disk) === before.hash) write(path, disk, undefined, "No longer in the design");
    else {
      task({ key: `remove:${path}:${before.hash}`, kind: before.kind === "component" ? "component" : "page", summary: `${path} is no longer in the design (deleted or renamed) but was changed by hand. Remove it or move your changes.`, file: path, frameId: before.frameId });
      nextFiles[path] = before;
    }
  }

  // ---- Helpers the generated code imports (cn, cva, lucide)
  const usesComponents = [...generated.files.values()].some((f) => f.kind === "component");
  if (usesComponents) {
    const utilsPath = stack.utilsPath(layout);
    const utils = await files.read(utilsPath);
    if (utils === undefined && !changes.some((c) => c.path === utilsPath)) write(utilsPath, undefined, UTILS_MODULE, "cn() helper for components");
    else if (utils !== undefined && !/export (function|const) cn\b/.test(utils)) {
      task({ key: `utils:${utilsPath}`, kind: "setup", summary: `Add a \`cn()\` helper (clsx + tailwind-merge) to ${utilsPath}; the generated components import it.`, file: utilsPath, code: UTILS_MODULE });
    }
  }
  if (!input.scaffold) {
    const pkg = await files.read("package.json");
    if (pkg !== undefined) {
      try {
        const json = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const have = { ...json.dependencies, ...json.devDependencies };
        const missing = Object.entries(REQUIRED_DEPS).filter(([name]) => !have[name]);
        if (missing.length > 0 && [...generated.files.values()].some((f) => f.kind === "page" || f.kind === "component")) {
          json.dependencies = Object.fromEntries(Object.entries({ ...json.dependencies, ...Object.fromEntries(missing) }).sort(([a], [b]) => a.localeCompare(b)));
          write("package.json", pkg, `${JSON.stringify(json, null, 2)}\n`, `Add ${missing.map(([n]) => n).join(", ")}`);
          install = true;
        }
      } catch {
        warnings.push("package.json could not be read; check the dependencies class-variance-authority, clsx, lucide-react, tailwind-merge");
      }
    }
  }

  // ---- Imported pages: edits at the anchored JSX, the rest as tasks
  const pending = new Map(changes.filter((c) => c.after !== undefined).map((c) => [c.path, c.after!]));
  // Classes parse with the app's Tailwind version (v3 and v4 differ in a few defaults).
  const appTokens = { ...project.tokens, source: layout.tailwind === 3 ? ("tailwind-v3" as const) : ("tailwind-v4" as const) };
  const imported = await planImported({ project, diff: importedDiff, snippets: generated.snippets, tokens: appTokens, files, pending });
  for (const change of imported.changes) {
    const existing = changes.find((c) => c.path === change.path);
    if (existing) existing.after = change.after;
    else changes.push({ ...change, before: change.before ?? (await files.read(change.path)) });
  }
  tasks.push(...imported.tasks);
  warnings.push(...imported.warnings);

  // ---- Things only an agent can do
  for (const skip of generated.skipped) {
    const frame = frames.get(skip.frameId);
    if (!frame || frame.kind !== "new") continue;
    task({ key: `screen:${frame.id}:${codeHash(JSON.stringify(frame.current))}`, kind: "screen", summary: `Build the ${frame.platform === "mobile" ? "phone" : ""} screen "${frame.name}" (${frame.target.route ?? "no route"}) from the design; it is not generated as code (${skip.reason}).`, frameId: frame.id });
  }
  const sourceNames = new Map([...componentSources(project.frames).values()].map((c) => [c.id, c.name]));
  const componentNames = (id: string) => sourceNames.get(id);
  for (const file of generated.files.values()) {
    const frame = file.frameId ? frames.get(file.frameId) : undefined;
    if (!frame) continue;
    const notes: { node?: DesignNode; note: Annotation }[] = (frame.annotations ?? []).map((note) => ({ note }));
    walk(frame.current, (node) => {
      for (const note of node.annotations ?? []) notes.push({ node, note });
    });
    for (const { node, note } of notes) {
      const span = node && file.nodes[node.id];
      // where it is, in words and in the code (node ids aren't in the code)
      const where = node && noteElement(frame.current, node.id, componentNames);
      const snippet = span ? file.content.slice(span.start, span.end).split("\n").slice(0, 14).join("\n") : undefined;
      task({
        key: `note:${note.id}:${codeHash(note.text)}`,
        kind: "note",
        summary: `${note.kind[0]!.toUpperCase()}${note.kind.slice(1)}: ${note.text}`,
        file: file.path,
        ...(span && { line: lineOf(file.content, span.start) }),
        frameId: frame.id,
        ...(node && { nodeId: node.id }),
        ...(where && { details: [`On ${where}${span ? ` (line ${lineOf(file.content, span.start)})` : ""}:`, ...(snippet ? ["", "```tsx", snippet, "```"] : [])].join("\n") }),
        note,
      });
    }
  }

  // Drawings kept as notes: the coding agent designs them (the picture goes with the spec)
  const names = new Map([...componentSources(project.frames).values()].map((c) => [c.id, c.name]));
  for (const request of project.requests ?? []) {
    const frame = frames.get(request.frameId);
    if (request.route !== "note" || !frame) continue;
    const file = [...generated.files.values()].find((f) => f.frameId === frame.id && (f.kind === "page" || f.kind === "component"))?.path ?? frame.target.file;
    const viewport = frame.viewports.find((v) => v.id === request.viewportId);
    const message = request.message.trim();
    const drawn = [...new Set(request.shapes.flatMap((s) => s.targets ?? []))];
    task({
      key: `request:${request.id}:${codeHash(JSON.stringify([request.message, request.shapes]))}`,
      kind: "note",
      summary: `Change "${frame.name}" as drawn${viewport ? ` (at ${viewport.width}px)` : ""}: ${message || "see the drawing"}`,
      ...(file && { file }),
      frameId: frame.id,
      details: [
        "Someone marked up this screen in AppShape. Legend: red = remove, green = add, blue = change or move; other colors have no fixed meaning. Coordinates are design pixels of the screen at that size.",
        "",
        ...describeMarkup(request, frame, (id) => names.get(id)).map((line) => `- ${line}`),
        ...(drawn.length ? ["", "The design doesn't show this change: AppShape's check in the app (verify) doesn't hold the elements the drawing touches to it. Make the change as drawn; the rest of the screen must still match the design."] : []),
      ].join("\n"),
      ...(drawn.length && { drawn }),
      request,
    });
  }

  const fresh = tasks.filter((t) => !handedOff.has(t.key));
  const state: CodeState = {
    version: 1,
    layout,
    appliedAt: input.now ?? new Date().toISOString(),
    files: nextFiles,
    handedOff: [...new Set([...handedOff, ...tasks.map((t) => t.key)])].sort(),
    ...(Object.keys(imported.state).length > 0 && { imported: imported.state }),
  };
  const changedPaths = new Set(changes.map((c) => c.path));
  const frameIds = [
    ...new Set([
      ...importedDiff.changes.map((c) => c.frame.id),
      ...[...generated.files.values()].filter((f) => f.frameId && changedPaths.has(f.path)).map((f) => f.frameId!),
      ...fresh.flatMap((t) => (t.frameId ? [t.frameId] : [])),
    ]),
  ];
  // Line numbers refer to the files as they will be after writing.
  return { changes, tasks: fresh, state, warnings: [...new Set(warnings)], install, frameIds };

  // ---------------------------------------------------------------------------

  /** The app's tailwind.config (Tailwind v3), as it is named in the app. */
  async function tailwindConfigPath(): Promise<string> {
    for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs"]) if ((await files.read(name)) !== undefined) return name;
    return "tailwind.config.js";
  }

  async function applyCss(file: GeneratedFile, disk: string | undefined, before: FileState | undefined) {
    const block = themeBlock(project.tokens, defaults, generated.fonts, generated.motion, generated.interactions);
    nextFiles[file.path] = { kind: "css", hash: codeHash(block) };
    if (disk === undefined) {
      write(file.path, undefined, file.content, "Styles and design system");
      return;
    }
    if (before?.hash === codeHash(block)) return;
    // Nothing differs from Tailwind's defaults and no block of ours yet: leave the CSS alone.
    if (themeDeclarations(project.tokens, defaults).length === 0 && darkDeclarations(project.tokens).length === 0 && !project.tokens.themes && !project.tokens.textStyles && !project.tokens.effectStyles && generated.fonts.length === 0 && !generated.motion && !generated.interactions && !disk.includes(THEME_START)) return;
    if (layout.tailwind === 3) {
      // Tailwind v3: the theme lives in tailwind.config (v4's @theme in CSS does nothing there)
      const extend = tailwind3Extend(project.tokens, defaults);
      const config = await tailwindConfigPath();
      if (extend) task({ key: `theme:${codeHash(extend)}`, kind: "theme", summary: `Update the Tailwind theme in ${config} to the design system below (merge into theme.extend).`, file: config, code: extend });
      // fonts and animations still go into the CSS (everything of the block but its @theme part)
      if (generated.fonts.length || generated.motion || generated.interactions) {
        task({ key: `theme-css:${codeHash(block)}`, kind: "theme", summary: `Add AppShape's fonts and animation styles to ${file.path} (the CSS below without its @theme part: Tailwind v3 takes the theme from ${config}).`, file: file.path, code: block });
      }
      return;
    }
    const range = themeBlockRange(disk);
    if (range) {
      write(file.path, disk, disk.slice(0, range[0]) + block + disk.slice(range[1]), "Design system");
      return;
    }
    const tailwind = /@import\s+["']tailwindcss["'][^;]*;/.exec(disk);
    if (!tailwind) {
      task({ key: `theme:${codeHash(block)}`, kind: "theme", summary: `Add the design system to the Tailwind CSS entry (no \`@import "tailwindcss"\` found in ${file.path}).`, file: file.path, code: block });
      return;
    }
    const at = tailwind.index + tailwind[0].length;
    write(file.path, disk, `${disk.slice(0, at)}\n\n${block}${disk.slice(at)}`, "Design system");
  }

  function applyRoutes(file: GeneratedFile, disk: string | undefined, before: FileState | undefined) {
    nextFiles[file.path] = { kind: "routes", hash: codeHash(file.content) };
    if (disk === undefined) {
      write(file.path, undefined, file.content, "Routes");
      return;
    }
    if (before && codeHash(disk) === before.hash) {
      write(file.path, disk, file.content, "Routes");
      return;
    }
    // Hand-edited (or not ours): add missing routes next to the existing ones.
    let code = disk;
    const routeLines = file.content.split("\n").filter((l) => l.includes("<Route "));
    const importLinesNew = importLines(file.content).lines.filter((l) => !l.includes(`"react-router"`));
    const missing = routeLines.filter((line) => {
      const path = /path=("[^"]*")/.exec(line)?.[1];
      return path !== undefined && !code.includes(`path=${path}`);
    });
    if (missing.length === 0) return;
    const close = code.lastIndexOf("</Routes>");
    if (close < 0) {
      task({ key: `routes:${codeHash(file.content)}`, kind: "routes", summary: `Register these routes in ${file.path}.`, file: file.path, code: missing.map((l) => l.trim()).join("\n") });
      return;
    }
    const lineStart = code.lastIndexOf("\n", close) + 1;
    const indent = " ".repeat(columnOf(code, close) + 2);
    code = code.slice(0, lineStart) + missing.map((l) => `${indent}${l.trim()}\n`).join("") + code.slice(lineStart);
    code = mergeImports(code, importLinesNew.filter((line) => missing.some((m) => m.includes(`<${/import \{ (\w+) \}/.exec(line)?.[1]} `))));
    if (parsesCleanly(code)) write(file.path, disk, code, "Register new pages");
    else task({ key: `routes:${codeHash(file.content)}`, kind: "routes", summary: `Register these routes in ${file.path}.`, file: file.path, code: missing.map((l) => l.trim()).join("\n") });
  }

  /** Design changes in a file someone edited: regenerate untouched elements, else hand off. */
  function applyTargeted(file: GeneratedFile, disk: string, before: FileState, frame: Frame | undefined, what: string) {
    const root = frame && (file.kind === "component" ? frame.current : frame.current);
    if (!root) return;
    const diskElements = jsxElements(disk);
    const genElements = new Map(jsxElements(file.content).map((e) => [`${e.start}:${e.end}`, e]));
    const edits: { start: number; end: number; text: string }[] = [];
    const pending: AgentTask[] = [];

    const visit = (node: DesignNode) => {
      const span = file.nodes[node.id];
      const old = before.nodes?.[node.id];
      const children = node.type !== "instance" && isContainer(node) ? node.children : [];
      if (!span) {
        children.forEach(visit);
        return;
      }
      if (old?.hash === span.hash) return; // this part of the design didn't change
      if (!old) return; // new element: part of its parent's change
      const text = file.content.slice(span.start, span.end);
      const shift = (at: number) => columnOf(disk, at) - columnOf(file.content, span.start);
      const untouched = pick(diskElements.filter((e) => e.hash === old.hash), old.start);
      if (untouched) {
        edits.push({ start: untouched.start, end: untouched.end, text: reindent(text, shift(untouched.start)) });
        return;
      }
      // Someone edited inside this element: update its own tag, recurse for the children.
      const generatedEl = genElements.get(`${span.start}:${span.end}`);
      const label = node.name ?? (node.type === "text" ? JSON.stringify(node.text.slice(0, 30)) : node.type);
      if (generatedEl && generatedEl.open !== old.open) {
        const tag = pick(diskElements.filter((e) => e.open === old.open && e.openEnd < e.end), old.start);
        if (tag) edits.push({ start: tag.start, end: tag.openEnd, text: reindent(generatedEl.open, shift(tag.start)) });
        else pending.push({ key: `el:${file.path}:${node.id}:${span.hash}`, kind: "element", summary: `Update ${label} in the ${what} (it was edited by hand, so AppShape didn't change it).`, details: HAND_EDITED, file: file.path, frameId: file.frameId, nodeId: node.id, code: text });
      }
      const ids = children.map((c) => c.id);
      const openChanged = Boolean(generatedEl && generatedEl.open !== old.open);
      if (JSON.stringify(ids) !== JSON.stringify(old.children ?? [])) {
        pending.push({ key: `children:${file.path}:${node.id}:${span.hash}`, kind: "element", summary: `Update the contents of ${label} in the ${what}: elements were added, removed or reordered in the design.`, details: HAND_EDITED, file: file.path, frameId: file.frameId, nodeId: node.id, code: text });
      } else if (children.length === 0 && !openChanged) {
        // A leaf whose content (text, image, input) changed, inside code someone edited.
        pending.push({ key: `el:${file.path}:${node.id}:${span.hash}`, kind: "element", summary: `Update ${label} in the ${what} (it was edited by hand, so AppShape didn't change it).`, details: HAND_EDITED, file: file.path, frameId: file.frameId, nodeId: node.id, code: text });
      }
      children.forEach(visit);
    };
    visit(root);

    if (edits.length === 0) {
      for (const t of pending) {
        const line = t.nodeId ? locate(disk, before.nodes?.[t.nodeId]) : undefined;
        task(line ? { ...t, line } : t);
      }
      return;
    }
    let code = disk;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
    // Imports the regenerated parts need.
    code = mergeImports(code, importLines(file.content).lines);
    if (!parsesCleanly(code)) {
      task({ key: `file:${file.path}:${codeHash(file.content)}`, kind: file.kind === "component" ? "component" : "page", summary: `Update the ${what} in ${file.path} to the design (AppShape's edit would not parse, so nothing was changed).`, file: file.path, frameId: file.frameId, code: file.content });
      return;
    }
    write(file.path, disk, code, `Update ${what} (your edits kept)`);
    for (const t of pending) {
      const line = t.nodeId ? locate(code, before.nodes?.[t.nodeId]) : undefined;
      task(line ? { ...t, line } : t);
    }
  }

  function fileState(file: GeneratedFile, frame: Frame | undefined): FileState {
    const elements = new Map(jsxElements(file.content).map((e) => [`${e.start}:${e.end}`, e]));
    const childIds = new Map<string, string[]>();
    if (frame) {
      walk(frame.current, (node) => {
        if (node.type !== "instance" && isContainer(node)) childIds.set(node.id, node.children.map((c) => c.id));
      });
    }
    const nodes: Record<string, NodeState> = {};
    for (const [id, span] of Object.entries(file.nodes)) {
      const el = elements.get(`${span.start}:${span.end}`);
      nodes[id] = { hash: span.hash, open: el?.open ?? file.content.slice(span.start, span.end), start: span.start, ...(childIds.has(id) && { children: childIds.get(id) }) };
    }
    return { kind: file.kind, hash: codeHash(file.content), ...(file.frameId && { frameId: file.frameId }), imports: importLines(file.content).lines, nodes };
  }
}

/** The candidate closest to where the element was generated. */
function pick(candidates: JsxElementInfo[], start: number): JsxElementInfo | undefined {
  let best: JsxElementInfo | undefined;
  for (const c of candidates) if (!best || Math.abs(c.start - start) < Math.abs(best.start - start)) best = c;
  return best;
}

function locate(code: string, node: NodeState | undefined): number | undefined {
  if (!node) return undefined;
  const at = code.indexOf(node.open.split("\n")[0]!);
  return at >= 0 ? lineOf(code, at) : undefined;
}

/**
 * Adds imports the code needs: names missing from an existing `import { … } from "m"` go into
 * it, other lines are appended after the last import.
 */
export function mergeImports(code: string, needed: string[]): string {
  let result = code;
  for (const line of needed) {
    const module = /from ["']([^"']+)["']/.exec(line)?.[1];
    const names = /\{([^}]*)\}/.exec(line)?.[1]?.split(",").map((n) => n.trim()).filter(Boolean);
    const have = importLines(result);
    if (have.lines.includes(line)) continue;
    const existing = module ? have.lines.find((l) => (l.includes(`from "${module}"`) || l.includes(`from '${module}'`)) && /\{[^}]*\}/.test(l) && !l.startsWith("import type")) : undefined;
    if (existing && names && !line.startsWith("import type")) {
      const current = /\{([^}]*)\}/.exec(existing)![1]!.split(",").map((n) => n.trim()).filter(Boolean);
      const merged = [...new Set([...current, ...names])].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));
      if (merged.length !== current.length) result = result.replace(existing, existing.replace(/\{[^}]*\}/, `{ ${merged.join(", ")} }`));
      continue;
    }
    const at = have.end;
    result = `${result.slice(0, at)}${at ? "\n" : ""}${line}${at ? "" : "\n"}${result.slice(at)}`;
  }
  return result;
}

/** For elements someone edited by hand: what to keep (agents tend to paste the target over them). */
const HAND_EDITED = "Someone edited this element's code by hand (an id, a handler, logic). Keep those edits: change only what the design changed. The target shows the element as AppShape would write it now, without the hand edits.";

/** An element in words for a note's task: "the Button “Get started” in the Card “Business”". */
function noteElement(root: DesignNode, id: string, componentName: (id: string) => string | undefined): string | undefined {
  const path: DesignNode[] = [];
  const find = (node: DesignNode): boolean => {
    path.push(node);
    if (node.id === id) return true;
    if (isContainer(node) && node.children.some(find)) return true;
    path.pop();
    return false;
  };
  if (!find(root)) return undefined;
  const node = path.at(-1)!;
  // the nearest named place around it: a component, a named element or a section
  const around = path
    .slice(1, -1)
    .reverse()
    .find((n) => n.type === "instance" || n.name || ["section", "header", "footer", "nav"].includes(n.semantic?.role ?? ""));
  return `${describeNode(node, "the", componentName)}${around ? ` in ${describeNode(around, "the", componentName)}` : ""}`;
}

