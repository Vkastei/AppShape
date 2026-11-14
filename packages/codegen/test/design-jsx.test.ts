/**
 * Draw & describe: screens as design JSX and back. Every screen of the library, the demo projects
 * and the imported fixture apps round-trips unchanged; JSX without ids reads back to the same
 * JSX; hand-written edits become the expected ops and change list.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { createId, DEFAULT_REDACTION, type DesignNode, type Frame, IR_VERSION, type Project, type Tokens } from "@appshape/ir";
import { buildPage, overlayFrame, PAGE_TEMPLATES, SECTIONS, type SectionContext, starterComponentFrame, withTheme } from "@appshape/kit";
import { ProjectFiles } from "@appshape/store";
import { beforeAll, describe, expect, it } from "vitest";
import { landingProject } from "../../../examples/codegen-demo/src/landing";
import { DesignJsxError, designJsx, proposeFromJsx, readDesignJsx } from "../src";

let defaults: Tokens;
const corpus: { name: string; project: Project }[] = [];

/** Every section and page template of the library as screens (with the starter components and overlays they use). */
function kitProject(tokens: Tokens): Project {
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
  const screen = (name: string, route: string, root: DesignNode): Frame => ({ id: createId("f"), name, kind: "new", platform: "web", target: { adapter: "react-vite", route }, viewports: [{ id: "desktop", width: 1280 }], current: root });
  const screens = [
    ...PAGE_TEMPLATES.map((t) => screen(t.name, `/${t.key}`, buildPage(t, ctx))),
    ...SECTIONS.map((s) => screen(s.name, `/section-${s.key}`, { id: createId("n"), type: "box", origin: "added", layout: { mode: "flex", direction: "column" }, children: [s.build(ctx)] })),
  ];
  return { irVersion: IR_VERSION, name: "Kit", adapters: [], tokens, components: [], board: { items: [] }, frames: [...screens, ...overlays.values(), ...starters.values()], changesets: [], redaction: DEFAULT_REDACTION };
}

beforeAll(async () => {
  defaults = await defaultTokens();
  corpus.push({ name: "library", project: kitProject(withTheme(defaults)) }, { name: "landing", project: landingProject(defaults) });
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  for (const dir of ["examples/m0-validation/generated/demo-project", "fixtures/vite-react-router-tw4/.appshape", "fixtures/next-app-router-tw4/.appshape", "fixtures/next-pages-router-tw3/.appshape", "fixtures/vite-tanstack-router-tw3/.appshape", "fixtures/generated-vite-motion/.appshape"]) {
    if (!existsSync(`${root}${dir}/project.json`)) continue;
    const { project } = await new ProjectFiles({ appRoot: root, dataDir: `${root}${dir}`, mode: "in-repo" }).load();
    corpus.push({ name: dir, project });
  }
}, 60_000);

const screens = (project: Project) => project.frames.filter((f) => f.kind !== "component");

describe("design JSX round trip", () => {
  it("covers the library, the demo projects and the imported fixture apps", () => {
    expect(corpus.map((c) => c.name)).toEqual(expect.arrayContaining(["library", "landing", "fixtures/vite-react-router-tw4/.appshape"]));
    expect(corpus.flatMap((c) => screens(c.project)).length).toBeGreaterThan(40);
  });

  it("reads every screen back unchanged", () => {
    for (const { name, project } of corpus) {
      for (const frame of screens(project)) {
        const jsx = designJsx(frame, project);
        const { root, warnings } = readDesignJsx(jsx, frame, project);
        expect(root, `${name}: ${frame.name}`).toEqual(frame.current);
        expect(warnings, `${name}: ${frame.name}`).toEqual([]);
        expect(proposeFromJsx(project, frame.id, jsx).ops, `${name}: ${frame.name}`).toEqual([]);
      }
    }
  });

  it("reads JSX without ids back to the same JSX (new elements are understood)", () => {
    const strip = (jsx: string) => jsx.replace(/ data-id="[^"]*"/g, "");
    for (const { name, project } of corpus.filter((c) => c.name === "library" || c.name === "landing")) {
      for (const frame of screens(project)) {
        const jsx = designJsx(frame, project);
        const { root } = readDesignJsx(strip(jsx), frame, project);
        expect(strip(designJsx({ ...frame, current: root }, project)), `${name}: ${frame.name}`).toBe(strip(jsx));
      }
    }
  });

  it("reads a screen written on one line (spaces between elements) back unchanged", () => {
    // models sometimes answer with the whole screen on one line: `<div …> <header …> …`
    for (const { name, project } of corpus.filter((c) => c.name === "landing")) {
      for (const frame of screens(project)) {
        const jsx = designJsx(frame, project);
        const draft = proposeFromJsx(project, frame.id, jsx.replace(/\n\s*/g, " "));
        expect(draft.ops, `${name}: ${frame.name}`).toEqual([]);
      }
    }
  });
});

