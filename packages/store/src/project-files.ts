import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  BoardSchema,
  ChangesetSchema,
  ComponentSchema,
  DesignNodeSchema,
  DesignRequestSchema,
  FrameMetaSchema,
  FrameSchema,
  findComponentProblems,
  findReferenceProblems,
  IR_VERSION,
  type Project,
  TokensSchema,
} from "@appshape/ir";
import { watch as chokidarWatch } from "chokidar";
import { z } from "zod";
import { isTempFile, readText, removeDirIfEmpty, removeFile, writeFileAtomic } from "./fs";
import type { DataLocation } from "./location";
import { MANAGED_PREFIXES, paths, ProjectFileSchema, serializeProject } from "./serialize";

export interface Problem {
  severity: "error" | "warning";
  /** Path relative to the data folder (or `board` for reference problems). */
  file: string;
  message: string;
}

/** The project cannot be opened at all (missing/invalid project.json or board.json, newer version). */
export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "ProjectLoadError";
  }
}

export interface LoadResult {
  project: Project;
  problems: Problem[];
}

/**
 * Owns the files of one data folder. Remembers what is on disk so `save` only writes changed
 * files, never touches files that failed to load, and so the watcher can ignore its own writes.
 */
export class ProjectFiles {
  /** Path → content as last read or written. */
  private known = new Map<string, string>();
  /** Files that failed to load; never overwritten or deleted. */
  private broken = new Set<string>();

  constructor(readonly location: DataLocation) {}

  private abs(path: string): string {
    return join(this.location.dataDir, ...path.split("/"));
  }

