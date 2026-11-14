import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defaultTokens, extractTokensV3, extractTokensV4 } from "@appshape/dialect-tailwind";
import { type Changeset, createId, type DesignNode, type DesignRequest, type Project, type Tokens } from "@appshape/ir";
import { renderSpecMarkdown } from "@appshape/protocol";
import { formatJson, readInstalledFonts } from "@appshape/store";
import { type AgentTask, type ApplyPlan, type FileChange, planApply } from "./apply";
import { appFiles, type Detection, detectApp } from "./detect";
import { handoffChangeset, handoffSpec } from "./handoff";
import { codeHash } from "./names";
import type { AppLayout, StackId } from "./stacks";
import { CODE_STATE_FILE, type CodeState, CodeStateSchema } from "./state";
import { withoutThemeBlock } from "./theme";

/** Applying a design to the app's code, for the server and the CLI. */

export interface CodeStatus {
  detection: Detection;
  /** The layout code is (or would be) generated for. */
  layout: AppLayout | undefined;
  applied: boolean;
  appliedAt?: string;
}

export interface PlannedApply {
  /** Identifies this exact plan; applying checks it is still the same. */
  planId: string;
  layout: AppLayout;
  scaffold: boolean;
  changes: FileChange[];
  tasks: AgentTask[];
  warnings: string[];
  install: boolean;
  /** Screens whose code changes or that have tasks. */
  frameIds: string[];
}

export interface AppliedResult {
  written: string[];
  deleted: string[];
  /** Changeset with the agent tasks (the caller saves it with the project). */
  changeset: Changeset | undefined;
  /** Spec files, relative to the data folder. */
  specFiles: string[];
  /** Screens whose code changed or that have tasks (what to verify). */
  frameIds: string[];
  install: boolean;
  scaffold: boolean;
}

export class PlanChangedError extends Error {
  constructor() {
    super("The design or the code changed since the preview; review the changes again.");
    this.name = "PlanChangedError";
  }
}

let defaultsPromise: Promise<Tokens> | undefined;
const tailwindDefaults = () => (defaultsPromise ??= defaultTokens());

export class CodeService {
  constructor(
    readonly appRoot: string,
    readonly dataDir: string,
  ) {}

  private files = () => appFiles(this.appRoot);

  async readState(): Promise<CodeState | undefined> {
    try {
      return CodeStateSchema.parse(JSON.parse(await readFile(join(this.dataDir, ...CODE_STATE_FILE.split("/")), "utf8")));
    } catch {
      return undefined;
    }
  }

  async status(): Promise<CodeStatus> {
    const detection = await detectApp(this.files());
    const state = await this.readState();
    const layout = detection.kind === "app" ? detection.layout : state?.layout;
    return { detection, layout, applied: Boolean(state), ...(state && { appliedAt: state.appliedAt }) };
  }

  /** What applying would do. `stack` is needed when there is no app yet (scaffold). */
  async plan(project: Project, options: { stack?: StackId } = {}): Promise<PlannedApply & { plan: ApplyPlan }> {
    const detection = await detectApp(this.files());
    if (detection.kind === "unsupported") throw new Error(`Can't generate code into this folder: ${detection.reason}.`);
    const scaffold = detection.kind === "none";
    if (scaffold && !options.stack) throw new Error("No app in this folder yet: pick a stack to create one.");
    const layout: AppLayout = detection.kind === "app" ? detection.layout : { stack: options.stack!, srcDir: options.stack!.startsWith("vite"), tailwind: 4 };
    const state = await this.readState();
    const plan = await planApply({
      project,
      layout,
      defaults: await this.themeDefaults(layout, scaffold, project),
      state,
      files: this.files(),
      ...(scaffold && { scaffold: { appName: project.name } }),
      now: new Date(0).toISOString(), // the real time is set when writing
      fonts: await readInstalledFonts(this.dataDir),
    });
    const planId = codeHash(JSON.stringify([layout, plan.changes.map((c) => [c.path, c.after ?? null]), plan.tasks.map((t) => t.key)]));
    return { planId, layout, scaffold, changes: plan.changes, tasks: plan.tasks, warnings: plan.warnings, install: plan.install, frameIds: plan.frameIds, plan };
  }

