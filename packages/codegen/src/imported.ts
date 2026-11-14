import { parseClasses } from "@appshape/dialect-tailwind";
import {
  type Annotation,
  clone,
  conditionKey,
  type DesignNode,
  type Frame,
  isContainer,
  type Layout,
  type Override,
  type Project,
  type Tokens,
} from "@appshape/ir";
import ts from "typescript";
import type { AgentTask, AppFiles, FileChange } from "./apply";
import { mergeImports } from "./apply";
import { type ClassContext, nodeClasses } from "./classes";
import type { Snippet, SnippetRequest } from "./generate";
import { JsxIndex, type JsxSite } from "./jsx-index";
import { codeHash } from "./names";
import { columnOf, lineOf, parsesCleanly } from "./source";

/**
 * Design changes on imported pages → edits of the app's own code. Every imported element knows
 * the JSX that renders it (its source anchor). A change is written directly when the code at that
 * place still looks like what was captured (fingerprint) and the edit is unambiguous: class edits
 * on a literal `className`, texts, link targets, image sources, icons, deleting static elements,
 * inserting new ones among static siblings. Everything else becomes an agent task that says where.
 *
 * AppShape remembers what the code renders per imported frame (the capture, plus the edits it
 * applied since), in the code state; the plan is the difference between that and the design.
 */

export interface ImportedFrameState {
  tree: DesignNode;
}

type Kind = "style" | "text" | "link" | "image" | "icon" | "delete" | "insert" | "move" | "note";

interface Change {
  kind: Kind;
  frame: Frame;
  /** The node as the code renders it (snapshot); for inserts the parent. */
  before: DesignNode;
  /** The node in the design. */
  after: DesignNode;
  beforeParent?: DesignNode;
  afterParent?: DesignNode;
  note?: Annotation;
  /** Inserts: the sibling it goes after (snapshot node), if any. */
  prevSibling?: DesignNode;
}

export interface ImportedDiff {
  changes: Change[];
  snippets: SnippetRequest[];
  /** Snapshot trees (what the code renders), by frame id. */
  snapshots: Map<string, DesignNode>;
}

interface Info {
  node: DesignNode;
  parent: DesignNode | undefined;
  index: number;
}

function indexTree(root: DesignNode): Map<string, Info> {
  const map = new Map<string, Info>();
  const visit = (node: DesignNode, parent: DesignNode | undefined, index: number) => {
    map.set(node.id, { node, parent, index });
    if (isContainer(node)) node.children.forEach((child, i) => visit(child, node, i));
  };
  visit(root, undefined, 0);
  return map;
}

const STYLE_KEYS = ["layout", "box", "style", "overrides", "hidden"] as const;
/** JSON with sorted keys: stored snapshots come back with keys in schema order. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

const styleOf = (n: DesignNode) => stable([...STYLE_KEYS.map((k) => n[k] ?? null), n.platformRaw?.unmapped ?? []]);

/** Leaf values that render the same: a px number (board handles) and the parsed `"24px"` of `left-[24px]`. */
export function sameLeaf(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const px = (s: string) => s.replace(/"(-?\d+(?:\.\d+)?)px"/g, "$1");
  return px(a) === px(b);
}

/** Imported frames: what changed between the code (snapshot) and the design. */
export function diffImported(project: Project, imported: Record<string, ImportedFrameState> | undefined): ImportedDiff {
  const changes: Change[] = [];
  const snippets: SnippetRequest[] = [];
  const snapshots = new Map<string, DesignNode>();
  for (const frame of project.frames) {
    if (frame.kind !== "imported" || !frame.baseline) continue;
    const snapshot = imported?.[frame.id]?.tree ?? frame.baseline;
    snapshots.set(frame.id, snapshot);
    const before = indexTree(snapshot);
    const after = indexTree(frame.current);
    for (const [id, a] of after) {
      const b = before.get(id);
      if (!b) {
        // only the topmost new node of a subtree
        if (a.parent && before.has(a.parent.id)) {
          const siblings = isContainer(a.parent) ? a.parent.children.slice(0, a.index) : [];
          const prev = [...siblings].reverse().find((s) => before.has(s.id));
          const change: Change = { kind: "insert", frame, before: before.get(a.parent.id)!.node, after: a.node, afterParent: a.parent, ...(prev && { prevSibling: before.get(prev.id)!.node }) };
          changes.push(change);
          const anchor = before.get(a.parent.id)!.node.source;
          if (anchor) snippets.push({ key: insertKey(frame.id, a.node.id), node: a.node, parent: a.parent.layout, path: anchor.file, inline: false });
        }
        continue;
      }
      const base = { frame, before: b.node, after: a.node, ...(b.parent && { beforeParent: b.parent }), ...(a.parent && { afterParent: a.parent }) };
      if ((b.parent?.id ?? null) !== (a.parent?.id ?? null) || relativeOrderChanged(b, a, before, after)) changes.push({ kind: "move", ...base });
      if (styleOf(b.node) !== styleOf(a.node)) changes.push({ kind: "style", ...base });
      if (b.node.type === "text" && a.node.type === "text" && (b.node.text !== a.node.text || stable(b.node.spans) !== stable(a.node.spans))) changes.push({ kind: "text", ...base });
      if (b.node.type === "link" && a.node.type === "link" && (b.node.href !== a.node.href || b.node.targetFrameId !== a.node.targetFrameId)) changes.push({ kind: "link", ...base });
      if (b.node.type === "button" && a.node.type === "button" && b.node.targetFrameId !== a.node.targetFrameId) changes.push({ kind: "link", ...base });
      if (b.node.type === "image" && a.node.type === "image" && (b.node.src !== a.node.src || b.node.alt !== a.node.alt || b.node.fit !== a.node.fit)) changes.push({ kind: "image", ...base });
      if (b.node.type === "icon" && a.node.type === "icon" && b.node.icon !== a.node.icon) changes.push({ kind: "icon", ...base });
      if (b.node.type !== a.node.type) changes.push({ kind: "move", ...base });
      const known = new Set((b.node.annotations ?? []).map((n) => `${n.id}:${n.text}`));
      for (const note of a.node.annotations ?? []) if (!known.has(`${note.id}:${note.text}`)) changes.push({ kind: "note", ...base, note });
    }
    for (const [id, b] of before) {
      if (after.has(id) || !b.parent || !after.has(b.parent.id)) continue; // topmost deleted only
      changes.push({ kind: "delete", frame, before: b.node, after: b.node, beforeParent: b.parent });
    }
    for (const note of frame.annotations ?? []) changes.push({ kind: "note", frame, before: frame.current, after: frame.current, note });
  }
  return { changes, snippets, snapshots };
}

