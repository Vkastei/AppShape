import { fileURLToPath } from "node:url";
import { componentSources, type DesignNode, type Frame, type Project } from "@appshape/ir";
import { ProjectFiles } from "@appshape/store";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { renderFrame } from "../src";

const demoDir = fileURLToPath(new URL("../../../examples/m0-validation/generated/demo-project", import.meta.url));
let project: Project;

beforeAll(async () => {
  ({ project } = await new ProjectFiles({ appRoot: "", dataDir: demoDir, mode: "in-repo" }).load());
});

const render = (root: DesignNode, tokens = project.tokens) => {
  const result = renderFrame(root, { tokens, components: project.components });
  return { ...result, html: renderToStaticMarkup(result.element) };
};
const rule = (css: string, id: string) => css.split("\n").filter((line) => line.includes(`[data-aps="${id}"]`));

describe("renderFrame on the demo project", () => {
  it("renders Pricing without warnings", async () => {
    const pricing = project.frames.find((f) => f.id === "f_pricing")!;
    const { html, css, warnings } = render(pricing.current);
    expect(warnings).toEqual([]);
    await expect(`<style>${css}</style>\n${html}`).toMatchFileSnapshot("__snapshots__/pricing.html");
  });

  it("uses the captured tags, texts and edits", () => {
    const pricing = project.frames.find((f) => f.id === "f_pricing")!;
    const { html, css } = render(pricing.current);
    expect(html).toContain('<h1 data-aps="n_title">Simple pricing for every team</h1>');
    expect(html).toContain('data-aps-placeholder="">Accordion</div>');
    expect(rule(css, "n_card_pro_root").join("")).toMatch(/box-shadow: 0 0 0 2px oklch\(0.51 0.21 275\), 0 4px 6px/);
    expect(rule(css, "n_card_starter_root").join("")).toContain("border-radius: 0.75rem");
  });

  it("turns breakpoints into container queries and states into pseudo-classes", () => {
    const pricing = project.frames.find((f) => f.id === "f_pricing")!;
    const { css } = render(pricing.current);
    expect(css).toContain(
      '@container aps-frame (min-width: 48rem) { .aps-frame [data-aps="n_plans"] { grid-template-columns: repeat(3, minmax(0, 1fr)); } }',
    );
    expect(css).toContain('@container aps-frame (min-width: 64rem) { .aps-frame [data-aps="n_plans"] { gap: 2.5rem; } }');
    expect(css.indexOf("min-width: 48rem")).toBeLessThan(css.indexOf("min-width: 64rem"));
    expect(css).toContain('.aps-frame [data-aps="n_nav_home"]:hover { color: oklch(0.21 0.034 264.665); }');
  });

  it("applies instance box styles to the rendered root", () => {
    const pricing = project.frames.find((f) => f.id === "f_pricing")!;
    const { css } = render(pricing.current);
    expect(css).toContain('.aps-frame [data-aps="n_card_pro_badge"] > * { margin-bottom: 1rem; align-self: flex-start; }');
  });
});

describe("renderFrame details", () => {
  const tokens = { source: "manual" as const, groups: { spacing: { "4": "1rem" } } };

  it("sizes fill depending on the parent", () => {
    const tree: DesignNode = {
      id: "row", type: "box", origin: "added", layout: { mode: "flex", direction: "row" },
      children: [
        { id: "a", type: "box", origin: "added", box: { width: { mode: "fill" }, height: { mode: "fill" } }, children: [] },
      ],
    };
    const { css } = render(tree, tokens);
    expect(rule(css, "a")[0]).toContain("flex: 1 1 0%; min-width: 0; align-self: stretch;");
  });

  it("warns about unknown tokens and blocks unsafe tags", () => {
    const tree: DesignNode = {
      id: "root", type: "element", origin: "imported", platformRaw: { tag: "script" },
      style: { color: "$color.nope", fontSize: "$fontSize.nope" }, children: [],
    };
    const { html, css, warnings } = render(tree, tokens);
    expect(html).toBe('<div class="aps-frame"><div data-aps="root"></div></div>');
    expect(rule(css, "root")[0]).toContain("color: magenta;");
    expect(warnings).toEqual(["unknown token $color.nope", "unknown token $fontSize.nope"]);
  });

  it("resolves vh units against the screen height", () => {
    const tree: DesignNode = { id: "page", type: "box", origin: "added", box: { minHeight: "100vh" }, children: [] };
    const { css } = renderFrame(tree, { tokens, viewportHeight: 852 });
    expect(rule(css, "page")[0]).toContain("min-height: 852px;");
    expect(rule(renderFrame(tree, { tokens }).css, "page")[0]).toContain("min-height: 100vh;");
  });

  it("draws background images through the asset resolver", () => {
    const tree: DesignNode = { id: "hero", type: "box", origin: "added", style: { backgroundImage: { src: "asset:uploads/a.png", size: "cover", position: "bottom-right", repeat: false } }, children: [] };
    const { css } = renderFrame(tree, { tokens, resolveAsset: (src) => `/api/assets/${src.slice(6)}` });
    const line = rule(css, "hero")[0]!;
    expect(line).toContain('background-image: url("/api/assets/uploads/a.png");');
    expect(line).toContain("background-size: cover;");
    expect(line).toContain("background-position: bottom right;");
    expect(line).toContain("background-repeat: no-repeat;");
  });

  it("renders tokens with a dark value through variables that follow the board's scheme", () => {
    const themed = {
      source: "manual" as const,
      groups: { color: { background: "#ffffff", foreground: "#18181b", primary: "#4f46e5" }, fontFamily: { sans: '"Inter Variable", sans-serif' } },
      dark: { color: { background: "#09090b", foreground: "#fafafa" } },
    };
    const tree: DesignNode = { id: "card", type: "box", origin: "added", style: { background: "$color.background", color: "$color.primary", borderColor: "$color.foreground/20" }, children: [] };
    const { css } = renderFrame(tree, { tokens: themed });
    const line = rule(css, "card")[0]!;
    expect(line).toContain("background-color: var(--aps-tk-color-background);");
    expect(line).toContain("color: #4f46e5;");
    expect(line).toContain("border-color: color-mix(in oklab, var(--aps-tk-color-foreground) 20%, transparent);");
    expect(css).toContain(".aps-frame { --aps-tk-color-background: #ffffff; --aps-tk-color-foreground: #18181b; }");
    expect(css).toContain(".aps-frame.aps-dark { --aps-tk-color-background: #09090b; --aps-tk-color-foreground: #fafafa; }");
    // the page defaults come from the theme, below everything else
    expect(css).toContain('@layer aps-reset { :where(.aps-frame) { font-family: "Inter Variable", sans-serif; color: var(--aps-tk-color-foreground); background: var(--aps-tk-color-background); } }');
  });

  it("supports hidden by default, shown from a breakpoint", () => {
    const tree: DesignNode = {
      id: "menu", type: "box", origin: "added", hidden: true, layout: { mode: "flex" },
      overrides: [{ when: { viewport: "md" }, hidden: false }], children: [],
    };
    const { css } = render(tree, tokens);
    expect(css).toContain('.aps-frame [data-aps="menu"] { display: none;');
    expect(css).toContain('@container aps-frame (min-width: 48rem) { .aps-frame [data-aps="menu"] { display: flex; } }');
  });
});

