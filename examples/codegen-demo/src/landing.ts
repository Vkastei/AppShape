import { createId, DEFAULT_REDACTION, type DesignNode, type Frame, IR_VERSION, type Project, type Tokens, walk } from "@appshape/ir";
import { buildPage, overlayFrame, type SectionContext, sectionDef, starterComponentFrame, withTheme } from "@appshape/kit";

/**
 * "Acme": a landing page made from the section library, with motion and interactions (benchmark
 * B3, and the interactive components of phase 4): the header's menu button opens the mobile menu on
 * phones, the heading fades in, features and testimonials slide in one after another on scroll,
 * the testimonials are one card design plus data, questions open and close, and "Start for free"
 * opens a dialog. A second screen has tabs, a carousel and a dropdown menu.
 */
export function landingProject(defaults: Tokens): Project {
  const tokens = withTheme(defaults);
  const starters = new Map<string, Frame>();
  const overlays = new Map<string, Frame>();
  const ctx: SectionContext = {
    tint: "#4f46e5",
    use: (key, props = {}, fill = []) => {
      let frame = starters.get(key);
      if (!frame) starters.set(key, (frame = starterComponentFrame(key, { adapter: "react-vite" })));
      return { id: createId("n"), type: "instance", origin: "added", componentId: frame.id, props, children: fill };
    },
    overlay: (key) => {
      let frame = overlays.get(key);
      if (!frame) overlays.set(key, (frame = overlayFrame(key, ctx, { adapter: "react-vite" })));
      return frame.id;
    },
  };

  const screen = (id: string, name: string, route: string, root: DesignNode): Frame => ({
    id,
    name,
    kind: "new",
    platform: "web",
    target: { adapter: "react-vite", route },
    viewports: [{ id: "desktop", width: 1280, breakpoint: "lg" }, { id: "mobile", width: 390 }],
    current: { ...root, name, style: { ...root.style, background: "$color.background", color: "$color.foreground" } },
  });

  // ---- Home: the landing page
  const home = buildPage({ key: "b3", name: "Landing", description: "", screen: "Home", sections: ["header-simple", "hero-centered", "features-cards", "testimonials-cards", "faq-list", "cta-banner", "footer-simple"] }, ctx);
  const find = (root: DesignNode, test: (node: DesignNode) => boolean): DesignNode => {
    let found: DesignNode | undefined;
    walk(root, (node) => {
      if (!found && test(node)) found = node;
    });
    if (!found) throw new Error("not in the landing page");
    return found;
  };
  const section = (name: string) => find(home, (n) => n.name === name && (n.semantic?.role === "section" || n.semantic?.role === "header" || n.semantic?.role === "footer"));
  find(home, (n) => n.type === "text" && n.semantic?.role === "heading" && n.semantic.level === 1).style!.motion = { preset: "fade", trigger: "load", duration: 800 };
  const featureGrid = find(section("Features"), (n) => n.layout?.mode === "grid");
  featureGrid.style = { ...featureGrid.style, motion: { preset: "slide-up", trigger: "scroll", stagger: 120 } };
  const testimonials = find(section("Testimonials"), (n) => n.type === "list");
  testimonials.style = { ...testimonials.style, motion: { preset: "slide-up", trigger: "scroll", stagger: 120 } };
  // the call to action's first button opens the dialog
  const sales = find(section("Call to action"), (n) => n.type === "instance" && n.props.label !== undefined && n.props.variant !== undefined);
  sales.interaction = { type: "open", frameId: ctx.overlay!("dialog"), as: "modal" };

  // ---- Components: tabs, a carousel, a dropdown menu
  const account: DesignNode = {
    id: createId("n"),
    type: "box",
    origin: "added",
    name: "Account",
    layout: { mode: "flex", direction: "row", align: "center", gap: "$spacing.2", padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.3", right: "$spacing.3" } },
    box: { alignSelf: "start" },
    style: { borderWidth: 1, borderColor: "$color.border", radius: "$radius.md", fontSize: "$fontSize.sm", cursor: "pointer" },
    interaction: { type: "open", frameId: ctx.overlay!("dropdown-menu"), as: "dropdown" },
    children: [{ id: createId("n"), type: "text", origin: "added", text: "Account" }, { id: createId("n"), type: "icon", origin: "added", icon: "chevron-down", set: "lucide" }],
  };
  const components: DesignNode = {
    id: createId("n"),
    type: "box",
    origin: "added",
    layout: { mode: "flex", direction: "column" },
    children: [
      {
        id: createId("n"),
        type: "box",
        origin: "added",
        name: "Showcase",
        layout: { mode: "flex", direction: "column", gap: "$spacing.8", padding: { top: "$spacing.12", bottom: "$spacing.12", left: "$spacing.gutter", right: "$spacing.gutter" } },
        children: [account, ctx.use("tabs")],
      },
      sectionDef("testimonials-carousel")!.build(ctx),
    ],
  };

  const frames: Frame[] = [screen("f_home", "Home", "/", home), screen("f_components", "Components", "/components", components), ...overlays.values(), ...starters.values()];
  return { irVersion: IR_VERSION, name: "Acme", adapters: [], tokens, components: [], board: { items: [] }, frames, changesets: [], redaction: DEFAULT_REDACTION };
}
