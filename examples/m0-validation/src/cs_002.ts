import type { Changeset, DesignNode, Frame, Op } from "@appshape/ir";
import type { SpecDocument } from "@appshape/protocol";
import { GENERATED_AT, hints, project, tokenSummary, uiComponents } from "./common";
import { added, box, button, color, input, instance, link, sp, text, xAuto } from "./nodes";
import { nodeRef } from "./refs";

/** cs_002 "Contact page": a new page designed from scratch plus a navbar link to it. */

const FORM_BEHAVIOR =
  "On submit: prevent the page reload, clear the form and show “Thanks! We’ll get back to you soon.” below the button. There is no backend yet.";

const fieldClasses = { radius: "$radius.md", borderWidth: 1, borderColor: color("gray-300"), fontSize: "$fontSize.sm" };
const field = (id: string, inputType: "text" | "email" | "textarea", label: string, placeholder: string): DesignNode =>
  input(id, inputType, { label, placeholder }, {
    name: `${label} field`,
    layout: { mode: "block", padding: { top: sp(2), bottom: sp(2), left: sp(3), right: sp(3) } },
    style: fieldClasses,
    ...(inputType === "textarea" && { box: { minHeight: "8rem" } }),
  });

const contactRoot: DesignNode = added(
  box("n_contact", {
    name: "Contact page",
    tag: "main",
    semantic: { role: "main" },
    layout: { mode: "block", padding: { top: sp(16), bottom: sp(16), left: sp(6), right: sp(6) } },
    box: { width: { mode: "fill" }, maxWidth: "$size.6xl", margin: xAuto },
  }, [
    box("n_contact_header", { name: "Header", tag: "header", box: { maxWidth: "$size.2xl" } }, [
      text("n_contact_title", "Contact us", {
        name: "Title",
        tag: "h1",
        semantic: { role: "heading", level: 1 },
        style: { fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight", color: color("gray-900") },
      }),
      text("n_contact_subtitle", "Questions about plans, billing or anything else? We are happy to help.", {
        name: "Subtitle",
        tag: "p",
        box: { margin: { top: sp(4) } },
        style: { fontSize: "$fontSize.lg", color: color("gray-600") },
      }),
    ]),
    box("n_contact_grid", {
      name: "Content grid",
      layout: { mode: "grid", columns: 1, gap: sp(10) },
      overrides: [{ when: { viewport: "md" }, layout: { columns: 3 } }],
      box: { margin: { top: sp(12) } },
    }, [
      box("n_contact_form", {
        name: "Contact form",
        tag: "form",
        layout: { mode: "flex", direction: "column", gap: sp(5), padding: { top: sp(6), right: sp(6), bottom: sp(6), left: sp(6) } },
        overrides: [{ when: { viewport: "md" }, box: { colSpan: 2 } }],
        style: { radius: "$radius.xl", borderWidth: 1, borderColor: color("gray-200"), background: color("white"), shadow: "$shadow.md" },
        annotations: [
          {
            id: "a_form_submit",
            kind: "behavior",
            text: FORM_BEHAVIOR,
          },
        ],
      }, [
        field("n_contact_name", "text", "Name", "Jane Doe"),
        field("n_contact_email", "email", "Email", "jane@example.com"),
        field("n_contact_message", "textarea", "Message", "How can we help?"),
        instance("n_contact_submit", "cmp_button", { type: "submit", children: "Send message" }, { name: "Submit", box: { alignSelf: "start" } }, [
          // Rendered Button output (in M3 the component sandbox renders this from the real component)
          button("n_contact_submit_button", {
            tag: "button",
            layout: { mode: "flex", direction: "row", align: "center", justify: "center", padding: { top: sp(2), bottom: sp(2), left: sp(4), right: sp(4) } },
            style: { radius: "$radius.md", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", background: color("primary-600"), color: color("white") },
            overrides: [{ when: { state: "hover" }, style: { background: color("primary-700") } }],
          }, [text("n_contact_submit_label", "Send message")]),
        ]),
      ]),
      box("n_contact_aside", {
        name: "Other channels",
        tag: "aside",
        layout: { mode: "flex", direction: "column", gap: sp(2) },
        style: { fontSize: "$fontSize.sm", color: color("gray-600") },
      }, [
        text("n_contact_aside_title", "Other ways to reach us", {
          tag: "h2",
          semantic: { role: "heading", level: 2 },
          style: { fontSize: "$fontSize.base", fontWeight: "$fontWeight.semibold", color: color("gray-900") },
        }),
        text("n_contact_aside_email", "Email: hello@acme.example", { tag: "p" }),
        text("n_contact_aside_reply", "We reply within one business day.", { tag: "p" }),
      ]),
    ]),
  ]),
);

export const contactFrame: Frame = {
  id: "f_contact",
  name: "Contact",
  kind: "new",
  platform: "web",
  target: { adapter: "react-vite", route: "/contact", file: "src/pages/Contact.tsx" },
  viewports: [
    { id: "desktop", width: 1280, breakpoint: "lg" },
    { id: "mobile", width: 390 },
  ],
  current: contactRoot,
  annotations: [{ id: "a_contact_layout", kind: "intent", text: "Same page shell as Pricing: Navbar and Footer come from the app layout." }],
};

const navLink = added(
  link("n_nav_contact", "/contact", {
    name: "Contact link",
    tag: "a",
    overrides: [{ when: { state: "hover" }, style: { color: color("gray-900") } }],
  }, [text("n_nav_contact_label", "Contact")]),
);
if (navLink.type === "link") navLink.targetFrameId = "f_contact";

export const ops: Op[] = [
  { id: "op_c1", frameId: "f_contact", op: "createFrame", frame: contactFrame },
  { id: "op_c2", frameId: "f_pricing", op: "insert", parentId: "n_nav_links", index: 2, scope: "component", node: navLink },
];

export const changeset: Changeset = {
  id: "cs_002",
  title: "Contact page",
  description: "Add a contact page with a simple form and link to it from the navigation.",
  status: "ready",
  ops,
  changes: [
    { id: "c1", opIds: ["op_c1"] },
    { id: "c2", opIds: ["op_c2"] },
  ],
  requirements: [
    "Register the page as the route `/contact` in `src/App.tsx`.",
    "Each form field has a visible label (wrap the control in a `<label>`) and a `name` attribute: `name`, `email`, `message`.",
  ],
  history: [
    { status: "draft", at: GENERATED_AT, by: "user" },
    { status: "ready", at: GENERATED_AT, by: "user" },
  ],
  createdAt: GENERATED_AT,
  updatedAt: GENERATED_AT,
};

const contactTree = `<main className="mx-auto w-full max-w-6xl px-6 py-16">
  <header className="max-w-2xl">
    <h1 className="text-4xl font-bold tracking-tight text-gray-900">Contact us</h1>
    <p className="mt-4 text-lg text-gray-600">Questions about plans, billing or anything else? We are happy to help.</p>
  </header>
  <div className="mt-12 grid gap-10 md:grid-cols-3">
    <form className="flex flex-col gap-5 rounded-xl border border-gray-200 bg-white p-6 shadow-md md:col-span-2">
      {/* note: On submit: prevent the page reload, clear the form and show
          “Thanks! We’ll get back to you soon.” below the button. There is no backend yet. */}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-900">
        Name
        <input type="text" name="name" placeholder="Jane Doe" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-900">
        Email
        <input type="email" name="email" placeholder="jane@example.com" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-900">
        Message
        <textarea name="message" placeholder="How can we help?" className="min-h-32 rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
      </label>
      <Button type="submit" className="self-start">Send message</Button>
    </form>
    <aside className="flex flex-col gap-2 text-sm text-gray-600">
      <h2 className="text-base font-semibold text-gray-900">Other ways to reach us</h2>
      <p>Email: hello@acme.example</p>
      <p>We reply within one business day.</p>
    </aside>
  </div>
</main>`;

export function spec(pricing: Frame): SpecDocument {
  const nav = (id: string) => nodeRef(pricing.baseline!, id);
  return {
    specVersion: 1,
    generatedAt: GENERATED_AT,
    changeset: { id: changeset.id, title: changeset.title, description: changeset.description, status: changeset.status },
    project,
    tokens: tokenSummary,
    components: [
      { name: "Navbar", file: "src/components/Navbar.tsx", kind: "project", usage: "Rendered on every page by `src/App.tsx`." },
      ...uiComponents,
    ],
    frames: [
      {
        frameId: contactFrame.id,
        name: contactFrame.name,
        kind: contactFrame.kind,
        platform: contactFrame.platform,
        target: contactFrame.target,
        viewports: ["desktop 1280", "mobile 390"],
        notes: contactFrame.annotations!.map((a) => a.text),
        changes: [
          {
            id: "c1",
            opIds: ["op_c1"],
            kind: "createFrame",
            title: "Create the Contact page",
            details: "New page component in `src/pages/Contact.tsx`, rendered at `/contact`. The tree shows the designed structure and classes.",
            annotations: [`Contact form (behavior): ${FORM_BEHAVIOR}`],
            tree: contactTree,
          },
        ],
      },
      {
        frameId: pricing.id,
        name: pricing.name,
        kind: pricing.kind,
        platform: pricing.platform,
        target: pricing.target,
        viewports: ["desktop 1280", "mobile 390"],
        changes: [
          {
            id: "c2",
            opIds: ["op_c2"],
            kind: "insert",
            title: "Add a “Contact” link to the navigation",
            scope: "component",
            details: "The Navbar is shared by all pages, so the link appears everywhere.",
            position: { parent: nav("n_nav_links"), after: nav("n_nav_pricing") },
            tree: '<NavLink to="/contact" className="hover:text-gray-900">Contact</NavLink>',
            link: { route: "/contact", frameId: "f_contact" },
          },
        ],
      },
    ],
    requirements: changeset.requirements!,
    acceptance: [
      { changeId: "c1", text: "`/contact` renders the page with the `h1` “Contact us”." },
      { changeId: "c1", text: "The form has labelled fields `name` (text), `email` (type email) and `message` (textarea) and a submit button “Send message” built with `Button`." },
      { changeId: "c1", text: "The side panel shows “Email: hello@acme.example”." },
      { changeId: "c1", text: "Submitting the form shows “Thanks! We’ll get back to you soon.” without reloading the page (manual check)." },
      { changeId: "c2", text: "The navigation shows “Contact” (to `/contact`) after “Pricing” on every page." },
      { text: "The app still type-checks (`pnpm --filter @appshape-fixtures/vite-react-router-tw4 typecheck`)." },
    ],
    hints,
  };
}