  async load(): Promise<LoadResult> {
    this.known.clear();
    this.broken.clear();
    const problems: Problem[] = [];
    const read = async (path: string) => {
      const text = await readText(this.abs(path));
      if (text !== undefined) this.known.set(path, text);
      return text;
    };
    const parse = <S extends z.ZodType>(path: string, text: string, schema: S): z.output<S> | undefined => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        problems.push({ severity: "error", file: path, message: `invalid JSON: ${(error as Error).message}` });
        this.broken.add(path);
        return undefined;
      }
      const result = schema.safeParse(raw);
      if (!result.success) {
        problems.push({ severity: "error", file: path, message: z.prettifyError(result.error) });
        this.broken.add(path);
        return undefined;
      }
      return result.data;
    };
    const required = async <S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> => {
      const text = await read(path);
      if (text === undefined) throw new ProjectLoadError("file is missing", path);
      const value = parse(path, text, schema);
      if (value === undefined) throw new ProjectLoadError(problems.at(-1)!.message, path);
      return value;
    };

    const versionText = await read(paths.project);
    if (versionText === undefined) throw new ProjectLoadError("file is missing", paths.project);
    let version: unknown;
    try {
      version = (JSON.parse(versionText) as { irVersion?: unknown }).irVersion;
    } catch (error) {
      throw new ProjectLoadError(`invalid JSON: ${(error as Error).message}`, paths.project);
    }
    if (typeof version === "number" && version > IR_VERSION) {
      throw new ProjectLoadError(`created by a newer AppShape (irVersion ${version}, supported ${IR_VERSION})`, paths.project);
    }
    const meta = await required(paths.project, ProjectFileSchema);
    await read(paths.gitignore);
    const board = await required(paths.board, BoardSchema);

    let tokens: Project["tokens"] = { source: "manual", groups: {} };
    const tokensText = await read(paths.tokens);
    if (tokensText !== undefined) tokens = parse(paths.tokens, tokensText, TokensSchema) ?? tokens;

    const components: Project["components"] = [];
    for (const name of await this.list("components", ".json")) {
      const path = `components/${name}`;
      const component = parse(path, (await read(path))!, ComponentSchema);
      if (component) components.push(component);
    }

    const frames: Project["frames"] = [];
    for (const id of await this.listDirs("frames")) {
      const metaPath = paths.frameMeta(id);
      const metaText = await read(metaPath);
      const currentText = await read(paths.frameCurrent(id));
      const baselineText = await read(paths.frameBaseline(id));
      if (metaText === undefined || currentText === undefined) {
        problems.push({ severity: "error", file: `frames/${id}/`, message: "frame.json and current.json are required" });
        for (const p of [metaPath, paths.frameCurrent(id), paths.frameBaseline(id)]) this.broken.add(p);
        continue;
      }
      const frameMeta = parse(metaPath, metaText, FrameMetaSchema);
      const current = parse(paths.frameCurrent(id), currentText, DesignNodeSchema);
      const baseline = baselineText === undefined ? undefined : parse(paths.frameBaseline(id), baselineText, DesignNodeSchema);
      const failed = !frameMeta || !current || (baselineText !== undefined && !baseline);
      const frame = failed ? undefined : FrameSchema.safeParse({ ...frameMeta, ...(baseline && { baseline }), current });
      if (frame?.success && frame.data.id === id) {
        frames.push(frame.data);
        continue;
      }
      if (frame?.success) problems.push({ severity: "error", file: metaPath, message: `frame id ${frame.data.id} does not match folder ${id}` });
      else if (frame) problems.push({ severity: "error", file: `frames/${id}/`, message: z.prettifyError(frame.error) });
      for (const p of [metaPath, paths.frameCurrent(id), paths.frameBaseline(id)]) this.broken.add(p);
    }

    const changesets: Project["changesets"] = [];
    for (const name of await this.list("changesets", ".json")) {
      const path = `changesets/${name}`;
      const changeset = parse(path, (await read(path))!, ChangesetSchema);
      if (changeset) changesets.push(changeset);
    }

    const requests: NonNullable<Project["requests"]> = [];
    for (const name of await this.list("requests", ".json")) {
      const path = `requests/${name}`;
      const request = parse(path, (await read(path))!, DesignRequestSchema);
      if (!request) continue;
      if (`${request.id}.json` !== name) problems.push({ severity: "warning", file: path, message: `request id ${request.id} does not match the file name` });
      requests.push(request);
    }
    // oldest first (the order they were drawn in)
    requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const project: Project = { ...meta, tokens, components, board, frames, changesets, ...(requests.length > 0 && { requests }) };
    const frameMap = new Map(frames.map((f) => [f.id, f]));
    for (const problem of findReferenceProblems(board, frameMap)) {
      problems.push({ severity: "warning", file: paths.board, message: `${problem.where}: ${problem.message}` });
    }
    for (const problem of findComponentProblems(frames, new Set(components.map((c) => c.id)))) {
      problems.push({ severity: "warning", file: `frames/${problem.frameId}/`, message: problem.message });
    }
    for (const request of requests) {
      const frame = frameMap.get(request.frameId);
      if (!frame) problems.push({ severity: "warning", file: paths.request(request.id), message: `drawing on a screen that doesn't exist (${request.frameId})` });
      else if (!frame.viewports.some((v) => v.id === request.viewportId)) problems.push({ severity: "warning", file: paths.request(request.id), message: `drawn on screen size ${request.viewportId}, which ${frame.name} doesn't have` });
    }
    return { project, problems };
  }

  /** Writes changed files and deletes removed ones. Returns the paths touched. */
  async save(project: Project): Promise<string[]> {
    const files = serializeProject(project);
    const touched: string[] = [];
    for (const [path, content] of files) {
      if (this.broken.has(path) || this.known.get(path) === content) continue;
      this.known.set(path, content);
      await writeFileAtomic(this.abs(path), content);
      touched.push(path);
    }
    for (const path of [...this.known.keys()]) {
      if (files.has(path) || this.broken.has(path)) continue;
      if (!MANAGED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
      this.known.delete(path);
      await removeFile(this.abs(path));
      touched.push(path);
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir.startsWith("frames/")) await removeDirIfEmpty(this.abs(dir));
    }
    return touched;
  }

  /**
   * Calls `onChange` (debounced) when files change on disk in a way AppShape did not cause,
   * e.g. `git checkout`, a text editor or an agent.
   */
  watch(onChange: (paths: string[]) => void, debounceMs = 150): () => Promise<void> {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const watcher = chokidarWatch(this.location.dataDir, {
      ignoreInitial: true,
      ignored: (path: string) => {
        const rel = relative(this.location.dataDir, path).split(sep).join("/");
        // images and fonts aren't project state (and watching them would lock folders on Windows)
        return rel === ".cache" || rel.startsWith(".cache/") || rel === "assets" || rel.startsWith("assets/") || isTempFile(rel);
      },
    });
    const flush = async () => {
      const changed: string[] = [];
      for (const path of pending) {
        const content = await readText(this.abs(path));
        if (content !== this.known.get(path)) changed.push(path);
      }
      pending.clear();
      if (changed.length > 0) onChange(changed);
    };
    const queue = (path: string) => {
      const rel = relative(this.location.dataDir, path).split(sep).join("/");
      // Only the project's own files; other folders (code/, specs/) belong to other tools.
      const own = [paths.project, paths.tokens, paths.board, paths.gitignore].includes(rel) || MANAGED_PREFIXES.some((p) => rel.startsWith(p));
      if (!own || (!rel.endsWith(".json") && rel !== paths.gitignore)) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), debounceMs);
    };
    watcher.on("add", queue).on("change", queue).on("unlink", queue);
    return async () => {
      clearTimeout(timer);
      await watcher.close();
    };
  }

  private async list(dir: string, extension: string): Promise<string[]> {
    try {
      const entries = await readdir(this.abs(dir), { withFileTypes: true });
      return entries.filter((e) => e.isFile() && e.name.endsWith(extension)).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  private async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(this.abs(dir), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }
}
