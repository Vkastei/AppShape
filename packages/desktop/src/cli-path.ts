import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appshapeHome, readUserSettings, updateUserSettings } from "@appshape/store";

/**
 * The `appshape` command in terminals: a small script in ~/.appshape/bin that runs the bundled CLI
 * with the desktop app's executable (in Node mode); on Windows that folder is added to the user's PATH.
 */

export interface CliOnPath {
  on: boolean;
  /** The folder with the script. */
  dir: string;
  /** The PATH can't be changed automatically here: add `dir` yourself. */
  manual: boolean;
}

export const binDir = () => join(appshapeHome(), "bin");
const shimFile = () => join(binDir(), process.platform === "win32" ? "appshape.cmd" : "appshape");

export function shimContent(target: { exe: string; cli: string }, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${target.exe}" "${target.cli}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${target.exe}" "${target.cli}" "$@"\n`;
}

/** Adds the folder to (or removes it from) the user's PATH in the registry, keeping `%VAR%` entries as they are. */
export function setUserPath(dir: string, add: boolean): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const script = [
    "$dir = $env:APPSHAPE_BIN_DIR",
    "$key = Get-Item -Path 'HKCU:\\Environment'",
    "$path = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
    "$parts = @($path -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ne $dir.TrimEnd('\\')) })",
    "if ($env:APPSHAPE_ADD -eq '1') { $parts += $dir }",
    "Set-ItemProperty -Path 'HKCU:\\Environment' -Name 'Path' -Value ($parts -join ';') -Type ExpandString",
    // tells open programs (Explorer, new terminals) that the environment changed
    "[Environment]::SetEnvironmentVariable('APPSHAPE_PATH_CHANGED', '1', 'User')",
    "[Environment]::SetEnvironmentVariable('APPSHAPE_PATH_CHANGED', $null, 'User')",
  ].join("; ");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, env: { ...process.env, APPSHAPE_BIN_DIR: dir, APPSHAPE_ADD: add ? "1" : "0" } },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve()),
    );
  });
}

export async function cliOnPath(): Promise<CliOnPath> {
  const settings = await readUserSettings();
  return { on: Boolean(settings.cliOnPath) && existsSync(shimFile()), dir: binDir(), manual: process.platform !== "win32" };
}

export async function setCliOnPath(on: boolean, target: { exe: string; cli: string }, updatePath = setUserPath): Promise<CliOnPath> {
  if (on) {
    await writeShim(target);
  } else {
    await rm(shimFile(), { force: true });
  }
  await updatePath(binDir(), on);
  await updateUserSettings((s) => ({ ...s, cliOnPath: on }));
  return cliOnPath();
}

async function writeShim(target: { exe: string; cli: string }): Promise<void> {
  await mkdir(binDir(), { recursive: true });
  await writeFile(shimFile(), shimContent(target));
  if (process.platform !== "win32") await chmod(shimFile(), 0o755);
}

/** After an update the app may live elsewhere: rewrite the script if it is on. */
export async function refreshShim(target: { exe: string; cli: string }): Promise<void> {
  if ((await readUserSettings()).cliOnPath) await writeShim(target);
}
