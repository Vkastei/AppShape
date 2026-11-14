import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CatalogFont,
  FONTS_DIR,
  type FontCatalogResponse,
  type FontMeta,
  fontSlug,
  IMAGE_EXTENSIONS,
  type InstalledFontsResponse,
  type UploadedAsset,
} from "@appshape/protocol";
import { appshapeHome, type DataLocation, readInstalledFonts, writeFileAtomic } from "@appshape/store";
import type { Hono } from "hono";
import { TOKEN_HEADER } from "@appshape/protocol";
import type { EventLog } from "./events";

const MAX_UPLOAD = 25 * 1024 * 1024;
/** Where font metadata and files come from (overridable for tests and mirrors). */
const CATALOG_URL = () => process.env.APPSHAPE_FONT_CATALOG ?? "https://fonts.google.com/metadata/fonts";
const FONT_CDN = () => (process.env.APPSHAPE_FONT_CDN ?? "https://cdn.jsdelivr.net/npm").replace(/\/$/, "");
const CATALOG_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Uploads (`POST /api/assets`) and fonts (`/api/fonts…`). Assets are read through `GET /api/assets/*`. */
export function assetRoutes(app: Hono, location: DataLocation, log: EventLog): void {
  const assetsDir = join(location.dataDir, "assets");

  app.post("/api/assets", async (c) => {
    const name = c.req.query("name") ?? "";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return c.text(`Only images can be added (${IMAGE_EXTENSIONS.join(", ")}).`, 415);
    if (Number(c.req.header("content-length") ?? 0) > MAX_UPLOAD) return c.text("The file is larger than 25 MB.", 413);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.length === 0) return c.text("The file is empty.", 400);
    if (data.length > MAX_UPLOAD) return c.text("The file is larger than 25 MB.", 413);
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 10);
    const base = fontSlug(name.slice(0, -(ext.length + 1))).slice(0, 40) || "image";
    const file = `${base}-${hash}.${ext === "jpeg" ? "jpg" : ext}`;
    const target = join(assetsDir, "uploads", file);
    // the same picture twice is stored once
    if (!(await stat(target).catch(() => undefined))) {
      await mkdir(join(assetsDir, "uploads"), { recursive: true });
      await writeFile(target, data);
      log.info(`added image ${file}`);
    }
    return c.json({ src: `asset:uploads/${file}` } satisfies UploadedAsset);
  });

  app.get("/api/fonts/catalog", async (c) => c.json(await fontCatalog(log)));

  // Previews of fonts that aren't installed (pickers, theme starter): fetched by this server and
  // cached, so the board never depends on the browser reaching a font CDN.
  app.get("/api/fonts/preview", async (c) => {
    const family = c.req.query("family")?.trim() ?? "";
    const font = (await fontCatalog(log)).fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
    if (!font) return c.text(`${family} isn't a Google Fonts family.`, 404);
    const asked = (c.req.query("weights") ?? "400").split(",").map(Number).filter((n) => Number.isFinite(n));
    const auth = encodeURIComponent(c.req.header(TOKEN_HEADER) ?? c.req.query("token") ?? "");
    try {
      const css = await previewCss(font, asked, (slug, file) => `/api/fonts/preview/${slug}/${file}?token=${auth}`);
      return c.body(css, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "private, max-age=86400" });
    } catch (error) {
      return c.text(`No preview for ${font.family}: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
  });

  app.get("/api/fonts/preview/:slug/:file", async (c) => {
    const { slug, file } = c.req.param();
    if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+\.woff2$/.test(file)) return c.text("not found", 404);
    try {
      const data = await cachedDownload(`${FONT_CDN()}/@fontsource/${slug}/files/${file}`, join(previewCache(), slug, file));
      return c.body(new Uint8Array(data), 200, { "content-type": "font/woff2", "cache-control": "private, max-age=604800" });
    } catch {
      return c.text("not found", 404);
    }
  });

  app.get("/api/fonts", async (c) => c.json({ fonts: (await readInstalledFonts(location.dataDir)).map(({ css: _, ...meta }) => meta) } satisfies InstalledFontsResponse));

  app.post("/api/fonts", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { family?: unknown } | undefined;
    if (typeof body?.family !== "string" || !body.family.trim()) return c.text("Which font? (family is missing)", 400);
    const catalog = await fontCatalog(log);
    const font = catalog.fonts.find((f) => f.family.toLowerCase() === (body.family as string).trim().toLowerCase());
    if (!font) return c.text(`${body.family} isn't a Google Fonts family.`, 404);
    try {
      await installFont(font, join(location.dataDir, ...FONTS_DIR.split("/")));
      log.info(`installed the font ${font.family}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`could not install ${font.family}: ${message}`);
      return c.text(`Couldn't download ${font.family}: ${message}`, 502);
    }
    return c.json({ fonts: (await readInstalledFonts(location.dataDir)).map(({ css: _, ...meta }) => meta) } satisfies InstalledFontsResponse);
  });
}

// ---------- previews

const previewCache = () => join(appshapeHome(), "cache", "font-previews");

/** A file from the CDN, kept in the cache folder after the first download. */
async function cachedDownload(url: string, file: string): Promise<Uint8Array> {
  const cached = await readFile(file).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  // written under a temporary name first, so a half-written file is never served
  const temp = `${file}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(temp, data)
    .then(() => rename(temp, file))
    .catch(() => rm(temp, { force: true }));
  return data;
}

/** The weights a font has that come closest to the ones asked for. */
export function previewWeights(available: readonly number[], asked: readonly number[]): number[] {
  const nearest = (w: number) => available.reduce((best, a) => (Math.abs(a - w) < Math.abs(best - w) ? a : best), available[0] ?? 400);
  return [...new Set((asked.length ? asked : [400]).map(nearest))].sort((a, b) => a - b);
}

/** `@font-face` rules for a font's Latin preview (static fontsource files), pointing at `fileUrl`. */
export async function previewCss(font: CatalogFont, asked: readonly number[], fileUrl: (slug: string, file: string) => string): Promise<string> {
  const slug = fontSlug(font.family);
  const rules: string[] = [];
  for (const weight of previewWeights(font.weights, asked)) {
    const sheet = await cachedDownload(`${FONT_CDN()}/@fontsource/${slug}/latin-${weight}.css`, join(previewCache(), slug, `latin-${weight}.css`)).catch(() => undefined);
    if (!sheet) continue;
    for (const block of new TextDecoder().decode(sheet).match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const source = /url\(\s*['"]?\.\/files\/([^'")]+\.woff2)['"]?\s*\)/.exec(block);
      if (source) rules.push(block.replace(/src:[^;]+;/, `src: url(${fileUrl(slug, source[1]!)}) format('woff2');`));
    }
  }
  if (rules.length === 0) throw new Error("no Latin files");
  return rules.join("\n");
}

// ---------- catalog

interface GoogleFamily {
  family: string;
  category: string;
  fonts: Record<string, unknown>;
  axes?: { tag: string; min: number; max: number }[];
  popularity?: number;
}

let memory: { at: number; fonts: CatalogFont[] } | undefined;

/** Google Fonts families, most popular first: fetched at most weekly, cached in `~/.appshape/cache`. */
export async function fontCatalog(log?: EventLog): Promise<FontCatalogResponse> {
  if (memory && Date.now() - memory.at < CATALOG_MAX_AGE) return { fonts: memory.fonts, complete: true };
  const cacheFile = join(appshapeHome(), "cache", "google-fonts.json");
  const cached = await readFile(cacheFile, "utf8")
    .then((text) => JSON.parse(text) as { at: number; fonts: CatalogFont[] })
    .catch(() => undefined);
  if (cached && Date.now() - cached.at < CATALOG_MAX_AGE) {
    memory = cached;
    return { fonts: cached.fonts, complete: true };
  }
  try {
    const response = await fetch(CATALOG_URL(), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    // the endpoint may prefix its JSON with `)]}'`
    const data = JSON.parse(text.slice(text.indexOf("{"))) as { familyMetadataList: GoogleFamily[] };
    const fonts = data.familyMetadataList
      .slice()
      .sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9))
      .map((f): CatalogFont => {
        const keys = Object.keys(f.fonts);
        const weights = keys.filter((k) => /^\d+$/.test(k)).map(Number);
        return { family: f.family, category: f.category, weights, italic: keys.some((k) => k.endsWith("i")), variable: (f.axes ?? []).some((a) => a.tag === "wght") };
      })
      .filter((f) => f.weights.length > 0);
    memory = { at: Date.now(), fonts };
    await writeFileAtomic(cacheFile, JSON.stringify(memory)).catch(() => {});
    return { fonts, complete: true };
  } catch (error) {
    log?.warn(`could not load the Google Fonts list: ${error instanceof Error ? error.message : String(error)}`);
    if (cached) return { fonts: cached.fonts, complete: true };
    return { fonts: BUILT_IN, complete: false };
  }
}

