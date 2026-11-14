import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AnyMap, originalPositionFor, type TraceMap } from "@jridgewell/trace-mapping";

/** One frame of a V8 stack trace. */
export interface StackFrame {
  fn?: string;
  url: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
}

const FRAME = /^\s*at (?:(?:async )?(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line);
    if (!m) continue;
    frames.push({ ...(m[1] && { fn: m[1] }), url: m[2]!, line: Number(m[3]), col: Number(m[4]) });
  }
  return frames;
}

/** A position in the app's source. */
export interface SourcePosition {
  /** Path relative to the app root, `/`-separated. */
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
}

const toPosix = (path: string) => path.replace(/\\/g, "/");

/**
 * Resolves stack frames from the browser to positions in the app's source, using the dev server's
 * source maps: script URLs (`sourceMappingURL`, inline or a file next to the chunk) and the
 * Server Component frames React replays in the browser (`about://React/Server/<file>`), whose maps
 * are read from disk.
 */
export class SourceResolver {
  private maps = new Map<string, Promise<{ map: TraceMap; base: string } | undefined>>();
  private modules = new Map<string, Promise<{ chunk: string; offset: number } | undefined>>();
  private frames = new Map<string, SourcePosition | null>();
  readonly misses = new Set<string>();

  constructor(
    private readonly appRoot: string,
    private readonly fetchText: (url: string) => Promise<string | undefined> = defaultFetch,
  ) {}

  /** The first frame of the stack that lies in the app's own code (not `node_modules`). */
  async callSite(stack: string): Promise<SourcePosition | undefined> {
    for (const frame of parseStack(stack)) {
      if (frame.fn?.includes("react_stack_bottom_frame")) break;
      const position = await this.resolveFrame(frame);
      if (position) return position;
    }
    return undefined;
  }

  async resolveFrame(frame: StackFrame): Promise<SourcePosition | undefined> {
    const key = `${frame.url}:${frame.line}:${frame.col}`;
    const known = this.frames.get(key);
    if (known !== undefined) return known ?? undefined;
    const position = await this.lookup(frame);
    this.frames.set(key, position ?? null);
    return position;
  }

  private async lookup(frame: StackFrame): Promise<SourcePosition | undefined> {
    if (frame.url.includes("/node_modules/") && !frame.url.includes("/node_modules/.vite/")) {
      // Vite serves app modules from their own paths; node_modules frames never hold app code.
      return undefined;
    }
    // Server module re-evaluated by Fast Refresh: lines count from the module, which lives in a chunk on disk.
    const refreshed = /^(?:about|rsc):\/\/React\/[^/]+\/(.+?)\?id=([^?]+)(?:\?\d+)?$/.exec(frame.url);
    if (refreshed) {
      const module = await this.serverModule(refreshed[1]!, refreshed[2]!);
      const loaded = module && (await this.mapFor(pathToFileURL(module.chunk).href));
      return loaded ? this.position(loaded, frame.line + module.offset, frame.col) : undefined;
    }
    const loaded = await this.mapFor(frame.url);
    if (!loaded) {
      return this.direct(frame);
    }
    return this.position(loaded, frame.line, frame.col);
  }

  private position(loaded: { map: TraceMap; base: string }, line: number, col: number): SourcePosition | undefined {
    const original = originalPositionFor(loaded.map, { line, column: col - 1 });
    if (!original.source || original.line == null || original.column == null) return undefined;
    const file = this.appPath(original.source, loaded.base);
    if (!file) return undefined;
    return { file, line: original.line, col: original.column + 1 };
  }

  /**
   * Where a Turbopack server module (`[project]/src/x.tsx [app-rsc] (ecmascript)`) starts: its chunk
   * (the one named in the frame, else a sibling, as chunks are rewritten) and the line before it.
   */
  private serverModule(path: string, rawId: string): Promise<{ chunk: string; offset: number } | undefined> {
    const id = decodeURIComponent(decodeURIComponent(rawId.replace(/\+/g, " ")));
    const key = `${path}|${id}`;
    let pending = this.modules.get(key);
    if (!pending) {
      pending = (async () => {
        let chunk = decodeURIComponent(path);
        if (chunk.startsWith("file://")) chunk = fileURLToPath(chunk);
        const header = `"${id}"`;
        const find = async (file: string) => {
          const lines = (await readFile(file, "utf8").catch(() => "")).split("\n");
          const at = lines.findIndex((l) => l.trimStart().startsWith(`${header},`));
          return at >= 0 ? { chunk: file, offset: at } : undefined;
        };
        const named = await find(chunk);
        if (named) return named;
        const dir = dirname(chunk);
        for (const name of await readdir(dir).catch(() => [] as string[])) {
          if (!name.endsWith(".js")) continue;
          const found = await find(resolve(dir, name));
          if (found) return found;
        }
        this.misses.add(`${chunk} (${id})`);
        return undefined;
      })().catch(() => undefined);
      this.modules.set(key, pending);
    }
    return pending;
  }

