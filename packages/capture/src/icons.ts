import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The icon SVGs the board draws (lucide-static). */
export function lucideIconsDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("lucide-static/package.json")), "icons");
}

let names: Set<string> | undefined;
let list: { name: string; tags: string[] }[] | undefined;

/** All icons of the board's set with their search tags (lucide's `tags.json`). */
export function lucideIconList(): { name: string; tags: string[] }[] {
  if (list) return list;
  const dir = lucideIconsDir();
  let tags: Record<string, string[]> = {};
  try {
    tags = JSON.parse(readFileSync(join(dir, "..", "tags.json"), "utf8")) as Record<string, string[]>;
  } catch {
    // older lucide-static: names only
  }
  list = readdirSync(dir)
    .filter((f) => f.endsWith(".svg"))
    .map((f) => f.slice(0, -4))
    .sort()
    .map((name) => ({ name, tags: tags[name] ?? [] }));
  return list;
}

/** Whether the board has an icon (`lucide` set only for now). */
export function hasIcon(set: string, name: string): boolean {
  if (set !== "lucide") return false;
  names ??= new Set(readdirSync(lucideIconsDir()).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));
  return names.has(name);
}
