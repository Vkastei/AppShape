import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { exists, readText, writeFileAtomic } from "./fs";

export const DATA_DIR_NAME = ".appshape";

export interface DataLocation {
  /** Root of the app the designs belong to. */
  appRoot: string;
  /** Folder holding project.json, board.json, frames/, … */
  dataDir: string;
  mode: "in-repo" | "external";
}

/** AppShape's per-user folder (registry, settings). Override with APPSHAPE_HOME. */
export function appshapeHome(): string {
  return process.env.APPSHAPE_HOME ?? join(homedir(), DATA_DIR_NAME);
}

const RegistrySchema = z.strictObject({
  version: z.literal(1),
  projects: z.array(z.strictObject({ appRoot: z.string(), dataDir: z.string() })),
});
export type Registry = z.infer<typeof RegistrySchema>;

const registryFile = () => join(appshapeHome(), "registry.json");

export async function readRegistry(): Promise<Registry> {
  const text = await readText(registryFile());
  if (text === undefined) return { version: 1, projects: [] };
  return RegistrySchema.parse(JSON.parse(text));
}

export async function registerExternal(appRoot: string, dataDir: string): Promise<void> {
  const registry = await readRegistry();
  const projects = registry.projects.filter((p) => !samePath(p.appRoot, appRoot));
  projects.push({ appRoot: resolve(appRoot), dataDir: resolve(dataDir) });
  await writeFileAtomic(registryFile(), `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
}

export function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  for (let dir = resolve(path); ; dir = dirname(dir)) {
    result.push(dir);
    if (dirname(dir) === dir) return result;
  }
}

/**
 * Finds the data folder for a path inside an app (or for a data folder itself):
 * an in-repo `.appshape/` in the path or one of its parents first, then the registry.
 */
export async function resolveLocation(start: string): Promise<DataLocation | undefined> {
  const path = resolve(start);
  const registry = await readRegistry();

  if (await exists(join(path, "project.json"))) {
    const entry = registry.projects.find((p) => samePath(p.dataDir, path));
    if (entry) return { appRoot: entry.appRoot, dataDir: entry.dataDir, mode: "external" };
    if (basename(path) === DATA_DIR_NAME) return { appRoot: dirname(path), dataDir: path, mode: "in-repo" };
  }
  for (const dir of ancestors(path)) {
    if (await exists(join(dir, DATA_DIR_NAME, "project.json"))) {
      return { appRoot: dir, dataDir: join(dir, DATA_DIR_NAME), mode: "in-repo" };
    }
  }
  const matches = registry.projects
    .filter((p) => isInside(path, p.appRoot))
    .sort((a, b) => b.appRoot.length - a.appRoot.length);
  const match = matches[0];
  return match ? { appRoot: match.appRoot, dataDir: match.dataDir, mode: "external" } : undefined;
}
