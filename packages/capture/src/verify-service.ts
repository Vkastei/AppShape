import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CodeService } from "@appshape/codegen";
import { type Changeset, type Project, type ProjectSettings, transition } from "@appshape/ir";
import { type VerifyFrameResult, type VerifyReport, VerifyReportSchema } from "@appshape/protocol";
import type { Browser } from "playwright-core";
import { AppProcess, devServerOptions } from "./app-process";
import { launchBrowser } from "./capture";
import { Importer } from "./importer";
import { type FrameResult, rebaselines, verifyChangeset, verifyFrames } from "./verify";

/** Where reports and images go, inside the data folder (not committed). */
export const VERIFY_DIR = ".cache/verify";

export type FrameSummary = VerifyFrameResult;

export interface ChangesetVerification {
  report: VerifyReport;
  /** The changeset with its new status (verified / needs_fix), when the status could change. */
  changeset: Changeset;
  frames: FrameSummary[];
  /** Imported pages whose code state was updated (they verify completely). */
  rebaselined: string[];
}

export function summarizeFrames(frames: readonly FrameResult[]): FrameSummary[] {
  return frames.map((f) => ({
    frameId: f.frameId,
    viewport: f.viewport,
    url: f.url,
    ...(f.error && { error: f.error }),
    elements: f.elements.length,
    failing: f.elements.filter((e) => e.problems.length).map((e) => ({ key: e.key, label: e.label, problems: e.problems })),
    extra: [...f.extra.values()].flat(),
    ...(f.mismatchRatio !== undefined && { mismatchRatio: f.mismatchRatio }),
    ...(f.images && { images: f.images }),
  }));
}

/**
 * Verification for the CLI, the MCP server and the editor's server: uses the given dev server or
 * starts the app's own (kept running until `close()`, so an agent can verify again quickly), keeps
 * one browser, writes reports, updates the code state of verified imported pages.
 */
export class VerifyService {
  private app: AppProcess | undefined;
  private startedUrl: string | undefined;
  private browser: Promise<Browser> | undefined;

  constructor(
    readonly appRoot: string,
    readonly dataDir: string,
  ) {}

  /** A running dev server: `url`, else the one this service started, else a new one. */
  async devServer(url?: string, log: (line: string) => void = () => {}, settings?: ProjectSettings): Promise<string> {
    const given = url ?? settings?.app?.devUrl;
    if (given) return given;
    if (this.startedUrl && this.app?.status().state === "running") return this.startedUrl;
    const status = await new Importer(this.appRoot, this.dataDir).status();
    if (status.detection.kind !== "app") throw new Error(status.detection.kind === "none" ? "No app found in this folder." : `Can't verify this app: ${status.detection.reason}.`);
    this.app ??= new AppProcess(this.appRoot);
    log(`Starting the app (${status.packageManager} run dev)…`);
    await this.app.run(await devServerOptions(settings?.app, status.detection.layout.stack.startsWith("next") ? "next" : "vite"));
    const started = await this.app.waitForUrl();
    if (!started) throw new Error(`The dev server did not start:\n${this.app.status().log.slice(-20).join("\n")}`);
    this.startedUrl = started;
    return started;
  }

  private openBrowser(): Promise<Browser> {
    this.browser ??= launchBrowser();
    return this.browser;
  }

  /** Checks screens against the design (e.g. after AppShape applied the design directly). */
  async verifyFrames(project: Project, frameIds: readonly string[], options: { url?: string; log?: (line: string) => void } = {}): Promise<{ frames: FrameSummary[]; rebaselined: string[] }> {
    const devUrl = await this.devServer(options.url, options.log, project.settings);
    const outDir = join(this.dataDir, ...VERIFY_DIR.split("/"), "frames");
    const frames = await verifyFrames({ appRoot: this.appRoot, dataDir: this.dataDir, project, devUrl, frameIds, outDir, browser: await this.openBrowser(), ...checkOptions(project) });
    const rebaselined = await new CodeService(this.appRoot, this.dataDir).rebaseline(rebaselines(frames));
    return { frames: summarizeFrames(frames), rebaselined };
  }

  /** Verifies a changeset and computes its new status; the caller saves the changeset. */
  async verifyChangeset(project: Project, changesetId: string, options: { url?: string; changeIds?: readonly string[]; log?: (line: string) => void; now?: string } = {}): Promise<ChangesetVerification> {
    const changeset = project.changesets.find((c) => c.id === changesetId);
    if (!changeset) throw new Error(`Unknown changeset ${changesetId}`);
    const devUrl = await this.devServer(options.url, options.log, project.settings);
    const code = new CodeService(this.appRoot, this.dataDir);
    const state = await code.readState();
    const now = options.now ?? new Date().toISOString();
    const { report, frames } = await verifyChangeset({
      appRoot: this.appRoot,
      dataDir: this.dataDir,
      project,
      devUrl,
      changeset,
      ...(options.changeIds?.length && { changeIds: options.changeIds }),
      ...(state?.imported && { before: state.imported }),
      outDir: join(this.dataDir, ...VERIFY_DIR.split("/"), changeset.id),
      browser: await this.openBrowser(),
      now,
      ...checkOptions(project),
    });
    await this.writeReport(report);
    // Only a check of every change decides the status.
    const rebaselined = report.status === "verified" && !options.changeIds?.length ? await code.rebaseline(rebaselines(frames)) : [];
    return { report, changeset: nextStatus(changeset, report, Boolean(options.changeIds?.length), now), frames: summarizeFrames(frames), rebaselined };
  }

  /** The last report of a changeset, if it was verified before. */
  async readReport(changesetId: string): Promise<VerifyReport | undefined> {
    try {
      return VerifyReportSchema.parse(JSON.parse(await readFile(this.reportPath(changesetId), "utf8")));
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.app?.stop();
    this.app = undefined;
    this.startedUrl = undefined;
    const browser = this.browser;
    this.browser = undefined;
    await (await browser?.catch(() => undefined))?.close();
  }

  private reportPath(changesetId: string): string {
    return join(this.dataDir, ...VERIFY_DIR.split("/"), `${changesetId}.json`);
  }

  private async writeReport(report: VerifyReport): Promise<void> {
    const target = this.reportPath(report.changesetId);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(tmp, target);
  }
}

/** The project's settings for checks (which viewports, how exact). */
function checkOptions(project: Project): { viewports?: string[]; tolerance?: number } {
  const verify = project.settings?.verify;
  return { ...(verify?.viewports?.length && { viewports: verify.viewports }), ...(verify?.tolerance !== undefined && { tolerance: verify.tolerance }) };
}

/** The changeset after a verification: verified / needs_fix where its lifecycle allows it. */
export function nextStatus(changeset: Changeset, report: VerifyReport, partial: boolean, at: string): Changeset {
  const passed = report.results.filter((r) => r.status === "pass").length;
  const note = `${passed}/${report.results.length} changes pass`;
  const to = report.status === "verified" ? (partial ? undefined : "verified") : "needs_fix";
  if (!to || changeset.status === to) return changeset;
  try {
    return transition(changeset, to, "verify", { note, at });
  } catch {
    return changeset; // e.g. still a draft: report only
  }
}
