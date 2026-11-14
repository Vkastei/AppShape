import type {
  Box,
  Component,
  DesignNode,
  Frame,
  Layout,
  NodeType,
  Override,
  RedactionConfig,
  SourceAnchor,
  Style,
  Tokens,
  Viewport,
} from "@appshape/ir";

/**
 * Every stack-specific concern lives behind two interfaces:
 * - `PlatformAdapter`: one per framework/stack (react-vite, next, expo; later flutter, swiftui, …)
 * - `StyleDialect`: one per styling system (tailwind-v3, tailwind-v4, nativewind; later css-modules, …)
 * The core (editor, diff, spec compiler, MCP) only talks to these interfaces.
 */

// ── Context ────────────────────────────────────────────────────────────────

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ProjectContext {
  repoRoot: string;
  /** App root (absolute). For monorepos this differs from `repoRoot`. */
  appRoot: string;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  /** Glob relative to `appRoot`. */
  listFiles(pattern: string): Promise<string[]>;
  log: Logger;
}

// ── Detection & instrumentation ────────────────────────────────────────────

export interface DetectResult {
  adapterId: string;
  /** 0..1; the highest-confidence adapter wins, ties are asked to the user. */
  confidence: number;
  platform: "web" | "mobile";
  appRoot: string;
  styleDialect: string;
  framework: { name: string; version?: string };
  router?: { name: string; version?: string };
  devCommand?: string;
  devUrl?: string;
}

/** Changes `appshape init` proposes to the user. Always dev-only; never part of production builds. */
export interface InstrumentPlan {
  summary: string;
  edits: Array<{
    file: string;
    kind: "create" | "patch";
    /** Full content for `create`, unified diff for `patch`. */
    content: string;
    why: string;
  }>;
  dependencies?: Array<{ name: string; version: string; dev: true }>;
}

// ── Routes & capture ───────────────────────────────────────────────────────

export interface RouteInfo {
  /** Route pattern, e.g. `/pricing`, `/blog/:slug`. */
  route: string;
  /** Concrete path to open for dynamic routes. */
  examplePath?: string;
  file?: string;
  params?: string[];
  title?: string;
}

/**
 * Raw node reported by the in-app runtime (web: DOM + fiber, RN: fiber + measured layout).
 * The adapter turns raw nodes into IR with the style dialect.
 */
export interface RawNode {
  /** `div`, `h1`, `View`, `Pressable`, … */
  element: string;
  classes?: string[];
  text?: string;
  attrs?: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** Subset of computed styles, for values the dialect cannot see in classes. */
  computed?: Record<string, string>;
  source?: SourceAnchor;
  /** Component boundaries from the fiber tree, innermost first. */
  components?: Array<{ name: string; file?: string; props?: Record<string, unknown> }>;
  /** React key when rendered from a list. */
  key?: string;
  redacted?: boolean;
  children: RawNode[];
}

/** Abstracts the thing that runs the app: Playwright page, Expo web page, or a native bridge. */
export interface CaptureDriver {
  open(url: string, viewport: Viewport): Promise<void>;
  /** Ask the injected runtime for the current tree. */
  dumpTree(options: { redaction: RedactionConfig }): Promise<RawNode>;
  screenshot(options?: { nodeRect?: RawNode["rect"] }): Promise<{ path: string; width: number; height: number }>;
}

export interface CaptureRequest {
  route: RouteInfo;
  url: string;
  viewport: Viewport;
  redaction: RedactionConfig;
}

export interface CaptureResult {
  tree: DesignNode;
  screenshot?: { path: string; width: number; height: number };
  /** Components seen during this capture; merged into the project catalog. */
  components: Component[];
  warnings: string[];
}

// ── Adapters ───────────────────────────────────────────────────────────────

/** How each IR primitive is written in this stack. */
export type PrimitiveMap = Record<NodeType, { element: string; importFrom?: string }>;

export interface NewScreenTarget {
  /** File to create, relative to the app root (e.g. `app/(tabs)/settings.tsx`). */
  file: string;
  route: string;
  /** Extra steps the agent needs, e.g. "register the route in src/App.tsx". */
  notes: string[];
}

export interface PlatformAdapter {
  id: string;
  displayName: string;
  platform: "web" | "mobile";
  detect(ctx: ProjectContext): Promise<DetectResult | undefined>;
  instrument(ctx: ProjectContext, detected: DetectResult): Promise<InstrumentPlan>;
  discoverRoutes(ctx: ProjectContext): Promise<RouteInfo[]>;
  capture(ctx: ProjectContext, request: CaptureRequest, driver: CaptureDriver, dialect: StyleDialect): Promise<CaptureResult>;
  primitives: PrimitiveMap;
  newScreenTarget(ctx: ProjectContext, frame: Pick<Frame, "name" | "target">): NewScreenTarget;
  /** Human-readable stack for the spec, e.g. ["React 19", "Vite", "React Router 7"]. */
  describeStack(detected: DetectResult): string[];
  /** Stack-specific guidance for agents, e.g. "Use `Link` from react-router for navigation". */
  specHints(detected: DetectResult): string[];
}

// ── Style dialects ─────────────────────────────────────────────────────────

export interface StyleBundle {
  layout?: Layout;
  box?: Box;
  style?: Style;
  overrides?: Override[];
}

export interface ParsedClasses extends StyleBundle {
  /** Classes the dialect could not map; kept verbatim in `platformRaw.classes`. */
  unknown: string[];
}

export interface StyleDialect {
  id: string;
  extractTokens(ctx: ProjectContext): Promise<Tokens>;
  parse(classes: readonly string[], tokens: Tokens): ParsedClasses;
  emit(bundle: StyleBundle, tokens: Tokens): string[];
  /**
   * Minimal class edits from the captured classes to the designed style. Unknown classes and
   * classes that still match are left alone.
   */
  diff(captured: readonly string[], designed: StyleBundle, tokens: Tokens): { remove: string[]; add: string[] };
  /** CSS for the canvas, compiled with the project's own theme. */
  renderCss(ctx: ProjectContext, classes: readonly string[]): Promise<string>;
}

export function defineAdapter(adapter: PlatformAdapter): PlatformAdapter {
  return adapter;
}

export function defineDialect(dialect: StyleDialect): StyleDialect {
  return dialect;
}