const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);
/** A few well-known families for when Google Fonts can't be reached. */
const BUILT_IN: CatalogFont[] = [
  { family: "Inter", category: "Sans Serif", weights: range(100, 900), italic: true, variable: true },
  { family: "Roboto", category: "Sans Serif", weights: range(100, 900), italic: true, variable: true },
  { family: "Open Sans", category: "Sans Serif", weights: range(300, 800), italic: true, variable: true },
  { family: "Montserrat", category: "Sans Serif", weights: range(100, 900), italic: true, variable: true },
  { family: "DM Sans", category: "Sans Serif", weights: range(100, 1000), italic: true, variable: true },
  { family: "Manrope", category: "Sans Serif", weights: range(200, 800), italic: false, variable: true },
  { family: "Space Grotesk", category: "Sans Serif", weights: range(300, 700), italic: false, variable: true },
  { family: "Lato", category: "Sans Serif", weights: [100, 300, 400, 700, 900], italic: true, variable: false },
  { family: "Playfair Display", category: "Serif", weights: range(400, 900), italic: true, variable: true },
  { family: "Lora", category: "Serif", weights: range(400, 700), italic: true, variable: true },
  { family: "Fraunces", category: "Serif", weights: range(100, 900), italic: true, variable: true },
  { family: "JetBrains Mono", category: "Monospace", weights: range(100, 800), italic: true, variable: true },
];