function relativeOrderChanged(b: Info, a: Info, before: Map<string, Info>, after: Map<string, Info>): boolean {
  if (!b.parent || !a.parent || !isContainer(b.parent) || !isContainer(a.parent)) return false;
  const kept = (list: DesignNode[], other: Map<string, Info>) => list.filter((n) => other.has(n.id)).map((n) => n.id);
  const order1 = kept(b.parent.children, after);
  const order2 = kept(a.parent.children, before);
  return order1.indexOf(b.node.id) !== order2.indexOf(a.node.id);
}

const insertKey = (frameId: string, nodeId: string) => `ins:${frameId}:${nodeId}`;

// ---------------------------------------------------------------------------
// Style leaves: every property (per side, per condition) as one comparable entry.

type Leaves = Map<string, string>;
const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

interface StyleBundle {
  layout?: Partial<Layout> | undefined;
  box?: DesignNode["box"] | Override["box"];
  style?: DesignNode["style"] | Override["style"];
  hidden?: boolean | undefined;
}

function bundleLeaves(bundle: StyleBundle, prefix: string, out: Leaves): void {
  const put = (key: string, value: unknown) => {
    if (value !== undefined) out.set(prefix + key, stable(value));
  };
  if (bundle.hidden !== undefined) put("hidden", bundle.hidden);
  for (const [k, v] of Object.entries(bundle.layout ?? {})) {
    if (k === "padding" && v && typeof v === "object") for (const s of SIDES) put(`layout.padding.${s}`, (v as Record<string, unknown>)[s]);
    else put(`layout.${k}`, v);
  }
  for (const [k, v] of Object.entries(bundle.box ?? {})) {
    if ((k === "margin" || k === "inset") && v && typeof v === "object") for (const s of SIDES) put(`box.${k}.${s}`, (v as Record<string, unknown>)[s]);
    else put(`box.${k}`, v);
  }
  for (const [k, v] of Object.entries(bundle.style ?? {})) {
    if (k === "borderWidth") for (const s of SIDES) put(`style.borderWidth.${s}`, typeof v === "object" && v ? (v as Record<string, unknown>)[s] : v);
    else if (k === "radius") for (const c of CORNERS) put(`style.radius.${c}`, typeof v === "object" && v ? (v as Record<string, unknown>)[c] : v);
    else if (k === "ring" && v && typeof v === "object") for (const [rk, rv] of Object.entries(v)) put(`style.ring.${rk}`, rv);
    else put(`style.${k}`, v);
  }
}

export function styleLeaves(node: { layout?: Layout; box?: DesignNode["box"]; style?: DesignNode["style"]; hidden?: boolean; overrides?: Override[] }): Leaves {
  const out: Leaves = new Map();
  bundleLeaves(node, "", out);
  for (const o of node.overrides ?? []) bundleLeaves(o, `${conditionKey(o.when)}|`, out);
  return out;
}

/** Rebuilds the parts of `node`'s style named by `keys` (for emitting just those classes). */
function pickStyle(node: DesignNode, keys: Set<string>): DesignNode {
  const pickBundle = (bundle: StyleBundle, prefix: string): StyleBundle => {
    const has = (k: string) => keys.has(prefix + k);
    const out: StyleBundle = {};
    if (has("hidden")) out.hidden = bundle.hidden;
    const layout: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bundle.layout ?? {})) {
      if (k === "padding" && v && typeof v === "object") {
        const sides = Object.fromEntries(SIDES.filter((s) => has(`layout.padding.${s}`) && (v as Record<string, unknown>)[s] !== undefined).map((s) => [s, (v as Record<string, unknown>)[s]]));
        if (Object.keys(sides).length) layout.padding = sides;
      } else if (has(`layout.${k}`)) layout[k] = v;
    }
    if (Object.keys(layout).length) out.layout = layout as Partial<Layout>;
    const box: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bundle.box ?? {})) {
      if ((k === "margin" || k === "inset") && v && typeof v === "object") {
        const sides = Object.fromEntries(SIDES.filter((s) => has(`box.${k}.${s}`) && (v as Record<string, unknown>)[s] !== undefined).map((s) => [s, (v as Record<string, unknown>)[s]]));
        if (Object.keys(sides).length) box[k] = sides;
      } else if (has(`box.${k}`)) box[k] = v;
    }
    if (Object.keys(box).length) out.box = box as StyleBundle["box"];
    const style: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bundle.style ?? {})) {
      if (k === "borderWidth" || k === "radius") {
        const names = k === "borderWidth" ? SIDES : CORNERS;
        const picked = names.filter((s) => has(`style.${k}.${s}`));
        if (picked.length === 0) continue;
        const value = (s: string) => (typeof v === "object" && v ? (v as Record<string, unknown>)[s] : v);
        style[k] = picked.length === names.length && typeof v !== "object" ? v : Object.fromEntries(picked.filter((s) => value(s) !== undefined).map((s) => [s, value(s)]));
      } else if (k === "ring" && v && typeof v === "object") {
        if (Object.keys(v).some((rk) => has(`style.ring.${rk}`))) style.ring = v;
      } else if (has(`style.${k}`)) style[k] = v;
    }
    if (Object.keys(style).length) out.style = style as StyleBundle["style"];
    return out;
  };
  const base = pickBundle(node, "");
  const overrides: Override[] = [];
  for (const o of node.overrides ?? []) {
    const picked = pickBundle(o, `${conditionKey(o.when)}|`);
    if (Object.keys(picked).length) overrides.push({ when: o.when, ...(picked as Omit<Override, "when">) });
  }
  return { id: node.id, type: "box", origin: "added", children: [], ...base, ...(overrides.length && { overrides }) } as DesignNode;
}