  /** Writes a plan after checking it is still what was previewed. */
  async apply(project: Project, planId: string, options: { stack?: StackId; now?: string; markupImage?: (request: DesignRequest) => Promise<Uint8Array | undefined> } = {}): Promise<AppliedResult> {
    const planned = await this.plan(project, options);
    if (planned.planId !== planId) throw new PlanChangedError();
    const now = options.now ?? new Date().toISOString();
    const written: string[] = [];
    const deleted: string[] = [];
    for (const change of planned.changes) {
      const target = this.inside(change.path);
      if (change.after === undefined) {
        await rm(target, { force: true });
        deleted.push(change.path);
      } else {
        await mkdir(dirname(target), { recursive: true });
        if (change.copyFrom) await copyFile(join(this.dataDir, ...change.copyFrom.split("/")), target);
        else await writeFile(target, change.after);
        written.push(change.path);
      }
    }
    await this.writeData(CODE_STATE_FILE, `${formatJson({ ...planned.plan.state, appliedAt: now })}\n`);

    let changeset: Changeset | undefined;
    const specFiles: string[] = [];
    if (planned.tasks.length > 0) {
      const id = createId("cs");
      // drawings kept as notes go with the spec as pictures (when a browser can draw them)
      const tasks: (AgentTask & { image?: string })[] = [];
      for (const task of planned.tasks) {
        const image = task.request && options.markupImage ? await options.markupImage(task.request).catch(() => undefined) : undefined;
        if (!image) {
          tasks.push(task);
          continue;
        }
        const path = `specs/${id}-${task.request!.id}.png`;
        await this.writeData(path, image);
        tasks.push({ ...task, image: path });
      }
      changeset = handoffChangeset(tasks, { id, now });
      const dataPrefix = relative(this.appRoot, this.dataDir).split("\\").join("/");
      const spec = handoffSpec(changeset, project, planned.layout, await this.themeDefaults(planned.layout, planned.scaffold, project), now, dataPrefix.startsWith("..") || isAbsolute(dataPrefix) ? this.dataDir.split("\\").join("/") : dataPrefix);
      for (const [path, content] of [
        [`specs/${changeset.id}.md`, renderSpecMarkdown(spec)],
        [`specs/${changeset.id}.json`, `${JSON.stringify(spec, null, 2)}\n`],
      ] as const) {
        await this.writeData(path, content);
        specFiles.push(path);
      }
    }
    return { written, deleted, changeset, specFiles, install: planned.install, scaffold: planned.scaffold, frameIds: planned.frameIds };
  }

  /**
   * The theme the app already has: Tailwind's defaults plus the app's own `@theme` (without
   * AppShape's block). Only tokens that differ from it go into AppShape's block, so an imported
   * app's theme isn't written twice.
   */
  private async themeDefaults(layout: AppLayout, scaffold: boolean, project?: Project): Promise<Tokens> {
    if (scaffold) return tailwindDefaults();
    try {
      return layout.tailwind === 4 ? await extractTokensV4(this.appRoot, { transform: withoutThemeBlock }) : await extractTokensV3(this.appRoot);
    } catch {
      // The app's theme can't be read (dependencies not installed): propose no theme changes.
      return project?.tokens ?? tailwindDefaults();
    }
  }

  /**
   * Verified imported pages: the code renders the design now, so it becomes their code state
   * (anchors from the recapture). Later design changes then apply directly again.
   */
  async rebaseline(trees: Readonly<Record<string, DesignNode>>): Promise<string[]> {
    const state = await this.readState();
    const ids = Object.keys(trees);
    if (!state || ids.length === 0) return [];
    const imported = { ...state.imported };
    for (const id of ids) imported[id] = { tree: trees[id]! };
    await this.writeData(CODE_STATE_FILE, `${formatJson({ ...state, imported })}\n`);
    return ids;
  }

  /** Absolute path of an app file; refuses paths that leave the app folder. */
  private inside(path: string): string {
    const target = resolve(this.appRoot, path);
    const rel = relative(this.appRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refusing to write outside the app: ${path}`);
    return target;
  }

  private async writeData(path: string, content: string | Uint8Array): Promise<void> {
    const target = join(this.dataDir, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, target);
  }
}
