/**
 * The app's own CSS, prepared for the board. Frames render in shadow roots that are as wide as the
 * design's viewport, so:
 * - `:root`/`html` become `:host`, `body` the frame's root element;
 * - width media queries become container queries on the frame (breakpoints follow the frame width);
 * - `@property` and `@font-face` move to the document (shadow roots ignore them);
 * - `url()` assets are collected so they can be stored and served without the dev server.
 */

export interface AppCss {
  /** CSS for each frame's shadow root. */
  shadow: string;
  /** CSS for the editor document (`@property`, `@font-face`). */
  document: string;
  /** Absolute asset URL → placeholder used in the CSS (`__DL_STYLE_FILE__/<name>`). */
  assets: Map<string, string>;
}

export const STYLE_FILE_PLACEHOLDER = "__DL_STYLE_FILE__";

interface Block {
  prelude: string;
  /** Undefined for statements (`@import …;`). */
  body?: string;
}

/** Splits CSS into top-level statements and blocks (strings and nesting respected). */
export function splitBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    let start = i;
    // skip whitespace
    while (start < n && /\s/.test(css[start]!)) start++;
    if (start >= n) break;
    let j = start;
    let quote: string | undefined;
    let parens = 0;
    while (j < n) {
      const ch = css[j]!;
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = undefined;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") parens++;
      else if (ch === ")") parens = Math.max(0, parens - 1);
      else if ((ch === "{" || ch === ";") && parens === 0) break;
      j++;
    }
    const prelude = css.slice(start, j).trim();
    if (j >= n) {
      if (prelude) blocks.push({ prelude });
      break;
    }
    if (css[j] === ";") {
      blocks.push({ prelude });
      i = j + 1;
      continue;
    }
    // find the matching brace
    let depth = 1;
    let k = j + 1;
    quote = undefined;
    while (k < n && depth > 0) {
      const ch = css[k]!;
      if (quote) {
        if (ch === "\\") k++;
        else if (ch === quote) quote = undefined;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      k++;
    }
    blocks.push({ prelude, body: css.slice(j + 1, k - 1) });
    i = k;
  }
  return blocks;
}

const GROUPING = /^@(media|supports|layer|container|scope|starting-style|document)\b/i;
const WIDTH_FEATURE = /^\(\s*(?:(?:min-|max-)?width\s*:[^()]+|width\s*[<>]=?\s*[^()]+|[^()]+[<>]=?\s*width(?:\s*[<>]=?\s*[^()]+)?)\)$/i;

/** `(width >= 48rem)`, `screen and (min-width: 768px)` → the condition for a container query, if that's all it is. */
export function containerCondition(query: string): string | undefined {
  let q = query.trim().replace(/^(?:only\s+)?(?:screen|all)\s+and\s+/i, "");
  let negate = false;
  const not = /^not\s+(?:all|screen)\s+and\s+(.+)$/i.exec(q);
  if (not) {
    negate = true;
    q = not[1]!;
  }
  if (q.includes(",")) return undefined;
  const parts = q.split(/\s+and\s+/i);
  if (!parts.every((p) => WIDTH_FEATURE.test(p.trim()))) return undefined;
  const condition = parts.map((p) => p.trim()).join(" and ");
  return negate ? `not (${condition})` : condition;
}

