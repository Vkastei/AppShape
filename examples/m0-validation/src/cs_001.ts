import type { Changeset, Frame, Op } from "@appshape/ir";
import type { SpecDocument } from "@appshape/protocol";
import { GENERATED_AT, hints, project, tokenSummary, uiComponents } from "./common";
import { added, box, color, instance, sp, text, xAuto } from "./nodes";
import { plans } from "./pricing";
import { nodeRef } from "./refs";

/** cs_001 "Pricing refresh": eight edits on the imported /pricing page. */

export const faqItems = [
  { question: "Can I change plans later?", answer: "Yes. You can upgrade or downgrade at any time; the change applies from the next billing period." },
  { question: "Is there a free trial for paid plans?", answer: "Every paid plan starts with a 14-day free trial. No credit card required." },
  { question: "Which payment methods do you accept?", answer: "All major credit cards and SEPA direct debit." },
  { question: "Can I cancel anytime?", answer: "Yes. Cancel in your account settings and keep access until the end of the billing period." },
];

const F = "f_pricing";
const cards = plans.map((p) => `n_card_${p.id}`);

const badge = added(
  instance("n_card_pro_badge", "cmp_badge", { children: "Most popular" }, {
    name: "Most popular badge",
    box: { alignSelf: "start", margin: { bottom: sp(4) } },
  }, [
    box("n_card_pro_badge_el", {
      tag: "span",
      layout: { mode: "flex", direction: "row", align: "center", padding: { top: sp(0.5), bottom: sp(0.5), left: sp(2.5), right: sp(2.5) } },
      style: { radius: "$radius.full", background: color("primary-50"), fontSize: "$fontSize.xs", fontWeight: "$fontWeight.medium", color: color("primary-700") },
    }, [text("n_card_pro_badge_label", "Most popular")]),
  ]),
);

const faq = added(
  box("n_faq", { name: "FAQ section", tag: "section", box: { maxWidth: "$size.3xl", margin: { ...xAuto, top: sp(20) } } }, [
    text("n_faq_title", "Frequently asked questions", {
      name: "FAQ title",
      tag: "h2",
      semantic: { role: "heading", level: 2 },
      style: { fontSize: "$fontSize.2xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight", color: color("gray-900") },
    }),
    instance("n_faq_accordion", "cmp_accordion", { items: faqItems }, { name: "FAQ list", box: { margin: { top: sp(6) } } }, []),
  ]),
);

export const ops: Op[] = [
  // c1: component-scoped restyle, recorded once per rendered instance
  ...cards.map((c, i): Op => ({
    id: `op_c1_${i + 1}`,
    frameId: F,
    op: "restyle",
    nodeId: `${c}_root`,
    scope: "component",
    style: { radius: "$radius.xl", shadow: "$shadow.md" },
  })),
  // c2
  { id: "op_c2", frameId: F, op: "restyle", nodeId: "n_card_pro_root", scope: "instance", style: { ring: { width: 2, color: color("primary-600") } } },
  // c3
  { id: "op_c3", frameId: F, op: "insert", parentId: "n_card_pro_root", index: 0, scope: "instance", node: badge },
  // c4
  { id: "op_c4", frameId: F, op: "retext", nodeId: "n_title", text: "Simple pricing for every team" },
  // c5
  { id: "op_c5", frameId: F, op: "insert", parentId: "n_main", index: 2, node: faq },
  // c6
  { id: "op_c6", frameId: F, op: "delete", nodeId: "n_compare" },
  // c7: move the CTA right below the price, in every card
  ...plans.map((p, i): Op => ({
    id: `op_c7_${i + 1}`,
    frameId: F,
    op: "move",
    nodeId: `n_card_${p.id}_cta`,
    parentId: `n_card_${p.id}_root`,
    index: p.id === "pro" ? 4 : 3,
    scope: "component",
  })),
  // c8
  { id: "op_c8_1", frameId: F, op: "relayout", nodeId: "n_plans", layout: { gap: sp(8) } },
  { id: "op_c8_2", frameId: F, op: "relayout", nodeId: "n_plans", layout: { gap: sp(10) }, when: { viewport: "lg" } },
];

const opIds = (prefix: string) => ops.filter((o) => o.id === prefix || o.id.startsWith(`${prefix}_`)).map((o) => o.id);
const changeIds = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];

export const changeset: Changeset = {
  id: "cs_001",
  title: "Pricing refresh",
  description: "Make the pricing page feel more polished, highlight the Pro plan and answer common questions.",
  status: "ready",
  ops,
  changes: changeIds.map((id) => ({ id, opIds: opIds(`op_${id}`) })),
  requirements: [
    "Keep `src/data/plans.ts` as the single source of truth for plans. Which plan is highlighted (c2, c3) must come from the data, not from the array index or the plan name in JSX.",
    "FAQ content is static for now. Put the questions in a new data file `src/data/faq.ts`.",
    "Do not change the Navbar, the Footer or the Home page.",
  ],
  history: [
    { status: "draft", at: GENERATED_AT, by: "user" },
    { status: "ready", at: GENERATED_AT, by: "user" },
  ],
  createdAt: GENERATED_AT,
  updatedAt: GENERATED_AT,
};

