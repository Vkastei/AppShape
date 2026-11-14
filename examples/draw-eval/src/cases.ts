import { largerScreenChanges } from "@appshape/codegen";
import type { DesignNode, DesignRequest, LegendColor } from "@appshape/ir";
import { type Finder, first, id, instance, named, nodes, nthInstance, parent, type Screen, textOf, withText } from "./tree";

/**
 * The drawn requests of the evaluation: what someone draws on a screen and writes, and what a
 * good proposal does (checks on the screen after it). Crossed-out elements, new sections, moves,
 * restyles, a change for phones only, and two imported screens. Some have no message at all: the
 * drawing alone says it.
 */

export type Mark =
  /** A cross (two pen strokes) over an element. */
  | { kind: "cross"; on: Finder; color?: LegendColor }
  | { kind: "ellipse" | "rect"; on: Finder; color?: LegendColor }
  /** A box in the space between two stacked elements (where something new goes); `from` is the last thing visible above. */
  | { kind: "gap"; after: Finder; before: Finder; from?: Finder; color?: LegendColor }
  /** An arrow from an element to another one, or to just above it. */
  | { kind: "arrow"; from: Finder; to: Finder; above?: boolean; color?: LegendColor }
  | { kind: "label"; near: Finder; text: string; color?: LegendColor };

export interface Check {
  name: string;
  pass: boolean;
}

export interface EvalCase {
  id: string;
  /** What it tests, in a few words. */
  title: string;
  project: "landing" | "desktopOnly" | "pricing" | "fixture";
  /** A preset job (make it work on phones, a new section from a sentence). */
  intent?: DesignRequest["intent"];
  /** Asks for this many different designs; each is scored with the checks, and they must differ. */
  variants?: number;
  screen: string;
  viewport: "desktop" | "mobile";
  message: string;
  marks: Mark[];
  /** Elements named for the scope and the checks (found on the screen before). */
  refs: Record<string, Finder>;
  /** Refs whose element (and everything inside) may change. */
  scope: string[];
  /** Refs whose direct children may be added, removed or reordered (but not changed inside). */
  into?: string[];
  /** What a good proposal does (`before` is the screen as it was; refs are ids on it). */
  checks(after: Screen, before: Screen, refs: Record<string, string>): Check[];
}

const check = (name: string, pass: boolean): Check => ({ name, pass });
const hasClass = (classes: string[], test: RegExp) => classes.some((c) => test.test(c));

/** The outermost new elements (not on the screen before, inside one that was). */
const added = (after: Screen, before: Screen) => [...nodes(after.root)].filter((n) => !before.byId(n.id) && before.byId(after.parentOf(n.id)?.id ?? ""));

/** Whether `id` comes after `first` and before `last` in reading order (inside `first` counts as after it). */
function between(screen: Screen, id: string, first: string, last: string): boolean {
  const order = [...nodes(screen.root)].map((n) => n.id);
  const [a, i, z] = [order.indexOf(first), order.indexOf(id), order.indexOf(last)];
  return a >= 0 && i > a && (z < 0 || i < z);
}

/** How many elements that pass `test` show inside an element: one in a list's template counts once per item. */
function shown(within: DesignNode, test: (node: DesignNode) => boolean): number {
  const count = (node: DesignNode): number => {
    if (test(node)) return 1;
    const kids = "children" in node && Array.isArray(node.children) ? (node.children as DesignNode[]) : [];
    const inside = kids.reduce((sum, k) => sum + count(k), 0);
    return node.type === "list" && Array.isArray(node.items) ? inside * node.items.length : inside;
  };
  return count(within);
}

/** How many instances of a component show inside an element. */
const shownCount = (screen: Screen, within: DesignNode, component: string) => shown(within, (n) => screen.componentName(n)?.replace(/\s/g, "").toLowerCase() === component.toLowerCase());

/** A node's layout on phones (its base, mobile-first). */
const phoneColumns = (node: DesignNode | undefined) => (node?.layout?.mode === "grid" ? (typeof node.layout.columns === "number" ? node.layout.columns : 1) : node?.layout?.direction === "row" ? 9 : 1);

