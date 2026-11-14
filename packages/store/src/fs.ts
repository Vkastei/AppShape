import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/** Retries on transient Windows errors (files held open by editors, indexers, antivirus). */
async function withRetry<T>(action: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !RETRY_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
    }
  }
}

/** Writes via a temp file + rename so readers never see a half-written file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, content, "utf8");
  try {
    await withRetry(() => rename(temp, file));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function removeFile(file: string): Promise<void> {
  await withRetry(() => rm(file, { force: true }));
}

/** Removes `dir` if it is empty; ignores non-empty or missing directories. */
export async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // not empty or already gone
  }
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return normalizeNewlines(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function isTempFile(path: string): boolean {
  return /\.[0-9a-f]{8}\.tmp$/.test(path);
}