describe("renderFrame with components", () => {
  const tokens = { source: "manual" as const, groups: { color: { brand: "#4f46e5", white: "#fff" } } };
  const button: Frame = {
    id: "f_button",
    name: "Button",
    kind: "component",
    platform: "web",
    target: { adapter: "react-vite" },
    viewports: [{ id: "component", width: 120 }],
    component: {
      props: [
        { name: "label", type: "string", bindings: [{ nodeId: "b_label", field: "text" }] },
        { name: "variant", type: "enum", options: ["primary", "outline"] },
      ],
    },
    current: {
      id: "b_root", type: "button", origin: "added",
      style: { background: "$color.brand" },
      overrides: [{ when: { prop: { name: "variant", value: "outline" } }, style: { background: "$color.white" } }],
      children: [{ id: "b_label", type: "text", origin: "added", text: "Button" }],
    },
  };
  const sources = componentSources([button]);
  const inst = (id: string, props: Record<string, string> = {}): DesignNode => ({ id, type: "instance", origin: "added", componentId: "f_button", props, children: [] });

  it("renders instances from the component with scoped inner ids", () => {
    const tree: DesignNode = { id: "page", type: "box", origin: "added", children: [inst("i1", { label: "Buy" }), inst("i2", { variant: "outline" })] };
    const result = renderFrame(tree, { tokens, sources });
    const html = renderToStaticMarkup(result.element);
    expect(html).toContain('<button data-aps="i1" type="button"><span data-aps-i="i1/b_label">Buy</span></button>');
    expect(html).toContain('<button data-aps="i2" type="button"><span data-aps-i="i2/b_label">Button</span></button>');
    expect(rule(result.css, "i1")[0]).toContain("background-color: #4f46e5;");
    expect(rule(result.css, "i2")[0]).toContain("background-color: #fff;");
    expect(result.css).not.toContain("b_root");
    expect(result.warnings).toEqual([]);
  });

  it("marks navigation targets and renders component frames on a stage", () => {
    const link: DesignNode = { id: "l", type: "link", origin: "added", targetFrameId: "f_about", children: [] };
    expect(renderToStaticMarkup(renderFrame(link, { tokens }).element)).toContain('data-aps-target="f_about"');
    const staged = renderToStaticMarkup(renderFrame(button.current, { tokens, sources, frameId: button.id, stage: true }).element);
    expect(staged).toMatch(/^<div class="aps-frame" style="display:flex;flex-direction:column"><button data-aps="b_root"/);
  });

  it("fills slots with real, selectable nodes", () => {
    const card: Frame = {
      ...button, id: "f_card", name: "Card", component: { props: [] },
      current: { id: "c_root", type: "box", origin: "added", children: [{ id: "c_slot", type: "slot", origin: "added", slotName: "body", style: { color: "red" }, children: [] }] },
    };
    const tree: DesignNode = {
      id: "i_card", type: "instance", origin: "added", componentId: "f_card", props: {},
      children: [{ id: "fill", type: "slot", origin: "added", slotName: "body", children: [inst("nested")] }],
    };
    const result = renderFrame(tree, { tokens, sources: componentSources([button, card]) });
    const html = renderToStaticMarkup(result.element);
    expect(html).toContain('<div data-aps="i_card"><div data-aps="fill"><button data-aps="nested" type="button"><span data-aps-i="nested/b_label">Button</span></button></div></div>');
    expect(rule(result.css, "fill")[0]).toContain("color: red;");
  });

  it("does not expand a component inside itself", () => {
    const loop: Frame = { ...button, id: "f_loop", component: { props: [] }, current: { id: "r", type: "box", origin: "added", children: [{ id: "self", type: "instance", origin: "added", componentId: "f_loop", props: {}, children: [] }] } };
    const result = renderFrame(loop.current, { tokens, sources: componentSources([loop]), frameId: "f_loop" });
    expect(renderToStaticMarkup(result.element)).toContain('<div data-aps="self" data-aps-placeholder="">Button</div>');
    expect(result.warnings).toEqual(["component Button contains itself"]);
  });
});
