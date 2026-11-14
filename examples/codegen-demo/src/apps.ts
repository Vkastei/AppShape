import { fileURLToPath } from "node:url";
import { type AppLayout, newAppFiles, STACK_IDS, type StackId } from "@appshape/codegen";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { demoProject } from "./design";
import { landingProject } from "./landing";

/** Where the generated example apps live (workspace packages, so they install and type-check). */
export const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
export const appDir = (stack: StackId) => `generated-${stack}`;
/** The Vite + React Router app again, for an app that animates with Motion. */
export const MOTION_APP = "generated-vite-motion";

/** The landing page with interactions (benchmark B3): a CSS app and a Motion app. */
export const LANDING_APPS = { css: "generated-landing", motion: "generated-landing-motion" } as const;

/** Every file of the generated apps (four stacks, the Motion app, the landing apps), keyed by path relative to `fixtures/`. */
export async function buildApps(): Promise<{ files: Map<string, string>; warnings: Record<string, string[]>; skipped: string[] }> {
  const defaults = await defaultTokens();
  const project = demoProject(defaults);
  const files = new Map<string, string>();
  const warnings: Record<string, string[]> = {};
  let skipped: string[] = [];
  for (const stack of STACK_IDS) {
    const layout: AppLayout = { stack, srcDir: stack.startsWith("vite"), tailwind: 4 };
    const app = newAppFiles({ project, layout, defaults }, `generated-${stack}`);
    for (const [path, content] of app.files) files.set(`${appDir(stack)}/${path}`, content);
    warnings[stack] = app.generated.warnings;
    skipped = app.generated.skipped.map((s) => `${s.frameId}: ${s.reason}`);
  }
  const motion = newAppFiles({ project, layout: { stack: "vite-react-router", srcDir: true, tailwind: 4, motion: "motion" }, defaults }, MOTION_APP);
  for (const [path, content] of motion.files) files.set(`${MOTION_APP}/${path}`, content);
  warnings.motion = motion.generated.warnings;
  const landing = landingProject(defaults);
  for (const [kind, dir] of Object.entries(LANDING_APPS)) {
    const app = newAppFiles({ project: landing, layout: { stack: "vite-react-router", srcDir: true, tailwind: 4, ...(kind === "motion" && { motion: "motion" as const }) }, defaults }, dir);
    for (const [path, content] of app.files) files.set(`${dir}/${path}`, content);
    warnings[dir] = app.generated.warnings;
  }
  return { files, warnings, skipped };
}
