import ts from "typescript";
import { codeHash } from "./names";

/** A JSX element in a source file. */
export interface JsxElementInfo {
  start: number;
  end: number;
  /** End of the opening tag (= `end` for self-closing elements). */
  openEnd: number;
  hash: string;
  open: string;
}

/** Every JSX element (and fragment) in a TSX file, in source order. */
export function jsxElements(code: string): JsxElementInfo[] {
  const file = ts.createSourceFile("file.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: JsxElementInfo[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      const start = node.getStart(file);
      const end = node.end;
      const openEnd = ts.isJsxElement(node) ? node.openingElement.end : ts.isJsxFragment(node) ? node.openingFragment.end : end;
      const text = code.slice(start, end);
      out.push({ start, end, openEnd, hash: codeHash(text), open: code.slice(start, openEnd) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** The file's import declarations (text) and where the last one ends. */
export function importLines(code: string): { lines: string[]; end: number } {
  const file = ts.createSourceFile("file.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: string[] = [];
  let end = 0;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    lines.push(code.slice(statement.getStart(file), statement.end));
    end = statement.end;
  }
  return { lines, end };
}

/** Whether the file parses without syntax errors (edits must not break code). */
export function parsesCleanly(code: string): boolean {
  const file = ts.createSourceFile("file.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;
}

/** Column (0-based) where `offset` sits on its line. */
export function columnOf(code: string, offset: number): number {
  return offset - (code.lastIndexOf("\n", offset - 1) + 1);
}

/** 1-based line number of `offset`. */
export function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) if (code[i] === "\n") line++;
  return line;
}

/** Shifts the lines after the first by `delta` columns (for moving an element to another depth). */
export function reindent(text: string, delta: number): string {
  if (delta === 0) return text;
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : delta > 0 ? " ".repeat(delta) + line : line.replace(new RegExp(`^ {0,${-delta}}`), "")))
    .join("\n");
}