describe("edits as proposals", () => {
  const home = () => {
    const project = landingProject(defaults);
    return { project, frame: project.frames.find((f) => f.name === "Home")! };
  };

  it("turns a hand-written edit into the expected ops and change list", () => {
    const { project, frame } = home();
    let jsx = designJsx(frame, project);
    const h1 = /<h1 data-id="([^"]+)"[^>]*>([^<]+)<\/h1>/.exec(jsx)!;
    // new heading text, a new outline button below it, the section's padding changed, the logo cloud gone
    jsx = jsx.replace(`>${h1[2]}</h1>`, ">Ship faster with Acme</h1>");
    jsx = jsx.replace(/(<h1 data-id="[^"]+"[^>]*>[^<]+<\/h1>)/, `$1\n<button className="rounded-md border border-border px-4 py-2 text-sm">Watch the demo</button>`);
    const draft = proposeFromJsx(project, frame.id, jsx);
    expect(draft.ops.map((op) => op.op)).toEqual(["insert", "retext"]);
    expect(draft.summary).toEqual([expect.stringMatching(/^Added a button “Watch the demo” in the /), "Changed the text “" + h1[2]!.slice(0, 40) + (h1[2]!.length > 40 ? "…" : "") + "” to “Ship faster with Acme”"]);
    const inserted = draft.ops[0] as Extract<(typeof draft.ops)[number], { op: "insert" }>;
    expect(inserted.node).toMatchObject({ type: "button", layout: { padding: { top: "$spacing.2", left: "$spacing.4" } }, style: { borderWidth: 1, borderColor: "$color.border", radius: "$radius.md" }, children: [{ type: "text", text: "Watch the demo" }] });
    expect(draft.warnings).toEqual([]);
  });

  it("removes, moves and restyles elements that keep their ids", () => {
    const { project, frame } = home();
    const jsx = designJsx(frame, project);
    const sections = [...jsx.matchAll(/\n {2}<(header|section|footer) data-id="([^"]+)"/g)].map((m) => m[2]!);
    // drop the second section, move the last one to the top, and make the first section's background muted
    const lines = jsx.split("\n");
    const block = (id: string) => {
      const start = lines.findIndex((l) => l.includes(`data-id="${id}"`));
      const tag = /<(\w+)/.exec(lines[start]!)![1];
      const end = lines.findIndex((l, i) => i > start && l === `  </${tag}>`);
      return [start, end] as const;
    };
    const [s2, e2] = block(sections[1]!);
    const [sl, el] = block(sections.at(-1)!);
    const last = lines.slice(sl, el + 1);
    const kept = [...lines.slice(0, s2), ...lines.slice(e2 + 1, sl), ...lines.slice(el + 1)];
    kept.splice(1, 0, ...last);
    const edited = kept.join("\n").replace(new RegExp(`(data-id="${sections[0]}"[^>]*className="[^"]*)bg-background`), "$1bg-muted");
    const draft = proposeFromJsx(project, frame.id, edited);
    expect(draft.ops.map((op) => op.op).sort()).toEqual(["delete", "move", "restyle"]);
    expect(draft.summary).toEqual([expect.stringMatching(/^Removed the section/), expect.stringMatching(/^Moved the footer/), expect.stringMatching(/^Changed the look of the header/)]);
  });

  it("knows the components, their properties and the screens' routes", () => {
    const { project, frame } = home();
    const jsx = designJsx(frame, project);
    const button = /<Button data-id="([^"]+)" label="Book a demo" variant="outline"/.exec(jsx)!;
    const edited = jsx.replace(button[0], `<Button data-id="${button[1]}" label="Book a demo" variant="secondary"`);
    const draft = proposeFromJsx(project, frame.id, edited);
    expect(draft.ops).toEqual([expect.objectContaining({ op: "setProps", nodeId: button[1], props: { variant: "secondary" } })]);
    expect(draft.summary).toEqual(["The Button “Book a demo”: variant = secondary"]);
    // a link to another screen by its route
    const link = /<NavLink data-id="([^"]+)" label="Pricing"/.exec(jsx);
    expect(link).toBeTruthy();
  });

  it("reads lists of data and keeps unknown things as warnings", () => {
    const { project, frame } = home();
    const jsx = designJsx(frame, project);
    expect(jsx).toContain(".map((item) => (");
    // one more testimonial
    const edited = jsx.replace(/\{\[\n(\s+)(\{[^\n]+\}),\n/, (m, pad: string, first: string) => `${m}${pad}${first.replace(/"name":"[^"]+"/, '"name":"Ada Lovelace"')},\n`);
    const draft = proposeFromJsx(project, frame.id, `${edited.trimEnd()}\n`);
    expect(draft.ops).toEqual([expect.objectContaining({ op: "setAttrs", attrs: { items: expect.arrayContaining([expect.objectContaining({ name: "Ada Lovelace" })]) } })]);

    const unknown = proposeFromJsx(project, frame.id, jsx.replace("</h1>", "</h1>\n<Carousel slides={3} />\n<svg></svg>"));
    expect(unknown.warnings).toEqual(["<Carousel> is not a component of this project: read as a plain element.", 'An <svg> was left out: use <Icon name="…" /> for icons.']);
    expect(() => readDesignJsx("no jsx here", frame, project)).toThrow(DesignJsxError);
  });

  it("warns about text a proposal makes hard to read, also inside a component's variant", () => {
    const { project, frame } = home();
    const jsx = designJsx(frame, project);
    expect(jsx).toContain('label="Start for free" variant="secondary"');
    expect(proposeFromJsx(project, frame.id, jsx.replace('label="Start for free" variant="secondary"', 'label="Start for free" variant="outline"')).warnings).toEqual([]);
    // a ghost button's dark text on the primary-colored band
    const ghost = proposeFromJsx(project, frame.id, jsx.replace('label="Start for free" variant="secondary"', 'label="Start for free" variant="ghost"'));
    expect(ghost.warnings).toEqual([expect.stringMatching(/^Hard to read: .*“Start for free” is hard to read here/)]);
  });

  it("reads a list over plain names, and icons named by the list's data", () => {
    const { project, frame } = home();
    const jsx = designJsx(frame, project);
    const logos = `</h1>\n<div className="flex gap-8" data-list="logos">{["Acme", "Globex", "Initech"].map((name) => (<span key={name} className="text-sm">{name}</span>))}</div>`;
    const draft = proposeFromJsx(project, frame.id, jsx.replace("</h1>", logos));
    expect(draft.warnings).toEqual([]);
    const list = [...JSON.stringify(draft.root).matchAll(/"items":(\[[^\]]*\])/g)].map((m) => m[1]).find((i) => i!.includes("Acme"));
    expect(JSON.parse(list!)).toEqual([{ value: "Acme" }, { value: "Globex" }, { value: "Initech" }]);
    // written back as data of objects
    expect(designJsx({ ...frame, current: draft.root }, project)).toContain("{item.value}");

    // icons named by the data: bound to the key, the names as AppShape writes them
    const icons = jsx.replace("</h1>", `</h1>\n<div className="flex gap-8">{[{ icon: "Zap", title: "Fast" }, { icon: "ShieldCheck", title: "Safe" }].map((item) => (<div className="flex"><Icon name={item.icon} /><span>{item.title}</span></div>))}</div>`);
    const read = proposeFromJsx(project, frame.id, icons);
    expect(read.warnings).toEqual([]);
    const tree = JSON.stringify(read.root);
    expect(tree).toContain('"items":[{"icon":"zap","title":"Fast"},{"icon":"shield-check","title":"Safe"}]');
    expect(tree).toContain('"icon":"zap","bind":{"icon":"icon"}');
    expect(designJsx({ ...frame, current: read.root }, project)).toMatch(/<Icon [^>]*name={item.icon}/);
  });
});
