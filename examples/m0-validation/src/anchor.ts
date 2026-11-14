import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAnchor } from "@appshape/ir";

export const FIXTURE_ROOT = fileURLToPath(new URL("../../../fixtures/vite-react-router-tw4/", import.meta.url));

/**
 * Stand-in for the importer's build-time transform: finds the JSX element in the fixture source
 * and returns its 1-based line/column, so the hand-written IR always matches the real files.
 */
export function anchor(
  file: string,
  needle: string,
  extra: Omit<SourceAnchor, "file" | "line" | "col"> = {},
): SourceAnchor {
  const text = readFileSync(join(FIXTURE_ROOT, file), "utf8").replace(/\r\n/g, "\n");
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`"${needle}" not found in ${file}`);
  if (text.indexOf(needle, index + 1) >= 0) throw new Error(`"${needle}" is ambiguous in ${file}`);
  const before = text.slice(0, index);
  return { file, line: before.split("\n").length, col: index - before.lastIndexOf("\n"), ...extra };
}
