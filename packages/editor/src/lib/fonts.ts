import { type CatalogFont, type FontMeta, fontSlug } from "@appshape/protocol";
import { useEditor } from "../store";
import { fetchInstalledFonts } from "./api";

/** slug → installedAt of the font whose rules are in the page. */
const loaded = new Map<string, string>();

/**
 * Puts the project's own fonts into the page (one `<style>` per font, file URLs with the session token),
 * so screens show them; fonts declared in the page also reach the screens' shadow roots.
 */
export async function loadProjectFonts(fonts?: FontMeta[]): Promise<void> {
  const token = useEditor.getState().token;
  if (!token) return;
  const list = fonts ?? (await fetchInstalledFonts(token)).fonts;
  useEditor.setState({ fonts: list });
  const auth = `?token=${encodeURIComponent(token)}`;
  for (const font of list) {
    if (loaded.get(font.slug) === font.installedAt) continue;
    const response = await fetch(`/api/assets/fonts/${font.slug}/font.css${auth}`);
    if (!response.ok) continue;
    const css = (await response.text()).replace(/url\(\.\/files\/([^)]+)\)/g, (_, file: string) => `url(/api/assets/fonts/${font.slug}/files/${file}${auth})`);
    let style = document.head.querySelector<HTMLStyleElement>(`style[data-font="${font.slug}"]`);
    if (!style) {
      style = document.createElement("style");
      style.dataset.font = font.slug;
      document.head.append(style);
    }
    style.textContent = css;
    loaded.set(font.slug, font.installedAt);
  }
}

const previewed = new Map<string, Promise<boolean>>();

/**
 * Loads a font for its preview in the picker (Latin, regular weight; the family name is the plain
 * one, e.g. "Inter"). Fonts the project uses come from its own files instead.
 */
export function previewFont(font: CatalogFont): void {
  void previewFamily(font.family, [font.weights.includes(400) ? 400 : font.weights[0]!]);
}

/**
 * Loads weights of a Google font for previews, through the board's server (it fetches and caches
 * them, and picks the nearest weights the font has). Resolves to whether the font could be shown.
 */
export function previewFamily(family: string, weights: number[] = [400]): Promise<boolean> {
  const token = useEditor.getState().token;
  const key = `${fontSlug(family)}:${weights.join(",")}`;
  let done = previewed.get(key);
  if (!done && token) {
    done = new Promise<boolean>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `/api/fonts/preview?family=${encodeURIComponent(family)}&weights=${weights.join(",")}&token=${encodeURIComponent(token)}`;
      link.onerror = () => resolve(false);
      // the stylesheet only declares the font; it's ready once a face of it has loaded
      link.onload = () =>
        void Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "${family}"`)))
          .then((faces) => resolve(faces.some((f) => f.length > 0)))
          .catch(() => resolve(false));
      document.head.append(link);
    });
    previewed.set(key, done);
  }
  return done ?? Promise.resolve(false);
}