function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** `:root` → `:host` (custom properties), `html` → the frame, `body` → the frame's root element. */
export function rewriteSelector(selector: string, frameClass: string): string {
  let s = selector.replace(/:root\b/g, ":host");
  s = s.replace(/(^|[\s>+~(,])html(?=$|[\s.:#[>+~),])/g, `$1.${frameClass}`);
  s = s.replace(/(^|[\s>+~(,])body(?=$|[\s.:#[>+~),])/g, `$1.${frameClass} > *`);
  // `:host.dark` → `:host(.dark)`
  s = s.replace(/:host((?:[.#[:](?!host)[^\s>+~,)]*)+)/g, (_m, compound: string) => `:host(${compound})`);
  return s;
}

export interface ProcessOptions {
  frameClass: string;
  container: string;
}

export function processAppCss(sheets: ReadonlyArray<{ href?: string; text: string }>, base: string, options: ProcessOptions): AppCss {
  const assets = new Map<string, string>();
  const documentRules: string[] = [];
  const seenDocument = new Set<string>();

  const rewriteUrls = (text: string, sheetBase: string) =>
    text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _q: string, url: string) => {
      if (url.startsWith("data:") || url.startsWith("#")) return match;
      let absolute: string;
      try {
        absolute = new URL(url, sheetBase).href;
      } catch {
        return match;
      }
      let name = assets.get(absolute);
      if (!name) {
        const ext = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(new URL(absolute).pathname)?.[1] ?? "bin";
        name = `${STYLE_FILE_PLACEHOLDER}/${hash(absolute)}.${ext.toLowerCase()}`;
        assets.set(absolute, name);
      }
      return `url("${name}")`;
    });

  const processBlocks = (css: string, sheetBase: string): string => {
    const out: string[] = [];
    for (const block of splitBlocks(css)) {
      const prelude = block.prelude;
      if (block.body === undefined) {
        if (/^@import\b/i.test(prelude)) continue;
        out.push(`${prelude};`);
        continue;
      }
      if (/^@property\b/i.test(prelude) || /^@font-face\b/i.test(prelude)) {
        const rule = `${prelude} {${rewriteUrls(block.body, sheetBase)}}`;
        if (!seenDocument.has(rule)) {
          seenDocument.add(rule);
          documentRules.push(rule);
        }
        continue;
      }
      const media = /^@media\s+(.+)$/is.exec(prelude);
      if (media) {
        const condition = containerCondition(media[1]!);
        const inner = processBlocks(block.body, sheetBase);
        out.push(condition ? `@container ${options.container} ${condition} {${inner}}` : `${prelude} {${inner}}`);
        continue;
      }
      if (GROUPING.test(prelude)) {
        out.push(`${prelude} {${processBlocks(block.body, sheetBase)}}`);
        continue;
      }
      if (prelude.startsWith("@")) {
        // @keyframes, @page, @counter-style …: as they are
        out.push(`${prelude} {${rewriteUrls(block.body, sheetBase)}}`);
        continue;
      }
      const selectors = splitSelectors(prelude).map((s) => rewriteSelector(s, options.frameClass));
      out.push(`${selectors.join(", ")} {${rewriteNested(rewriteUrls(block.body, sheetBase), options)}}`);
    }
    return out.join("\n");
  };

  const shadow: string[] = [];
  const seenSheets = new Set<string>();
  for (const sheet of sheets) {
    if (seenSheets.has(sheet.text)) continue;
    seenSheets.add(sheet.text);
    shadow.push(processBlocks(sheet.text, sheet.href ?? base));
  }
  return { shadow: schemeQueries(shadow.join("\n")), document: documentRules.join("\n"), assets };
}

/** Custom property that carries the board's color scheme (`light`/`dark`) into the frames. */
export const SCHEME_PROPERTY = "--aps-scheme";

/**
 * `@media (prefers-color-scheme: dark)` → `@container style(--aps-scheme: dark)`, so the app's
 * dark styles follow the board's scheme instead of the system's. Idempotent (also for CSS saved
 * by earlier imports).
 */
export function schemeQueries(css: string): string {
  return css.replace(
    /@media\s+(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*\{/gi,
    (_m, scheme: string) => `@container style(${SCHEME_PROPERTY}: ${scheme.toLowerCase()}) {`,
  );
}

/**
 * How the app switches to dark mode: `media` (`prefers-color-scheme`, Tailwind's default) or
 * `class` (a `.dark` class on `<html>`); undefined if it has no dark styles.
 */
export function darkModeOf(css: string): "media" | "class" | undefined {
  if (/(?:^|[\s,(>~+])\.dark(?![\w\\-])/m.test(css)) return "class";
  if (/prefers-color-scheme\s*:\s*dark|--aps-scheme:\s*dark/i.test(css)) return "media";
  return undefined;
}

/** Media queries nested in style rules (CSS nesting). */
function rewriteNested(body: string, options: ProcessOptions): string {
  return body.replace(/@media\s+([^{]+)\{/g, (match, query: string) => {
    const condition = containerCondition(query);
    return condition ? `@container ${options.container} ${condition} {` : match;
  });
}

function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
