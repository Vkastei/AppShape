import { z } from "zod";

/** `POST /api/assets?name=<file name>` (body: the file): the stored asset. */
export interface UploadedAsset {
  /** `asset:uploads/<name>-<hash>.<ext>`, usable as an image source. */
  src: string;
}

/** Image files the board accepts (by extension). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] as const;

/**
 * A font installed in a project: `.appshape/assets/fonts/<slug>/` holds `font.json` (this), `font.css`
 * (`@font-face` rules with `./files/…` URLs) and the `files/*.woff2` they load. Self-hosted, so the board
 * and the generated app use the same files and no page loads fonts from a third party.
 */
export const FontMetaSchema = z.object({
  /** Google Fonts family name ("Inter"). */
  family: z.string().min(1),
  /** The family name the `@font-face` rules declare ("Inter Variable" for variable fonts). */
  cssFamily: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Google Fonts category: "Sans Serif", "Serif", "Display", "Handwriting", "Monospace". */
  category: z.string(),
  variable: z.boolean(),
  weights: z.array(z.number().int()),
  italic: z.boolean(),
  /** The fontsource package the files come from (`@fontsource-variable/inter`). */
  package: z.string(),
  /** Font files, relative to the font's folder (`files/inter-latin-wght-normal.woff2`). */
  files: z.array(z.string()),
  installedAt: z.string(),
});
export type FontMeta = z.infer<typeof FontMetaSchema>;

/** A Google Fonts family in the picker (`GET /api/fonts/catalog`), most popular first. */
export interface CatalogFont {
  family: string;
  category: string;
  /** Normal (upright) weights. */
  weights: number[];
  italic: boolean;
  variable: boolean;
}

export interface FontCatalogResponse {
  fonts: CatalogFont[];
  /** False when Google Fonts couldn't be reached and nothing was cached: only a short built-in list. */
  complete: boolean;
}

/** `GET /api/fonts`, `POST /api/fonts` ({ family }): installed fonts. */
export interface InstalledFontsResponse {
  fonts: FontMeta[];
}

/** Folder of installed fonts inside the data folder. */
export const FONTS_DIR = "assets/fonts";

/** "Playfair Display" → "playfair-display" (the fontsource package and folder name). */
export function fontSlug(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const FALLBACK: Record<string, string> = {
  Serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  Monospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  Handwriting: "cursive",
};

/** The `font-family` value for a font token: the font, then a fallback of its kind. */
export function fontStack(font: Pick<FontMeta, "cssFamily" | "category">): string {
  return `"${font.cssFamily}", ${FALLBACK[font.category] ?? "ui-sans-serif, system-ui, sans-serif"}`;
}

/** The first family of a `font-family` value, unquoted (`"Inter Variable", sans-serif` → `Inter Variable`). */
export function firstFamily(value: string): string {
  const first = value.split(",")[0]!.trim();
  return first.replace(/^(['"])(.*)\1$/, "$2");
}
