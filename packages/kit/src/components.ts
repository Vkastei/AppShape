import { type ComponentDef, createId, type DesignNode, type Edges, type Frame, type StyleValue } from "@appshape/ir";
import { placeholderImage } from "./placeholders";

/**
 * Starter components: the building blocks every section uses, made only from theme tokens (so they
 * follow the theme and both color schemes). A project gets one when it first needs it; it is then
 * an ordinary component of the project (marked with `kit`), and changing it changes every use.
 */
export interface StarterComponent {
  /** Stable key, stored as the component's `kit` (never shown). */
  key: string;
  name: string;
  description: string;
  /** Width of the component's frame on the board. */
  width: number;
  /** Variant values worth seeing on the board next to the default (extra previews). */
  previews?: { prop: string; values: string[] };
  build(options: BuildOptions): { root: DesignNode; def: ComponentDef };
}

interface BuildOptions {
  /** Color for drawn placeholder pictures. */
  tint: string;
}

const id = () => createId("n");
const all = (v: StyleValue): Edges => ({ top: v, right: v, bottom: v, left: v });
const pad = (y: StyleValue, x: StyleValue): Edges => ({ top: y, bottom: y, left: x, right: x });
const text = (value: string, extra: Partial<Extract<DesignNode, { type: "text" }>> = {}): Extract<DesignNode, { type: "text" }> => ({ id: id(), type: "text", origin: "added", text: value, ...extra });
const when = (prop: string, value: string, state?: "hover" | "focus") => ({ prop: { name: prop, value }, ...(state && { state }) });

function field(inputType: "email" | "textarea" | "select", label: string, placeholder: string, extra: Partial<Extract<DesignNode, { type: "input" }>> = {}): { root: DesignNode; def: ComponentDef } {
  const root: DesignNode = {
    id: id(),
    type: "input",
    origin: "added",
    name: inputType === "textarea" ? "Textarea" : inputType === "select" ? "Select" : "Input",
    inputType,
    label,
    placeholder,
    layout: { padding: pad("$spacing.3", "$spacing.3") },
    box: { width: { mode: "fill" } },
    style: { background: "$color.background", color: "$color.foreground", borderWidth: 1, borderColor: "$color.input", radius: "$radius.md", fontSize: "$fontSize.sm" },
    overrides: [
      { when: { viewport: "md" }, layout: { padding: pad("$spacing.2", "$spacing.3") } },
      { when: { state: "focus" }, style: { borderColor: "$color.ring", ring: { width: 2, color: "$color.ring/30" } } },
    ],
    ...extra,
  } as DesignNode;
  return {
    root,
    def: {
      props: [
        { name: "label", type: "string", bindings: [{ nodeId: root.id, field: "label" }] },
        { name: "placeholder", type: "string", bindings: [{ nodeId: root.id, field: "placeholder" }] },
      ],
    },
  };
}

