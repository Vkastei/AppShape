import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FONTS_DIR, type FontMeta, FontMetaSchema } from "@appshape/protocol";

export interface InstalledFont extends FontMeta {
  /** `font.css` as written (URLs relative to the font's folder). */
  css: string;
}

/** Every font installed in the project (`dataDir` = the `.appshape` folder), by slug. */
export async function readInstalledFonts(dataDir: string): Promise<InstalledFont[]> {
  const root = join(dataDir, ...FONTS_DIR.split("/"));
  const slugs = await readdir(root).catch(() => [] as string[]);
  const fonts: InstalledFont[] = [];
  for (const slug of slugs.sort()) {
    try {
      const meta = FontMetaSchema.parse(JSON.parse(await readFile(join(root, slug, "font.json"), "utf8")));
      fonts.push({ ...meta, css: await readFile(join(root, slug, "font.css"), "utf8") });
    } catch {
      // half-installed or not a font folder: skip
    }
  }
  return fonts;
}
