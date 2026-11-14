import { createHash } from "node:crypto";

/** "Pricing card" → "PricingCard"; leading digits get a prefix. */
export function pascalCase(value: string): string {
  const words = value.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `Screen${name}`;
}

/** "Pricing card" → "pricingCard". */
export function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal[0]!.toLowerCase() + pascal.slice(1);
}

/** Adds 2, 3, … until the name is free (and marks it taken). */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
  taken.add(name);
  return name;
}

/** "/" → "", "/pricing/team" → "pricing/team". */
export function routeSegments(route: string): string {
  return route.replace(/^\/+|\/+$/g, "");
}

/** "Hello world" → "/hello-world" ("Home" → "/"). Same rule as the editor's new screens. */
export function slugRoute(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug === "home" || slug === "" ? "/" : `/${slug}`;
}

/**
 * Hash of code as AppShape wrote it, ignoring whitespace (so re-indentation or a formatter
 * don't count as edits).
 */
export function codeHash(code: string): string {
  return createHash("sha1").update(code.replace(/\s+/g, "")).digest("hex").slice(0, 16);
}