export const STARTER_COMPONENTS: StarterComponent[] = [
  {
    key: "button",
    name: "Button",
    description: "Main actions (primary), other actions (secondary, outline) and quiet ones (ghost).",
    width: 120,
    previews: { prop: "variant", values: ["secondary", "outline", "ghost"] },
    build() {
      const label = text("Button", { name: "Label" });
      const root: DesignNode = {
        id: id(),
        type: "button",
        origin: "added",
        name: "Button",
        // 44px tall on phones (an easy tap), 36px from tablets up
        layout: { mode: "flex", direction: "row", align: "center", justify: "center", gap: "$spacing.2", padding: pad("$spacing.3", "$spacing.4") },
        box: { alignSelf: "start" },
        style: { background: "$color.primary", color: "$color.primary-foreground", radius: "$radius.md", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.semibold", cursor: "pointer" },
        overrides: [
          { when: { viewport: "md" }, layout: { padding: pad("$spacing.2", "$spacing.4") } },
          { when: { state: "hover" }, style: { background: "$color.primary/90" } },
          { when: when("variant", "secondary"), style: { background: "$color.secondary", color: "$color.secondary-foreground" } },
          { when: when("variant", "secondary", "hover"), style: { background: "$color.secondary/80" } },
          { when: when("variant", "outline"), style: { background: "$color.background", color: "$color.foreground", borderWidth: 1, borderColor: "$color.input" } },
          { when: when("variant", "outline", "hover"), style: { background: "$color.accent", color: "$color.accent-foreground" } },
          { when: when("variant", "ghost"), style: { background: "transparent", color: "$color.foreground" } },
          { when: when("variant", "ghost", "hover"), style: { background: "$color.accent", color: "$color.accent-foreground" } },
          { when: when("size", "sm"), layout: { gap: "$spacing.1.5", padding: pad("$spacing.1.5", "$spacing.3") }, style: { fontSize: "$fontSize.xs" } },
          { when: { ...when("size", "sm"), viewport: "md" }, layout: { padding: pad("$spacing.1.5", "$spacing.3") } },
          { when: when("size", "lg"), layout: { padding: pad("$spacing.3", "$spacing.6") }, style: { fontSize: "$fontSize.base" } },
          { when: { ...when("size", "lg"), viewport: "md" }, layout: { padding: pad("$spacing.3", "$spacing.6") } },
        ],
        children: [label],
      };
      return {
        root,
        def: {
          props: [
            { name: "label", type: "string", bindings: [{ nodeId: label.id, field: "text" }] },
            { name: "variant", type: "enum", options: ["primary", "secondary", "outline", "ghost"], default: "primary" },
            { name: "size", type: "enum", options: ["sm", "md", "lg"], default: "md" },
            { name: "opens", type: "string", description: "Screen it opens", bindings: [{ nodeId: root.id, field: "target" }] },
          ],
        },
      };
    },
  },
  {
    key: "card",
    name: "Card",
    description: "A framed group of content. Put anything inside.",
    width: 320,
    build() {
      const root: DesignNode = {
        id: id(),
        type: "box",
        origin: "added",
        name: "Card",
        layout: { mode: "flex", direction: "column", padding: all("$spacing.6") },
        style: { background: "$color.card", color: "$color.card-foreground", borderWidth: 1, borderColor: "$color.border", radius: "$radius.xl", shadow: "$shadow.sm" },
        children: [
          {
            id: id(),
            type: "slot",
            origin: "added",
            slotName: "content",
            layout: { mode: "flex", direction: "column", gap: "$spacing.2" },
            children: [
              text("Card title", { semantic: { role: "heading", level: 3 }, style: { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" } }),
              text("A short description of what this card is about.", { style: { fontSize: "$fontSize.sm", color: "$color.muted-foreground" } }),
            ],
          },
        ],
      };
      return { root, def: { props: [] } };
    },
  },
  {
    key: "badge",
    name: "Badge",
    description: "A small label: new, popular, a status or a category.",
    width: 80,
    previews: { prop: "variant", values: ["solid", "outline"] },
    build() {
      const label = text("New", { name: "Label" });
      const root: DesignNode = {
        id: id(),
        type: "box",
        origin: "added",
        name: "Badge",
        layout: { mode: "flex", direction: "row", align: "center", gap: "$spacing.1", padding: pad("$spacing.0.5", "$spacing.2.5") },
        box: { alignSelf: "start" },
        style: { background: "$color.accent", color: "$color.accent-foreground", radius: "$radius.full", fontSize: "$fontSize.xs", fontWeight: "$fontWeight.medium" },
        overrides: [
          { when: when("variant", "solid"), style: { background: "$color.primary", color: "$color.primary-foreground" } },
          { when: when("variant", "outline"), style: { background: "transparent", color: "$color.foreground", borderWidth: 1, borderColor: "$color.border" } },
        ],
        children: [label],
      };
      return {
        root,
        def: {
          props: [
            { name: "label", type: "string", bindings: [{ nodeId: label.id, field: "text" }] },
            { name: "variant", type: "enum", options: ["soft", "solid", "outline"], default: "soft" },
          ],
        },
      };
    },
  },
  {
    key: "input",
    name: "Input",
    description: "A text field with its label.",
    width: 280,
    build: () => field("email", "Email", "you@example.com"),
  },
  {
    key: "textarea",
    name: "Textarea",
    description: "A field for longer text.",
    width: 320,
    build: () => field("textarea", "Message", "Write a message…", { box: { width: { mode: "fill" }, minHeight: "$spacing.24" } }),
  },
  {
    key: "select",
    name: "Select",
    description: "A choice from a list.",
    width: 240,
    build: () => field("select", "Plan", "Choose an option"),
  },
  {
    key: "checkbox",
    name: "Checkbox",
    description: "A box to tick, with its label.",
    width: 220,
    build() {
      const label = text("I agree to the terms", { name: "Label", style: { fontSize: "$fontSize.sm" } });
      const root: DesignNode = {
        id: id(),
        type: "box",
        origin: "added",
        name: "Checkbox",
        layout: { mode: "flex", direction: "row", align: "center", gap: "$spacing.2" },
        children: [
          { id: id(), type: "input", origin: "added", inputType: "checkbox", box: { width: { mode: "fixed", value: "$spacing.4" }, height: { mode: "fixed", value: "$spacing.4" } }, style: { radius: "$radius.sm" } },
          label,
        ],
      };
      return { root, def: { props: [{ name: "label", type: "string", bindings: [{ nodeId: label.id, field: "text" }] }] } };
    },
  },
  {
    key: "avatar",
    name: "Avatar",
    description: "A round picture of a person.",
    width: 56,
    build({ tint }) {
      const root: DesignNode = {
        id: id(),
        type: "image",
        origin: "added",
        name: "Avatar",
        src: placeholderImage("portrait", tint).src,
        alt: "",
        fit: "cover",
        box: { width: { mode: "fixed", value: "$spacing.10" }, height: { mode: "fixed", value: "$spacing.10" } },
        style: { radius: "$radius.full" },
        overrides: [
          { when: when("size", "sm"), box: { width: { mode: "fixed", value: "$spacing.8" }, height: { mode: "fixed", value: "$spacing.8" } } },
          { when: when("size", "lg"), box: { width: { mode: "fixed", value: "$spacing.14" }, height: { mode: "fixed", value: "$spacing.14" } } },
        ],
      };
      return {
        root,
        def: {
          props: [
            { name: "image", type: "string", bindings: [{ nodeId: root.id, field: "src" }] },
            { name: "size", type: "enum", options: ["sm", "md", "lg"], default: "md" },
          ],
        },
      };
    },
  },
  {
    key: "accordion",
    name: "Accordion item",
    description: "A question that opens to show its answer (FAQ).",
    width: 480,
    previews: { prop: "open", values: ["true"] },
    build() {
      const question = text("How does it work?", { name: "Question", style: { fontWeight: "$fontWeight.medium" } });
      const down: DesignNode = { id: id(), type: "icon", origin: "added", name: "Closed icon", icon: "chevron-down", set: "lucide", style: { color: "$color.muted-foreground" } };
      const up: DesignNode = { id: id(), type: "icon", origin: "added", name: "Open icon", icon: "chevron-up", set: "lucide", hidden: true, style: { color: "$color.muted-foreground" } };
      const answer = text("Short, helpful answer to the question. Two or three sentences are plenty.", {
        name: "Answer",
        hidden: true,
        layout: { padding: { bottom: "$spacing.4" } },
        style: { fontSize: "$fontSize.sm", color: "$color.muted-foreground" },
      });
      const whenOpen = (hidden: boolean) => [{ when: when("open", "true"), hidden }];
      up.overrides = whenOpen(false);
      answer.overrides = whenOpen(false);
      down.overrides = whenOpen(true);
      const root: DesignNode = {
        id: id(),
        type: "box",
        origin: "added",
        name: "Accordion item",
        layout: { mode: "flex", direction: "column" },
        style: { borderWidth: { bottom: 1 }, borderColor: "$color.border" },
        // clicking the question opens and closes it (in the prototype and in the app)
        children: [{ id: id(), type: "box", origin: "added", name: "Header", interaction: { type: "variant", prop: "open", value: "toggle" }, layout: { mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.4", padding: { top: "$spacing.4", bottom: "$spacing.4" } }, style: { textAlign: "left", cursor: "pointer" }, children: [question, down, up] }, answer],
      };
      return {
        root,
        def: {
          props: [
            { name: "question", type: "string", bindings: [{ nodeId: question.id, field: "text" }] },
            { name: "answer", type: "string", bindings: [{ nodeId: answer.id, field: "text" }] },
            { name: "open", type: "boolean", default: false },
          ],
        },
      };
    },
  },
  {
    key: "tabs",
    name: "Tabs",
    description: "Content in tabs: the row of tabs switches which panel shows.",
    width: 480,
    previews: { prop: "tab", values: ["second"] },
    build() {
      const values = ["first", "second", "third"] as const;
      const labels = values.map((v, i) => text(["Overview", "Details", "Reviews"][i]!, { name: "Label" }));
      const tab = (value: (typeof values)[number], i: number): DesignNode => ({
        id: id(),
        type: "box",
        origin: "added",
        name: `${labels[i]!.text} tab`,
        semantic: { role: "tab" },
        interaction: { type: "variant", prop: "tab", value },
        layout: { mode: "flex", direction: "row", align: "center", padding: pad("$spacing.2", "$spacing.3") },
        style: { fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", color: "$color.muted-foreground", borderWidth: { bottom: 2 }, borderColor: "transparent", cursor: "pointer" },
        overrides: [
          { when: { state: "hover" }, style: { color: "$color.foreground" } },
          { when: when("tab", value), style: { color: "$color.foreground", borderColor: "$color.primary" } },
        ],
        children: [labels[i]!],
      });
      const panel = (value: (typeof values)[number], body: string): DesignNode => ({
        id: id(),
        type: "slot",
        origin: "added",
        name: `${labels[values.indexOf(value)]!.text} panel`,
        slotName: value,
        semantic: { role: "tabpanel" },
        hidden: true,
        layout: { mode: "flex", direction: "column", gap: "$spacing.2", padding: { top: "$spacing.4" } },
        overrides: [{ when: when("tab", value), hidden: false }],
        children: [text(body, { style: { fontSize: "$fontSize.sm", color: "$color.muted-foreground" } })],
      });
      const root: DesignNode = {
        id: id(),
        type: "box",
        origin: "added",
        name: "Tabs",
        layout: { mode: "flex", direction: "column" },
        box: { width: { mode: "fill" } },
        children: [
          { id: id(), type: "box", origin: "added", name: "Tab list", semantic: { role: "tablist" }, layout: { mode: "flex", direction: "row", gap: "$spacing.1" }, style: { borderWidth: { bottom: 1 }, borderColor: "$color.border" }, children: values.map(tab) },
          panel("first", "What it is and who it is for, in a sentence or two."),
          panel("second", "The details: sizes, materials, what is included."),
          panel("third", "What customers say about it."),
        ],
      };
      return {
        root,
        def: {
          props: [
            { name: "tab", type: "enum", options: [...values], default: "first", description: "The tab that is open" },
            ...values.map((v, i) => ({ name: `${v}Label`, type: "string" as const, bindings: [{ nodeId: labels[i]!.id, field: "text" as const }] })),
          ],
        },
      };
    },
  },
  {
    key: "nav-link",
    name: "Nav link",
    description: "A link in a navigation bar; the current page's is marked active.",
    width: 100,
    previews: { prop: "active", values: ["true"] },
    build() {
      const label = text("Link", { name: "Label" });
      const root: DesignNode = {
        id: id(),
        type: "link",
        origin: "added",
        name: "Nav link",
        href: "#",
        layout: { padding: pad("$spacing.1.5", "$spacing.3") },
        style: { color: "$color.muted-foreground", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium", radius: "$radius.md" },
        overrides: [
          { when: { state: "hover" }, style: { color: "$color.foreground" } },
          { when: when("active", "true"), style: { color: "$color.foreground", background: "$color.secondary" } },
        ],
        children: [label],
      };
      return {
        root,
        def: {
          props: [
            { name: "label", type: "string", bindings: [{ nodeId: label.id, field: "text" }] },
            { name: "opens", type: "string", description: "Screen it opens", bindings: [{ nodeId: root.id, field: "target" }] },
            { name: "active", type: "boolean", default: false },
          ],
        },
      };
    },
  },
];

export function starterComponent(key: string): StarterComponent | undefined {
  return STARTER_COMPONENTS.find((c) => c.key === key);
}

/** A starter component as a component frame for a project (place it on the board yourself). */
export function starterComponentFrame(key: string, options: { adapter: string; name?: string; tint?: string }): Frame {
  const starter = starterComponent(key);
  if (!starter) throw new Error(`unknown starter component ${key}`);
  const { root, def } = starter.build({ tint: options.tint ?? "#71717a" });
  return {
    id: createId("f"),
    name: options.name ?? starter.name,
    kind: "component",
    platform: "web",
    target: { adapter: options.adapter },
    viewports: [{ id: "component", width: starter.width }],
    current: root,
    component: { ...def, description: starter.description, kit: key },
  };
}
