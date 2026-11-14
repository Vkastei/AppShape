import { applyCommandToProject, BoardOpError, RequestOpError, type Changeset, type Command, OpError, type Project, type ProjectSettings, type RedactionConfig } from "@appshape/ir";
import type { ProjectSnapshot } from "@appshape/protocol";
import { type DataLocation, type Problem, ProjectFiles } from "@appshape/store";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type ApplyResult = { ok: true; rev: number } | { ok: false; error: string; rev: number };

/**
 * The open project: in-memory state (authoritative while the server runs), debounced saving,
 * and reloading when files change on disk.
 */
export class ProjectSession {
  private files: ProjectFiles;
  private project!: Project;
  private problems: Problem[] = [];
  private rev = 0;
  private saveTimer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();
  private stopWatching: (() => Promise<void>) | undefined;

  constructor(
    readonly location: DataLocation,
    private readonly log: Logger,
    private readonly saveDelayMs = 200,
  ) {
    this.files = new ProjectFiles(location);
  }

  async open(onExternalChange: (snapshot: ProjectSnapshot, paths: string[]) => void): Promise<void> {
    const { project, problems } = await this.files.load();
    this.project = project;
    this.problems = problems;
    for (const problem of problems) this.log.warn(`${problem.file}: ${problem.message}`);
    this.stopWatching = this.files.watch((paths) => void this.reload(paths, onExternalChange));
  }

  snapshot(): ProjectSnapshot {
    return {
      rev: this.rev,
      project: this.project,
      problems: this.problems,
      location: { mode: this.location.mode, appRoot: this.location.appRoot, dataDir: this.location.dataDir },
    };
  }

  get currentRev(): number {
    return this.rev;
  }

  apply(command: Command): ApplyResult {
    try {
      this.project = applyCommandToProject(this.project, command.ops);
    } catch (error) {
      if (error instanceof OpError || error instanceof BoardOpError || error instanceof RequestOpError) return { ok: false, error: error.message, rev: this.rev };
      throw error;
    }
    this.rev++;
    this.scheduleSave();
    return { ok: true, rev: this.rev };
  }

  /** Adds (or replaces) a changeset, e.g. the agent tasks of an apply. */
  /** Project-level fields (name, settings, redaction) changed in the settings. */
  updateProject(patch: { name?: string; settings?: ProjectSettings; redaction?: RedactionConfig }): void {
    const settings = patch.settings ?? this.project.settings;
    const { settings: _old, ...rest } = this.project;
    this.project = {
      ...rest,
      ...(patch.name && { name: patch.name }),
      ...(patch.redaction && { redaction: patch.redaction }),
      ...(settings && Object.keys(settings).length > 0 && { settings }),
    };
    this.rev++;
    this.scheduleSave();
  }

  addChangeset(changeset: Changeset): void {
    this.project = { ...this.project, changesets: [...this.project.changesets.filter((c) => c.id !== changeset.id), changeset] };
    this.rev++;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), this.saveDelayMs);
  }

  /** Writes pending changes now. */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const project = this.project;
    this.saving = this.saving.then(async () => {
      try {
        const touched = await this.files.save(project);
        if (touched.length > 0) this.log.info(`saved ${touched.join(", ")}`);
      } catch (error) {
        this.log.error(`saving failed: ${(error as Error).message}`);
      }
    });
    await this.saving;
  }

  private async reload(paths: string[], notify: (snapshot: ProjectSnapshot, paths: string[]) => void): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.log.warn("files changed on disk while edits were pending; the files on disk win");
    }
    await this.saving;
    try {
      const { project, problems } = await this.files.load();
      this.project = project;
      this.problems = problems;
      this.rev++;
      this.log.info(`reloaded after external change: ${paths.join(", ")}`);
      notify(this.snapshot(), paths);
    } catch (error) {
      this.log.error(`reload failed, keeping the open project: ${(error as Error).message}`);
    }
  }

  async close(): Promise<void> {
    await this.stopWatching?.();
    if (this.saveTimer) await this.flush();
    await this.saving;
  }
}

