import { DEFAULT_REDACTION, type DesignNode, type Frame, IR_VERSION, type Project, type Tokens } from "@appshape/ir";

/**
 * "Habits": a small app designed in AppShape, used to test code generation. Two web pages linked
 * by buttons, a Button component with a variant and a link property, a Card component with a slot,
 * a custom brand color, responsive layout, a form, an image and an icon, entrance animations (a
 * heading fading in, cards sliding in one after another on scroll), plus a phone screen (which is
 * not generated as web code).
 */

let counter = 0;
const id = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(3, "0")}`;
const edges = (v: string) => ({ top: v, right: v, bottom: v, left: v });
const text = (value: string, extra: Partial<DesignNode> = {}): DesignNode => ({ id: id("n"), type: "text", origin: "added", text: value, ...extra }) as DesignNode;

export function demoProject(defaults: Tokens): Project {
  counter = 0;
  const tokens: Tokens = {
    ...defaults,
    groups: { ...defaults.groups, color: { ...defaults.groups.color, "brand-600": "oklch(0.55 0.2 150)", "brand-700": "oklch(0.48 0.18 150)" } },
  };

  // ---- Button component: label, opens (screen), variant primary | secondary
  const buttonLabel = text("Get started", { name: "Label" });
  const buttonIcon: DesignNode = { id: id("n"), type: "icon", origin: "added", icon: "arrow-right", set: "lucide", name: "Icon" };
  const buttonRoot: DesignNode = {
    id: id("n"),
    type: "button",
    origin: "added",
    name: "Button",
    layout: { mode: "flex", direction: "row", align: "center", justify: "center", gap: "$spacing.2", padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.4", right: "$spacing.4" } },
    box: { alignSelf: "start" },
    style: { background: "$color.brand-600", color: "$color.white", radius: "$radius.md", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium" },
    overrides: [
      { when: { state: "hover" }, style: { background: "$color.brand-700" } },
      { when: { prop: { name: "variant", value: "secondary" } }, style: { background: "$color.white", color: "$color.gray-900", borderWidth: 1, borderColor: "$color.gray-300" } },
      { when: { prop: { name: "variant", value: "secondary" }, state: "hover" }, style: { background: "$color.gray-50" } },
    ],
    children: [buttonLabel, buttonIcon],
  };
  const button: Frame = {
    id: "f_button",
    name: "Button",
    kind: "component",
    platform: "web",
    target: { adapter: "react-vite" },
    viewports: [{ id: "component", width: 160 }],
    current: buttonRoot,
    component: {
      description: "Primary call to action",
      props: [
        { name: "label", type: "string", bindings: [{ nodeId: buttonLabel.id, field: "text" }] },
        { name: "showIcon", type: "boolean", bindings: [{ nodeId: buttonIcon.id, field: "visible" }] },
        { name: "opens", type: "string", description: "Screen it opens", bindings: [{ nodeId: buttonRoot.id, field: "target" }] },
        { name: "variant", type: "enum", options: ["primary", "secondary"], default: "primary" },
      ],
    },
  };

  // ---- Card component: title + slot "content"
  const cardTitle = text("Card title", { name: "Title", semantic: { role: "heading", level: 3 }, style: { fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" } });
  const cardSlot: DesignNode = {
    id: id("n"),
    type: "slot",
    origin: "added",
    slotName: "content",
    layout: { mode: "flex", direction: "column", gap: "$spacing.2" },
    children: [text("Supporting text for this card.", { style: { fontSize: "$fontSize.sm", color: "$color.gray-600" } })],
  };
  const card: Frame = {
    id: "f_card",
    name: "Card",
    kind: "component",
    platform: "web",
    target: { adapter: "react-vite" },
    viewports: [{ id: "component", width: 320 }],
    current: {
      id: id("n"),
      type: "box",
      origin: "added",
      name: "Card",
      layout: { mode: "flex", direction: "column", gap: "$spacing.3", padding: edges("$spacing.6") },
      style: { background: "$color.white", borderWidth: 1, borderColor: "$color.gray-200", radius: "$radius.xl", shadow: "$shadow.sm" },
      children: [cardTitle, cardSlot],
    },
    component: { props: [{ name: "title", type: "string", bindings: [{ nodeId: cardTitle.id, field: "text" }] }] },
  };

  const instance = (componentId: string, props: Record<string, string | boolean>, extra: Partial<DesignNode> = {}): DesignNode =>
    ({ id: id("n"), type: "instance", origin: "added", componentId, props, children: [], ...extra }) as DesignNode;

  // ---- Home page
  const home: Frame = {
    id: "f_home",
    name: "Home",
    kind: "new",
    platform: "web",
    target: { adapter: "react-vite", route: "/" },
    viewports: [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }],
    current: {
      id: id("n"),
      type: "box",
      origin: "added",
      name: "Home",
      semantic: { role: "main" },
      layout: { mode: "flex", direction: "column", gap: "$spacing.12", padding: edges("$spacing.6") },
      box: { minHeight: "100vh" },
      style: { background: "$color.gray-50" },
      overrides: [{ when: { viewport: "md" }, layout: { padding: edges("$spacing.12") } }],
      children: [
        {
          id: id("n"),
          type: "box",
          origin: "added",
          name: "Hero",
          semantic: { role: "header" },
          layout: { mode: "flex", direction: "column", gap: "$spacing.4" },
          box: { maxWidth: "$size.3xl" },
          children: [
            text("Build better habits", { semantic: { role: "heading", level: 1 }, style: { fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight", color: "$color.gray-900", motion: { preset: "fade", trigger: "load", duration: 800 } }, overrides: [{ when: { viewport: "md" }, style: { fontSize: "$fontSize.6xl" } }] }),
            text("Small steps every day. Track what matters and see your progress grow.", { style: { fontSize: "$fontSize.lg", color: "$color.gray-600" } }),
            {
              id: id("n"),
              type: "box",
              origin: "added",
              name: "Actions",
              layout: { mode: "flex", direction: "row", gap: "$spacing.3", wrap: true },
              children: [instance("f_button", { label: "Start today", opens: "f_today" }), instance("f_button", { label: "Learn more", variant: "secondary", showIcon: false, opens: "f_about" })],
            },
          ],
        },
        {
          id: id("n"),
          type: "box",
          origin: "added",
          name: "Features",
          layout: { mode: "grid", columns: 1, gap: "$spacing.6" },
          // the cards slide in one after another when the grid scrolls into view
          style: { motion: { preset: "slide-up", trigger: "scroll", stagger: 120 } },
          overrides: [{ when: { viewport: "md" }, layout: { columns: 3 } }],
          children: [
            instance("f_card", { title: "Daily check-ins" }),
            instance("f_card", { title: "Streaks" }, {
              children: [{ id: id("n"), type: "slot", origin: "added", slotName: "content", children: [text("Keep the chain going.", { style: { fontSize: "$fontSize.sm", color: "$color.gray-600" } }), { id: id("n"), type: "image", origin: "added", src: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23e4e4e7'/%3E%3C/svg%3E", alt: "Streak chart", fit: "cover", box: { width: { mode: "fill" } }, style: { radius: "$radius.lg" } }] }],
            }),
            instance("f_card", { title: "Insights" }),
          ],
        },
      ],
    },
  };

  // ---- Today page
  const today: Frame = {
    id: "f_today",
    name: "Today",
    kind: "new",
    platform: "web",
    target: { adapter: "react-vite", route: "/today" },
    viewports: [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }],
    current: {
      id: id("n"),
      type: "box",
      origin: "added",
      name: "Today",
      layout: { mode: "flex", direction: "column", gap: "$spacing.6", padding: edges("$spacing.6") },
      box: { minHeight: "100vh" },
      children: [
        { id: id("n"), type: "link", origin: "added", targetFrameId: "f_home", style: { color: "$color.brand-600", fontSize: "$fontSize.sm", fontWeight: "$fontWeight.medium" }, children: [text("← Back")] },
        text("Today", { semantic: { role: "heading", level: 1 }, style: { fontSize: "$fontSize.3xl", fontWeight: "$fontWeight.bold" } }),
        {
          id: id("n"),
          type: "box",
          origin: "added",
          name: "New habit",
          semantic: { role: "form" },
          layout: { mode: "flex", direction: "column", gap: "$spacing.4" },
          box: { maxWidth: "$size.md" },
          annotations: [{ id: "a_save", kind: "behavior", text: "Saving adds the habit to today's list.", author: "user" }],
          children: [
            { id: id("n"), type: "input", origin: "added", inputType: "text", label: "Habit", placeholder: "e.g. Read 10 pages", layout: { padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.3", right: "$spacing.3" } }, style: { borderWidth: 1, borderColor: "$color.gray-300", radius: "$radius.md", fontSize: "$fontSize.sm" } },
            instance("f_button", { label: "Save habit" }),
          ],
        },
        { id: id("n"), type: "box", origin: "added", name: "Tip", hidden: true, layout: { mode: "flex", gap: "$spacing.2" }, overrides: [{ when: { viewport: "md" }, hidden: false }], style: { color: "$color.gray-500", fontSize: "$fontSize.sm" }, children: [text("Tip: habits stick best when they are small.")] },
      ],
    },
  };

  // ---- Phone screen (spec only until native code generation)
  const phone: Frame = {
    id: "f_phone",
    name: "Reminders",
    kind: "new",
    platform: "mobile",
    target: { adapter: "react-vite", route: "/reminders" },
    viewports: [{ id: "phone", width: 393, height: 852, device: "iphone-15" }],
    current: { id: id("n"), type: "box", origin: "added", layout: { mode: "flex", direction: "column", padding: edges("$spacing.6") }, children: [text("Reminders")] },
  };

  return {
    irVersion: IR_VERSION,
    name: "Habits",
    adapters: [],
    tokens,
    components: [],
    board: { items: [] },
    frames: [home, today, phone, button, card],
    changesets: [],
    redaction: DEFAULT_REDACTION,
  };
}
