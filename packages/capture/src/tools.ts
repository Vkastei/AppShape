import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { PackageManager } from "./app-process";

/** Programs on the user's computer: Node, package managers, Git, a browser for capturing. */

/** `<command> --version` (first version number in the output), or undefined if it isn't installed. */
export function toolVersion(command: string, args: string[] = ["--version"], timeoutMs = 15_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      const options = { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], env: process.env };
      // .cmd shims (npm, pnpm on Windows) need a shell; the arguments are fixed words
      child = process.platform === "win32" ? spawn([command, ...args].join(" "), { ...options, shell: true }) : spawn(command, args, options);
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? /\d+\.\d+(?:\.\d+)?/.exec(out)?.[0] : undefined);
    });
  });
}

function regPath(key: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", "Path"], { windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(stdout)?.[1]?.trim());
    });
  });
}

/**
 * Re-reads PATH from the registry (Windows), so programs installed while AppShape runs are found
 * without restarting it. Entries only the current process has are kept.
 */
export async function refreshPath(): Promise<void> {
  if (process.platform !== "win32") return;
  const [machine, user] = await Promise.all([
    regPath("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
    regPath("HKCU\\Environment"),
  ]);
  if (machine === undefined && user === undefined) return;
  const expand = (value: string) => value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
  const fresh = [machine, user].filter((v): v is string => Boolean(v)).flatMap((v) => expand(v).split(delimiter)).filter(Boolean);
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "Path";
  const current = (process.env[key] ?? "").split(delimiter).filter(Boolean);
  const seen = new Set(fresh.map((p) => p.toLowerCase()));
  process.env[key] = [...fresh, ...current.filter((p) => !seen.has(p.toLowerCase()))].join(delimiter);
}

/** Package manager for an app without a lockfile (a new app): pnpm when installed, else npm (comes with Node). */
export async function defaultManager(): Promise<PackageManager> {
  return (await toolVersion("pnpm")) ? "pnpm" : "npm";
}

/** Installed Edge or Chrome (AppShape drives the user's own browser for capturing and checks). */
export function findBrowser(): { name: string; path: string } | undefined {
  const env = process.env;
  const candidates: [string, string | undefined][] =
    process.platform === "win32"
      ? [
          ["Microsoft Edge", env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")],
          ["Microsoft Edge", env.ProgramFiles && join(env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")],
          ["Google Chrome", env.ProgramFiles && join(env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")],
          ["Google Chrome", env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe")],
          ["Google Chrome", env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")],
        ]
      : process.platform === "darwin"
        ? [
            ["Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
            ["Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
          ]
        : [
            ["Microsoft Edge", "/opt/microsoft/msedge/msedge"],
            ["Google Chrome", "/opt/google/chrome/chrome"],
          ];
  for (const [name, path] of candidates) if (path && existsSync(path)) return { name, path };
  return undefined;
}
