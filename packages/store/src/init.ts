import { basename, join, resolve } from "node:path";
import type { ProjectSettings, Tokens } from "@appshape/ir";
import { exists } from "./fs";
import { DATA_DIR_NAME, type DataLocation, registerExternal, resolveLocation } from "./location";
import { ProjectFiles } from "./project-files";
import { emptyProject } from "./serialize";

export class AlreadyInitializedError extends Error {
  constructor(readonly location: DataLocation) {
    super(`an AppShape project already exists for this app: ${location.dataDir}`);
    this.name = "AlreadyInitializedError";
  }
}

export interface InitOptions {
  name?: string;
  /** Store the data outside the app, in this folder (registered in ~/.appshape/registry.json). */
  external?: string;
  /** Initial design system (default: empty). */
  tokens?: Tokens;
  settings?: ProjectSettings;
}

export async function initProject(appRoot: string, options: InitOptions = {}): Promise<DataLocation> {
  const root = resolve(appRoot);
  const existing = await resolveLocation(root);
  if (existing) throw new AlreadyInitializedError(existing);

  const location: DataLocation = options.external
    ? { appRoot: root, dataDir: resolve(options.external), mode: "external" }
    : { appRoot: root, dataDir: join(root, DATA_DIR_NAME), mode: "in-repo" };
  if (await exists(join(location.dataDir, "project.json"))) {
    throw new AlreadyInitializedError(location);
  }
  const project = emptyProject(options.name ?? basename(root));
  await new ProjectFiles(location).save({ ...project, ...(options.tokens && { tokens: options.tokens }), ...(options.settings && { settings: options.settings }) });
  if (location.mode === "external") await registerExternal(location.appRoot, location.dataDir);
  return location;
}
