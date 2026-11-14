import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { compile } from "tailwindcss";

/**
 * CSS for Tailwind classes (utilities only, no preflight), with the design system's `@theme` (and
 * AppShape's other theme parts) on top of Tailwind's defaults. The board uses it for classes the
 * design can't express yet (typed in "Classes"), so they show as in the app.
 */
export async function utilitiesCss(classes: readonly string[], themeCss = ""): Promise<string> {
  const require = createRequire(import.meta.url);
  const loadStylesheet = async (id: string, base: string) => {
    const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : require.resolve(id, { paths: [base, dirname(require.resolve("tailwindcss/index.css"))] });
    return { path, base: dirname(path), content: await readFile(path, "utf8") };
  };
  const input = `@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n${themeCss}`;
  const compiler = await compile(input, { base: dirname(require.resolve("tailwindcss/index.css")), loadStylesheet });
  return compiler.build([...classes]);
}