export function spec(frame: Frame): SpecDocument {
  const base = frame.baseline!;
  const ref = (id: string, name?: string) => nodeRef(base, id, name);
  const ids = (change: string) => changeset.changes!.find((c) => c.id === change)!.opIds;
  return {
    specVersion: 1,
    generatedAt: GENERATED_AT,
    changeset: { id: changeset.id, title: changeset.title, description: changeset.description, status: changeset.status },
    project,
    tokens: tokenSummary,
    components: [
      { name: "PricingCard", file: "src/components/PricingCard.tsx", kind: "project", usage: "Rendered once per plan from `plans` in `src/pages/Pricing.tsx`." },
      ...uiComponents,
    ],
    frames: [
      {
        frameId: frame.id,
        name: frame.name,
        kind: frame.kind,
        platform: frame.platform,
        target: frame.target,
        viewports: ["desktop 1280", "mobile 390"],
        changes: [
          {
            id: "c1",
            opIds: ids("c1"),
            kind: "restyle",
            title: "Make the pricing cards rounder, with a stronger shadow",
            node: ref("n_card_starter_root", "PricingCard root"),
            scope: "component",
            instances: { count: 3 },
            classes: { remove: ["rounded-md", "shadow-sm"], add: ["rounded-xl", "shadow-md"] },
          },
          {
            id: "c2",
            opIds: ids("c2"),
            kind: "restyle",
            title: "Highlight the Pro plan card with a ring",
            node: ref("n_card_pro_root", "PricingCard root"),
            scope: "instance",
            instances: { count: 3, which: 'the card for the plan with id "pro" (2nd of 3)' },
            classes: { remove: [], add: ["ring-2", "ring-primary-600"] },
          },
          {
            id: "c3",
            opIds: ids("c3"),
            kind: "insert",
            title: "Add a “Most popular” badge to the Pro plan card",
            scope: "instance",
            instances: { count: 3, which: 'the card for the plan with id "pro" (2nd of 3)' },
            position: { parent: ref("n_card_pro_root", "PricingCard root"), before: ref("n_card_pro_name") },
            tree: '<Badge className="mb-4 self-start">Most popular</Badge>',
          },
          {
            id: "c4",
            opIds: ids("c4"),
            kind: "retext",
            title: "Change the page title",
            node: ref("n_title"),
            text: { from: "Pricing", to: "Simple pricing for every team" },
          },
          {
            id: "c5",
            opIds: ids("c5"),
            kind: "insert",
            title: "Add an FAQ section below the plans",
            position: { parent: ref("n_main"), after: ref("n_plans") },
            tree: [
              '<section className="mx-auto mt-20 max-w-3xl">',
              '  <h2 className="text-2xl font-bold tracking-tight text-gray-900">Frequently asked questions</h2>',
              '  <Accordion className="mt-6" items={faqItems} />',
              "</section>",
              "",
              "// faqItems (4 entries):",
              ...faqItems.map((item) => `// - ${JSON.stringify(item)}`),
            ].join("\n"),
          },
          {
            id: "c6",
            opIds: ids("c6"),
            kind: "delete",
            title: "Remove the “Compare all features” link",
            details: "Remove the whole paragraph that wraps the link.",
            node: ref("n_compare"),
          },
          {
            id: "c7",
            opIds: ids("c7"),
            kind: "move",
            title: "Move the “Get started” button directly below the price",
            details: "Order inside each card becomes: name, description, price, button, features.",
            node: ref("n_card_starter_cta", "Get started button"),
            scope: "component",
            instances: { count: 3 },
            position: { parent: ref("n_card_starter_root", "PricingCard root"), after: ref("n_card_starter_price") },
          },
          {
            id: "c8",
            opIds: ids("c8"),
            kind: "relayout",
            title: "Increase the gap between the pricing cards",
            node: ref("n_plans"),
            classes: { remove: ["gap-6"], add: ["gap-8", "lg:gap-10"] },
          },
        ],
      },
    ],
    requirements: changeset.requirements!,
    acceptance: [
      { changeId: "c1", text: "All three cards use `rounded-xl` and `shadow-md` and no longer `rounded-md` / `shadow-sm`." },
      { changeId: "c2", text: "Only the Pro card has `ring-2 ring-primary-600`." },
      { changeId: "c3", text: "Only the Pro card shows a “Most popular” `Badge`, above the plan name." },
      { changeId: "c4", text: "The page `h1` reads “Simple pricing for every team”." },
      { changeId: "c5", text: "Below the plans there is an `h2` “Frequently asked questions” followed by an `Accordion` with the 4 questions." },
      { changeId: "c6", text: "There is no “Compare all features” link anymore." },
      { changeId: "c7", text: "In every card the “Get started” button comes after the price and before the feature list." },
      { changeId: "c8", text: "The plans grid uses `gap-8 lg:gap-10` (and still `md:grid-cols-3`)." },
      { text: "The app still type-checks (`pnpm --filter @appshape-fixtures/vite-react-router-tw4 typecheck`)." },
    ],
    hints,
  };
}
