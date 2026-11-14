import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { TokenGroup, Tokens } from "@appshape/ir";

/**
 * Tailwind v3 keeps its theme in `tailwind.config.*`. The app's own Tailwind resolves it (defaults
 * merged with `theme.extend`); the result maps onto the same token groups as v4, with the utility
 * suffixes as names (`colors.brand.600` → `$color.brand-600`, `borderRadius.DEFAULT` → `$radius.DEFAULT`).
 */

type ThemeValue = string | number | string[] | [string, unknown] | Record<string, unknown> | ((...args: unknown[]) => unknown);

const CONFIG_FILES = ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts", "tailwind.config.cts", "tailwind.config.mts"];

async function findConfig(appRoot: string): Promise<string | undefined> {
  const names = new Set(await readdir(appRoot).catch(() => [] as string[]));
  const found = CONFIG_FILES.find((f) => names.has(f));
  return found ? join(appRoot, found) : undefined;
}

/** Nested color objects → `name-shade`; `DEFAULT` → the name itself. */
function flattenColors(colors: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(colors)) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") out[name] = value;
    else if (value && typeof value === "object" && !Array.isArray(value)) flattenColors(value as Record<string, unknown>, name, out);
  }
  return out;
}

export function tokensFromV3Theme(theme: Record<string, ThemeValue>): Tokens {
  const groups: Partial<Record<TokenGroup, Record<string, string | number>>> = {};
  const put = (group: TokenGroup, name: string, value: string | number) => {
    (groups[group] ??= {})[name] = value;
  };
  const each = (key: string, fn: (name: string, value: ThemeValue) => void) => {
    const value = theme[key];
    if (value && typeof value === "object" && !Array.isArray(value)) for (const [name, v] of Object.entries(value)) fn(name, v as ThemeValue);
  };
  const scalar = (v: ThemeValue) => (typeof v === "string" || typeof v === "number" ? v : undefined);

  if (theme.colors && typeof theme.colors === "object") {
    for (const [name, value] of Object.entries(flattenColors(theme.colors as Record<string, unknown>))) put("color", name, value);
  }
  each("spacing", (name, v) => {
    const s = scalar(v);
    if (s !== undefined) put("spacing", name, s);
  });
  each("fontSize", (name, v) => {
    if (typeof v === "string") put("fontSize", name, v);
    else if (Array.isArray(v)) {
      put("fontSize", name, String(v[0]));
      const extra = v[1];
      const lineHeight = typeof extra === "string" ? extra : extra && typeof extra === "object" ? (extra as { lineHeight?: string }).lineHeight : undefined;
      if (lineHeight) put("lineHeight", name, lineHeight);
    }
  });
  each("fontWeight", (name, v) => {
    const s = scalar(v);
    if (s !== undefined) put("fontWeight", name, Number.isNaN(Number(s)) ? s : Number(s));
  });
  each("fontFamily", (name, v) => {
    const list = Array.isArray(v) ? (typeof v[0] === "string" && Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : Array.isArray(v[0]) ? (v[0] as string[]) : []) : typeof v === "string" ? [v] : [];
    if (list.length) put("fontFamily", name, list.join(", "));
  });
  for (const [key, group] of [
    ["lineHeight", "lineHeight"],
    ["letterSpacing", "letterSpacing"],
    ["borderRadius", "radius"],
    ["boxShadow", "shadow"],
    ["blur", "blur"],
    ["screens", "breakpoint"],
    ["maxWidth", "size"],
    ["opacity", "opacity"],
    ["zIndex", "zIndex"],
  ] as const) {
    each(key, (name, v) => {
      const s = scalar(v);
      if (s !== undefined && !(group === "size" && name.startsWith("screen-"))) put(group, name, s);
    });
  }
  return { source: "tailwind-v3", groups };
}

/** Tokens of a Tailwind v3 project, resolved by the project's own Tailwind. */
export async function extractTokensV3(appRoot: string): Promise<Tokens> {
  appRoot = resolve(appRoot);
  const require = createRequire(join(appRoot, "package.json"));
  const resolveConfig = require("tailwindcss/resolveConfig") as (config: unknown) => { theme: Record<string, ThemeValue> };
  const configPath = await findConfig(appRoot);
  let config: unknown = { content: [] };
  if (configPath) {
    const loadConfig = require("tailwindcss/loadConfig") as (path: string) => unknown;
    config = loadConfig(configPath);
  }
  return tokensFromV3Theme(resolveConfig(config).theme);
}