  /** Frames that point straight at a source file (no map), e.g. `file:///…/src/App.tsx`. */
  private direct(frame: StackFrame): SourcePosition | undefined {
    if (!frame.url.startsWith("file:")) return undefined;
    const file = this.appPath(frame.url, frame.url);
    return file ? { file, line: frame.line, col: frame.col } : undefined;
  }

  /** Maps a source path from a source map to a path relative to the app root (undefined outside it). */
  appPath(source: string, base: string): string | undefined {
    let path = source;
    path = path.replace(/^turbopack:\/\/\/?/, "");
    if (path.startsWith("[project]/")) return this.inApp(resolve(this.appRoot, path.slice("[project]/".length)));
    const webpack = /^webpack:\/\/[^/]*\/(.*)$/.exec(path);
    if (webpack) return this.inApp(resolve(this.appRoot, webpack[1]!.replace(/^\.\//, "")));
    if (path.startsWith("file://")) return this.inApp(fileURLToPath(path));
    if (/^[A-Za-z]:[\\/]/.test(path) || (isAbsolute(path) && !path.startsWith("/@") && !base.startsWith("http"))) return this.inApp(path);
    if (base.startsWith("http")) {
      // Vite: sources are served paths; `/@fs/<abs>` for files outside the root
      const url = new URL(path, base);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith("/@fs/")) return this.inApp(pathname.slice("/@fs/".length));
      if (/^\/[A-Za-z]:\//.test(pathname)) return this.inApp(pathname.slice(1));
      if (isAbsolute(path) && /^[A-Za-z]:/.test(this.appRoot) === false && path.startsWith(this.appRoot)) return this.inApp(path);
      return this.inApp(resolve(this.appRoot, `.${pathname}`));
    }
    if (base.startsWith("file:")) return this.inApp(resolve(dirname(fileURLToPath(base)), path));
    return this.inApp(resolve(this.appRoot, path));
  }

  private inApp(absolute: string): string | undefined {
    const rel = toPosix(relative(this.appRoot, absolute.split("?")[0]!));
    if (rel.startsWith("..") || isAbsolute(rel) || rel.includes("node_modules/") || rel.startsWith(".next/")) return undefined;
    return rel;
  }

  private mapFor(url: string): Promise<{ map: TraceMap; base: string } | undefined> {
    const cacheKey = url.split("?")[0]!.startsWith("about:") || url.startsWith("rsc:") ? url.split("?")[0]! : url.replace(/[?&]t=\d+/, "");
    let pending = this.maps.get(cacheKey);
    if (!pending) {
      pending = this.loadMap(url).catch(() => undefined);
      this.maps.set(cacheKey, pending);
    }
    return pending;
  }

  private async loadMap(url: string): Promise<{ map: TraceMap; base: string } | undefined> {
    const server = /^(?:about|rsc):\/\/React\/[^/]+\/(.+?)(?:\?\d+)?$/.exec(url);
    if (server) {
      let path = decodeURIComponent(server[1]!);
      if (path.startsWith("file://")) path = fileURLToPath(path);
      return this.loadFileMap(path);
    }
    if (url.startsWith("file:")) return this.loadFileMap(fileURLToPath(url));
    if (!url.startsWith("http")) return undefined;
    const code = await this.fetchText(url);
    if (code === undefined) {
      this.misses.add(url);
      return undefined;
    }
    const ref = lastMappingUrl(code);
    if (!ref) return undefined;
    const json = ref.startsWith("data:") ? decodeDataUrl(ref) : await this.fetchText(new URL(ref, url).href);
    if (!json) {
      this.misses.add(url);
      return undefined;
    }
    const mapUrl = ref.startsWith("data:") ? url : new URL(ref, url).href;
    return { map: new AnyMap(JSON.parse(json)), base: mapUrl };
  }

  private async loadFileMap(path: string): Promise<{ map: TraceMap; base: string } | undefined> {
    let code: string;
    try {
      code = await readFile(path, "utf8");
    } catch {
      this.misses.add(path);
      return undefined;
    }
    const ref = lastMappingUrl(code);
    let json: string | undefined;
    let mapPath = `${path}.map`;
    if (ref?.startsWith("data:")) {
      json = decodeDataUrl(ref);
      mapPath = path;
    } else {
      if (ref) mapPath = resolve(dirname(path), decodeURIComponent(ref));
      try {
        json = await readFile(mapPath, "utf8");
      } catch {
        this.misses.add(mapPath);
        return undefined;
      }
    }
    if (!json) return undefined;
    const base = pathToFileURL(mapPath).href;
    return { map: new AnyMap(JSON.parse(json)), base };
  }
}

function lastMappingUrl(code: string): string | undefined {
  const matches = [...code.matchAll(/\/\/[#@] sourceMappingURL=(\S+)/g)];
  return matches.at(-1)?.[1];
}

function decodeDataUrl(url: string): string | undefined {
  const comma = url.indexOf(",");
  if (comma < 0) return undefined;
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  return meta.includes(";base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
}

async function defaultFetch(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}
