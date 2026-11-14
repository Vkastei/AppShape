import { createId, type DesignNode, type Frame, type TokenGroup, type Tokens, type Viewport } from "@appshape/ir";

/** Building blocks for the insert palette. They use the design system when it has the token. */

export type PrimitiveKind = "stack" | "row" | "card" | "heading" | "text" | "button" | "link" | "image" | "input" | "icon" | "divider";

export const PRIMITIVES: { kind: PrimitiveKind; label: string }[] = [
  { kind: "stack", label: "Stack" },
  { kind: "row", label: "Row" },
  { kind: "card", label: "Card" },
  { kind: "heading", label: "Heading" },
  { kind: "text", label: "Text" },
  { kind: "button", label: "Button" },
  { kind: "link", label: "Link" },
  { kind: "image", label: "Image" },
  { kind: "input", label: "Input" },
  { kind: "icon", label: "Icon" },
  { kind: "divider", label: "Divider" },
];

const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#e4e4e7"/><path d="M220 250l70-90 50 60 40-40 80 70z" fill="#a1a1aa"/><circle cx="410" cy="130" r="26" fill="#a1a1aa"/></svg>',
  );

/** Picks the first token that exists, else the fallback raw value. */
export function tokenOr(tokens: Tokens, group: TokenGroup, names: string[], fallback: string): string {
  const name = names.find((n) => tokens.groups[group]?.[n] !== undefined);
  return name ? `$${group}.${name}` : fallback;
}

export function primitive(kind: PrimitiveKind, tokens: Tokens): DesignNode {
  const id = () => createId("n");
  const t = (group: TokenGroup, names: string[], fallback: string) => tokenOr(tokens, group, names, fallback);
  const space = (n: string, rem: string) => t("spacing", [n], rem);
  // theme colors (light and dark) first, then Tailwind's palette
  const accent = t("color", ["primary", "primary-600", "indigo-600", "blue-600"], "#4f46e5");
  const heading = tokens.groups.fontFamily?.heading !== undefined ? { fontFamily: "$fontFamily.heading" } : {};
  const text = (value: string, extra: Partial<DesignNode> = {}): DesignNode =>
    ({ id: id(), type: "text", origin: "added", text: value, ...extra }) as DesignNode;

  switch (kind) {
    case "stack":
      return { id: id(), type: "box", origin: "added", layout: { mode: "flex", direction: "column", gap: space("4", "1rem"), padding: edges(space("4", "1rem")) }, children: [] };
    case "row":
      return { id: id(), type: "box", origin: "added", layout: { mode: "flex", direction: "row", align: "center", gap: space("4", "1rem") }, children: [] };
    case "card":
      return {
        id: id(),
        type: "box",
        origin: "added",
        name: "Card",
        layout: { mode: "flex", direction: "column", gap: space("2", "0.5rem"), padding: edges(space("6", "1.5rem")) },
        style: {
          background: t("color", ["card", "white"], "#ffffff"),
          borderWidth: 1,
          borderColor: t("color", ["border", "gray-200", "zinc-200"], "#e5e7eb"),
          radius: t("radius", ["xl", "lg"], "0.75rem"),
          shadow: t("shadow", ["sm"], "0 1px 3px 0 rgb(0 0 0 / 0.1)"),
        },
        children: [
          text("Card title", { semantic: { role: "heading", level: 3 }, style: { ...heading, fontSize: t("fontSize", ["lg"], "1.125rem"), fontWeight: t("fontWeight", ["semibold"], "600") } }),
          text("Some supporting text for this card.", { style: { fontSize: t("fontSize", ["sm"], "0.875rem"), color: t("color", ["muted-foreground", "gray-600", "zinc-600"], "#4b5563") } }),
        ],
      };
    case "heading":
      return text("Heading", {
        semantic: { role: "heading", level: 2 },
        style: { ...heading, fontSize: t("fontSize", ["3xl", "2xl"], "1.875rem"), fontWeight: t("fontWeight", ["bold"], "700"), letterSpacing: t("letterSpacing", ["tight"], "-0.025em") },
      });
    case "text":
      return text("Text", { style: { fontSize: t("fontSize", ["base"], "1rem"), color: t("color", ["foreground", "gray-700", "zinc-700"], "#374151") } });
    case "button":
      return {
        id: id(),
        type: "button",
        origin: "added",
        layout: { mode: "flex", direction: "row", align: "center", justify: "center", gap: space("2", "0.5rem"), padding: { top: space("2", "0.5rem"), bottom: space("2", "0.5rem"), left: space("4", "1rem"), right: space("4", "1rem") } },
        box: { alignSelf: "start" },
        style: { background: accent, color: t("color", ["primary-foreground", "white"], "#ffffff"), radius: t("radius", ["md"], "0.375rem"), fontSize: t("fontSize", ["sm"], "0.875rem"), fontWeight: t("fontWeight", ["medium"], "500") },
        children: [text("Button")],
      };
    case "link":
      return { id: id(), type: "link", origin: "added", href: "#", style: { color: accent, fontWeight: t("fontWeight", ["medium"], "500") }, children: [text("Link")] };
    case "image":
      return { id: id(), type: "image", origin: "added", src: IMAGE_PLACEHOLDER, alt: "", fit: "cover", box: { width: { mode: "fill" } }, style: { radius: t("radius", ["lg"], "0.5rem") } };
    case "input":
      return {
        id: id(),
        type: "input",
        origin: "added",
        inputType: "text",
        label: "Label",
        placeholder: "Placeholder",
        layout: { padding: { top: space("2", "0.5rem"), bottom: space("2", "0.5rem"), left: space("3", "0.75rem"), right: space("3", "0.75rem") } },
        style: { borderWidth: 1, borderColor: t("color", ["input", "gray-300", "zinc-300"], "#d1d5db"), radius: t("radius", ["md"], "0.375rem"), fontSize: t("fontSize", ["sm"], "0.875rem") },
      };
    case "icon":
      return { id: id(), type: "icon", origin: "added", icon: "star", set: "lucide", style: { fontSize: t("fontSize", ["xl"], "1.25rem") } };
    case "divider":
      return { id: id(), type: "box", origin: "added", name: "Divider", box: { width: { mode: "fill" }, height: { mode: "fixed", value: 1 } }, style: { background: t("color", ["border", "gray-200", "zinc-200"], "#e5e7eb") }, children: [] };
  }
}

