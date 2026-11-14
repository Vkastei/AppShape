import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { AppLayout } from "@appshape/codegen";
import ts from "typescript";

/** A page of the app. */
export interface AppRoute {
  /** Route pattern: `/`, `/pricing`, `/blog/[slug]`, `/posts/$id`, `/users/:id`. */
  path: string;
  /** File that renders it, relative to the app root (when known). */
  file?: string;
  /** Has parameters; needs an example URL to capture. */
  dynamic: boolean;
}

const toPosix = (p: string) => p.replace(/\\/g, "/");
const PAGE_EXT = /\.(tsx|jsx|ts|js|mdx)$/;

async function list(dir: string): Promise<Array<{ name: string; dir: boolean }>> {
  try {
    return (await readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  return (await list(dirname(path))).some((e) => e.name === path.split(/[\\/]/).pop());
}

/** The app's pages, from its router's conventions. */
export async function discoverRoutes(appRoot: string, layout: AppLayout): Promise<AppRoute[]> {
  let routes: AppRoute[];
  switch (layout.stack) {
    case "next-app":
      routes = await nextAppRoutes(appRoot);
      break;
    case "next-pages":
      routes = await nextPagesRoutes(appRoot);
      break;
    case "vite-tanstack":
      routes = await tanstackRoutes(appRoot);
      break;
    case "vite-react-router":
      routes = await reactRouterRoutes(appRoot);
      break;
  }
  // Imports name modules without extension: point at the actual file.
  for (const route of routes) {
    if (!route.file || /.(tsx|jsx|ts|js|mdx)$/.test(route.file)) continue;
    const base = route.file;
    delete route.file;
    for (const candidate of [".tsx", ".jsx", ".ts", ".js", "/index.tsx", "/index.jsx"]) {
      if (await exists(join(appRoot, base + candidate))) {
        route.file = base + candidate;
        break;
      }
    }
  }
  const seen = new Set<string>();
  return routes
    .filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
    .sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

async function nextAppRoutes(appRoot: string): Promise<AppRoute[]> {
  const base = (await exists(join(appRoot, "src", "app"))) ? join(appRoot, "src", "app") : join(appRoot, "app");
  const routes: AppRoute[] = [];
  const walk = async (dir: string, segments: string[]) => {
    for (const entry of await list(dir)) {
      if (entry.dir) {
        const name = entry.name;
        if (name.startsWith("_") || name.startsWith("@") || name.startsWith("(.") || name === "node_modules") continue;
        await walk(join(dir, name), /^\(.+\)$/.test(name) ? segments : [...segments, name]);
      } else if (/^page\.(tsx|jsx|ts|js|mdx)$/.test(entry.name)) {
        const path = `/${segments.join("/")}`;
        routes.push({ path, file: toPosix(relative(appRoot, join(dir, entry.name))), dynamic: segments.some((s) => s.startsWith("[")) });
      }
    }
  };
  await walk(base, []);
  return routes;
}

async function nextPagesRoutes(appRoot: string): Promise<AppRoute[]> {
  const base = (await exists(join(appRoot, "src", "pages"))) ? join(appRoot, "src", "pages") : join(appRoot, "pages");
  const routes: AppRoute[] = [];
  const walk = async (dir: string, segments: string[]) => {
    for (const entry of await list(dir)) {
      if (entry.dir) {
        if (segments.length === 0 && entry.name === "api") continue;
        await walk(join(dir, entry.name), [...segments, entry.name]);
      } else if (PAGE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const name = entry.name.replace(PAGE_EXT, "");
        if (segments.length === 0 && /^_(app|document|error)$|^(404|500)$/.test(name)) continue;
        const parts = name === "index" ? segments : [...segments, name];
        routes.push({ path: `/${parts.join("/")}`, file: toPosix(relative(appRoot, join(dir, entry.name))), dynamic: parts.some((s) => s.startsWith("[")) });
      }
    }
  };
  await walk(base, []);
  return routes;
}

/** TanStack Router file routes: `posts.$id.tsx`, `posts/index.tsx`, `_layout/…`, `route.tsx`. */
async function tanstackRoutes(appRoot: string): Promise<AppRoute[]> {
  const base = join(appRoot, "src", "routes");
  const routes: AppRoute[] = [];
  const walk = async (dir: string, segments: string[]) => {
    for (const entry of await list(dir)) {
      if (entry.name.startsWith("-")) continue;
      if (entry.dir) {
        await walk(join(dir, entry.name), [...segments, ...entry.name.split(".")]);
        continue;
      }
      if (!/\.(tsx|jsx)$/.test(entry.name) || entry.name.startsWith("__root")) continue;
      const name = entry.name.replace(/\.(lazy\.)?(tsx|jsx)$/, "");
      let parts = [...segments, ...name.split(".")];
      if (parts.at(-1) === "route") parts = parts.slice(0, -1);
      if (parts.at(-1) === "index") parts = parts.slice(0, -1);
      // pathless layouts (`_layout`) and non-nested markers (`posts_`) don't show in the URL
      const urlParts = parts.filter((p) => !p.startsWith("_") && !/^\(.+\)$/.test(p)).map((p) => p.replace(/_$/, ""));
      const layoutOnly = parts.length > 0 && parts.at(-1)!.startsWith("_");
      if (layoutOnly) continue;
      routes.push({ path: `/${urlParts.join("/")}`, file: toPosix(relative(appRoot, join(dir, entry.name))), dynamic: urlParts.some((p) => p.startsWith("$")) });
    }
  };
  await walk(base, []);
  return routes;
}

/** React Router: `<Route path element={<Page/>}>` in JSX and `{ path, element/Component }` route objects. */
async function reactRouterRoutes(appRoot: string): Promise<AppRoute[]> {
  const routes: AppRoute[] = [];
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await list(dir)) {
      if (entry.dir) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) await walk(join(dir, entry.name));
      } else if (/\.(tsx|jsx|ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(join(dir, entry.name));
    }
  };
  await walk(join(appRoot, "src"));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (!/react-router/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = importMap(sf, file, appRoot);
    const join2 = (parent: string, path: string | undefined) => {
      if (path === undefined) return parent;
      if (path.startsWith("/")) return path;
      return `${parent.replace(/\/$/, "")}/${path}`;
    };
    const elementFile = (expr: ts.Expression | undefined): string | undefined => {
      if (!expr) return undefined;
      let name: string | undefined;
      if (ts.isJsxSelfClosingElement(expr)) name = expr.tagName.getText(sf);
      else if (ts.isJsxElement(expr)) name = expr.openingElement.tagName.getText(sf);
      else if (ts.isIdentifier(expr)) name = expr.text;
      return name ? imports.get(name) : undefined;
    };
    const visit = (node: ts.Node, parent: string) => {
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(sf) === "Route") {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        let path: string | undefined;
        let index = false;
        let element: ts.Expression | undefined;
        for (const attr of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          const name = attr.name.getText(sf);
          if (name === "path" && attr.initializer && ts.isStringLiteral(attr.initializer)) path = attr.initializer.text;
          if (name === "index") index = true;
          if ((name === "element" || name === "Component") && attr.initializer && ts.isJsxExpression(attr.initializer)) element = attr.initializer.expression;
        }
        const full = join2(parent, path);
        if ((path !== undefined || index) && element) {
          const target = elementFile(element);
          routes.push({ path: full || "/", ...(target && { file: target }), dynamic: /[:*]/.test(full) });
        }
        if (ts.isJsxElement(node)) for (const child of node.children) visit(child, full);
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (key: string) => node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === key);
        const pathProp = prop("path");
        const element = prop("element") ?? prop("Component");
        const indexProp = prop("index");
        const children = prop("children");
        if (pathProp || (indexProp && element)) {
          const path = pathProp && ts.isStringLiteral(pathProp.initializer) ? pathProp.initializer.text : undefined;
          const full = join2(parent, path);
          if (element) {
            const target = elementFile(element.initializer);
            routes.push({ path: full || "/", ...(target && { file: target }), dynamic: /[:*]/.test(full) });
          }
          if (children) ts.forEachChild(children.initializer, (c) => visit(c, full));
          return;
        }
      }
      ts.forEachChild(node, (c) => visit(c, parent));
    };
    visit(sf, "");
  }
  return routes;
}

/** Local imports of a module: name → file relative to the app root. */
function importMap(sf: ts.SourceFile, file: string, appRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    let base: string | undefined;
    if (spec.startsWith(".")) base = resolve(dirname(file), spec);
    else if (spec.startsWith("@/")) base = join(appRoot, "src", spec.slice(2));
    if (!base) continue;
    const target = toPosix(relative(appRoot, base));
    const clause = stmt.importClause;
    if (clause?.name) map.set(clause.name.text, target);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) map.set(el.name.text, target);
  }
  return map;
}

/** A readable frame name for a route: `/` → Home, `/idea-generator` → Idea generator. */
export function routeName(path: string): string {
  if (path === "/" || path === "") return "Home";
  const last = path.split("/").filter(Boolean).map((s) => s.replace(/^[[$:]+|\]+$/g, "").replace(/^\.\.\./, "")).join(" › ");
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
