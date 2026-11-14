import type { RedactionConfig } from "@appshape/ir";

/**
 * Redaction runs on captured content before anything is written: real names, emails or keys from
 * the developer's data must not reach git or an agent. Replacements keep the shape (length, digits,
 * separators), so the layout stays realistic.
 */

export interface Redactor {
  /** `force`: the element is marked for redaction (selector, `data-aps-redact`): replace all of it. */
  text(text: string, force: boolean): { text: string; redacted: boolean };
  href(href: string): string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w])\+?\d(?:[\d\s().-]{6,}\d)(?![\w])/g;
/** 12.11.2025, 2025-11-12, 11/12/2025 12:30, 2024 – 2025: dates and ranges, not phone numbers. */
const DATE_OR_TIME = /^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(\s+\d{1,2}:\d{2})?|\d{4}\s*[-–]\s*\d{4})$/;
const LONG_DIGITS =/(?<![\w.,])\d{6,}(?![\w.,])/g;
const SECRETS = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:gh[pousr]|github_pat|xox[abpr]|AKIA)[A-Za-z0-9_-]{12,}\b/g,
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
];

const dots = (s: string) => "•".repeat(s.length);
/** Same shape: letters → x/X, digits → 0, everything else kept. */
export const shapeOf = (s: string) => s.replace(/[A-Z]/g, "X").replace(/[a-z]/g, "x").replace(/[0-9]/g, "0").replace(/[^\sXx0.,:;!?()'"/-]/gu, "x");

export function createRedactor(config: RedactionConfig): Redactor {
  const custom = config.patterns.flatMap((p) => {
    try {
      return [new RegExp(p, "g")];
    } catch {
      return [];
    }
  });
  const off = config.mode === "off";

  const text = (input: string, force: boolean): { text: string; redacted: boolean } => {
    if (off) return { text: input, redacted: false };
    if (force) return { text: shapeOf(input), redacted: input.trim().length > 0 };
    let out = input;
    if (config.detectors.secrets) for (const re of SECRETS) out = out.replace(re, dots);
    if (config.detectors.email) out = out.replace(EMAIL, "user@example.com");
    if (config.detectors.phone) {
      out = out.replace(PHONE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 8 && !DATE_OR_TIME.test(m.trim()) ? m.replace(/\d/g, "5") : m));
    }
    if (config.detectors.longDigits) out = out.replace(LONG_DIGITS, (m) => "0".repeat(m.length));
    for (const re of custom) out = out.replace(re, dots);
    return { text: out, redacted: out !== input };
  };

  return {
    text,
    href(href) {
      if (off) return href;
      if (/^mailto:/i.test(href)) return "mailto:user@example.com";
      if (/^tel:/i.test(href)) return "tel:+15555555555";
      return text(href, false).text;
    },
  };
}

/** A neutral gray image (SVG data URI) of the captured size. */
export function placeholderImage(rect?: readonly number[]): string {
  const w = Math.max(1, Math.round(rect?.[2] ?? 160));
  const h = Math.max(1, Math.round(rect?.[3] ?? 120));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#e4e4e7"/><path d="M${w / 2 - 12} ${h / 2 + 8}l8-10 6 7 4-5 6 8z" fill="#a1a1aa"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
