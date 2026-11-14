import ts from "typescript";

/** A JSX element in a source file. */
export interface JsxSite {
  /** 1-based line and column of the `<`. */
  line: number;
  col: number;
  start: number;
  end: number;
  /** Element name as written: `div`, `Link`, `motion.div`, `Icons.Check`. */
  element: string;
  /** Enclosing component (function or variable name). */
  component?: string;
  /** Inside a `.map()`/`.forEach()` callback or similar (rendered once per item). */
  repeated: boolean;
  /** Rendered under a condition (`&&`, `?:`, inside an `if`) or passed as a prop value. */
  conditional: boolean;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
}

/** Index of the JSX elements of one file. */
export class JsxIndex {
  readonly sites: JsxSite[] = [];
  private byLine = new Map<number, JsxSite[]>();
  readonly sourceFile: ts.SourceFile;

  constructor(
    readonly path: string,
    readonly text: string,
  ) {
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
    this.sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    this.collect();
  }

  private collect() {
    const sf = this.sourceFile;
    const visit = (node: ts.Node, component: string | undefined, repeated: boolean, conditional: boolean) => {
      let nextComponent = component;
      let nextRepeated = repeated;
      let nextConditional = conditional;
      const name = componentName(node);
      if (name && (/^[A-Z]/.test(name) || name === "default")) {
        nextComponent = name;
        nextRepeated = false;
        nextConditional = false;
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^(map|flatMap|forEach)$/.test(node.expression.name.text)) {
        nextRepeated = true;
      } else if (ts.isConditionalExpression(node) || (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))) {
        nextConditional = true;
      } else if (ts.isIfStatement(node) || ts.isJsxAttribute(node)) {
        nextConditional = true;
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const start = node.getStart(sf);
        const { line, character } = sf.getLineAndCharacterOfPosition(start);
        const site: JsxSite = {
          line: line + 1,
          col: character + 1,
          start,
          end: node.getEnd(),
          element: opening.tagName.getText(sf),
          ...(component && { component }),
          repeated,
          conditional,
          node,
        };
        this.sites.push(site);
        const list = this.byLine.get(site.line) ?? [];
        list.push(site);
        this.byLine.set(site.line, list);
        // children of an element are rendered with it: no longer conditional on their own
        nextConditional = false;
      }
      ts.forEachChild(node, (child) => visit(child, nextComponent, nextRepeated, nextConditional));
    };
    visit(sf, undefined, false, false);
  }

  /**
   * The JSX element React reported for a position: the element starting there, else the innermost
   * element containing it, else the first element on that line.
   */
  find(line: number, col: number): JsxSite | undefined {
    const onLine = this.byLine.get(line) ?? [];
    const exact = onLine.find((s) => s.col === col);
    if (exact) return exact;
    const offset = this.offsetOf(line, col);
    if (offset !== undefined) {
      let best: JsxSite | undefined;
      for (const site of this.sites) {
        if (site.start <= offset && offset < site.end && (!best || site.start >= best.start)) best = site;
      }
      // Only accept a containing element when the position is inside its opening tag.
      if (best && this.inOpeningTag(best, offset)) return best;
    }
    return onLine[0];
  }

  private inOpeningTag(site: JsxSite, offset: number): boolean {
    const text = this.text.slice(site.start, offset);
    return !text.includes(">") || text.split("{").length > 1;
  }

  offsetOf(line: number, col: number): number | undefined {
    try {
      return this.sourceFile.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      return undefined;
    }
  }
}

/** Name of a component-like function: `function Card()`, `const Card = () =>`, `export default function()`. */
function componentName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "default";
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(node.parent)) {
    // forwardRef(() => …), memo(function …)
    const call = node.parent;
    const callee = call.expression.getText();
    if (/(^|\.)(forwardRef|memo)$/.test(callee) && ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name)) return call.parent.name.text;
  }
  if (ts.isMethodDeclaration(node) && node.name.getText() === "render") {
    const cls = node.parent;
    if (ts.isClassDeclaration(cls) && cls.name) return cls.name.text;
  }
  return undefined;
}