function edges(value: string) {
  return { top: value, right: value, bottom: value, left: value };
}

export type ScreenPreset = "desktop" | "tablet" | "phone";

export const SCREEN_PRESETS: { preset: ScreenPreset; label: string }[] = [
  { preset: "desktop", label: "Web page (desktop + mobile)" },
  { preset: "tablet", label: "Tablet" },
  { preset: "phone", label: "Phone app screen" },
];

export function slugRoute(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug === "home" || slug === "" ? "/" : `/${slug}`;
}

/** A new, empty screen: a full-height vertical stack. */
export function newScreen(name: string, route: string, preset: ScreenPreset, tokens: Tokens, adapter = "react-vite"): Frame {
  const viewports: Viewport[] =
    preset === "desktop"
      ? [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }]
      : preset === "tablet"
        ? [{ id: "tablet", width: 768, height: 1024, breakpoint: "md" }]
        : [{ id: "phone", width: 393, height: 852, device: "iphone-15" }];
  const minHeight = preset === "desktop" ? "100vh" : `${viewports[0]!.height}px`;
  return {
    id: createId("f"),
    name,
    kind: "new",
    platform: preset === "phone" ? "mobile" : "web",
    target: { adapter, route },
    viewports,
    current: {
      id: createId("n"),
      type: "box",
      origin: "added",
      name: name,
      layout: { mode: "flex", direction: "column", gap: tokenOr(tokens, "spacing", ["6"], "1.5rem"), padding: edges(tokenOr(tokens, "spacing", ["6"], "1.5rem")) },
      box: { minHeight },
      style: { background: tokenOr(tokens, "color", ["background", "white"], "#ffffff") },
      children: [],
    },
  };
}

/** A new screen with a copy of an existing screen's content. */
export function duplicateScreen(frame: Frame, name: string, route: string, clone: (node: DesignNode) => DesignNode): Frame {
  const { baseline: _baseline, capture: _capture, ...rest } = frame;
  return { ...structuredClone(rest), id: createId("f"), name, kind: "new", target: { adapter: frame.target.adapter, route }, current: clone(frame.current) };
}
