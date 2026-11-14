import ts from "typescript";

/**
 * Answers that change only parts of a screen: each edit names an element of the screen's design
 * JSX by its `data-id` and says what happens to it. Applied to the JSX that was sent, they give the
 * whole changed screen, which is read like any other answer. A model writes a few small edits
 * instead of repeating the whole screen, which costs a fraction of the output.
 */

export const JSX_EDIT_OPS = ["update", "replace", "insertBefore", "insertAfter", "append", "remove", "moveBefore", "moveAfter", "screen"] as const;
export type JsxEditOp = (typeof JSX_EDIT_OPS)[number];

export interface JsxEdit {
  op: JsxEditOp;
  /** The `data-id` of the element the edit is about (unused for `screen`). */
  target: string;
  /**
   * The new JSX: the element's new opening tag (update: classes and properties, its children stay),
   * its whole new version (replace), the new elements (insert, append) or the whole screen (screen).
   */
  jsx: string;
  /** For moves: the `data-id` of the element to move next to. */
  anchor: string;
}

export class JsxEditError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "JsxEditError";
  }
}

interface Located {
  start: number;
  end: number;
  /** The opening tag (or the whole self-closing element). */
  open: { start: number; end: number };
  /** Where its children go (after the opening tag), or undefined for a self-closing element. */
  inner?: { start: number; end: number };
  root: boolean;
}

/** Every element with a `data-id`, where it is in the source. */
function locate(source: string): Map<string, Located> {
  const sf = ts.createSourceFile("screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map<string, Located>();
  let first = true;
  const idOf = (attributes: ts.JsxAttributes) => {
    for (const a of attributes.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText(sf) === "data-id" && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
    }
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const root = first;
      first = false;
      const id = idOf(ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes);
      if (id && !found.has(id)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        found.set(id, {
          start: node.getStart(sf),
          end: node.getEnd(),
          open: { start: opening.getStart(sf), end: opening.getEnd() },
          ...(ts.isJsxElement(node) && { inner: { start: node.openingElement.getEnd(), end: node.closingElement.getStart(sf) } }),
          root,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const splice = (source: string, start: number, end: number, text: string) => source.slice(0, start) + text + source.slice(end);

/** The opening tag of a JSX snippet's outermost element (`<X a="b">` from `<X a="b">…</X>` or `<X a="b" />`), and whether it has children. */
function openingOf(jsx: string): { tag: string; name: string; selfClosing: boolean; empty: boolean } | undefined {
  const sf = ts.createSourceFile("part.tsx", `(${jsx.trim()})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.JsxElement | ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) return undefined;
  const opening = ts.isJsxElement(found) ? found.openingElement : found;
  const empty = ts.isJsxSelfClosingElement(found) || found.children.every((c) => ts.isJsxText(c) && !c.text.trim());
  return { tag: opening.getText(sf), name: opening.tagName.getText(sf), selfClosing: ts.isJsxSelfClosingElement(found), empty };
}

/** The tag name of a located element (`div`, `Card`). */
function tagNameAt(source: string, at: Located): string {
  return /^<([A-Za-z][\w.]*)/.exec(source.slice(at.open.start, at.open.end))?.[1] ?? "";
}

/** The screen's JSX with the edits applied in order. Throws `JsxEditError` with every problem in words. */
export function applyJsxEdits(source: string, edits: readonly JsxEdit[]): string {
  if (edits.length === 0) throw new JsxEditError(["The answer has no changes."]);
  let out = source;
  const problems: string[] = [];
  for (const [i, edit] of edits.entries()) {
    const where = `Change ${i + 1} (${edit.op}${edit.target ? ` ${edit.target}` : ""})`;
    if (edit.op === "screen") {
      if (!edit.jsx.trim()) problems.push(`${where} has no JSX.`);
      else out = edit.jsx;
      continue;
    }
    const at = locate(out);
    const target = at.get(edit.target);
    if (!target) {
      problems.push(`${where}: there is no element with data-id "${edit.target}" on the screen.`);
      continue;
    }
    const needsJsx = edit.op === "update" || edit.op === "replace" || edit.op === "insertBefore" || edit.op === "insertAfter" || edit.op === "append";
    if (needsJsx && !edit.jsx.trim()) {
      problems.push(`${where} has no JSX.`);
      continue;
    }
    if (target.root && edit.op !== "update" && edit.op !== "replace" && edit.op !== "append") {
      problems.push(`${where}: the screen's outermost element can only be updated, replaced or appended to.`);
      continue;
    }
    // an empty element in place of one with children means "change its tag", not "empty it"
    const asUpdate = edit.op === "replace" && target.inner !== undefined && out.slice(target.inner.start, target.inner.end).trim() !== "" && openingOf(edit.jsx)?.empty === true && (openingOf(edit.jsx)?.name ?? "") === tagNameAt(out, target);
    switch (asUpdate ? "update" : edit.op) {
      case "update": {
        const opening = openingOf(edit.jsx);
        if (!opening) {
          problems.push(`${where}: the JSX has no element.`);
          break;
        }
        // keep the children: a self-closing tag becomes an opening one when the element has children
        const tag = target.inner && opening.selfClosing ? opening.tag.replace(/\s*\/>$/, ">") : !target.inner && !opening.selfClosing ? opening.tag.replace(/>$/, " />") : opening.tag;
        out = splice(out, target.open.start, target.open.end, tag);
        break;
      }
      case "replace":
        out = splice(out, target.start, target.end, edit.jsx.trim());
        break;
      case "insertBefore":
        out = splice(out, target.start, target.start, `${edit.jsx.trim()}\n`);
        break;
      case "insertAfter":
        out = splice(out, target.end, target.end, `\n${edit.jsx.trim()}`);
        break;
      case "append":
        if (!target.inner) {
          // a self-closing element gets children: <X … /> → <X …>children</X> is a rewrite the model should do
          problems.push(`${where}: the element has no children to add to; replace it instead.`);
          break;
        }
        out = splice(out, target.inner.end, target.inner.end, `\n${edit.jsx.trim()}\n`);
        break;
      case "remove":
        out = splice(out, target.start, target.end, "");
        break;
      case "moveBefore":
      case "moveAfter": {
        const anchor = at.get(edit.anchor);
        if (!anchor) {
          problems.push(`${where}: there is no element with data-id "${edit.anchor}" to move it next to.`);
          break;
        }
        if (anchor.start >= target.start && anchor.end <= target.end) {
          problems.push(`${where}: an element can't move next to something inside itself.`);
          break;
        }
        const text = out.slice(target.start, target.end);
        const removed = splice(out, target.start, target.end, "");
        // the anchor's position after the element was taken out
        const shift = (pos: number) => (pos >= target.end ? pos - (target.end - target.start) : pos);
        const pos = edit.op === "moveBefore" ? shift(anchor.start) : shift(anchor.end);
        out = splice(removed, pos, pos, edit.op === "moveBefore" ? `${text}\n` : `\n${text}`);
        break;
      }
    }
  }
  if (problems.length) throw new JsxEditError(problems);
  return out;
}
