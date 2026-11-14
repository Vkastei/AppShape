import {
  BoardSchema,
  ChangesetSchema,
  ComponentSchema,
  DEFAULT_REDACTION,
  DesignNodeSchema,
  DesignRequestSchema,
  FrameMetaSchema,
  IR_VERSION,
  type Project,
  ProjectSchema,
  TokensSchema,
} from "@appshape/ir";
import type { z } from "zod";

/**
 * Project ⇄ files. Paths are relative to the data folder and always use `/`.
 * Every file goes through its schema before writing, so keys come out in schema order and the
 * same project always produces identical bytes.
 */

export const ProjectFileSchema = ProjectSchema.pick({ irVersion: true, name: true, adapters: true, redaction: true, settings: true });

export const GITIGNORE = ".cache/\n";

/** Folders whose files are created and deleted together with project entities. */
export const MANAGED_PREFIXES = ["frames/", "components/", "changesets/", "requests/"] as const;

export function toJson<S extends z.ZodType>(schema: S, value: z.input<S>): string {
  return `${formatJson(schema.parse(value))}\n`;
}

/**
 * JSON with two-space indentation, but lists of plain values (class lists) and small flat objects
 * (source anchors, sides) on one line: imported pages stay a fraction of the size and diff well.
 */
export function formatJson(value: unknown, indent = ""): string {
  const plain = (v: unknown) => v === null || typeof v !== "object";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(plain)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    const inner = `${indent}  `;
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    if (entries.every(([, v]) => plain(v))) {
      const line = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
      if (line.length <= 100) return line;
    }
    const inner = `${indent}  `;
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export const paths = {
  project: "project.json",
  tokens: "tokens.json",
  board: "board.json",
  gitignore: ".gitignore",
  component: (id: string) => `components/${id}.json`,
  frameMeta: (id: string) => `frames/${id}/frame.json`,
  frameBaseline: (id: string) => `frames/${id}/baseline.json`,
  frameCurrent: (id: string) => `frames/${id}/current.json`,
  changeset: (id: string) => `changesets/${id}.json`,
  request: (id: string) => `requests/${id}.json`,
};

export function serializeProject(project: Project): Map<string, string> {
  const files = new Map<string, string>();
  files.set(paths.gitignore, GITIGNORE);
  const { irVersion, name, adapters, redaction, settings } = project;
  files.set(paths.project, toJson(ProjectFileSchema, { irVersion, name, adapters, redaction, ...(settings && Object.keys(settings).length > 0 && { settings }) }));
  files.set(paths.tokens, toJson(TokensSchema, project.tokens));
  files.set(paths.board, toJson(BoardSchema, project.board));
  for (const component of project.components) files.set(paths.component(component.id), toJson(ComponentSchema, component));
  for (const frame of project.frames) {
    const { baseline, current, ...meta } = frame;
    files.set(paths.frameMeta(frame.id), toJson(FrameMetaSchema, meta));
    if (baseline) files.set(paths.frameBaseline(frame.id), toJson(DesignNodeSchema, baseline));
    files.set(paths.frameCurrent(frame.id), toJson(DesignNodeSchema, current));
  }
  for (const changeset of project.changesets) files.set(paths.changeset(changeset.id), toJson(ChangesetSchema, changeset));
  for (const request of project.requests ?? []) files.set(paths.request(request.id), toJson(DesignRequestSchema, request));
  return files;
}

export function emptyProject(name: string): Project {
  return {
    irVersion: IR_VERSION,
    name,
    adapters: [],
    tokens: { source: "manual", groups: {} },
    components: [],
    board: { items: [] },
    frames: [],
    changesets: [],
    redaction: DEFAULT_REDACTION,
  };
}
