import { createId, type DesignNode, type Edges, type Frame, type JsonValue, type Override, type Style, type StyleValue } from "@appshape/ir";
import { type PlaceholderKind, placeholderImage } from "./placeholders";

/**
 * The section library: ready-made page sections (header, hero, features, pricing, …), built only
 * from theme tokens and starter components, so they match the project's design system, follow its
 * theme and work in light and dark mode. Every section is responsive: one column on phones, more
 * from tablets (`md`) up.
 */

export const SECTION_CATEGORIES = [
  "Header",
  "Hero",
  "Logos",
  "Features",
  "Stats",
  "Testimonials",
  "Pricing",
  "FAQ",
  "Call to action",
  "Contact",
  "Blog",
  "Team",
  "Content",
  "Footer",
] as const;
export type SectionCategory = (typeof SECTION_CATEGORIES)[number];

export interface SectionContext {
  /** An instance of a starter component (the project's own copy); `fill` fills its slot. */
  use(key: string, props?: Record<string, JsonValue>, fill?: DesignNode[]): DesignNode;
  /** The project's overlay screen made from a kit overlay (`OVERLAYS`), e.g. the mobile menu: its frame id. */
  overlay?(key: string): string;
  /** Color for drawn placeholder pictures. */
  tint: string;
}

export interface SectionDef {
  key: string;
  category: SectionCategory;
  name: string;
  description: string;
  build(ctx: SectionContext): DesignNode;
}

// ---------- building blocks

type Node<T extends DesignNode["type"]> = Extract<DesignNode, { type: T }>;
const id = () => createId("n");
const x = (v: StyleValue): Edges => ({ left: v, right: v });
const y = (v: StyleValue): Edges => ({ top: v, bottom: v });
const md = (patch: Omit<Override, "when">): Override => ({ when: { viewport: "md" }, ...patch });
const lg = (patch: Omit<Override, "when">): Override => ({ when: { viewport: "lg" }, ...patch });

function text(value: string, style: Style = {}, extra: Partial<Node<"text">> = {}): Node<"text"> {
  return { id: id(), type: "text", origin: "added", text: value, ...(Object.keys(style).length > 0 && { style }), ...extra };
}

function box(layout: NonNullable<DesignNode["layout"]>, children: DesignNode[], extra: Partial<Node<"box">> = {}): Node<"box"> {
  return { id: id(), type: "box", origin: "added", layout, children, ...extra };
}

const column = (gap: StyleValue, children: DesignNode[], extra: Partial<Node<"box">> = {}) => box({ mode: "flex", direction: "column", gap }, children, extra);
const row = (gap: StyleValue, children: DesignNode[], extra: Partial<Node<"box">> = {}) => box({ mode: "flex", direction: "row", align: "center", gap }, children, extra);

/** A grid: one column on phones, `columns` from tablets (`wide` = from desktops). */
function grid(columns: number, gap: StyleValue, children: DesignNode[], options: { tablet?: number; wide?: boolean } = {}): Node<"box"> {
  const overrides: Override[] = [];
  if (options.tablet) overrides.push(md({ layout: { columns: options.tablet } }));
  overrides.push((options.wide ? lg : md)({ layout: { columns } }));
  return box({ mode: "grid", columns: 1, gap }, children, { overrides });
}

/** Headings in the design system's text styles (H1–H3): changing a style changes every section. */
function heading(value: string, level: 1 | 2 | 3, extra: { center?: boolean; color?: StyleValue } = {}): Node<"text"> {
  return text(
    value,
    { textStyle: `h${level}`, ...(extra.center && { textAlign: "center" }), ...(extra.color && { color: extra.color }) },
    { semantic: { role: "heading", level } },
  );
}

