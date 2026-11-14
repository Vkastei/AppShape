import { clone, type Component, type DesignNode, type Frame, type Tokens } from "@appshape/ir";
import { anchor } from "./anchor";
import { box, button, color, instance, link, list, sp, text, xAuto } from "./nodes";

/**
 * What the importer (M2) would produce for `/pricing` of the fixture app, written by hand.
 * Ids are readable on purpose so changesets and specs stay reviewable.
 */

export const plans = [
  {
    id: "starter",
    name: "Starter",
    price: 0,
    description: "For side projects and trying things out.",
    features: ["1 project", "Community support", "Basic analytics"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 19,
    description: "For professionals shipping real products.",
    features: ["Unlimited projects", "Email support", "Advanced analytics", "Custom domains"],
  },
  {
    id: "team",
    name: "Team",
    price: 49,
    description: "For teams that build many apps together.",
    features: ["Everything in Pro", "Shared workspaces", "Role-based access", "Priority support"],
  },
];

export const tokens: Tokens = {
  source: "tailwind-v4",
  groups: {
    color: {
      white: "#fff",
      "gray-50": "oklch(0.985 0.002 247.839)",
      "gray-200": "oklch(0.928 0.006 264.531)",
      "gray-300": "oklch(0.872 0.01 258.338)",
      "gray-500": "oklch(0.551 0.027 264.364)",
      "gray-600": "oklch(0.446 0.03 256.802)",
      "gray-700": "oklch(0.373 0.034 259.733)",
      "gray-900": "oklch(0.21 0.034 264.665)",
      "primary-50": "oklch(0.97 0.02 275)",
      "primary-100": "oklch(0.93 0.04 275)",
      "primary-600": "oklch(0.51 0.21 275)",
      "primary-700": "oklch(0.45 0.2 275)",
    },
    spacing: Object.fromEntries(
      ["0.5", "1", "1.5", "2", "2.5", "3", "4", "5", "6", "8", "10", "12", "16", "20", "24"].map((n) => [n, `${Number(n) * 0.25}rem`]),
    ),
    size: { "2xl": "42rem", "3xl": "48rem", "6xl": "72rem" },
    radius: { md: "0.375rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" },
    shadow: { sm: "0 1px 3px 0 rgb(0 0 0 / 0.1)", md: "0 4px 6px -1px rgb(0 0 0 / 0.1)" },
    fontFamily: { sans: "Inter, ui-sans-serif, system-ui, sans-serif" },
    fontSize: { xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem", "2xl": "1.5rem", "4xl": "2.25rem", "5xl": "3rem" },
    fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeight: { xs: "1rem", sm: "1.25rem", base: "1.5rem", lg: "1.75rem", "2xl": "2rem", "4xl": "2.5rem", "5xl": "1" },
    letterSpacing: { tight: "-0.025em" },
    breakpoint: { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem" },
  },
};

export const components: Component[] = [
  { id: "cmp_navbar", name: "Navbar", kind: "project", platform: "web", source: { file: "src/components/Navbar.tsx", exportName: "Navbar" }, usage: { instances: 1, frames: ["f_pricing"] } },
  { id: "cmp_footer", name: "Footer", kind: "project", platform: "web", source: { file: "src/components/Footer.tsx", exportName: "Footer" }, usage: { instances: 1, frames: ["f_pricing"] } },
  {
    id: "cmp_pricing_card",
    name: "PricingCard",
    kind: "project",
    platform: "web",
    source: { file: "src/components/PricingCard.tsx", exportName: "PricingCard" },
    props: [{ name: "plan", type: "object", required: true }],
    usage: { instances: 3, frames: ["f_pricing"] },
  },
  {
    id: "cmp_button",
    name: "Button",
    kind: "ui-kit",
    platform: "web",
    source: { file: "src/components/ui/button.tsx", exportName: "Button" },
    props: [
      { name: "variant", type: "enum", options: ["primary", "secondary"], default: "primary" },
      { name: "className", type: "string" },
    ],
    usage: { instances: 3, frames: ["f_pricing"] },
  },
  {
    id: "cmp_badge",
    name: "Badge",
    kind: "ui-kit",
    platform: "web",
    source: { file: "src/components/ui/badge.tsx", exportName: "Badge" },
    props: [{ name: "children", type: "node", required: true }, { name: "className", type: "string" }],
    usage: { instances: 0, frames: [] },
  },
  {
    id: "cmp_accordion",
    name: "Accordion",
    kind: "ui-kit",
    platform: "web",
    source: { file: "src/components/ui/accordion.tsx", exportName: "Accordion" },
    props: [{ name: "items", type: "array", required: true }, { name: "className", type: "string" }],
    usage: { instances: 0, frames: [] },
  },
];

const navLinkStyle = { overrides: [{ when: { state: "hover" as const }, style: { color: color("gray-900") } }] };

function navbar(): DesignNode {
  const file = "src/components/Navbar.tsx";
  const src = (needle: string) => anchor(file, needle, { component: "Navbar", owner: "AppRoutes" });
  return instance("n_navbar", "cmp_navbar", {}, { name: "Navbar", source: anchor("src/App.tsx", "<Navbar />", { component: "AppRoutes" }) }, [
    box("n_nav", {
      name: "Nav bar",
      tag: "nav",
      cls: "border-b border-gray-200 bg-white",
      semantic: { role: "nav" },
      source: src("<nav"),
      style: { borderWidth: { bottom: 1 }, borderColor: color("gray-200"), background: color("white") },
    }, [
      box("n_nav_inner", {
        name: "Nav content",
        tag: "div",
        cls: "mx-auto flex max-w-6xl items-center justify-between px-6 py-4",
        source: src('<div className="mx-auto flex'),
        layout: { mode: "flex", direction: "row", align: "center", justify: "between", padding: { top: sp(4), bottom: sp(4), left: sp(6), right: sp(6) } },
        box: { maxWidth: "$size.6xl", margin: xAuto },
      }, [
        link("n_nav_logo", "/", {
          name: "Logo",
          tag: "a",
          cls: "text-lg font-bold text-gray-900",
          source: src('<Link to="/" '),
          style: { fontSize: "$fontSize.lg", fontWeight: "$fontWeight.bold", color: color("gray-900") },
        }, [text("n_nav_logo_label", "Acme")]),
        box("n_nav_links", {
          name: "Nav links",
          tag: "div",
          cls: "flex items-center gap-6 text-sm font-medium text-gray-600",
          source: src('<div className="flex items-center gap-6'),
          layout: { mode: "flex", direction: "row", align: "center", gap: sp(6) },
          style: { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", color: color("gray-600") },
        }, [
          link("n_nav_home", "/", { name: "Home link", tag: "a", cls: "hover:text-gray-900", source: src('<NavLink to="/" '), ...navLinkStyle }, [
            text("n_nav_home_label", "Home"),
          ]),
          link("n_nav_pricing", "/pricing", { name: "Pricing link", tag: "a", cls: "hover:text-gray-900", source: src('<NavLink to="/pricing"'), ...navLinkStyle }, [
            text("n_nav_pricing_label", "Pricing"),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function pricingCard(plan: (typeof plans)[number], index: number): DesignNode {
  const file = "src/components/PricingCard.tsx";
  const src = (needle: string, extra = {}) => anchor(file, needle, { component: "PricingCard", owner: "Pricing", ...extra });
  const p = `n_card_${plan.id}`;
  return instance(p, "cmp_pricing_card", { plan }, {
    name: `PricingCard (${plan.name})`,
    source: anchor("src/pages/Pricing.tsx", "<PricingCard key", { component: "Pricing", repeated: { count: plans.length, index, key: plan.id } }),
  }, [
    box(`${p}_root`, {
      name: "Card",
      tag: "div",
      cls: "flex flex-col rounded-md border border-gray-200 bg-white p-6 shadow-sm",
      source: src('<div className="flex flex-col'),
      layout: { mode: "flex", direction: "column", padding: { top: sp(6), right: sp(6), bottom: sp(6), left: sp(6) } },
      style: { radius: "$radius.md", borderWidth: 1, borderColor: color("gray-200"), background: color("white"), shadow: "$shadow.sm" },
    }, [
      text(`${p}_name`, plan.name, {
        name: "Plan name",
        tag: "h2",
        cls: "text-lg font-semibold text-gray-900",
        semantic: { role: "heading", level: 2 },
        source: src("<h2"),
        style: { fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold", color: color("gray-900") },
      }),
      text(`${p}_desc`, plan.description, {
        name: "Plan description",
        tag: "p",
        cls: "mt-2 text-sm text-gray-600",
        source: src('<p className="mt-2'),
        box: { margin: { top: sp(2) } },
        style: { fontSize: "$fontSize.sm", color: color("gray-600") },
      }),
      box(`${p}_price`, {
        name: "Price",
        tag: "p",
        cls: "mt-6 flex items-baseline gap-1",
        source: src('<p className="mt-6'),
        layout: { mode: "flex", direction: "row", align: "baseline", gap: sp(1) },
        box: { margin: { top: sp(6) } },
      }, [
        text(`${p}_amount`, `$${plan.price}`, {
          name: "Amount",
          tag: "span",
          cls: "text-4xl font-bold text-gray-900",
          source: src('<span className="text-4xl'),
          style: { fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", color: color("gray-900") },
        }),
        text(`${p}_period`, "/month", {
          name: "Period",
          tag: "span",
          cls: "text-sm text-gray-500",
          source: src('<span className="text-sm'),
          style: { fontSize: "$fontSize.sm", color: color("gray-500") },
        }),
      ]),
      list(`${p}_features`, "plan.features", {
        name: "Features",
        tag: "ul",
        cls: "mt-6 flex flex-1 flex-col gap-2 text-sm text-gray-700",
        source: src("<ul"),
        layout: { mode: "flex", direction: "column", gap: sp(2) },
        box: { margin: { top: sp(6) }, grow: 1 },
        style: { fontSize: "$fontSize.sm", color: color("gray-700") },
      }, plan.features.map((feature, i) =>
        text(`${p}_f${i + 1}`, `✓ ${feature}`, {
          tag: "li",
          source: src("<li key={feature}>", { repeated: { count: plan.features.length, index: i, key: feature } }),
        }),
      )),
      instance(`${p}_cta`, "cmp_button", { className: "mt-8 w-full", children: "Get started" }, {
        name: "CTA",
        source: src('<Button className="mt-8 w-full">'),
      }, [
        button(`${p}_cta_button`, {
          tag: "button",
          cls: "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 mt-8 w-full",
          source: anchor("src/components/ui/button.tsx", "<button", { component: "Button", owner: "PricingCard" }),
          layout: { mode: "flex", direction: "row", align: "center", justify: "center", padding: { top: sp(2), bottom: sp(2), left: sp(4), right: sp(4) } },
          box: { width: { mode: "fill" }, margin: { top: sp(8) } },
          style: { radius: "$radius.md", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", background: color("primary-600"), color: color("white") },
          overrides: [{ when: { state: "hover" }, style: { background: color("primary-700") } }],
        }, [text(`${p}_cta_label`, "Get started")]),
      ]),
    ]),
  ]);
}

function pricingPage(): DesignNode {
  const file = "src/pages/Pricing.tsx";
  const src = (needle: string) => anchor(file, needle, { component: "Pricing", owner: "AppRoutes" });
  return box("n_main", {
    name: "Pricing page",
    tag: "main",
    cls: "mx-auto w-full max-w-6xl px-6 py-16",
    semantic: { role: "main" },
    source: src("<main"),
    layout: { mode: "block", padding: { top: sp(16), bottom: sp(16), left: sp(6), right: sp(6) } },
    box: { width: { mode: "fill" }, maxWidth: "$size.6xl", margin: xAuto },
  }, [
    box("n_header", {
      name: "Header",
      tag: "header",
      cls: "mx-auto max-w-2xl text-center",
      semantic: { role: "header" },
      source: src("<header"),
      box: { maxWidth: "$size.2xl", margin: xAuto },
      style: { textAlign: "center" },
    }, [
      text("n_title", "Pricing", {
        name: "Title",
        tag: "h1",
        cls: "text-4xl font-bold tracking-tight text-gray-900",
        semantic: { role: "heading", level: 1 },
        source: src("<h1"),
        style: { fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight", color: color("gray-900") },
      }),
      text("n_subtitle", "Start for free and upgrade when your project grows.", {
        name: "Subtitle",
        tag: "p",
        cls: "mt-4 text-lg text-gray-600",
        source: src('<p className="mt-4'),
        box: { margin: { top: sp(4) } },
        style: { fontSize: "$fontSize.lg", color: color("gray-600") },
      }),
    ]),
    list("n_plans", "plans array in src/data/plans.ts", {
      name: "Plans grid",
      tag: "div",
      cls: "mt-12 grid gap-6 md:grid-cols-3",
      source: src('<div className="mt-12'),
      layout: { mode: "grid", columns: 1, gap: sp(6) },
      overrides: [{ when: { viewport: "md" }, layout: { columns: 3 } }],
      box: { margin: { top: sp(12) } },
    }, plans.map(pricingCard)),
    box("n_compare", {
      name: "Compare link row",
      tag: "p",
      cls: "mt-10 text-center",
      source: src('<p className="mt-10'),
      box: { margin: { top: sp(10) } },
      style: { textAlign: "center" },
    }, [
      link("n_compare_link", "/compare", {
        name: "Compare link",
        tag: "a",
        cls: "text-sm font-medium text-primary-600 hover:text-primary-700",
        source: src('<Link to="/compare"'),
        style: { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", color: color("primary-600") },
        overrides: [{ when: { state: "hover" }, style: { color: color("primary-700") } }],
      }, [text("n_compare_label", "Compare all features →")]),
    ]),
  ]);
}

function footer(): DesignNode {
  const src = (needle: string) => anchor("src/components/Footer.tsx", needle, { component: "Footer", owner: "AppRoutes" });
  return instance("n_footer", "cmp_footer", {}, { name: "Footer", source: anchor("src/App.tsx", "<Footer />", { component: "AppRoutes" }) }, [
    box("n_footer_el", {
      tag: "footer",
      cls: "mt-auto border-t border-gray-200 bg-white",
      semantic: { role: "footer" },
      source: src("<footer"),
      box: { margin: { top: "auto" } },
      style: { borderWidth: { top: 1 }, borderColor: color("gray-200"), background: color("white") },
    }, [
      text("n_footer_text", "© 2026 Acme Inc.", {
        tag: "p",
        cls: "mx-auto max-w-6xl px-6 py-6 text-sm text-gray-500",
        source: src("<p"),
        layout: { mode: "block", padding: { top: sp(6), bottom: sp(6), left: sp(6), right: sp(6) } },
        box: { maxWidth: "$size.6xl", margin: xAuto },
        style: { fontSize: "$fontSize.sm", color: color("gray-500") },
      }),
    ]),
  ]);
}

export function pricingFrame(): Frame {
  const root = box("n_app", {
    name: "App shell",
    tag: "div",
    cls: "flex min-h-screen flex-col bg-gray-50 font-sans",
    source: anchor("src/App.tsx", '<div className="flex min-h-screen', { component: "AppRoutes" }),
    layout: { mode: "flex", direction: "column" },
    box: { minHeight: "100vh" },
    style: { background: color("gray-50"), fontFamily: "$fontFamily.sans" },
  }, [navbar(), pricingPage(), footer()]);

  return {
    id: "f_pricing",
    name: "Pricing",
    kind: "imported",
    platform: "web",
    target: { adapter: "react-vite", route: "/pricing", file: "src/pages/Pricing.tsx" },
    viewports: [
      { id: "desktop", width: 1280, breakpoint: "lg" },
      { id: "mobile", width: 390 },
    ],
    baseline: root,
    current: clone(root),
    capture: { at: "2026-10-05T10:00:00.000Z", url: "http://localhost:5173/pricing", redaction: "strict" },
  };
}