// ---------- install

/**
 * Downloads a family's fontsource stylesheets and their woff2 files into `<fontsDir>/<slug>/`:
 * variable fonts as one file per script, others per weight (plus 400 and 700 italic).
 */
export async function installFont(font: CatalogFont, fontsDir: string): Promise<FontMeta> {
  const slug = fontSlug(font.family);
  const pkg = font.variable ? `@fontsource-variable/${slug}` : `@fontsource/${slug}`;
  const sheets = font.variable
    ? ["index.css", ...(font.italic ? ["wght-italic.css"] : [])]
    : [...font.weights.map((w) => `${w}.css`), ...(font.italic ? [400, 700].filter((w) => font.weights.includes(w)).map((w) => `${w}-italic.css`) : [])];
  // Everything is downloaded first (a font is small); the folder is written only when that worked,
  // font.json last, so a failed download changes nothing and a half-written font is never read.
  const blocks: string[] = [];
  const downloads = new Map<string, Uint8Array>();
  for (const sheet of sheets) {
    const cssUrl = `${FONT_CDN()}/${pkg}@latest/${sheet}`;
    const response = await fetch(cssUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${pkg}/${sheet}: HTTP ${response.status}`);
    for (const block of (await response.text()).match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      // keep the woff2 source only (every browser that matters reads it)
      const source = /url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)\s*format\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(block);
      if (!source) continue;
      const name = source[1]!.split("/").pop()!;
      if (!downloads.has(name)) {
        const file = await fetch(new URL(source[1]!, cssUrl), { signal: AbortSignal.timeout(30_000) });
        if (!file.ok) throw new Error(`${name}: HTTP ${file.status}`);
        downloads.set(name, new Uint8Array(await file.arrayBuffer()));
      }
      blocks.push(block.replace(/src:[^;]+;/, `src: url(./files/${name}) format('${source[2]}');`));
    }
  }
  if (blocks.length === 0) throw new Error(`no font files in ${pkg}`);
  const cssFamily = /font-family:\s*['"]?([^'";]+)['"]?/.exec(blocks[0]!)?.[1]?.trim() ?? font.family;
  const meta: FontMeta = {
    family: font.family,
    cssFamily,
    slug,
    category: font.category,
    variable: font.variable,
    weights: font.weights,
    italic: font.italic,
    package: pkg,
    files: [...downloads.keys()].map((name) => `files/${name}`),
    installedAt: new Date().toISOString(),
  };
  const dir = join(fontsDir, slug);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "files"), { recursive: true });
  for (const [name, data] of downloads) await writeFile(join(dir, "files", name), data);
  await writeFile(join(dir, "font.css"), `/* ${font.family}: ${pkg} (fontsource; the font's own license applies) */\n${blocks.join("\n")}\n`);
  await writeFile(join(dir, "font.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}
