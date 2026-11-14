import type { SpecDocument } from "@appshape/protocol";

export const GENERATED_AT = "2026-10-05T10:00:00.000Z";

export const project: SpecDocument["project"] = {
  name: "Acme web (fixture)",
  root: "fixtures/vite-react-router-tw4",
  stack: ["React 19", "Vite", "React Router 7 (declarative routes)", "Tailwind CSS v4"],
  adapter: "react-vite",
  styleDialect: "tailwind-v4",
};

export const tokenSummary = [
  "Colors: `primary-50`, `primary-100`, `primary-600`, `primary-700` (defined in `src/index.css` under `@theme`), plus Tailwind's default palette (`gray-*`, `white`).",
  "Radius, shadows, spacing and font sizes: Tailwind defaults (`rounded-md|lg|xl|full`, `shadow-sm|md`, `gap-*`, `text-*`).",
  "Font: `font-sans` = Inter.",
];

export const hints = [
  "Routes are declared in `src/App.tsx` with `<Routes>`/`<Route>` from `react-router` (v7, declarative mode).",
  "Use `Link`/`NavLink` from `react-router` for internal navigation.",
  "Tailwind CSS v4: theme tokens live in `src/index.css` under `@theme`; use their utilities (e.g. `bg-primary-600`). There is no tailwind.config.js.",
];

export const uiComponents: SpecDocument["components"] = [
  { name: "Button", file: "src/components/ui/button.tsx", kind: "ui-kit", usage: "Variants `primary` (default) and `secondary`; pass extra classes via `className`." },
  { name: "Badge", file: "src/components/ui/badge.tsx", kind: "ui-kit", usage: "Pill label; extra classes via `className`." },
  { name: "Accordion", file: "src/components/ui/accordion.tsx", kind: "ui-kit", usage: "`items: { question, answer }[]`; extra classes via `className`." },
];
