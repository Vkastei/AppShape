import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { ProjectSettings } from "@appshape/ir";
import type { AppProcessStatus } from "@appshape/protocol";
import { defaultManager } from "./tools";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const MAX_LOG = 200;
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?/;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** The app's package manager: `packageManager` in package.json, else the nearest lockfile. */
export async function detectPackageManager(appRoot: string, fallback: PackageManager = "pnpm"): Promise<PackageManager> {
  try {
    const pkg = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8")) as { packageManager?: string };
    const named = /^(pnpm|npm|yarn|bun)@/.exec(pkg.packageManager ?? "")?.[1];
    if (named) return named as PackageManager;
  } catch {
    // no package.json yet (scaffold)
  }
  let dir = appRoot;
  for (let depth = 0; depth < 8; depth++) {
    for (const [file, manager] of LOCKFILES) {
      try {
        await readFile(join(dir, file), { flag: "r" }).then(() => undefined);
        return manager;
      } catch {
        // keep looking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback;
}

/** A free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface StartOptions {
  install: boolean;
  start: boolean;
  /** Dev server port (passed as `--port`). */
  port?: number;
  /** Vite needs `--strictPort` so it doesn't move to another port. */
  framework?: "next" | "vite" | "other";
  /** package.json script to run (default `dev`). */
  script?: string;
  /** Default: from the lockfile. */
  manager?: PackageManager;
}

/**
 * How to start the app's dev server with the project's settings (script, package manager, port);
 * `freePort` picks a free port when the settings don't fix one (for AppShape's own runs).
 */
export async function devServerOptions(
  settings: ProjectSettings["app"] | undefined,
  framework: StartOptions["framework"],
  options: { freePort?: boolean } = {},
): Promise<StartOptions> {
  const port = settings?.port ?? (options.freePort === false ? undefined : await freePort());
  return {
    install: false,
    start: true,
    framework,
    ...(port && { port }),
    ...(settings?.devScript && { script: settings.devScript }),
    ...(settings?.packageManager && { manager: settings.packageManager }),
  };
}

/**
 * The user's app as a child process: install, then `<pm> run dev`. Its output is kept so the
 * editor can show progress, and the dev server URL is read from it.
 */
export class AppProcess {
  private state: AppProcessStatus["state"] = "idle";
  private log: string[] = [];
  private url: string | undefined;
  private child: ChildProcess | undefined;
  private step: string | undefined;
  private manager: PackageManager | undefined;
  private waiters: Array<(url: string | undefined) => void> = [];
  private listeners = new Set<(event: AppProcessEvent) => void>();

  constructor(private readonly appRoot: string) {}

  /** Output lines and state changes, e.g. for the editor's log. Returns the unsubscribe function. */
  onEvent(listener: (event: AppProcessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AppProcessEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // a listener's problem is not the app's
      }
    }
  }

  private setState(state: AppProcessStatus["state"]): void {
    if (state === this.state) return;
    this.state = state;
    this.emit({ type: "state", state, ...(this.url && { url: this.url }), ...(this.step && { step: this.step }), ...(this.manager && { manager: this.manager }) });
  }

  status(): AppProcessStatus {
    return { state: this.state, log: this.log.slice(-60), ...(this.url && { url: this.url }), ...(this.step && { step: this.step }) };
  }

  /** Installs dependencies, then starts the dev server (each only when asked). */
  async run(options: StartOptions): Promise<void> {
    await this.stop();
    this.log = [];
    this.url = undefined;
    this.manager = options.manager ?? (await detectPackageManager(this.appRoot, await defaultManager()));
    if (options.install) {
      this.step = `${this.manager} install`;
      this.setState("installing");
      const ok = await this.exec(`${this.manager} install`, ["install"]);
      if (!ok) {
        this.setState("failed");
        this.settle();
        return;
      }
    }
    if (options.start) this.start(options);
    else {
      this.setState("idle");
      this.settle();
    }
  }

  /** Resolves with the dev server URL once it is up (undefined if it fails or stops first). */
  waitForUrl(timeoutMs = 120_000): Promise<string | undefined> {
    if (this.url) return Promise.resolve(this.url);
    if (this.state !== "starting" && this.state !== "installing") return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      this.waiters.push((url) => {
        clearTimeout(timer);
        resolve(url);
      });
    });
  }

  private settle(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter(this.url);
  }

  private start(options: StartOptions): void {
    const manager = this.manager ?? "pnpm";
    const extra: string[] = [];
    if (options.port) {
      extra.push("--port", String(options.port));
      if (options.framework === "vite") extra.push("--strictPort");
    }
    // npm and bun need `--` before script arguments; pnpm and yarn pass them on.
    const args = ["run", options.script ?? "dev", ...(extra.length && (manager === "npm" || manager === "bun") ? ["--"] : []), ...extra];
    this.step = `${manager} ${args.join(" ")}`;
    this.setState("starting");
    this.append(`$ ${this.step}`);
    const child = this.spawn(manager, args);
    this.child = child;
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString().replace(ANSI, "").split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.append(line);
        const match = URL_PATTERN.exec(line);
        if (match && !this.url) {
          this.url = match[0].replace(/\/$/, "");
          this.setState("running");
          this.settle();
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      this.append(`could not run ${manager}: ${error.message}`);
      this.setState("failed");
      this.settle();
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.append(`dev server exited (${code ?? "killed"})`);
      this.url = undefined;
      this.setState(this.state === "running" || code === 0 || code === null ? "stopped" : "failed");
      this.settle();
    });
  }

  private exec(label: string, args: string[]): Promise<boolean> {
    const manager = this.manager ?? "pnpm";
    this.step = label;
    this.append(`$ ${label}`);
    return new Promise((resolve) => {
      const child = this.spawn(manager, args);
      this.child = child;
      const onData = (chunk: Buffer) => {
        for (const line of chunk.toString().replace(ANSI, "").split(/\r?\n/)) if (line.trim()) this.append(line);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (error) => {
        this.append(`could not run ${manager}: ${error.message}`);
        resolve(false);
      });
      child.on("exit", (code) => {
        if (this.child === child) this.child = undefined;
        if (code !== 0) this.append(`${label} failed (exit code ${code})`);
        resolve(code === 0);
      });
    });
  }

  private spawn(manager: PackageManager, args: string[]): ChildProcess {
    const options = { cwd: this.appRoot, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" } };
    // On Windows package managers are .cmd shims and need a shell; the arguments are fixed words and numbers.
    return process.platform === "win32" ? spawn([manager, ...args].join(" "), { ...options, shell: true }) : spawn(manager, args, options);
  }

  private append(line: string): void {
    this.emit({ type: "line", line });
    this.log.push(line);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  /** Stops whatever runs (the whole process tree). */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    this.child = undefined;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("exit", () => setTimeout(resolve, 200));
      else child.kill("SIGTERM");
      setTimeout(resolve, 3000);
    });
    this.url = undefined;
    this.setState("stopped");
    this.settle();
  }
}

export type AppProcessEvent =
  | { type: "line"; line: string }
  | { type: "state"; state: AppProcessStatus["state"]; url?: string; step?: string; manager?: PackageManager };
