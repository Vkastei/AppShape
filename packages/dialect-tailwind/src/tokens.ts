import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { TokenGroup, Tokens } from "@appshape/ir";

/**
 * Tailwind v4 keeps its whole theme in CSS custom properties inside `@theme` blocks: the defaults
 * in `tailwindcss/theme.css` plus the project's own `@theme` blocks. Token names are the utility
 * suffixes (`--color-primary-600` → `$color.primary-600`, used by `bg-primary-600`).
 */

/** Spacing steps that get a named token (`$spacing.4`); other multiples become raw values. */
export const SPACING_STEPS = [
  "0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16",
  "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96",
];

const NAMESPACES: [prefix: string, group: TokenGroup][] = [
  ["--color-", "color"],
  ["--breakpoint-", "breakpoint"],
  ["--container-", "size"],
  ["--font-weight-", "fontWeight"],
  ["--font-", "fontFamily"],
  ["--tracking-", "letterSpacing"],
  ["--leading-", "lineHeight"],
  ["--radius-", "radius"],
  ["--shadow-", "shadow"],
  ["--blur-", "blur"],
];

/** Reads `--name: value;` declarations from every `@theme` block (later blocks win). */
export function themeVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /@theme\b[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(withoutComments))) {
    let depth = 1;
    let i = block.lastIndex;
    const start = i;
    while (i < withoutComments.length && depth > 0) {
      if (withoutComments[i] === "{") depth++;
      else if (withoutComments[i] === "}") depth--;
      i++;
    }
    const body = withoutComments.slice(start, i - 1);
    for (const decl of body.matchAll(/(--[A-Za-z0-9_.-]+)\s*:\s*([^;]+);/g)) {
      const value = decl[2]!.trim().replace(/\s+/g, " ");
      if (value === "initial") vars.delete(decl[1]!);
      else vars.set(decl[1]!, value);
    }
  }
  return vars;
}

function parseLength(value: string): { amount: number; unit: string } | undefined {
  const m = /^(-?[0-9.]+)(rem|px|em)$/.exec(value);
  return m ? { amount: Number(m[1]), unit: m[2]! } : undefined;
}

export function tokensFromThemeVariables(vars: ReadonlyMap<string, string>): Tokens {
  const groups: Partial<Record<TokenGroup, Record<string, string | number>>> = {};
  const put = (group: TokenGroup, name: string, value: string | number) => {
    (groups[group] ??= {})[name] = value;
  };

  for (const [name, value] of vars) {
    // `--text-shadow-*` (Tailwind 4.1's text shadows) are not font sizes
    if (name.startsWith("--text-shadow-")) continue;
    if (name.startsWith("--text-")) {
      const rest = name.slice("--text-".length);
      if (rest.endsWith("--line-height")) put("lineHeight", rest.slice(0, -"--line-height".length), value);
      else if (!rest.includes("--")) put("fontSize", rest, value);
      continue;
    }
    const namespace = NAMESPACES.find(([prefix]) => name.startsWith(prefix));
    if (!namespace) continue;
    const key = name.slice(namespace[0].length);
    if (key.includes("--")) continue; // sub-properties like --font-sans--font-feature-settings
    const numeric = Number(value);
    put(namespace[1], key, namespace[1] === "fontWeight" && !Number.isNaN(numeric) ? numeric : value);
  }

  const spacing = parseLength(vars.get("--spacing") ?? "0.25rem");
  if (spacing) {
    for (const step of SPACING_STEPS) put("spacing", step, step === "0" ? "0" : `${+(Number(step) * spacing.amount).toFixed(4)}${spacing.unit}`);
    put("spacing", "px", "1px");
  }
  put("radius", "none", "0");
  put("radius", "full", "9999px");
  return { source: "tailwind-v4", groups };
}

/** CSS files of the app that configure Tailwind (`@import "tailwindcss"` or `@theme`). */
async function findThemeCss(appRoot: string, transform: (css: string) => string = (css) => css): Promise<string[]> {
  const found: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".appshape", "coverage"]);
  const walk = async (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.name.endsWith(".css")) {
        const css = transform(await readFile(path, "utf8"));
        if (/@import\s+["']tailwindcss|@theme\b/.test(css)) found.push(css);
      }
    }
  };
  await walk(appRoot, 0);
  return found;
}

/**
 * Tokens of a Tailwind v4 project: default theme + the project's `@theme` blocks. `transform`
 * edits each CSS file first (e.g. to leave out a block AppShape generated).
 */
export async function extractTokensV4(appRoot: string, options: { transform?: (css: string) => string } = {}): Promise<Tokens> {
  const require = createRequire(join(appRoot, "package.json"));
  const defaults = await readFile(require.resolve("tailwindcss/theme.css"), "utf8");
  const project = await findThemeCss(appRoot, options.transform);
  return tokensFromThemeVariables(themeVariables([defaults, ...project].join("\n")));
}

/** Tailwind's default design system: the starting point for new projects. */
export async function defaultTokens(): Promise<Tokens> {
  const require = createRequire(import.meta.url);
  const defaults = await readFile(require.resolve("tailwindcss/theme.css"), "utf8");
  return tokensFromThemeVariables(themeVariables(defaults));
}