const CASE_LIST: EvalCase[] = [
  {
    id: "remove-badge",
    title: "Crossed out, no message",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "",
    marks: [{ kind: "cross", on: instance("Badge", ["label", /version 2\.0/]) }],
    refs: { badge: instance("Badge", ["label", /version 2\.0/]), around: parent(instance("Badge", ["label", /version 2\.0/])), heading: withText("Ship a better product") },
    scope: ["badge"],
    into: ["around"],
    checks: (after, _before, r) => [check("the badge is gone", !after.byId(r.badge!)), check("the heading is still there", Boolean(after.byId(r.heading!)))],
  },
  {
    id: "shorter-heading",
    title: "New copy for one element",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "Make the headline shorter and punchier, five words at most.",
    marks: [{ kind: "ellipse", on: withText("Ship a better product"), color: "change" }],
    refs: { heading: withText("Ship a better product") },
    scope: ["heading"],
    checks: (after, before, r) => {
      const h = after.byId(r.heading!);
      const text = h ? textOf(h) : "";
      return [
        check("the headline changed", Boolean(h) && text !== textOf(before.byId(r.heading!)!)),
        check("five words at most", text.split(/\s+/).filter(Boolean).length <= 5),
        check("still the page's main heading style", Boolean(h) && after.classes(h!).includes("type-h1")),
      ];
    },
  },
  {
    id: "add-newsletter",
    title: "New section in an empty spot",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "Add a newsletter signup here: an email field and a subscribe button.",
    marks: [
      { kind: "gap", after: named("FAQ"), before: named("Call to action"), from: named("Questions"), color: "add" },
      { kind: "label", near: named("Questions"), text: "newsletter", color: "add" },
    ],
    // the box is drawn just under the questions: its own section, or the end of the FAQ's, are both fair readings
    refs: { root: (s) => s.root, faqContent: parent(named("Questions")), questions: named("Questions"), cta: named("Call to action") },
    scope: [],
    into: ["root", "faqContent"],
    checks: (after, before, r) => {
      const fresh = added(after, before);
      const jsx = fresh[0] ? after.jsx(fresh[0]) : "";
      return [
        check("one new block", fresh.length === 1),
        check("below the questions, above the call to action", Boolean(fresh[0]) && between(after, fresh[0]!.id, r.questions!, r.cta!) && !after.ancestors(fresh[0]!.id).some((a) => a.id === r.questions)),
        check("an email field", /type="email"|<Input\b/.test(jsx)),
        check("a button", /<Button\b|<button\b/.test(jsx)),
      ];
    },
  },
  {
    id: "features-four",
    title: "One more of a repeated item, layout follows",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "Add a fourth feature about integrations, and show all four in one row on desktop.",
    marks: [{ kind: "ellipse", on: parent(nthInstance("Card", 0, named("Features"))), color: "change" }],
    refs: { grid: parent(nthInstance("Card", 0, named("Features"))) },
    scope: ["grid"],
    checks: (after, _before, r) => {
      const grid = after.byId(r.grid!);
      const classes = grid ? after.classes(grid) : [];
      return [
        check("four cards", Boolean(grid) && after.instances("Card", grid).length === 4),
        check("the new one is about integrations", Boolean(grid) && /integrat|connect|plug|slack|github|api\b|your (other )?tools/i.test(textOf(grid!))),
        check("one row of four on desktop", hasClass(classes, /^(md|lg|xl):grid-cols-4$/) && !classes.includes("grid-cols-4")),
      ];
    },
  },
  {
    id: "move-testimonials",
    title: "Move a section (arrow)",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "Move the testimonials above the features.",
    marks: [{ kind: "arrow", from: named("Testimonials"), to: named("Features"), above: true, color: "change" }],
    refs: { root: (s) => s.root, testimonials: named("Testimonials"), features: named("Features") },
    scope: ["testimonials"],
    into: ["root"],
    checks: (after, before, r) => {
      const order = after.childIds(r.root!);
      const t = after.byId(r.testimonials!);
      return [
        check("testimonials come before the features", order.indexOf(r.testimonials!) >= 0 && order.indexOf(r.testimonials!) < order.indexOf(r.features!)),
        check("the testimonials themselves are unchanged", Boolean(t) && after.jsx(t!) === before.jsx(before.byId(r.testimonials!)!)),
      ];
    },
  },
  {
    id: "cta-second-action",
    title: "Add next to an element, restyle",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "Make this stand out more, and add a secondary “Talk to sales” link next to it.",
    marks: [{ kind: "ellipse", on: instance("Button", ["label", "Start for free"]), color: "change" }],
    refs: { button: instance("Button", ["label", "Start for free"]), row: parent(instance("Button", ["label", "Start for free"])) },
    scope: ["row"],
    checks: (after, _before, r) => {
      const row = after.byId(r.row!);
      return [
        check("“Start for free” is kept", Boolean(after.byId(r.button!))),
        check("“Talk to sales” next to it", Boolean(row) && /talk to sales/i.test(textOf(row!))),
        // on the primary-colored band: light text, or a variant with its own light fill (secondary, outline)
        check("“Talk to sales” can be read on the colored band", (() => {
          const link = row && after.all((n) => /talk to sales/i.test(textOf(n)) && n.id !== row.id, row).at(-1);
          const own = link ? [link, ...after.ancestors(link.id).slice(0, 2)] : [];
          return own.some((n) => /text-(primary-foreground|white)\b|variant="(secondary|outline)"/.test(after.jsx(n).split(">")[0]!));
        })()),
      ];
    },
  },
  {
    id: "hide-on-phones",
    title: "A change for phones only",
    project: "landing",
    screen: "Home",
    viewport: "mobile",
    message: "Hide this picture on phones; keep it on larger screens.",
    marks: [{ kind: "cross", on: first("image", named("Hero")) }],
    refs: { image: first("image", named("Hero")) },
    scope: ["image"],
    checks: (after, _before, r) => {
      const image = after.byId(r.image!);
      const classes = image ? after.classes(image) : [];
      return [
        check("the picture is kept (not deleted)", Boolean(image)),
        check("hidden on phones, shown from a breakpoint up", classes.includes("hidden") && hasClass(classes, /^(sm|md|lg):(block|flex|inline|inline-block|grid)$/)),
      ];
    },
  },
  {
    id: "faq-trim",
    title: "Two crossed out in a list, no message",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    message: "",
    marks: [
      { kind: "cross", on: nthInstance("AccordionItem", 2) },
      { kind: "cross", on: nthInstance("AccordionItem", 3) },
    ],
    refs: { list: parent(nthInstance("AccordionItem", 0)), q1: nthInstance("AccordionItem", 0), q2: nthInstance("AccordionItem", 1), q3: nthInstance("AccordionItem", 2), q4: nthInstance("AccordionItem", 3) },
    scope: ["q3", "q4"],
    into: ["list"],
    checks: (after, _before, r) => [
      check("the two crossed-out questions are gone", !after.byId(r.q3!) && !after.byId(r.q4!)),
      check("the other two are kept", Boolean(after.byId(r.q1!) && after.byId(r.q2!))),
    ],
  },
  {
    id: "pricing-billing-switch",
    title: "New control above a grid",
    project: "pricing",
    screen: "Pricing page",
    viewport: "desktop",
    message: "Add a switch between monthly and yearly billing here; yearly saves 20%.",
    marks: [{ kind: "gap", after: named("Intro"), before: parent(nthInstance("Card", 0)), color: "add" }],
    refs: { content: parent(named("Intro")), intro: named("Intro"), grid: parent(nthInstance("Card", 0)) },
    scope: [],
    into: ["content", "intro"],
    checks: (after, before, r) => {
      const fresh = added(after, before);
      const text = fresh[0] ? textOf(fresh[0]) : "";
      return [
        check("one new element between the intro and the plans", fresh.length === 1 && between(after, fresh[0]!.id, r.intro!, r.grid!)),
        check("monthly and yearly", /month/i.test(text) && /year|annual/i.test(text)),
        check("says yearly saves 20%", /20\s?%/.test(text)),
        check("the three plans are kept", after.byId(r.grid!) !== undefined && after.instances("Card", after.byId(r.grid!)).length === 3),
      ];
    },
  },
  {
    id: "pricing-move-highlight",
    title: "Move a highlight to another card (arrow)",
    project: "pricing",
    screen: "Pricing page",
    viewport: "desktop",
    message: "Business should be the highlighted plan instead of Team.",
    marks: [{ kind: "arrow", from: instance("Badge", ["label", "Popular"]), to: withText("Business"), color: "change" }],
    refs: { team: nthInstance("Card", 1), business: nthInstance("Card", 2), starter: nthInstance("Card", 0) },
    scope: ["team", "business"],
    checks: (after, before, r) => {
      const team = after.byId(r.team!);
      const business = after.byId(r.business!);
      const popular = (card: typeof team) => Boolean(card) && after.instances("Badge", card).some((b) => /popular/i.test(textOf(b)));
      return [
        check("Business has the badge", popular(business)),
        check("Team doesn't any more", Boolean(team) && !popular(team)),
        check("Business has the highlight border", Boolean(business) && after.classes(business!).includes("border-primary")),
        check("Team's border is back to normal", Boolean(team) && !after.classes(team!).includes("border-primary")),
        check("Starter is unchanged", after.jsx(after.byId(r.starter!) ?? after.root) === before.jsx(before.byId(r.starter!)!)),
      ];
    },
  },
  {
    id: "imported-heading",
    title: "Restyle on an imported screen",
    project: "fixture",
    screen: "Pricing",
    viewport: "desktop",
    message: "This should be a normal big page heading, not tiny capitals.",
    marks: [{ kind: "ellipse", on: id("n_title"), color: "change" }],
    refs: { title: id("n_title") },
    scope: ["title"],
    checks: (after, before, r) => {
      const title = after.byId(r.title!);
      const classes = title ? after.classes(title) : [];
      return [
        check("no more capitals", Boolean(title) && !classes.includes("uppercase")),
        check("big", hasClass(classes, /^(\w+:)?text-(3xl|4xl|5xl|6xl)$/)),
        check("same words", Boolean(title) && textOf(title!) === textOf(before.byId(r.title!)!)),
      ];
    },
  },
  {
    id: "imported-faq-to-link",
    title: "Replace a section on an imported screen",
    project: "fixture",
    screen: "Pricing",
    viewport: "desktop",
    message: "Replace the FAQ with one short line that links to the contact page.",
    marks: [
      { kind: "cross", on: id("n_faq") },
      { kind: "label", near: id("n_faq"), text: "link to contact instead", color: "add" },
    ],
    refs: { main: id("n_main"), faq: id("n_faq") },
    scope: ["faq"],
    into: ["main"],
    checks: (after, _before, r) => {
      const main = after.byId(r.main!);
      const contact = after.project.frames.find((f) => f.name === "Contact");
      const jsx = main ? after.jsx(main) : "";
      return [
        check("the FAQ is gone", !after.byId(r.faq!) || after.all((n) => n.name === "FAQ list").length === 0),
        check("a link to the contact page", /href="\/contact"/.test(jsx) || Boolean(contact && main && after.all((n) => (n.type === "link" || n.type === "button") && n.targetFrameId === contact.id, main).length)),
      ];
    },
  },
  {
    id: "phones-landing",
    title: "Make it work on phones (whole screen)",
    project: "desktopOnly",
    intent: "phones",
    screen: "Home",
    viewport: "mobile",
    message: "",
    marks: [],
    refs: { root: (s) => s.root, nav: named("Navigation"), features: parent(nthInstance("Card", 0, named("Features"))), testimonials: first("list", named("Testimonials")) },
    scope: ["root"],
    checks: (after, before, r) => {
      const nav = after.byId(r.nav!);
      return [
        check("larger screens look exactly as before", largerScreenChanges(before.root, after.root, after.project.tokens, 768).length === 0),
        check("features in one column on phones", phoneColumns(after.byId(r.features!)) === 1),
        check("testimonials in one column on phones", phoneColumns(after.byId(r.testimonials!)) === 1),
        check("the navigation doesn't overflow on phones (hidden or wrapping)", Boolean(nav) && (nav!.hidden === true || nav!.layout?.wrap === true || nav!.layout?.direction === "column")),
      ];
    },
  },
  {
    id: "section-logos",
    title: "A section from a sentence (between sections)",
    project: "landing",
    intent: "section",
    screen: "Home",
    viewport: "desktop",
    message: "A slim section with the logos of five customers in one row.",
    marks: [{ kind: "gap", after: named("Testimonials"), before: named("FAQ"), from: first("list", named("Testimonials")), color: "add" }],
    refs: { root: (s) => s.root, testimonials: named("Testimonials"), faq: named("FAQ") },
    scope: [],
    into: ["root"],
    checks: (after, before, r) => {
      const fresh = added(after, before);
      const block = fresh[0];
      const items = block ? shown(block, (n) => n.type === "image" || n.type === "icon" || (n.type === "text" && n.text.trim().length > 0 && n.text.trim().length < 30)) : 0;
      return [
        check("one new section", fresh.length === 1),
        check("between the testimonials and the FAQ", Boolean(block) && between(after, block!.id, r.testimonials!, r.faq!)),
        check("five logos (or names)", items >= 5),
      ];
    },
  },
  {
    id: "section-pricing-quotes",
    title: "A section from a sentence (with components)",
    project: "pricing",
    intent: "section",
    screen: "Pricing page",
    viewport: "desktop",
    message: "Three short quotes from happy customers, as cards.",
    marks: [{ kind: "gap", after: parent(parent(parent(nthInstance("Card", 0)))), before: named("FAQ"), from: parent(nthInstance("Card", 0)), color: "add" }],
    refs: { root: (s) => s.root, pricing: parent(parent(parent(nthInstance("Card", 0)))), faq: named("FAQ") },
    scope: [],
    into: ["root"],
    checks: (after, before, r) => {
      const fresh = added(after, before);
      const block = fresh[0];
      return [
        check("one new section", fresh.length === 1),
        check("between the plans and the FAQ", Boolean(block) && between(after, block!.id, r.pricing!, r.faq!)),
        check("three cards (the project's Card component)", Boolean(block) && shownCount(after, block!, "Card") === 3),
      ];
    },
  },
];

/** Variants: three different designs for one request. */
const VARIANT_CASES: EvalCase[] = [
  {
    id: "variants-hero",
    title: "3 variations of a section",
    project: "landing",
    screen: "Home",
    viewport: "desktop",
    variants: 3,
    message: "3 variations of this hero: try different layouts, keep the headline and the buttons.",
    marks: [{ kind: "rect", on: named("Hero"), color: "change" }],
    refs: { hero: named("Hero"), heading: withText("Ship a better product") },
    scope: ["hero"],
    checks: (after, before, r) => {
      const hero = after.byId(r.hero!);
      const jsx = hero ? after.jsx(hero) : "";
      return [
        check("the hero changed and is still there", Boolean(hero) && jsx !== before.jsx(before.byId(r.hero!)!)),
        check("the headline is kept", Boolean(after.byId(r.heading!)) && /Ship a better product/.test(jsx)),
        check("buttons are kept", /<Button\b|<button\b/.test(jsx)),
      ];
    },
  },
  { ...CASE_LIST.find((c) => c.id === "section-logos")!, id: "variants-logos", title: "3 variants of a section from a sentence", variants: 3 },
];

export const CASES: EvalCase[] = [...CASE_LIST, ...VARIANT_CASES];
