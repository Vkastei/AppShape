import { createId, type DesignNode, type Edges, type Frame, type JsonValue } from "@appshape/ir";
import { starterComponentFrame } from "./components";

/**
 * A small landing page made of starter components, for previewing a theme (the theme starter).
 * Uses only theme tokens, so every choice shows: colors, fonts, shape, density, both schemes.
 */
export function themePreview(tint = "#71717a"): { root: DesignNode; frames: Frame[] } {
  const frames = ["button", "card", "badge", "input", "nav-link", "accordion"].map((key) => starterComponentFrame(key, { adapter: "preview", tint }));
  const byKey = new Map(frames.map((f) => [f.component!.kit!, f.id]));
  const id = () => createId("n");
  const use = (key: string, props: Record<string, JsonValue> = {}, children: DesignNode[] = []): DesignNode => ({ id: id(), type: "instance", origin: "added", componentId: byKey.get(key)!, props, children });
  const text = (value: string, style: NonNullable<DesignNode["style"]>, extra: Partial<DesignNode> = {}): DesignNode => ({ id: id(), type: "text", origin: "added", text: value, style, ...extra }) as DesignNode;
  const box = (layout: NonNullable<DesignNode["layout"]>, children: DesignNode[], extra: Partial<DesignNode> = {}): DesignNode => ({ id: id(), type: "box", origin: "added", layout, children, ...extra }) as DesignNode;
  const x = (v: string): Edges => ({ left: v, right: v });
  const section = (children: DesignNode[], extra: Partial<DesignNode> = {}) =>
    box({ mode: "flex", direction: "column", align: "center", padding: { ...x("$spacing.gutter"), top: "$spacing.section", bottom: "$spacing.section" } }, [box({ mode: "flex", direction: "column", gap: "$spacing.8" }, children, { box: { width: { mode: "fill" }, maxWidth: "$size.content" } })], {
      ...extra,
      overrides: [{ when: { viewport: "md" }, layout: { padding: { ...x("$spacing.gutter"), top: "$spacing.section-lg", bottom: "$spacing.section-lg" } } }],
    });
  const heading = (value: string, level: number, size: string) => text(value, { fontFamily: "$fontFamily.heading", fontSize: size, fontWeight: "$fontWeight.bold", letterSpacing: "$letterSpacing.tight" }, { semantic: { role: "heading", level } });

  const feature = (icon: string, title: string, body: string) =>
    use("card", {}, [
      {
        id: id(), type: "slot", origin: "added", slotName: "content", layout: { mode: "flex", direction: "column", gap: "$spacing.3" },
        children: [
          box({ mode: "flex", align: "center", justify: "center" }, [{ id: id(), type: "icon", origin: "added", icon, set: "lucide", style: { fontSize: "$fontSize.lg" } }], {
            box: { width: { mode: "fixed", value: "$spacing.10" }, height: { mode: "fixed", value: "$spacing.10" } },
            style: { background: "$color.accent", color: "$color.accent-foreground", radius: "$radius.lg" },
          }),
          text(title, { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" }, { semantic: { role: "heading", level: 3 } }),
          text(body, { fontSize: "$fontSize.sm", color: "$color.muted-foreground" }),
        ],
      },
    ]);

  const nav = box({ mode: "flex", direction: "row", align: "center", justify: "between", gap: "$spacing.4", padding: { ...x("$spacing.gutter"), top: "$spacing.4", bottom: "$spacing.4" } }, [
    text("Acme", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.bold" }),
    box({ mode: "flex", direction: "row", align: "center", gap: "$spacing.1" }, [use("nav-link", { label: "Product", active: true }), use("nav-link", { label: "Pricing" }), use("nav-link", { label: "About" })], {
      hidden: true,
      overrides: [{ when: { viewport: "md" }, hidden: false }],
    }),
    use("button", { label: "Sign up", size: "sm" }),
  ], { style: { borderWidth: { bottom: 1 }, borderColor: "$color.border" }, semantic: { role: "header" } });

  const title = heading("Ship a better product, faster", 1, "$fontSize.4xl");
  title.style = { ...title.style, textAlign: "center" };
  title.overrides = [{ when: { viewport: "md" }, style: { fontSize: "$fontSize.6xl" } }];
  const hero = section([
    box({ mode: "flex", direction: "column", align: "center", gap: "$spacing.6" }, [
      use("badge", { label: "New: version 2.0" }),
      title,
      text("Everything your team needs to plan, build and launch, in one calm place.", { fontSize: "$fontSize.lg", color: "$color.muted-foreground", textAlign: "center" }),
      box({ mode: "flex", direction: "row", wrap: true, justify: "center", gap: "$spacing.3" }, [use("button", { label: "Get started", size: "lg" }), use("button", { label: "Learn more", variant: "outline", size: "lg" })]),
    ]),
  ]);

  const features = section(
    [
      heading("Why teams choose Acme", 2, "$fontSize.3xl"),
      box({ mode: "grid", columns: 1, gap: "$spacing.6" }, [
        feature("zap", "Fast by default", "Pages load in a blink, on every device."),
        feature("shield-check", "Secure", "Your data stays yours, encrypted at rest."),
        feature("sparkles", "Delightful", "Details that make work feel lighter."),
      ], { overrides: [{ when: { viewport: "md" }, layout: { columns: 3 } }] }),
    ],
    { style: { background: "$color.muted" } },
  );

  const signup = section([
    box({ mode: "grid", columns: 1, gap: "$spacing.10" }, [
      box({ mode: "flex", direction: "column", gap: "$spacing.4" }, [
        heading("Questions?", 2, "$fontSize.3xl"),
        use("accordion", { question: "Is there a free plan?", answer: "Yes. Start free and upgrade when your team grows.", open: true }),
        use("accordion", { question: "Can I cancel anytime?" }),
      ]),
      use("card", {}, [
        {
          id: id(), type: "slot", origin: "added", slotName: "content", layout: { mode: "flex", direction: "column", gap: "$spacing.4" },
          children: [
            text("Stay in the loop", { fontFamily: "$fontFamily.heading", fontSize: "$fontSize.lg", fontWeight: "$fontWeight.semibold" }, { semantic: { role: "heading", level: 3 } }),
            use("input", { label: "Email", placeholder: "you@example.com" }),
            use("button", { label: "Subscribe" }),
          ],
        },
      ]),
    ], { overrides: [{ when: { viewport: "md" }, layout: { columns: 2 } }] }),
  ]);

  const root = box({ mode: "flex", direction: "column" }, [nav, hero, features, signup], { name: "Theme preview", style: { background: "$color.background", color: "$color.foreground" } });
  return { root, frames };
}
