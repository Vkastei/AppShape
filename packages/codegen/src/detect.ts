import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppFiles } from "./apply";
import type { AppLayout, StackId } from "./stacks";

/** Reads app files relative to the app root; missing files read as undefined. */
export function appFiles(appRoot: string): AppFiles {
  return {
    read: async (path) => {
      try {
        return (await readFile(join(appRoot, path), "utf8")).replace(/\r\n/g, "\n");
      } catch {
        return undefined;
      }
    },
    list: async () => {
      const out: string[] = [];
      const skip = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".appshape", "coverage", "public"]);
      const walk = async (dir: string, rel: string, depth: number) => {
        if (depth > 8) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
          const path = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(join(dir, entry.name), path, depth + 1);
          else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !/\.config\./.test(entry.name)) out.push(path);
        }
      };
      await walk(appRoot, "", 0);
      return out;
    },
  };
}

export type Detection = { kind: "none" } | { kind: "app"; layout: AppLayout } | { kind: "unsupported"; reason: string };

const CSS_CANDIDATES = ["src/index.css", "src/app/globals.css", "app/globals.css", "styles/globals.css", "src/styles/globals.css", "src/main.css", "src/App.css", "src/styles.css"];

/** What kind of app is in the folder (from package.json and the file layout). */
export async function detectApp(files: AppFiles): Promise<Detection> {
  const pkg = await files.read("package.json");
  if (pkg === undefined) return { kind: "none" };
  let deps: Record<string, string>;
  try {
    const json = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    deps = { ...json.dependencies, ...json.devDependencies };
  } catch {
    return { kind: "unsupported", reason: "package.json is not valid JSON" };
  }
  const has = async (path: string) => (await files.read(path)) !== undefined;
  let stack: StackId;
  let srcDir = true;
  if (deps.next) {
    const appRouter = (await has("app/layout.tsx")) || (await has("src/app/layout.tsx")) || (await has("app/layout.jsx")) || (await has("src/app/layout.jsx"));
    stack = appRouter ? "next-app" : "next-pages";
    srcDir = (await has("src/app/layout.tsx")) || (await has("src/pages/_app.tsx")) || (await has("src/pages/index.tsx"));
  } else if (deps["@tanstack/react-router"]) {
    stack = "vite-tanstack";
  } else if (deps["react-router"] || deps["react-router-dom"]) {
    stack = "vite-react-router";
  } else {
    return { kind: "unsupported", reason: "no supported router found (React Router, TanStack Router or Next.js)" };
  }
  const tw = deps.tailwindcss ?? deps["@tailwindcss/vite"] ?? deps["@tailwindcss/postcss"];
  if (!tw) return { kind: "unsupported", reason: "Tailwind CSS is not installed" };
  const tailwind = /^[\^~]?3\./.test(tw) ? 3 : 4;
  let cssPath: string | undefined;
  for (const candidate of CSS_CANDIDATES) {
    const css = await files.read(candidate);
    if (css && /@import\s+["']tailwindcss|@tailwind\s+base|@theme\b/.test(css)) {
      cssPath = candidate;
      break;
    }
  }
  const motion = deps.motion ? "motion" : deps["framer-motion"] ? "framer-motion" : undefined;
  return { kind: "app", layout: { stack, srcDir, tailwind, ...(cssPath && { cssPath }), ...(motion && { motion }) } };
}