// ---------------------------------------------------------------------------
// The JSX at an anchor.

interface ClassSource {
  /** Literal nodes holding classes (string literals in className, cn(…), …). */
  literals: Array<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral>;
  /** The className attribute, if any. */
  attribute: ts.JsxAttribute | undefined;
  /** className holds something other than literals (conditions, variables, templates). */
  dynamic: boolean;
}

function openingOf(site: JsxSite): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(site.node) ? site.node.openingElement : site.node;
}

function attribute(site: JsxSite, names: string[]): ts.JsxAttribute | undefined {
  for (const prop of openingOf(site).attributes.properties) {
    if (ts.isJsxAttribute(prop) && names.includes(prop.name.getText())) return prop;
  }
  return undefined;
}

function classSource(site: JsxSite): ClassSource {
  const attr = attribute(site, ["className", "class"]);
  const literals: ClassSource["literals"] = [];
  let dynamic = false;
  const init = attr?.initializer;
  if (init && ts.isStringLiteral(init)) literals.push(init);
  else if (init && ts.isJsxExpression(init) && init.expression) {
    const visit = (expr: ts.Node) => {
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) literals.push(expr);
      else if (ts.isCallExpression(expr) && /^(cn|clsx|cx|twMerge|classNames|classnames)$/.test(expr.expression.getText())) {
        for (const arg of expr.arguments) {
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) literals.push(arg);
          else dynamic = true;
        }
      } else if (ts.isParenthesizedExpression(expr)) visit(expr.expression);
      else dynamic = true;
    };
    visit(init.expression);
  }
  return { literals, attribute: attr, dynamic };
}

const splitClasses = (text: string) => text.split(/\s+/).filter(Boolean);

/** The element at the anchor, or where it moved to (same element and classes, nearest line). */
function locate(index: JsxIndex, node: DesignNode): JsxSite | undefined {
  const anchor = node.source;
  if (!anchor) return undefined;
  const expected = node.platformRaw?.element && node.platformRaw.element !== "#text" ? node.platformRaw.element : node.platformRaw?.tag;
  const captured = new Set(node.platformRaw?.classes ?? []);
  const fits = (site: JsxSite) => {
    if (expected && site.element !== expected) return false;
    const { literals } = classSource(site);
    return literals.every((l) => splitClasses(l.text).every((c) => captured.has(c)));
  };
  const exact = index.sites.find((s) => s.line === anchor.line && s.col === anchor.col);
  if (exact && fits(exact)) return exact;
  // Moved (the file was edited): same element with the same classes, nearest to the old line.
  const candidates = index.sites.filter((s) => fits(s) && classSource(s).literals.length > 0).sort((a, b) => Math.abs(a.line - anchor.line) - Math.abs(b.line - anchor.line));
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1 && Math.abs(candidates[0]!.line - anchor.line) === Math.abs(candidates[1]!.line - anchor.line)) return undefined;
  return candidates[0];
}

// ---------------------------------------------------------------------------

interface Splice {
  start: number;
  end: number;
  text: string;
}

export interface ImportedPlanInput {
  project: Project;
  diff: ImportedDiff;
  snippets: Map<string, Snippet>;
  tokens: Tokens;
  files: AppFiles;
  /** File contents after the other planned changes (generated code), if any. */
  pending: Map<string, string>;
}

export interface ImportedPlan {
  changes: FileChange[];
  tasks: AgentTask[];
  /** What the code renders after the changes, per imported frame. */
  state: Record<string, ImportedFrameState>;
  warnings: string[];
}