// small brand-colored text uses accent-foreground: brand-tinted and readable in both color schemes
const eyebrow = (value: string, center = false) => text(value, { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold", color: "$color.accent-foreground", ...(center && { textAlign: "center" }) });
const lead = (value: string, center = false, color: StyleValue = "$color.muted-foreground") => text(value, { fontSize: "$fontSize.lg", color, lineHeight: "$lineHeight.relaxed", ...(center && { textAlign: "center" }) });
const small = (value: string, extra: Style = {}) => text(value, { fontSize: "$fontSize.sm", color: "$color.muted-foreground", ...extra });

/** A section: full width (its background), content centered at the theme's content width. */
function section(name: string, children: DesignNode[], options: { background?: StyleValue; color?: StyleValue; gap?: StyleValue; role?: string; style?: Style } = {}): Node<"box"> {
  return box(
    { mode: "flex", direction: "column", align: "center", padding: { ...x("$spacing.gutter"), ...y("$spacing.section") } },
    [column(options.gap ?? "$spacing.12", children, { name: "Content", box: { width: { mode: "fill" }, maxWidth: "$size.content" } })],
    {
      name,
      semantic: { role: options.role ?? "section" },
      style: { ...(options.background && { background: options.background }), ...(options.color && { color: options.color }), ...options.style },
      overrides: [md({ layout: { padding: { ...x("$spacing.gutter"), ...y("$spacing.section-lg") } } })],
    },
  );
}

/** Title block of a section: eyebrow, heading, lead. */
const intro = (label: string | undefined, title: string, body: string | undefined, center = true) =>
  column("$spacing.4", [...(label ? [eyebrow(label, center)] : []), heading(title, 2, { center }), ...(body ? [lead(body, center)] : [])], {
    name: "Intro",
    ...(center && { layout: { mode: "flex", direction: "column", gap: "$spacing.4", align: "center" }, box: { maxWidth: "$size.2xl", alignSelf: "center" } }),
  });

function image(kind: PlaceholderKind, tint: string, ratio = "16 / 10", extra: Partial<Node<"image">> = {}): Node<"image"> {
  return {
    id: id(),
    type: "image",
    origin: "added",
    src: placeholderImage(kind, tint).src,
    alt: "",
    fit: "cover",
    box: { width: { mode: "fill" }, aspectRatio: ratio },
    style: { radius: "$radius.2xl" },
    ...extra,
  };
}

const icon = (name: string, style: Style = {}): Node<"icon"> => ({ id: id(), type: "icon", origin: "added", icon: name, set: "lucide", ...(Object.keys(style).length > 0 && { style }) });

/** An icon on a tinted tile. */
const iconTile = (name: string) =>
  box({ mode: "flex", align: "center", justify: "center" }, [icon(name, { fontSize: "$fontSize.xl" })], {
    name: "Icon",
    box: { width: { mode: "fixed", value: "$spacing.10" }, height: { mode: "fixed", value: "$spacing.10" } },
    style: { background: "$color.accent", color: "$color.accent-foreground", radius: "$radius.lg" },
  });

const check = (value: string) => row("$spacing.3", [icon("check", { color: "$color.primary" }), text(value, { fontSize: "$fontSize.sm" })], { layout: { mode: "flex", direction: "row", align: "start", gap: "$spacing.3" } });

const link = (value: string, style: Style = {}): Node<"link"> => ({
  id: id(),
  type: "link",
  origin: "added",
  href: "#",
  style: { fontSize: "$fontSize.sm", color: "$color.muted-foreground", ...style },
  overrides: [{ when: { state: "hover" }, style: { color: "$color.foreground" } }],
  children: [text(value)],
});

const logo = () =>
  row("$spacing.2", [box({ mode: "flex" }, [], { name: "Mark", box: { width: { mode: "fixed", value: "$spacing.7" }, height: { mode: "fixed", value: "$spacing.7" } }, style: { background: "$color.primary", radius: "$radius.lg" } }), text("Acme", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.bold" })], { name: "Logo" });

/** Shown on phones only / from tablets up. */
const phoneOnly = (node: DesignNode): DesignNode => ({ ...node, overrides: [...(node.overrides ?? []), md({ hidden: true })] });
const fromTablet = (node: DesignNode): DesignNode => ({ ...node, hidden: true, overrides: [...(node.overrides ?? []), md({ hidden: false })] });

const slotFill = (gap: StyleValue, children: DesignNode[]): DesignNode => ({ id: id(), type: "slot", origin: "added", slotName: "content", layout: { mode: "flex", direction: "column", gap }, children });

/** A square icon button (menu, close); `name` is what screen readers call it. */
const iconButton = (name: string, iconName: string, interaction?: DesignNode["interaction"]): DesignNode => ({
  ...box({ mode: "flex", align: "center", justify: "center" }, [icon(iconName, { fontSize: "$fontSize.xl" })], {
    name,
    box: { width: { mode: "fixed", value: "$spacing.10" }, height: { mode: "fixed", value: "$spacing.10" } },
    style: { radius: "$radius.md", cursor: "pointer" },
    overrides: [{ when: { state: "hover" }, style: { background: "$color.accent" } }],
  }),
  ...(interaction && { interaction }),
});

/** On phones: opens the mobile menu (a drawer from the right). */
const menuButton = (ctx: SectionContext) => {
  const menu = ctx.overlay?.("mobile-menu");
  return phoneOnly(iconButton("Menu", "menu", menu ? { type: "open", frameId: menu, as: "drawer", side: "right" } : undefined));
};

function headerBar(ctx: SectionContext, middle: DesignNode | undefined, actions: DesignNode[]): Node<"box"> {
  return box(
    { mode: "flex", direction: "row", align: "center", justify: "center", padding: { ...x("$spacing.gutter"), ...y("$spacing.4") } },
    [row("$spacing.6", [logo(), ...(middle ? [fromTablet(middle)] : []), row("$spacing.2", [...actions.map(fromTablet), menuButton(ctx)], { name: "Actions" })], { name: "Bar", box: { width: { mode: "fill" }, maxWidth: "$size.content" }, layout: { mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.6" } })],
    { name: "Header", semantic: { role: "header" }, style: { background: "$color.background", borderWidth: { bottom: 1 }, borderColor: "$color.border" } },
  );
}

const navLinks = (ctx: SectionContext, labels: string[]) => row("$spacing.1", labels.map((label, i) => ctx.use("nav-link", { label, ...(i === 0 && { active: true }) })), { name: "Navigation", semantic: { role: "nav" } });

const person = (ctx: SectionContext, name: string, role: string) =>
  row("$spacing.3", [ctx.use("avatar", { size: "sm" }), column("$spacing.0", [text(name, { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold" }), small(role)])], { name: "Person" });

const card = (ctx: SectionContext, gap: StyleValue, children: DesignNode[], extra: Partial<Node<"instance">> = {}) => ({ ...ctx.use("card", {}, [slotFill(gap, children)]), ...extra }) as DesignNode;

const featureCard = (ctx: SectionContext, iconName: string, title: string, body: string) => card(ctx, "$spacing.3", [iconTile(iconName), heading(title, 3), small(body)]);

/** Repeated content: `template` once per item (its nodes bind the item's keys). */
function repeated(dataName: string, items: Record<string, JsonValue>[], template: DesignNode, list: Partial<Node<"box">>): DesignNode {
  return { ...box({ mode: "flex", direction: "column" }, []), ...list, type: "list", dataName, items, children: [template] } as DesignNode;
}

const REVIEWS: Record<string, JsonValue>[] = [
  { quote: "“We moved our whole team over in a week. Planning finally feels calm.”", name: "Maya Patel", role: "Head of Product, Lumen" },
  { quote: "“The best tool we've adopted this year. Everyone actually uses it.”", name: "Jonas Weber", role: "CTO, Northwind" },
  { quote: "“Clear, fast and pleasant. Our launches are on time again.”", name: "Sara Lind", role: "Founder, Fjord" },
  { quote: "“Our designers and developers finally look at the same thing.”", name: "Tom Becker", role: "Design Lead, Kite" },
  { quote: "“Setup took an afternoon. The support team is wonderful.”", name: "Ana Costa", role: "Operations, Verde" },
  { quote: "“It replaced three tools for us, and nobody misses them.”", name: "Ken Ito", role: "COO, Harbor" },
];

/** A testimonial card whose quote, name and role come from the item. */
const quoteCard = (ctx: SectionContext) =>
  card(ctx, "$spacing.6", [
    { ...text(String(REVIEWS[0]!.quote), { fontSize: "$fontSize.base", lineHeight: "$lineHeight.relaxed" }), name: "Quote", bind: { text: "quote" } },
    row("$spacing.3", [
      ctx.use("avatar", { size: "sm" }),
      column("$spacing.0", [
        { ...text(String(REVIEWS[0]!.name), { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold" }), name: "Name", bind: { text: "name" } },
        { ...small(String(REVIEWS[0]!.role)), name: "Role", bind: { text: "role" } },
      ]),
    ], { name: "Person" }),
  ]);

const FEATURES: [string, string, string][] = [
  ["zap", "Fast by default", "Pages load in a blink on every device, without tuning."],
  ["shield-check", "Secure", "Your data is encrypted at rest and in transit."],
  ["sparkles", "Delightful", "Thoughtful details that make everyday work lighter."],
  ["users", "Built for teams", "Share, comment and decide together in one place."],
  ["chart-line", "Clear insights", "See what works at a glance with simple reports."],
  ["plug", "Connects", "Works with the tools you already use."],
];

// ---------- the sections

export const SECTIONS: SectionDef[] = [
  {
    key: "header-simple",
    category: "Header",
    name: "Header",
    description: "Logo, links and a button; a menu button on phones.",
    build: (ctx) => headerBar(ctx, navLinks(ctx, ["Product", "Pricing", "About", "Blog"]), [ctx.use("button", { label: "Get started", size: "sm" })]),
  },
  {
    key: "header-login",
    category: "Header",
    name: "Header with log in",
    description: "Links in the middle, log in and sign up on the right.",
    build: (ctx) => headerBar(ctx, navLinks(ctx, ["Features", "Pricing", "Customers", "Docs"]), [ctx.use("button", { label: "Log in", variant: "ghost", size: "sm" }), ctx.use("button", { label: "Sign up", size: "sm" })]),
  },
  {
    key: "hero-centered",
    category: "Hero",
    name: "Hero, centered",
    description: "Badge, big headline, text, two buttons and a picture.",
    build: (ctx) =>
      section(
        "Hero",
        [
          column("$spacing.6", [
            ctx.use("badge", { label: "New: version 2.0 is here" }),
            heading("Ship a better product, faster", 1, { center: true }),
            lead("Everything your team needs to plan, build and launch, in one calm place.", true),
            row("$spacing.3", [ctx.use("button", { label: "Get started", size: "lg" }), ctx.use("button", { label: "Book a demo", variant: "outline", size: "lg" })], { layout: { mode: "flex", direction: "row", wrap: true, justify: "center", gap: "$spacing.3" } }),
          ], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.6" }, box: { maxWidth: "$size.3xl", alignSelf: "center" } }),
          image("abstract", ctx.tint, "16 / 9", { style: { radius: "$radius.2xl", borderWidth: 1, borderColor: "$color.border" } }),
        ],
        { gap: "$spacing.16" },
      ),
  },
  {
    key: "hero-split",
    category: "Hero",
    name: "Hero, text and picture",
    description: "Headline and buttons on the left, a picture on the right; stacked on phones.",
    build: (ctx) =>
      section("Hero", [
        grid(2, "$spacing.12", [
          column("$spacing.6", [
            eyebrow("For growing teams"),
            heading("Work that flows, from idea to launch", 1),
            lead("Plan projects, share progress and ship on time, without the busywork."),
            row("$spacing.3", [ctx.use("button", { label: "Start for free", size: "lg" }), ctx.use("button", { label: "See how it works", variant: "ghost", size: "lg" })], { layout: { mode: "flex", direction: "row", wrap: true, gap: "$spacing.3" } }),
            row("$spacing.2", [icon("star", { color: "$color.primary" }), small("Rated 4.9 by 2,000+ teams")]),
          ], { layout: { mode: "flex", direction: "column", justify: "center", gap: "$spacing.6" } }),
          image("photo", ctx.tint, "4 / 3"),
        ], { wide: true }),
      ]),
  },
  {
    key: "hero-image",
    category: "Hero",
    name: "Hero on a picture",
    description: "Headline in light text over a full-width background picture.",
    build: (ctx) =>
      box(
        { mode: "flex", direction: "column" },
        [
          box(
            { mode: "flex", direction: "column", align: "center", padding: { ...x("$spacing.gutter"), top: "$spacing.32", bottom: "$spacing.32" } },
            [
              column("$spacing.6", [heading("Find your calm", 1, { center: true, color: "#ffffff" }), lead("Retreats in places where the noise stops and the ideas start.", true, "rgb(255 255 255 / 0.85)"), ctx.use("button", { label: "Explore places", size: "lg" })], {
                layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.6" },
                box: { maxWidth: "$size.2xl" },
              }),
            ],
            { name: "Overlay", style: { background: "rgb(0 0 0 / 0.5)" } },
          ),
        ],
        { name: "Hero", semantic: { role: "section" }, style: { backgroundImage: { src: placeholderImage("photo", ctx.tint).src, size: "cover", position: "center", repeat: false }, background: "$color.neutral-900" } },
      ),
  },
  {
    key: "logos",
    category: "Logos",
    name: "Logo strip",
    description: "\"Trusted by\" and a row of customer logos.",
    build: (ctx) =>
      section(
        "Logos",
        [
          small("Trusted by teams at", { textAlign: "center", fontWeight: "$fontWeight.medium" }),
          box({ mode: "flex", direction: "row", wrap: true, align: "center", justify: "center", gap: "$spacing.10" }, Array.from({ length: 5 }, () => image("logo", ctx.tint, "10 / 3", { box: { width: { mode: "fixed", value: "$spacing.32" }, aspectRatio: "10 / 3" }, style: { radius: "$radius.none" } })), { name: "Logos" }),
        ],
        { gap: "$spacing.8" },
      ),
  },
  {
    key: "features-cards",
    category: "Features",
    name: "Features in cards",
    description: "Three cards with an icon, a title and a sentence each.",
    build: (ctx) =>
      section("Features", [intro("Features", "Everything you need, nothing you don't", "Simple tools that work together, so you can focus on the work."), grid(3, "$spacing.6", FEATURES.slice(0, 3).map(([i, t, b]) => featureCard(ctx, i, t, b)))], { background: "$color.muted" }),
  },
  {
    key: "features-icons",
    category: "Features",
    name: "Features with icons",
    description: "Six features in a grid of icons and text, without cards.",
    build: (ctx) =>
      section("Features", [
        intro("Why us", "Built for the way you work", undefined),
        grid(3, "$spacing.10", FEATURES.map(([i, t, b]) => column("$spacing.3", [iconTile(i), heading(t, 3), small(b)])), { tablet: 2, wide: true }),
      ]),
  },
  {
    key: "features-split",
    category: "Features",
    name: "Feature with picture",
    description: "A picture next to a title, text and a checklist.",
    build: (ctx) =>
      section("Feature", [
        grid(2, "$spacing.12", [
          image("photo", ctx.tint, "4 / 3"),
          column("$spacing.6", [
            eyebrow("Collaboration"),
            heading("Everyone on the same page", 2),
            lead("Comments, tasks and files live next to the work, so nothing gets lost in chat."),
            column("$spacing.3", ["Real-time editing", "Comments and mentions", "Version history"].map(check)),
          ], { layout: { mode: "flex", direction: "column", justify: "center", gap: "$spacing.6" } }),
        ], { wide: true }),
      ]),
  },
  {
    key: "stats",
    category: "Stats",
    name: "Numbers",
    description: "Four key numbers with labels.",
    build: () =>
      section("Stats", [
        grid(4, "$spacing.8", [
          ["10k+", "Teams"],
          ["99.9%", "Uptime"],
          ["4.9/5", "Rating"],
          ["24/7", "Support"],
        ].map(([n, l]) => column("$spacing.1", [text(n!, { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight", textAlign: "center" }), small(l!, { textAlign: "center" })])), { tablet: 2 }),
      ], { background: "$color.muted" }),
  },
  {
    key: "testimonials-cards",
    category: "Testimonials",
    name: "Testimonials",
    description: "Three quotes from customers, with their picture and role.",
    build: (ctx) =>
      section("Testimonials", [
        intro("Testimonials", "Loved by teams everywhere", undefined),
        // one card design, repeated for each testimonial (generated as data and a .map())
        repeated("testimonials", REVIEWS.slice(0, 3), quoteCard(ctx), { ...grid(3, "$spacing.6", []), name: "Testimonials" }),
      ]),
  },
  {
    key: "testimonials-carousel",
    category: "Testimonials",
    name: "Testimonials carousel",
    description: "Customer quotes in a row that scrolls sideways and snaps; one card design plus its data.",
    build: (ctx) =>
      section("Testimonials", [
        intro("Testimonials", "What our customers say", undefined),
        repeated(
          "reviews",
          REVIEWS,
          { ...quoteCard(ctx), box: { width: { mode: "fixed", value: "$spacing.80" }, shrink: 0 } } as DesignNode,
          { name: "Carousel", layout: { mode: "flex", direction: "row", gap: "$spacing.6", padding: { bottom: "$spacing.4" } }, box: { width: { mode: "fill" } }, style: { overflow: "auto", snap: "start" } },
        ),
      ], { background: "$color.muted" }),
  },
  {
    key: "testimonial-quote",
    category: "Testimonials",
    name: "Big quote",
    description: "One customer quote, large and centered.",
    build: (ctx) =>
      section("Testimonial", [
        column("$spacing.8", [
          text("“AppShape gave us our evenings back. The team ships twice as often, and it shows.”", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.2xl", fontWeight: "$fontWeight.medium", textAlign: "center", lineHeight: "$lineHeight.snug" }, { overrides: [md({ style: { fontSize: "$fontSize.3xl" } })] }),
          column("$spacing.2", [ctx.use("avatar", { size: "lg" }), text("Lea Fischer", { fontWeight: "$fontWeight.semibold" }), small("VP Engineering, Brightline")], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.2" } }),
        ], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.8" }, box: { maxWidth: "$size.3xl", alignSelf: "center" } }),
      ], { background: "$color.muted" }),
  },
  {
    key: "pricing-tiers",
    category: "Pricing",
    name: "Pricing plans",
    description: "Three plans side by side; the middle one is highlighted.",
    build: (ctx) => {
      const plan = (name: string, price: string, note: string, features: string[], popular = false) =>
        card(
          ctx,
          "$spacing.6",
          [
            row("$spacing.2", [heading(name, 3), ...(popular ? [ctx.use("badge", { label: "Popular", variant: "solid" })] : [])], { layout: { mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.2" } }),
            row("$spacing.1", [text(price, { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight" }), small("/ month")], { layout: { mode: "flex", direction: "row", align: "baseline", gap: "$spacing.1" } }),
            small(note),
            column("$spacing.3", features.map(check)),
            { ...ctx.use("button", { label: popular ? "Start free trial" : "Get started", variant: popular ? "primary" : "outline" }), box: { width: { mode: "fill" } } } as DesignNode,
          ],
          popular ? { style: { borderColor: "$color.primary", borderWidth: 2 } } : {},
        );
      return section("Pricing", [
        intro("Pricing", "Simple pricing that grows with you", "Start free. Upgrade when your team does. Cancel anytime."),
        grid(3, "$spacing.6", [
          plan("Starter", "$0", "For individuals trying things out.", ["1 project", "Basic reports", "Community support"]),
          plan("Team", "$29", "For small teams that ship together.", ["Unlimited projects", "Advanced reports", "Priority support", "Integrations"], true),
          plan("Business", "$99", "For companies with more needs.", ["Everything in Team", "Single sign-on", "Audit log", "Dedicated manager"]),
        ]),
      ]);
    },
  },
  {
    key: "pricing-single",
    category: "Pricing",
    name: "One plan",
    description: "A single plan with what's included, next to a short pitch.",
    build: (ctx) =>
      section("Pricing", [
        grid(2, "$spacing.12", [
          column("$spacing.6", [eyebrow("Pricing"), heading("One plan, everything included", 2), lead("No tiers, no surprises. Every feature, for everyone on your team."), column("$spacing.3", ["Unlimited projects", "All integrations", "Priority support"].map(check))], { layout: { mode: "flex", direction: "column", justify: "center", gap: "$spacing.6" } }),
          card(ctx, "$spacing.6", [
            small("Per person, billed yearly", { textAlign: "center" }),
            text("$12", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.6xl", fontWeight: "$fontWeight.bold", textAlign: "center", letterSpacing: "$letterSpacing.tight" }),
            { ...ctx.use("button", { label: "Start your free trial", size: "lg" }), box: { width: { mode: "fill" } } } as DesignNode,
            small("14 days free, no credit card needed.", { textAlign: "center" }),
          ]),
        ], { wide: true }),
      ], { background: "$color.muted" }),
  },
  {
    key: "faq-list",
    category: "FAQ",
    name: "FAQ",
    description: "Questions that open to show their answers.",
    build: (ctx) =>
      section("FAQ", [
        intro(undefined, "Frequently asked questions", "Can't find what you're looking for? Write to us."),
        column("$spacing.0", [
          ctx.use("accordion", { question: "Is there a free plan?", answer: "Yes. Start for free and upgrade when your team grows.", open: true }),
          ctx.use("accordion", { question: "Can I cancel anytime?", answer: "Of course. Cancel with one click, no questions asked." }),
          ctx.use("accordion", { question: "Do you offer discounts for nonprofits?", answer: "Yes, nonprofits and schools get 50% off every plan." }),
          ctx.use("accordion", { question: "Where is my data stored?", answer: "In data centers in the EU, encrypted at rest and in transit." }),
        ], { name: "Questions", box: { width: { mode: "fill" }, maxWidth: "$size.3xl", alignSelf: "center" } }),
      ]),
  },
  {
    key: "faq-split",
    category: "FAQ",
    name: "FAQ, two columns",
    description: "Title and contact on the left, questions on the right.",
    build: (ctx) =>
      section("FAQ", [
        grid(2, "$spacing.12", [
          column("$spacing.4", [heading("Questions & answers", 2), lead("Everything you need to know. Still unsure?"), { ...ctx.use("button", { label: "Contact us", variant: "outline" }) } as DesignNode]),
          column("$spacing.0", [
            ctx.use("accordion", { question: "How long does setup take?", answer: "Most teams are up and running in under an hour.", open: true }),
            ctx.use("accordion", { question: "Can I import my data?", answer: "Yes, from spreadsheets and the most common tools." }),
            ctx.use("accordion", { question: "Is support included?", answer: "Every plan includes email support; Team and up get priority." }),
          ]),
        ], { wide: true }),
      ]),
  },
  {
    key: "cta-banner",
    category: "Call to action",
    name: "Call to action",
    description: "A bold band in the brand color with a headline and buttons.",
    build: (ctx) =>
      section(
        "Call to action",
        [
          column("$spacing.6", [
            heading("Ready to get started?", 2, { center: true, color: "$color.primary-foreground" }),
            lead("Join thousands of teams that ship calmly. Free for 14 days.", true, "$color.primary-foreground/80"),
            row("$spacing.3", [ctx.use("button", { label: "Start for free", variant: "secondary", size: "lg" })], { layout: { mode: "flex", direction: "row", wrap: true, justify: "center", gap: "$spacing.3" } }),
          ], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.6" } }),
        ],
        { background: "$color.primary", color: "$color.primary-foreground" },
      ),
  },
  {
    key: "cta-card",
    category: "Call to action",
    name: "Call to action card",
    description: "A framed box with a headline and two buttons, side by side on wide screens.",
    build: (ctx) =>
      section("Call to action", [
        card(ctx, "$spacing.6", [
          box({ mode: "flex", direction: "column", gap: "$spacing.6" }, [
            column("$spacing.2", [heading("Try it with your team", 2), small("Set up in minutes. No credit card required.", { fontSize: "$fontSize.base" })]),
            row("$spacing.3", [ctx.use("button", { label: "Start free trial", size: "lg" }), ctx.use("button", { label: "Talk to sales", variant: "outline", size: "lg" })], { layout: { mode: "flex", direction: "row", wrap: true, gap: "$spacing.3" } }),
          ], { overrides: [lg({ layout: { direction: "row", align: "center", justify: "between" } })] }),
        ]),
      ]),
  },
  {
    key: "contact-form",
    category: "Contact",
    name: "Contact form",
    description: "Ways to reach you on the left, a form on the right.",
    build: (ctx) =>
      section("Contact", [
        grid(2, "$spacing.12", [
          column("$spacing.6", [
            eyebrow("Contact"),
            heading("Let's talk", 2),
            lead("Questions, ideas or a demo? We answer within one working day."),
            column("$spacing.4", [
              row("$spacing.3", [icon("mail", { color: "$color.primary" }), text("hello@acme.com")]),
              row("$spacing.3", [icon("phone", { color: "$color.primary" }), text("+49 30 1234 5678")]),
              row("$spacing.3", [icon("map-pin", { color: "$color.primary" }), text("Torstraße 1, Berlin")]),
            ]),
          ]),
          card(ctx, "$spacing.4", [
            grid(2, "$spacing.4", [ctx.use("input", { label: "First name", placeholder: "Jane" }), ctx.use("input", { label: "Last name", placeholder: "Doe" })]),
            ctx.use("input", { label: "Email", placeholder: "jane@company.com" }),
            ctx.use("textarea", { label: "Message", placeholder: "How can we help?" }),
            ctx.use("checkbox", { label: "I agree to the privacy policy" }),
            { ...ctx.use("button", { label: "Send message" }), box: { width: { mode: "fill" } } } as DesignNode,
          ]),
        ], { wide: true }),
      ]),
  },
  {
    key: "newsletter",
    category: "Contact",
    name: "Newsletter",
    description: "A short pitch with an email field and a button.",
    build: (ctx) =>
      section(
        "Newsletter",
        [
          column("$spacing.6", [
            heading("Stay in the loop", 2, { center: true }),
            lead("One email a month with product news and tips. No spam.", true),
            box({ mode: "flex", direction: "column", gap: "$spacing.3" }, [{ ...ctx.use("input", { label: "Email", placeholder: "you@example.com" }), box: { width: { mode: "fill" } } } as DesignNode, ctx.use("button", { label: "Subscribe" })], {
              name: "Form",
              box: { width: { mode: "fill" }, maxWidth: "$size.md" },
              overrides: [md({ layout: { direction: "row", align: "end" } })],
            }),
          ], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.6" } }),
        ],
        { background: "$color.muted" },
      ),
  },
  {
    key: "blog-cards",
    category: "Blog",
    name: "Latest posts",
    description: "Three article cards with picture, date, title and summary.",
    build: (ctx) =>
      section("Blog", [
        intro("Blog", "From the blog", "Ideas, stories and news from our team."),
        grid(3, "$spacing.6", [
          ["Mar 4, 2026", "How we plan a launch in one page", "A simple template that keeps everyone aligned."],
          ["Feb 18, 2026", "Five habits of calm teams", "What the most relaxed teams do differently."],
          ["Jan 30, 2026", "Designing for focus", "Small interface choices that protect attention."],
        ].map(([d, t, s]) => card(ctx, "$spacing.3", [image("photo", ctx.tint, "16 / 9", { style: { radius: "$radius.lg" } }), small(d!), heading(t!, 3), small(s!), link("Read more →", { color: "$color.accent-foreground", fontWeight: "$fontWeight.medium" })]))),
      ]),
  },
  {
    key: "team-grid",
    category: "Team",
    name: "Team",
    description: "People with picture, name and role.",
    build: (ctx) =>
      section("Team", [
        intro("Team", "The people behind Acme", "A small team that cares about the details."),
        grid(4, "$spacing.8", [
          ["Anna Schmidt", "Co-founder & CEO"],
          ["Ben Okafor", "Co-founder & CTO"],
          ["Clara Ruiz", "Head of Design"],
          ["David Kim", "Engineering"],
        ].map(([n, r]) => column("$spacing.3", [ctx.use("avatar", { size: "lg" }), column("$spacing.0", [text(n!, { fontWeight: "$fontWeight.semibold", textAlign: "center" }), small(r!, { textAlign: "center" })])], { layout: { mode: "flex", direction: "column", align: "center", gap: "$spacing.3" } })), { tablet: 2 }),
      ]),
  },
  {
    key: "article",
    category: "Content",
    name: "Article",
    description: "A blog post or long text: title, author, picture, paragraphs and a quote.",
    build: (ctx) =>
      section("Article", [
        column("$spacing.8", [
          column("$spacing.4", [small("Product · 6 min read", { color: "$color.accent-foreground", fontWeight: "$fontWeight.semibold" }), heading("How we plan a launch in one page", 1), person(ctx, "Maya Patel", "March 4, 2026")]),
          image("photo", ctx.tint, "16 / 9"),
          text("Launches used to mean long documents nobody read. Now we use a single page that answers four questions: what we're shipping, for whom, by when, and how we'll know it worked.", { fontSize: "$fontSize.lg", lineHeight: "$lineHeight.relaxed" }),
          heading("Start with the reader", 2),
          text("Write the page for the person who has five minutes before a meeting. Lead with the decision, keep the details in links, and update it as things change.", { lineHeight: "$lineHeight.relaxed" }),
          box({ mode: "flex", direction: "column", padding: { left: "$spacing.6" } }, [text("“If it doesn't fit on one page, we don't understand it yet.”", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.xl", fontWeight: "$fontWeight.medium" })], { name: "Quote", style: { borderWidth: { left: 4 }, borderColor: "$color.primary" } }),
          text("The result: fewer meetings, faster decisions and launches that land on the day we planned.", { lineHeight: "$lineHeight.relaxed" }),
        ], { name: "Text", box: { width: { mode: "fill" }, maxWidth: "$size.2xl", alignSelf: "center" } }),
      ]),
  },
  {
    key: "footer-columns",
    category: "Footer",
    name: "Footer with links",
    description: "Logo and text, three columns of links, copyright and social icons.",
    build: () => {
      const col = (title: string, links: string[]) => column("$spacing.3", [text(title, { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold" }), ...links.map((l) => link(l))]);
      return section(
        "Footer",
        [
          grid(4, "$spacing.10", [column("$spacing.4", [logo(), small("Calm tools for teams that ship.")]), col("Product", ["Features", "Pricing", "Changelog"]), col("Company", ["About", "Blog", "Careers"]), col("Legal", ["Privacy", "Terms", "Imprint"])], { tablet: 2 }),
          box({ mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: "$spacing.8" } }, [small("© 2026 Acme Inc. All rights reserved."), row("$spacing.4", ["globe", "rss", "at-sign"].map((n) => icon(n, { color: "$color.muted-foreground" })))], {
            name: "Bottom",
            style: { borderWidth: { top: 1 }, borderColor: "$color.border" },
            overrides: [md({ layout: { direction: "row", align: "center", justify: "between" } })],
          }),
        ],
        { role: "footer", gap: "$spacing.12", style: { borderWidth: { top: 1 }, borderColor: "$color.border" } },
      );
    },
  },
  {
    key: "footer-simple",
    category: "Footer",
    name: "Simple footer",
    description: "Logo, a few links and the copyright in one row.",
    build: () =>
      box(
        { mode: "flex", direction: "column", align: "center", padding: { ...x("$spacing.gutter"), ...y("$spacing.10") } },
        [
          box({ mode: "flex", direction: "column", align: "center", gap: "$spacing.6" }, [logo(), row("$spacing.6", ["About", "Pricing", "Blog", "Contact"].map((l) => link(l)), { layout: { mode: "flex", direction: "row", wrap: true, justify: "center", gap: "$spacing.6" } }), small("© 2026 Acme Inc.")], {
            name: "Content",
            box: { width: { mode: "fill" }, maxWidth: "$size.content" },
            overrides: [md({ layout: { direction: "row", justify: "between" } })],
          }),
        ],
        { name: "Footer", semantic: { role: "footer" }, style: { borderWidth: { top: 1 }, borderColor: "$color.border" } },
      ),
  },
];

export function sectionDef(key: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.key === key);
}

/** The starter components a section uses (they are added to the project before it). */
/** Starter components the sections use (also those of the overlays they open), in order. */
export function sectionUses(keys: readonly string[]): string[] {
  const used = new Set<string>();
  const ctx: SectionContext = {
    tint: "#71717a",
    use: (key) => (used.add(key), { id: id(), type: "box", origin: "added", children: [] }),
    overlay: (key) => (overlayDef(key)?.build(ctx), "f_overlay"),
  };
  for (const key of keys) sectionDef(key)?.build(ctx);
  return [...used];
}

/** Kit overlays the sections open (the mobile menu of headers), in order. */
export function sectionOverlays(keys: readonly string[]): string[] {
  const used = new Set<string>();
  const ctx: SectionContext = { tint: "#71717a", use: () => ({ id: id(), type: "box", origin: "added", children: [] }), overlay: (key) => (used.add(key), "f_overlay") };
  for (const key of keys) sectionDef(key)?.build(ctx);
  return [...used];
}

// ---------- overlay screens

/** A screen shown over the page (`frame.overlay`), opened by an element of a section. */
export interface OverlayDef {
  key: string;
  name: string;
  description: string;
  as: "modal" | "drawer" | "dropdown";
  side?: "left" | "right";
  /** Its width (the overlay screen's viewport). */
  width: number;
  build(ctx: SectionContext): DesignNode;
}

const menuLink = (value: string, size: StyleValue = "$fontSize.base"): DesignNode => ({
  ...link(value, { fontSize: size, color: "$color.foreground", fontWeight: "$fontWeight.medium", radius: "$radius.md" }),
  layout: { padding: { ...x("$spacing.3"), ...y("$spacing.2") } },
  overrides: [{ when: { state: "hover" }, style: { background: "$color.accent", color: "$color.accent-foreground" } }],
});

const plainButton = (label: string, interaction: DesignNode["interaction"]): DesignNode => ({
  ...box({ mode: "flex", align: "center", justify: "center", padding: { ...x("$spacing.4"), ...y("$spacing.2") } }, [text(label, { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold" })], {
    name: label,
    style: { radius: "$radius.md", borderWidth: 1, borderColor: "$color.input", cursor: "pointer" },
    overrides: [{ when: { state: "hover" }, style: { background: "$color.accent" } }],
  }),
  ...(interaction && { interaction }),
});

export const OVERLAYS: OverlayDef[] = [
  {
    key: "mobile-menu",
    name: "Mobile menu",
    description: "The header's links and button for phones, sliding in from the right.",
    as: "drawer",
    side: "right",
    width: 320,
    build: (ctx) =>
      column("$spacing.6", [
        row("$spacing.4", [logo(), iconButton("Close menu", "x", { type: "close" })], { name: "Top", layout: { mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.4" } }),
        column("$spacing.1", ["Product", "Pricing", "About", "Blog"].map((l) => menuLink(l, "$fontSize.lg")), { name: "Navigation", semantic: { role: "nav" } }),
        { ...ctx.use("button", { label: "Get started" }), box: { width: { mode: "fill" } } } as DesignNode,
      ], { name: "Mobile menu", layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: { ...x("$spacing.6"), ...y("$spacing.4") } }, style: { background: "$color.background", color: "$color.foreground" } }),
  },
  {
    key: "dialog",
    name: "Dialog",
    description: "A message over the dimmed page, with actions.",
    as: "modal",
    width: 480,
    build: (ctx) =>
      column("$spacing.6", [
        row("$spacing.4", [heading("Talk to our team", 3), iconButton("Close", "x", { type: "close" })], { name: "Top", layout: { mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.4" } }),
        lead("Tell us a little about your team and we will get back to you within a day."),
        ctx.use("input", { label: "Work email", placeholder: "you@company.com" }),
        row("$spacing.3", [plainButton("Cancel", { type: "close" }), ctx.use("button", { label: "Send" })], { name: "Actions", layout: { mode: "flex", direction: "row", align: "center", justify: "end", gap: "$spacing.3" } }),
      ], { name: "Dialog", layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: { ...x("$spacing.6"), ...y("$spacing.6") } }, style: { background: "$color.background", color: "$color.foreground", radius: "$radius.xl", shadow: "$shadow.xl" } }),
  },
  {
    key: "dropdown-menu",
    name: "Dropdown menu",
    description: "A short list of links below the element that opens it.",
    as: "dropdown",
    width: 224,
    build: () =>
      column("$spacing.0.5", ["Profile", "Settings", "Billing", "Sign out"].map((l) => menuLink(l, "$fontSize.sm")), {
        name: "Dropdown menu",
        layout: { mode: "flex", direction: "column", gap: "$spacing.0.5", padding: { ...x("$spacing.1.5"), ...y("$spacing.1.5") } },
        style: { background: "$color.background", color: "$color.foreground", borderWidth: 1, borderColor: "$color.border", radius: "$radius.lg", shadow: "$shadow.lg" },
      }),
  },
];

/** Starter components the overlays use. */
export function overlayUses(keys: readonly string[]): string[] {
  const used = new Set<string>();
  const ctx: SectionContext = { tint: "#71717a", use: (key) => (used.add(key), { id: id(), type: "box", origin: "added", children: [] }) };
  for (const key of keys) overlayDef(key)?.build(ctx);
  return [...used];
}

export function overlayDef(key: string): OverlayDef | undefined {
  return OVERLAYS.find((o) => o.key === key);
}

/** A kit overlay as an overlay screen for a project (place it on the board yourself). */
export function overlayFrame(key: string, ctx: SectionContext, options: { adapter: string }): Frame {
  const def = overlayDef(key);
  if (!def) throw new Error(`unknown overlay ${key}`);
  return { id: createId("f"), name: def.name, kind: "new", platform: "web", overlay: true, target: { adapter: options.adapter }, viewports: [{ id: def.key, width: def.width }], current: def.build(ctx) };
}

/** Whether a node is a section (inserted at a screen's top level, between the other sections). */
export function isSection(node: DesignNode): boolean {
  return node.semantic?.role === "section" || node.semantic?.role === "header" || node.semantic?.role === "footer";
}

// ---------- page templates

export interface PageTemplate {
  key: string;
  name: string;
  description: string;
  /** Suggested screen name and route for a new screen. */
  screen: string;
  sections: string[];
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { key: "landing", name: "Landing page", description: "Hero, logos, features, testimonials, pricing, questions and a call to action.", screen: "Home", sections: ["header-simple", "hero-centered", "logos", "features-cards", "testimonials-cards", "pricing-tiers", "faq-list", "cta-banner", "footer-columns"] },
  { key: "product", name: "Product page", description: "A split hero, feature details, numbers and a call to action.", screen: "Product", sections: ["header-login", "hero-split", "features-icons", "features-split", "stats", "cta-card", "footer-columns"] },
  { key: "pricing", name: "Pricing page", description: "Plans, questions and a call to action.", screen: "Pricing", sections: ["header-simple", "pricing-tiers", "faq-split", "cta-banner", "footer-simple"] },
  { key: "about", name: "About page", description: "The story, numbers, the team and a quote.", screen: "About", sections: ["header-simple", "hero-split", "stats", "team-grid", "testimonial-quote", "footer-simple"] },
  { key: "contact", name: "Contact page", description: "A contact form, questions and the newsletter.", screen: "Contact", sections: ["header-simple", "contact-form", "faq-list", "newsletter", "footer-simple"] },
  { key: "blog-post", name: "Blog post", description: "An article with more posts below.", screen: "Blog post", sections: ["header-simple", "article", "blog-cards", "newsletter", "footer-simple"] },
];

export function pageTemplate(key: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.key === key);
}

/**
 * A page template's sections as one screen root (no padding: the sections bring their own). A page
 * has one main heading: without a hero, the first section's heading becomes the H1 (it keeps its look).
 */
export function buildPage(template: PageTemplate, ctx: SectionContext): Node<"box"> {
  const sections = template.sections.map((key) => sectionDef(key)!.build(ctx));
  const headingsIn = (root: DesignNode): Node<"text">[] => {
    const found: Node<"text">[] = [];
    const collect = (node: DesignNode) => {
      if (node.type === "text" && node.semantic?.role === "heading") found.push(node);
      // slot fills of instances are the page's own content
      if ("children" in node) node.children.forEach(collect);
    };
    collect(root);
    return found;
  };
  if (!sections.some((s) => headingsIn(s).some((h) => h.semantic?.level === 1))) {
    const first = sections.map(headingsIn).find((list) => list.length > 0) ?? [];
    for (const h of first) h.semantic = { role: "heading", level: Math.max(1, (h.semantic?.level ?? 2) - 1) };
  }
  return box({ mode: "flex", direction: "column" }, sections, {
    name: template.screen,
    box: { minHeight: "100vh" },
    style: { background: "$color.background", color: "$color.foreground" },
  });
}