export async function planImported(input: ImportedPlanInput): Promise<ImportedPlan> {
  const { diff, project } = input;
  const ctx: ClassContext = { tokens: input.tokens, warnings: [] };
  const tasks: AgentTask[] = [];
  const warnings: string[] = [];
  const texts = new Map<string, string>();
  const indexes = new Map<string, JsxIndex>();
  const read = async (path: string): Promise<string | undefined> => {
    if (texts.has(path)) return texts.get(path);
    const text = input.pending.get(path) ?? (await input.files.read(path));
    if (text !== undefined) texts.set(path, text);
    return text;
  };
  const indexOf = async (path: string) => {
    let index = indexes.get(path);
    if (!index) {
      const text = await read(path);
      if (text === undefined) return undefined;
      index = new JsxIndex(path, text);
      indexes.set(path, index);
    }
    return index;
  };

  // How often each anchor is rendered across all imported frames (shared code: components, lists).
  const anchorUses = new Map<string, Array<{ frameId: string; node: DesignNode }>>();
  const anchorKey = (n: DesignNode) => (n.source ? `${n.source.file}:${n.source.line}:${n.source.col}` : undefined);
  for (const [frameId, tree] of diff.snapshots) {
    const visit = (n: DesignNode) => {
      const key = anchorKey(n);
      if (key) (anchorUses.get(key) ?? anchorUses.set(key, []).get(key)!).push({ frameId, node: n });
      if (isContainer(n)) n.children.forEach(visit);
    };
    visit(tree);
  }
  const currentById = new Map<string, Map<string, DesignNode>>();
  for (const frame of project.frames) if (diff.snapshots.has(frame.id)) currentById.set(frame.id, new Map([...indexTree(frame.current)].map(([id, i]) => [id, i.node])));

  // Snapshot updates for what gets applied: per frame, node id → updater.
  const nextTrees = new Map<string, DesignNode>([...diff.snapshots].map(([id, tree]) => [id, clone(tree)]));
  const splices = new Map<string, Array<Splice & { apply: () => void; fail: () => void }>>();
  const importsFor = new Map<string, string[]>();
  const handledAnchors = new Set<string>();
  /** Inserted elements, to anchor once their file is written. */
  const fresh: Array<{ copy: DesignNode; file: string; firstLine: string; indent: string; snippetNewlines?: (offset: number) => number }> = [];

  const where = (n: DesignNode) => (n.source ? `${n.source.file}:${n.source.line}` : "its page");
  const label = (n: DesignNode) => {
    const tag = n.platformRaw?.element && n.platformRaw.element !== "#text" ? n.platformRaw.element : (n.platformRaw?.tag ?? n.type);
    const text = n.type === "text" ? ` "${n.text.slice(0, 40)}${n.text.length > 40 ? "…" : ""}"` : n.name ? ` (${n.name})` : "";
    return `<${tag}>${text}`;
  };
  const task = (change: Change, summary: string, code?: string) => {
    const node = change.kind === "insert" ? change.after : change.before;
    const anchor = (change.kind === "insert" ? change.before : node).source;
    tasks.push({
      key: `imp:${change.kind}:${change.frame.id}:${node.id}:${codeHash(stable(change.kind === "delete" ? null : change.after))}`,
      kind: change.kind === "note" ? "note" : "element",
      summary,
      ...(anchor && { file: anchor.file, line: anchor.line }),
      frameId: change.frame.id,
      nodeId: node.id,
      ...(code && { code }),
      ...(change.note && { note: change.note }),
    });
  };
  const splice = (path: string, s: Splice, apply: () => void, fail: () => void) => {
    (splices.get(path) ?? splices.set(path, []).get(path)!).push({ ...s, apply, fail });
  };
  const snapshotNode = (frameId: string, id: string) => {
    const tree = nextTrees.get(frameId)!;
    return indexTree(tree).get(id);
  };

  for (const change of diff.changes) {
    const { frame, before, after } = change;
    switch (change.kind) {
      case "note": {
        task(change, `${change.note!.kind[0]!.toUpperCase()}${change.note!.kind.slice(1)}: ${change.note!.text}${before.source ? ` (${label(before)} at ${where(before)})` : ` (page ${frame.name})`}`);
        break;
      }
      case "move":
        task(change, `Move ${label(before)} (${where(before)}) to its new place in the design of "${frame.name}".`);
        break;
      case "style":
        await planStyle(change);
        break;
      case "text":
        await planText(change);
        break;
      case "link":
        await planLink(change);
        break;
      case "image":
        await planImage(change);
        break;
      case "icon":
        await planIcon(change);
        break;
      case "delete":
        await planDelete(change);
        break;
      case "insert":
        await planInsert(change);
        break;
    }
  }

  // ---- Write: splices per file, last first; a file whose result doesn't parse is left alone.
  const changes: FileChange[] = [];
  for (const [path, list] of splices) {
    const original = (await read(path))!;
    const sorted = [...list].sort((a, b) => b.start - a.start || b.end - a.end);
    let text = original;
    let lastStart = Number.POSITIVE_INFINITY;
    const done: typeof list = [];
    for (const s of sorted) {
      if (s.end > lastStart) {
        s.fail();
        continue;
      }
      text = text.slice(0, s.start) + s.text + text.slice(s.end);
      lastStart = s.start;
      done.push(s);
    }
    const imports = importsFor.get(path);
    if (imports?.length) text = mergeImports(text, imports);
    if (text === original) {
      for (const s of done) s.apply();
      continue;
    }
    if (/\.(tsx|jsx)$/.test(path) && !parsesCleanly(text)) {
      for (const s of done) s.fail();
      warnings.push(`${path}: the edit would not parse; handed to the agent`);
      continue;
    }
    for (const s of done) s.apply();
    shiftAnchors(path, original, text, done);
    anchorInserted(path, text);
    changes.push({ path, before: input.pending.has(path) ? undefined : original, after: text, summary: `Design changes on ${[...new Set(diff.changes.filter((c) => anchorFile(c) === path).map((c) => c.frame.name))].join(", ") || "imported pages"}` });
  }

  const state: Record<string, ImportedFrameState> = {};
  for (const [frameId, tree] of nextTrees) state[frameId] = { tree };
  return { changes, tasks, state, warnings };

  // -------------------------------------------------------------------------

  function anchorFile(change: Change): string | undefined {
    if (change.kind === "insert") return change.before.source?.file;
    if (change.kind === "text" && change.before.platformRaw?.element === "#text") return change.beforeParent?.source?.file;
    return change.before.source?.file;
  }

  /** Line/column of anchors in `path` after splices (all imported frames). */
  function shiftAnchors(path: string, oldText: string, newText: string, done: Splice[]) {
    const oldIndex = new JsxIndex(path, oldText);
    const ordered = [...done].sort((a, b) => a.start - b.start);
    const map = (offset: number) => {
      let delta = 0;
      for (const s of ordered) if (s.end <= offset) delta += s.text.length - (s.end - s.start);
      return offset + delta;
    };
    // imports added at the top shift everything after them
    const importShift = (() => {
      const before = oldText.length + ordered.reduce((sum, s) => sum + s.text.length - (s.end - s.start), 0);
      return newText.length - before;
    })();
    for (const tree of nextTrees.values()) {
      const visit = (n: DesignNode) => {
        if (n.source?.file === path && n.source.line > 0) {
          const offset = oldIndex.offsetOf(n.source.line, n.source.col);
          if (offset !== undefined) {
            const next = map(offset) + importShift;
            n.source = { ...n.source, line: lineOf(newText, next), col: columnOf(newText, next) + 1 };
          }
        }
        if (isContainer(n)) n.children.forEach(visit);
      };
      visit(tree);
    }
  }

  /** Anchors for inserted elements: the inserted JSX, walked together with the design subtree. */
  function anchorInserted(path: string, text: string) {
    const index = new JsxIndex(path, text);
    for (const item of fresh.filter((f) => f.file === path)) {
      const at = text.indexOf(`\n${item.indent}${item.firstLine}`);
      const start = at < 0 ? -1 : at + 1 + item.indent.length;
      const visit = (n: DesignNode) => {
        if (n.source && n.source.line < 1) {
          // col holds the offset in the snippet; lines after the first gained the indent
          const offset = n.source.col - 1;
          const site = start < 0 ? undefined : index.sites.find((s) => s.start === start + offset + item.indent.length * (item.snippetNewlines?.(offset) ?? 0));
          if (site) {
            n.source = { file: path, line: site.line, col: site.col };
            // the fingerprint later edits check: element and classes as written
            const classes = classSource(site).literals.flatMap((l) => splitClasses(l.text));
            n.platformRaw = { ...n.platformRaw, ...(/^[a-z]/.test(site.element) ? { tag: site.element } : { element: site.element }), ...(classes.length && { classes }) };
          } else delete n.source;
        }
        if (isContainer(n)) n.children.forEach(visit);
      };
      visit(item.copy);
    }
  }

  /** All snapshot copies of an anchor must change the same way for a direct edit (shared code). */
  function sameEverywhere(change: Change, signature: (before: DesignNode, after: DesignNode | undefined) => string): boolean {
    const key = anchorKey(change.before);
    const uses = key ? (anchorUses.get(key) ?? []) : [];
    if (uses.length <= 1) return true;
    const expected = signature(change.before, change.after);
    return uses.every((u) => signature(u.node, currentById.get(u.frameId)?.get(u.node.id)) === expected);
  }

  async function planStyle(change: Change) {
    const { before, after } = change;
    const key = anchorKey(before);
    const diffLeaves = (b: DesignNode, a: DesignNode | undefined) => {
      if (!a) return "deleted";
      const lb = styleLeaves(b);
      const la = styleLeaves(a);
      const out: string[] = [];
      for (const k of [...new Set([...lb.keys(), ...la.keys()])].sort()) if (lb.get(k) !== la.get(k)) out.push(`${k}=${la.get(k) ?? "∅"}`);
      return out.join(";");
    };
    const summary = () => `Restyle ${label(before)} at ${where(before)} to match the design`;
    if (!sameEverywhere(change, diffLeaves)) {
      task(change, `${summary()}. This code renders ${anchorUses.get(key!)?.length} elements (a list or component) but only some change: make the change for these only (e.g. with a prop or a condition).`);
      return;
    }
    if (key && handledAnchors.has(`style:${key}`)) return;
    if (key) handledAnchors.add(`style:${key}`);
    const index = before.source ? await indexOf(before.source.file) : undefined;
    const site = index && locate(index, before);
    if (!site) {
      task(change, `${summary()} (the element could not be found at that place any more).`, nodeClasses(after, change.afterParent?.layout, ctx).base.join(" "));
      return;
    }
    const source = classSource(site);
    const literalClasses = source.literals.flatMap((l) => splitClasses(l.text));
    const parse = (classes: string[], parent: Partial<Layout> | undefined) => parseClasses(classes, { tokens: input.tokens, ...(parent && { parent }) });

    const lb = styleLeaves(before);
    const la = styleLeaves(after);
    const changed = new Set<string>();
    for (const k of new Set([...lb.keys(), ...la.keys()])) if (lb.get(k) !== la.get(k)) changed.add(k);
    if (changed.has("hidden")) {
      changed.add("layout.mode");
      changed.add("layout.inline");
    }
    // Classes of the literal that set a changed property are replaced …
    const reemit = new Set(changed);
    const removed = new Set<string>();
    // … classes kept as they are come and go as written in "Classes" …
    const unmappedBefore = before.platformRaw?.unmapped ?? [];
    const unmappedAfter = after.platformRaw?.unmapped ?? [];
    for (const cls of unmappedBefore) if (!unmappedAfter.includes(cls) && literalClasses.includes(cls)) removed.add(cls);
    const unmappedAdded = unmappedAfter.filter((c) => !unmappedBefore.includes(c));
    for (const cls of literalClasses) {
      const keys = styleLeaves(parse([cls], change.beforeParent?.layout));
      const hit = [...keys.keys()].some((k) => changed.has(k)) || (changed.has("hidden") && cls === "hidden");
      if (!hit) continue;
      removed.add(cls);
      for (const k of keys.keys()) reemit.add(k);
    }
    // … by classes for the design's values of those properties.
    const added = [...nodeClasses(pickStyle(after, reemit), change.afterParent?.layout, ctx).base.filter((c) => !literalClasses.includes(c) || removed.has(c)), ...unmappedAdded.filter((c) => !literalClasses.includes(c))];
    const removedOutsideLiterals = [...changed].length > 0 && removed.size === 0 && added.length === 0;
    const diffText = `remove: ${[...removed].join(" ") || "–"}; add: ${added.join(" ") || "–"}`;
    if (source.dynamic && removed.size === 0 && literalClasses.length === 0) {
      task(change, `${summary()}: ${diffText} (className is computed).`);
      return;
    }
    if (removedOutsideLiterals) {
      task(change, `${summary()} (the classes involved are not in a literal className).`);
      return;
    }
    // Which literal to edit: the one holding the removed classes (all of them), else the first.
    const target = removed.size > 0 ? source.literals.find((l) => [...removed].every((c) => splitClasses(l.text).includes(c))) : source.literals[0];
    if (removed.size > 0 && !target) {
      task(change, `${summary()}: ${diffText} (the classes are spread over several parts of className).`);
      return;
    }
    const oldList = target ? splitClasses(target.text) : [];
    const firstRemoved = oldList.findIndex((c) => removed.has(c));
    const kept = oldList.filter((c) => !removed.has(c));
    const insertAt = firstRemoved >= 0 ? oldList.slice(0, firstRemoved).filter((c) => !removed.has(c)).length : kept.length;
    const newList = [...new Set([...kept.slice(0, insertAt), ...added, ...kept.slice(insertAt)])];

    // Safety: the edited classes must parse back to the design.
    const captured = before.platformRaw?.classes ?? literalClasses;
    const outside = captured.filter((c) => !literalClasses.includes(c));
    const otherLiterals = source.literals.filter((l) => l !== target).flatMap((l) => splitClasses(l.text));
    const full = [...outside, ...otherLiterals, ...newList];
    const reparsed = styleLeaves(parse(full, change.afterParent?.layout));
    const mismatch = [...changed].filter((k) => k !== "layout.mode" && k !== "layout.inline" && !sameLeaf(reparsed.get(k), la.get(k)));
    if (mismatch.length) {
      task(change, `${summary()}: ${diffText}. Check: ${mismatch.slice(0, 4).join(", ")}.`);
      return;
    }
    const text = (await read(before.source!.file))!;
    const apply = () => {
      for (const use of anchorUses.get(key!) ?? [{ frameId: change.frame.id, node: before }]) {
        const node = snapshotNode(use.frameId, use.node.id)?.node;
        const designed = currentById.get(use.frameId)?.get(use.node.id);
        if (!node || !designed) continue;
        for (const k of STYLE_KEYS) {
          if (designed[k] === undefined) delete node[k];
          else (node as unknown as Record<string, unknown>)[k] = clone(designed[k] as never);
        }
        node.platformRaw = { ...node.platformRaw, classes: full, ...(designed.platformRaw?.unmapped && { unmapped: designed.platformRaw.unmapped }) };
      }
    };
    const fail = () => task(change, `${summary()}: ${diffText}.`);
    if (target) {
      const quote = text[target.getStart()]!;
      splice(before.source!.file, { start: target.getStart(), end: target.getEnd(), text: `${quote}${newList.join(" ")}${quote === "`" ? "`" : quote}` }, apply, fail);
    } else {
      // No className yet: add one after the tag name.
      const opening = openingOf(site);
      const at = opening.tagName.getEnd();
      splice(before.source!.file, { start: at, end: at, text: ` className="${newList.join(" ")}"` }, apply, fail);
    }
  }

  async function planText(change: Change) {
    const before = change.before as Extract<DesignNode, { type: "text" }>;
    const after = change.after as Extract<DesignNode, { type: "text" }>;
    const summary = `Change the text ${label(before)} at ${where(before.platformRaw?.element === "#text" ? (change.beforeParent ?? before) : before)} to "${after.text}"`;
    if (after.spans?.length || before.spans?.length || after.text.includes("\n") || before.text.includes("\n")) {
      task(change, `${summary} (formatted text).`);
      return;
    }
    const container = before.platformRaw?.element === "#text" ? change.beforeParent : before;
    if (!container?.source) {
      task(change, summary);
      return;
    }
    const index = await indexOf(container.source.file);
    const site = index && locate(index, container);
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const old = normalize(before.text);
    const file = container.source.file;
    const text = (await read(file))!;
    const apply = () => {
      const node = snapshotNode(change.frame.id, before.id)?.node;
      if (node && node.type === "text") node.text = after.text;
    };
    const fail = () => task(change, summary);
    if (site && ts.isJsxElement(site.node)) {
      const literal: Array<{ start: number; end: number; raw: boolean }> = [];
      for (const child of site.node.children) {
        if (ts.isJsxText(child) && normalize(child.text) === old) {
          const raw = child.text;
          const lead = raw.length - raw.trimStart().length;
          const trail = raw.length - raw.trimEnd().length;
          literal.push({ start: child.end - raw.length + lead, end: child.end - trail, raw: true });
        } else if (ts.isJsxExpression(child) && child.expression && (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression)) && normalize(child.expression.text) === old) {
          literal.push({ start: child.getStart(), end: child.getEnd(), raw: true });
        }
      }
      if (literal.length === 1) {
        const safe = /^[^{}<>]*$/.test(after.text) && after.text === after.text.trim() && after.text !== "";
        const shared = (anchorUses.get(anchorKey(container)!) ?? []).length > 1;
        const static_ = !shared || (container === before && sameEverywhere(change, (b, a) => (a && a.type === "text" ? a.text : "∅")));
        if (!static_) {
          task(change, `${summary}. The text is written in code shared by several elements (list or component): change it for this one only.`);
          return;
        }
        splice(file, { start: literal[0]!.start, end: literal[0]!.end, text: safe ? after.text : `{${JSON.stringify(after.text)}}` }, apply, fail);
        return;
      }
    }
    // Text from data or props: a unique string literal with that text in the file. In shared code
    // (a component on several pages) every copy showing this text must change the same way.
    const copies = container === before ? (anchorUses.get(anchorKey(container)!) ?? []).filter((u) => u.node.type === "text" && normalize(u.node.text) === old) : [];
    const consistent = container === before ? copies.every((u) => { const now = currentById.get(u.frameId)?.get(u.node.id); return now?.type === "text" && now.text === after.text; }) : (anchorUses.get(anchorKey(container)!) ?? []).length <= 1;
    if (!consistent) {
      task(change, `${summary}. The text is shown by code used in several places (${copies.length || "several"} copies); change it for this place only.`);
      return;
    }
    // The literal is searched in the component's file first, then in all of the app's sources
    // (data modules); it must be the only one with that text.
    const literalsIn = (source: ts.SourceFile) => {
      const found: ts.StringLiteralLike[] = [];
      const visit = (n: ts.Node) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && normalize(n.text) === old && !ts.isImportDeclaration(n.parent) && !(ts.isJsxAttribute(n.parent) && /^(className|class|href|to|src|key|id)$/.test(n.parent.name.getText()))) found.push(n);
        ts.forEachChild(n, visit);
      };
      visit(source);
      return found;
    };
    const local = index ? literalsIn(index.sourceFile) : [];
    let hits = local.map((lit) => ({ lit, path: file }));
    if (hits.length === 0 && input.files.list) {
      hits = [];
      for (const path of await input.files.list()) {
        const other = await indexOf(path);
        if (other) for (const lit of literalsIn(other.sourceFile)) hits.push({ lit, path });
        if (hits.length > 1) break;
      }
    }
    if (hits.length === 1) {
      const { lit, path } = hits[0]!;
      const source = (await read(path))!;
      splice(path, { start: lit.getStart(), end: lit.getEnd(), text: quoted(after.text, source[lit.getStart()]!) }, apply, fail);
      return;
    }
    task(change, `${summary} (the text comes from data or props${container.source ? ` used at ${where(container)}` : ""}).`);
  }

  async function planLink(change: Change) {
    const { before, after } = change;
    const route = "targetFrameId" in after && after.targetFrameId ? project.frames.find((f) => f.id === after.targetFrameId)?.target.route : undefined;
    const href = route ?? (after.type === "link" ? after.href : undefined);
    const summary = `Point ${label(before)} at ${where(before)} to ${href ?? "the screen linked in the design"}`;
    const index = before.source ? await indexOf(before.source.file) : undefined;
    const site = index && locate(index, before);
    const attr = site && attribute(site, ["href", "to"]);
    const init = attr?.initializer;
    if (!href || !site || !init || !ts.isStringLiteral(init) || (anchorUses.get(anchorKey(before)!) ?? []).length > 1) {
      task(change, `${summary}.`);
      return;
    }
    const quote = (await read(before.source!.file))![init.getStart()]!;
    splice(
      before.source!.file,
      { start: init.getStart(), end: init.getEnd(), text: `${quote}${href}${quote}` },
      () => {
        const node = snapshotNode(change.frame.id, before.id)?.node;
        if (node && (node.type === "link" || node.type === "button")) {
          if (after.type === "link" || after.type === "button") node.targetFrameId = after.targetFrameId;
          if (node.type === "link" && after.type === "link") node.href = after.href;
        }
      },
      () => task(change, `${summary}.`),
    );
  }

  async function planImage(change: Change) {
    const before = change.before as Extract<DesignNode, { type: "image" }>;
    const after = change.after as Extract<DesignNode, { type: "image" }>;
    const summary = `Update the image ${label(before)} at ${where(before)}: src "${after.src.startsWith("data:") ? "(embedded)" : after.src}", alt "${after.alt ?? ""}"`;
    if (before.fit !== after.fit || !/^(\/|https?:)/.test(after.src)) {
      task(change, `${summary}${after.src.startsWith("asset:") ? ` (copy .appshape/assets/${after.src.slice(6)} into the app's public folder)` : ""}.`);
      return;
    }
    const index = before.source ? await indexOf(before.source.file) : undefined;
    const site = index && locate(index, before);
    const edits: Splice[] = [];
    for (const [name, value, old] of [["src", after.src, before.src], ["alt", after.alt ?? "", before.alt ?? ""]] as const) {
      if (value === old) continue;
      const attr = site && attribute(site, [name]);
      const init = attr?.initializer;
      if (!init || !ts.isStringLiteral(init) || (name === "src" && init.text !== old)) {
        task(change, `${summary}.`);
        return;
      }
      edits.push({ start: init.getStart(), end: init.getEnd(), text: JSON.stringify(value) });
    }
    if ((anchorUses.get(anchorKey(before)!) ?? []).length > 1) {
      task(change, `${summary} (the image is rendered by shared code).`);
      return;
    }
    for (const edit of edits) {
      splice(before.source!.file, edit, () => {
        const node = snapshotNode(change.frame.id, before.id)?.node;
        if (node?.type === "image") {
          node.src = after.src;
          if (after.alt === undefined) delete node.alt;
          else node.alt = after.alt;
        }
      }, () => task(change, `${summary}.`));
    }
  }

  async function planIcon(change: Change) {
    const before = change.before as Extract<DesignNode, { type: "icon" }>;
    const after = change.after as Extract<DesignNode, { type: "icon" }>;
    const name = after.icon.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
    const summary = `Use the icon ${name} (lucide-react) for ${label(before)} at ${where(before)}`;
    const index = before.source ? await indexOf(before.source.file) : undefined;
    const site = index && locate(index, before);
    if (!site || (after.set ?? "lucide") !== "lucide" || (anchorUses.get(anchorKey(before)!) ?? []).length > 1 || !/^[A-Z]\w*$/.test(site.element)) {
      task(change, `${summary}.`);
      return;
    }
    const file = before.source!.file;
    const text = (await read(file))!;
    if (!/from ["']lucide-react["']/.test(text)) {
      task(change, `${summary}.`);
      return;
    }
    const opening = openingOf(site);
    const apply = () => {
      const node = snapshotNode(change.frame.id, before.id)?.node;
      if (node?.type === "icon") node.icon = after.icon;
    };
    const fail = () => task(change, `${summary}.`);
    splice(file, { start: opening.tagName.getStart(), end: opening.tagName.getEnd(), text: name }, apply, fail);
    if (ts.isJsxElement(site.node)) splice(file, { start: site.node.closingElement.tagName.getStart(), end: site.node.closingElement.tagName.getEnd(), text: name }, () => undefined, () => undefined);
    (importsFor.get(file) ?? importsFor.set(file, []).get(file)!).push(`import { ${name} } from "lucide-react";`);
  }

  async function planDelete(change: Change) {
    const { before } = change;
    const summary = `Remove ${label(before)} at ${where(before.platformRaw?.element === "#text" ? (change.beforeParent ?? before) : before)} from "${change.frame.name}"`;
    const remove = () => {
      const info = snapshotNode(change.frame.id, before.id);
      if (info?.parent && isContainer(info.parent)) info.parent.children.splice(info.parent.children.findIndex((c) => c.id === before.id), 1);
    };
    const fail = () => task(change, `${summary}.`);
    if (before.platformRaw?.element === "#text") {
      const parent = change.beforeParent;
      const index = parent?.source ? await indexOf(parent.source.file) : undefined;
      const site = index && parent && locate(index, parent);
      const old = before.type === "text" ? before.text.replace(/\s+/g, " ").trim() : "";
      const match = site && ts.isJsxElement(site.node) ? site.node.children.filter((c) => ts.isJsxText(c) && c.text.replace(/\s+/g, " ").trim() === old) : [];
      if (match.length !== 1 || (anchorUses.get(anchorKey(parent!)!) ?? []).length > 1) {
        task(change, `${summary}.`);
        return;
      }
      const child = match[0]! as ts.JsxText;
      const raw = child.text;
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      splice(parent!.source!.file, { start: child.end - raw.length + lead, end: child.end - trail, text: "" }, remove, fail);
      return;
    }
    const index = before.source ? await indexOf(before.source.file) : undefined;
    const site = index && locate(index, before);
    if (!site || site.repeated || site.conditional || (anchorUses.get(anchorKey(before)!) ?? []).length > 1) {
      task(change, `${summary}${site?.repeated ? " (it is rendered in a list: remove the item from the data or filter it)" : site?.conditional ? " (it is rendered under a condition)" : ""}.`);
      return;
    }
    const text = (await read(before.source!.file))!;
    let start = site.start;
    let end = site.end;
    // Remove the whole line when the element is alone on it.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    if (text.slice(lineStart, start).trim() === "" && text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim() === "") {
      start = lineStart > 0 ? lineStart - 1 : lineStart;
      end = lineEnd < 0 ? text.length : lineEnd;
    }
    splice(before.source!.file, { start, end, text: "" }, remove, fail);
  }

  async function planInsert(change: Change) {
    const parent = change.before;
    const node = change.after;
    const summary = `Add ${label(node)} to ${label(parent)} at ${where(parent)} in "${change.frame.name}"${change.prevSibling ? `, after ${label(change.prevSibling)}` : " as its first child"}`;
    const snippet = input.snippets.get(insertKey(change.frame.id, node.id));
    const index = parent.source ? await indexOf(parent.source.file) : undefined;
    const site = index && locate(index, parent);
    if (!snippet || !site || !ts.isJsxElement(site.node) || site.repeated || (anchorUses.get(anchorKey(parent)!) ?? []).length > 1) {
      task(change, `${summary}${site?.repeated || (anchorUses.get(anchorKey(parent)!) ?? []).length > 1 ? " (the parent is rendered by shared code: list or component)" : ""}.`, snippet?.text);
      return;
    }
    const file = parent.source!.file;
    const text = (await read(file))!;
    // After the previous sibling, when it is a direct child in the JSX; else at the start.
    let at: number | undefined;
    const prev = change.prevSibling;
    if (prev) {
      if (prev.platformRaw?.element === "#text") {
        const old = prev.type === "text" ? prev.text.replace(/\s+/g, " ").trim() : "";
        const child = site.node.children.find((c) => ts.isJsxText(c) && c.text.replace(/\s+/g, " ").trim() === old);
        if (child) at = child.end - ((child as ts.JsxText).text.length - (child as ts.JsxText).text.trimEnd().length);
      } else {
        const prevSite = locate(index, prev);
        if (prevSite && prevSite.node.parent === site.node) at = prevSite.end;
      }
      if (at === undefined) {
        task(change, `${summary}.`, snippet.text);
        return;
      }
    } else {
      at = site.node.openingElement.getEnd();
    }
    const lineStart = text.lastIndexOf("\n", (prev ? at : site.start) - 1) + 1;
    const baseIndent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    const indent = prev ? baseIndent : `${baseIndent}  `;
    const body = snippet.text.split("\n").map((l, i) => (i === 0 ? l : l ? indent + l : l)).join("\n");
    const inserted = `\n${indent}${body}`;
    const apply = () => {
      const info = snapshotNode(change.frame.id, parent.id);
      if (!info || !isContainer(info.node)) return;
      const copy = clone(node);
      // The new elements are in the code now: they get anchors once the file is written.
      const ranges = new Map(snippet.ranges.map(([id, s]) => [id, s]));
      const visit = (n: DesignNode) => {
        const s = ranges.get(n.id);
        if (s !== undefined) n.source = { file, line: 0, col: s + 1 };
        else delete n.source;
        if (isContainer(n)) n.children.forEach(visit);
      };
      visit(copy);
      const prevIndex = prev ? info.node.children.findIndex((c) => c.id === prev.id) : -1;
      info.node.children.splice(prevIndex + 1, 0, copy);
      fresh.push({ copy, file, firstLine: snippet.text.split("\n")[0]!, indent, snippetNewlines: (offset) => snippet.text.slice(0, offset).split("\n").length - 1 });
    };
    splice(file, { start: at, end: at, text: inserted }, apply, () => task(change, `${summary}.`, snippet.text));
    if (snippet.imports.length) (importsFor.get(file) ?? importsFor.set(file, []).get(file)!).push(...snippet.imports);
  }
}

/** A string literal in the quote style of the code it replaces. */
function quoted(text: string, quote: string): string {
  if (quote === "'") return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  if (quote === "`") return `\`${text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
  return JSON.stringify(text);
}
