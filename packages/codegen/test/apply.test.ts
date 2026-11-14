import ts from "typescript";
import { fileURLToPath } from "node:url";
import { defaultTokens } from "@appshape/dialect-tailwind";
import { DEFAULT_REDACTION, type DesignNode, type Frame, IR_VERSION, type Project, type Tokens } from "@appshape/ir";
import { DEFAULT_THEME, starterComponentFrame, withTheme } from "@appshape/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { renderSpecMarkdown } from "@appshape/protocol";
import { type ApplyPlan, type AppFiles, appFiles, type CodeState, detectApp, handoffChangeset, handoffSpec, mergeImports, planApply } from "../src";

let defaults: Tokens;
beforeAll(async () => {
  defaults = await defaultTokens();
});

const text = (id: string, value: string, extra: Partial<DesignNode> = {}) => ({ id, type: "text", origin: "added", text: value, ...extra }) as DesignNode;

function design(): Project {
  const button: Frame = {
    id: "f_button", name: "Button", kind: "component", platform: "web", target: { adapter: "react-vite" }, viewports: [{ id: "component", width: 120 }],
    component: { props: [{ name: "label", type: "string", bindings: [{ nodeId: "b_label", field: "text" }] }] },
    current: { id: "b_root", type: "button", origin: "added", layout: { mode: "flex", padding: { top: "$spacing.2", bottom: "$spacing.2", left: "$spacing.4", right: "$spacing.4" } }, style: { background: "$color.indigo-600", color: "$color.white" }, children: [text("b_label", "Go")] },
  };
  const screen = (id: string, name: string, route: string, children: DesignNode[]): Frame => ({
    id, name, kind: "new", platform: "web", target: { adapter: "react-vite", route }, viewports: [{ id: "desktop", width: 1280 }],
    current: { id: `${id}_root`, type: "box", origin: "added", layout: { mode: "flex", direction: "column", gap: "$spacing.4", padding: { top: "$spacing.6", right: "$spacing.6", bottom: "$spacing.6", left: "$spacing.6" } }, children },
  });
  const home = screen("f_home", "Home", "/", [
    text("h_title", "Welcome", { semantic: { role: "heading", level: 1 }, style: { fontSize: "$fontSize.4xl", fontWeight: "$fontWeight.bold" } }),
    text("h_body", "Hello there.", { annotations: [{ id: "a_data", kind: "data", text: "Greeting comes from the user profile." }] }),
    { id: "h_cta", type: "instance", origin: "added", componentId: "f_button", props: { label: "Start" }, children: [] },
  ]);
  const about = screen("f_about", "About", "/about", [text("a_title", "About us", { semantic: { role: "heading", level: 1 } })]);
  return { irVersion: IR_VERSION, name: "Test", adapters: [], tokens: defaults, components: [], board: { items: [] }, frames: [home, about, button], changesets: [], redaction: DEFAULT_REDACTION };
}

/** In-memory app folder. */
class Memory implements AppFiles {
  constructor(readonly files = new Map<string, string>()) {}
  async read(path: string) {
    return this.files.get(path);
  }
  apply(plan: ApplyPlan) {
    for (const change of plan.changes) {
      if (change.after === undefined) this.files.delete(change.path);
      else this.files.set(change.path, change.after);
    }
  }
}

const layout = { stack: "vite-react-router" as const, srcDir: true, tailwind: 4 as const };
const edit = (project: Project, frameId: string, nodeId: string, change: (node: DesignNode) => void) => {
  const frame = project.frames.find((f) => f.id === frameId)!;
  const find = (n: DesignNode): DesignNode | undefined => (n.id === nodeId ? n : "children" in n ? n.children.map(find).find(Boolean) : undefined);
  change(find(frame.current)!);
};

async function firstApply() {
  const project = design();
  const app = new Memory();
  const plan = await planApply({ project, layout, defaults, state: undefined, files: app, scaffold: { appName: "test" }, now: "2026-10-06T10:00:00.000Z" });
  app.apply(plan);
  return { project, app, plan, state: plan.state };
}

async function reapply(project: Project, app: Memory, state: CodeState) {
  const plan = await planApply({ project, layout, defaults, state, files: app, now: "2026-10-06T11:00:00.000Z" });
  app.apply(plan);
  return plan;
}

describe("first apply", () => {
  it("scaffolds the app and generates pages, components, routes and styles", async () => {
    const { app, plan } = await firstApply();
    expect([...app.files.keys()].sort()).toEqual([
      ".gitignore", "index.html", "package.json", "src/App.tsx", "src/components/Button.tsx", "src/index.css", "src/lib/utils.ts", "src/main.tsx", "src/pages/About.tsx", "src/pages/Home.tsx", "tsconfig.json", "vite.config.ts",
    ]);
    expect(plan.install).toBe(true);
    expect(plan.tasks.map((t) => [t.kind, t.summary, t.file, t.line])).toEqual([["note", "Data: Greeting comes from the user profile.", "src/pages/Home.tsx", 7]]);
    // where the note is, in words and code (node ids aren't in the code)
    expect(plan.tasks[0]!.details).toMatch(/^On the text “Hello there\.” \(line 7\):\n\n```tsx\n.*Hello there\..*\n```$/s);
    expect(app.files.get("src/pages/Home.tsx")).toContain(`<Button label="Start" />`);
  });

  it("hands each task off once", async () => {
    const { project, app, state } = await firstApply();
    const again = await reapply(project, app, state);
    expect(again.changes).toEqual([]);
    expect(again.tasks).toEqual([]);
  });

  it("hands a drawing kept as a note to the agent, with its marks and what they touch", async () => {
    const { project, app, state } = await firstApply();
    const at = "2026-10-06T10:30:00.000Z";
    const request = {
      id: "rq_1", frameId: "f_home", viewportId: "desktop", message: "Make the greeting a card", status: "draft" as const, route: "note" as const, createdAt: at, updatedAt: at,
      shapes: [{ id: "s1", kind: "ellipse" as const, color: "change", x: 20, y: 60, w: 300, h: 40, targets: ["h_body"] }],
    };
    const plan = await reapply({ ...project, requests: [request] }, app, state);
    expect(plan.changes).toEqual([]);
    expect(plan.tasks).toEqual([
      expect.objectContaining({ kind: "note", summary: 'Change "Home" as drawn (at 1280px): Make the greeting a card', file: "src/pages/Home.tsx", frameId: "f_home" }),
    ]);
    expect(plan.tasks[0]!.details).toContain('blue (change) ellipse at (20, 60), 300×40 — touches text "Hello there." (`h_body`)');

    const changeset = handoffChangeset([{ ...plan.tasks[0]!, image: "specs/cs_1-rq_1.png" }], { id: "cs_1", now: at });
    const markdown = renderSpecMarkdown(handoffSpec(changeset, project, layout, defaults, at));
    expect(markdown).toContain("- **Drawing:** `.appshape/specs/cs_1-rq_1.png`");
    expect(markdown).toContain("Legend: red = remove, green = add, blue = change or move");
    // what the drawing touches isn't held to the design by verify, and the agent is told so
    expect(changeset.tasks?.[0]?.drawn).toEqual(["h_body"]);
    expect(markdown).toContain("doesn't hold the elements the drawing touches to it");
    // a drawing that isn't kept as a note isn't handed off
    expect((await reapply({ ...project, requests: [{ ...request, id: "rq_2", route: undefined } as never] }, app, plan.state)).tasks).toEqual([]);
  });
});

describe("design changes", () => {
  it("regenerate files nobody edited", async () => {
    const { project, app, state } = await firstApply();
    edit(project, "f_home", "h_title", (n) => ((n as Extract<DesignNode, { type: "text" }>).text = "Welcome back"));
    edit(project, "f_button", "b_root", (n) => (n.style = { ...n.style, background: "$color.emerald-600" }));
    const plan = await reapply(project, app, state);
    expect(plan.changes.map((c) => [c.path, c.summary])).toEqual([
      ["src/pages/Home.tsx", "Update page Home"],
      ["src/components/Button.tsx", "Update component Button"],
    ]);
    expect(plan.tasks).toEqual([]);
    expect(app.files.get("src/pages/Home.tsx")).toContain(">Welcome back</h1>");
    expect(app.files.get("src/components/Button.tsx")).toContain("bg-emerald-600");
  });

  it("keep hand-written code and regenerate only untouched elements", async () => {
    const { project, app, state } = await firstApply();
    // Someone adds logic and edits the body text's element by hand.
    const home = app.files.get("src/pages/Home.tsx")!;
    const edited = home
      .replace("export function Home() {\n", "export function Home() {\n  const user = useUser();\n")
      .replace('import { Button } from "../components/Button";', 'import { Button } from "../components/Button";\nimport { useUser } from "../user";')
      .replace("<p>Hello there.</p>", "<p>Hello {user.name}.</p>");
    app.files.set("src/pages/Home.tsx", edited);

    edit(project, "f_home", "h_title", (n) => ((n as Extract<DesignNode, { type: "text" }>).text = "Welcome back"));
    edit(project, "f_home", "h_body", (n) => (n.style = { color: "$color.gray-600" }));
    edit(project, "f_home", "h_cta", (n) => ((n as Extract<DesignNode, { type: "instance" }>).props = { label: "Start now" }));
    const plan = await reapply(project, app, state);

    const result = app.files.get("src/pages/Home.tsx")!;
    expect(plan.changes.map((c) => c.summary)).toEqual(["Update page Home (your edits kept)"]);
    expect(result).toContain("const user = useUser();");
    expect(result).toContain('import { useUser } from "../user";');
    expect(result).toContain(">Welcome back</h1>");
    expect(result).toContain('<Button label="Start now" />');
    // The hand-edited element got only its tag updated (classes); its content stays.
    expect(result).toContain('<p className="text-gray-600">Hello {user.name}.</p>');
    expect(plan.tasks).toEqual([]);

    // A content change inside the hand-edited element can't be applied safely: agent task.
    edit(project, "f_home", "h_body", (n) => ((n as Extract<DesignNode, { type: "text" }>).text = "Hi!"));
    const next = await reapply(project, app, plan.state);
    expect(next.changes).toEqual([]);
    expect(next.tasks.map((t) => [t.kind, t.file, t.line, t.code])).toEqual([["element", "src/pages/Home.tsx", 9, '<p className="text-gray-600">Hi!</p>']]);
  });

  it("add pages, register routes in an edited App.tsx, update the theme, delete pages", async () => {
    const { project, app, state } = await firstApply();
    app.files.set("src/App.tsx", app.files.get("src/App.tsx")!.replace("<Routes>", "<Routes>\n      {/* my routes */}"));
    app.files.set("src/index.css", `${app.files.get("src/index.css")}\n.mine { color: red; }\n`);
    project.frames.push({ ...structuredClone(project.frames[1]!), id: "f_contact", name: "Contact", target: { adapter: "react-vite", route: "/contact" }, current: { id: "c_root", type: "box", origin: "added", children: [text("c_t", "Contact")] } });
    project.tokens = { ...project.tokens, groups: { ...project.tokens.groups, color: { ...project.tokens.groups.color, brand: "#0f766e" } } };
    const plan = await reapply(project, app, state);
    expect(plan.changes.map((c) => [c.path, c.summary])).toEqual([
      ["src/pages/Contact.tsx", "New page Contact"],
      ["src/App.tsx", "Register new pages"],
      ["src/index.css", "Design system"],
    ]);
    const routes = app.files.get("src/App.tsx")!;
    expect(routes).toContain("{/* my routes */}");
    expect(routes).toContain('<Route path="/contact" element={<Contact />} />');
    expect(routes).toContain('import { Contact } from "./pages/Contact";');
    expect(app.files.get("src/index.css")).toContain("--color-brand: #0f766e;");
    expect(app.files.get("src/index.css")).toContain(".mine { color: red; }");

    project.frames = project.frames.filter((f) => f.id !== "f_about");
    const removal = await reapply(project, app, plan.state);
    expect(removal.changes.map((c) => [c.path, c.after === undefined])).toEqual([["src/pages/About.tsx", true]]);
  });
});

describe("images and fonts", () => {
  const font = {
    family: "Fraunces", cssFamily: "Fraunces Variable", slug: "fraunces", category: "Serif", variable: true, weights: [400, 700], italic: false,
    package: "@fontsource-variable/fraunces", files: ["files/fraunces-latin-wght-normal.woff2"], installedAt: "2026-10-08T00:00:00.000Z",
    css: "@font-face {\n  font-family: 'Fraunces Variable';\n  src: url(./files/fraunces-latin-wght-normal.woff2) format('woff2-variations');\n}",
  };
  const unused = { ...font, family: "Lato", cssFamily: "Lato", slug: "lato", files: ["files/lato-latin-400-normal.woff2"], css: "@font-face { font-family: 'Lato'; src: url(./files/lato-latin-400-normal.woff2) format('woff2'); }" };

  it("copies the design's images and fonts into the app, and the font rules go with the font", async () => {
    const { project, app, state } = await firstApply();
    project.tokens = { ...project.tokens, groups: { ...project.tokens.groups, fontFamily: { ...project.tokens.groups.fontFamily, display: '"Fraunces Variable", ui-serif, serif' } } };
    edit(project, "f_home", "h_title", (n) => (n.style = { ...n.style, fontFamily: "$fontFamily.display" }));
    edit(project, "f_home", "f_home_root", (n) => (n.style = { backgroundImage: { src: "asset:uploads/hero-1a2b.jpg", size: "cover" } }));
    const plan = await planApply({ project, layout, defaults, state, files: app, now: "2026-10-08T10:00:00.000Z", fonts: [font, unused] });
    expect(plan.changes.filter((c) => c.copyFrom).map((c) => [c.path, c.copyFrom])).toEqual([
      ["public/fonts/fraunces/fraunces-latin-wght-normal.woff2", "assets/fonts/fraunces/files/fraunces-latin-wght-normal.woff2"],
      ["public/images/hero-1a2b.jpg", "assets/uploads/hero-1a2b.jpg"],
    ]);
    app.apply(plan);
    const css = app.files.get("src/index.css")!;
    expect(css).toContain("--font-display: \"Fraunces Variable\", ui-serif, serif;");
    expect(css).toContain("src: url(/fonts/fraunces/fraunces-latin-wght-normal.woff2) format('woff2-variations');");
    expect(css).not.toContain("Lato");
    expect(app.files.get("src/pages/Home.tsx")).toContain("bg-[url('/images/hero-1a2b.jpg')] bg-cover");

    // without the font, its rules leave the block again (and the block stays one block)
    delete project.tokens.groups.fontFamily!.display;
    edit(project, "f_home", "h_title", (n) => (n.style = { ...n.style, fontFamily: undefined }));
    const again = await planApply({ project, layout, defaults, state: plan.state, files: app, now: "2026-10-08T11:00:00.000Z", fonts: [font, unused] });
    app.apply(again);
    const after = app.files.get("src/index.css")!;
    expect(after).not.toContain("appshape:fonts");
    expect(after.split("appshape:theme").length).toBe(2);
  });
});

describe("themes and starter components", () => {
  it("writes the dark values into the block and generates variants with cva", async () => {
    const project = design();
    project.tokens = withTheme(defaults);
    const button = starterComponentFrame("button", { adapter: "react-vite", name: "Action" });
    const accordion = starterComponentFrame("accordion", { adapter: "react-vite" });
    project.frames.push(button, accordion);
    project.frames[0]!.current = { ...project.frames[0]!.current, children: [...(project.frames[0]!.current as Extract<DesignNode, { type: "box" }>).children,
      { id: "h_ghost", type: "instance", origin: "added", componentId: button.id, props: { label: "Later", variant: "ghost", size: "lg" }, children: [] },
      { id: "h_faq", type: "instance", origin: "added", componentId: accordion.id, props: { open: true }, children: [] }] } as DesignNode;
    const app = new Memory();
    const plan = await planApply({ project, layout, defaults, state: undefined, files: app, scaffold: { appName: "test" }, now: "2026-10-11T10:00:00.000Z" });
    app.apply(plan);

    const css = app.files.get("src/index.css")!;
    expect(css).toContain("--color-primary: #4f46e5;");
    expect(css).toMatch(/\/\* appshape:dark[^]*:root \{\n {2}--color-accent: [^;]+;[^]*@variant dark \{\n {4}--color-accent: [^;]+;[^]*\/\* appshape:dark end \*\//);
    expect(css).toContain("color: var(--color-foreground);");
    expect(css).toContain("background-color: var(--color-background);");

    const code = app.files.get("src/components/Action.tsx")!;
    expect(code).toContain('import { cva } from "class-variance-authority";');
    expect(code).toContain('ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground"');
    expect(code).toContain('variant?: "primary" | "secondary" | "outline" | "ghost";');
    expect(code).toMatch(/hover:bg-primary\/90/);
    expect(app.files.get("src/pages/Home.tsx")).toContain('<Action label="Later" variant="ghost" size="lg" />');
    expect(app.files.get("src/components/AccordionItem.tsx")).toMatch(/const answerVariants = cva\("pb-4 text-muted-foreground text-sm hidden", \{\n {2}variants: \{\n {4}open: \{\n {6}true: "block",/);

    // a changed theme replaces the whole block, dark part included
    project.tokens = withTheme(defaults, { ...DEFAULT_THEME, brand: "#0d9488" });
    const again = await planApply({ project, layout, defaults, state: plan.state, files: app, now: "2026-10-11T11:00:00.000Z" });
    app.apply(again);
    const after = app.files.get("src/index.css")!;
    expect(after).toContain("--color-brand: #0d9488;");
    expect(after.split("appshape:dark (").length).toBe(2);
  });
});

describe("existing apps", () => {
  const fixture = fileURLToPath(new URL("../../../fixtures/vite-react-router-tw4/", import.meta.url));

  it("detects the stack and adds a new page next to hand-written code", async () => {
    const files = appFiles(fixture);
    const detection = await detectApp(files);
    expect(detection).toEqual({ kind: "app", layout: { stack: "vite-react-router", srcDir: true, tailwind: 4, cssPath: "src/index.css" } });
    const project = design();
    project.frames = project.frames.filter((f) => f.id !== "f_home"); // only About (+ Button)
    const plan = await planApply({ project, layout: (detection as { layout: typeof layout }).layout, defaults, state: undefined, files });
    expect(plan.changes.map((c) => [c.path, c.summary])).toEqual([
      ["src/pages/About.tsx", "New page About"],
      ["src/components/Button.tsx", "New component Button"],
      ["src/App.tsx", "Register new pages"],
      ["src/lib/utils.ts", "cn() helper for components"],
      ["package.json", "Add class-variance-authority, clsx, lucide-react, tailwind-merge"],
    ]);
    const routes = plan.changes.find((c) => c.path === "src/App.tsx")!.after!;
    expect(routes).toContain("<Navbar />");
    expect(routes).toContain('        <Route path="/about" element={<About />} />\n      </Routes>');
    expect(plan.install).toBe(true);
  });
});

describe("entrances", () => {
  /** Home with a heading that fades in, a staggered list of plain boxes and a link to a screen that slides in. */
  const animated = () => {
    const project = design();
    const home = project.frames.find((f) => f.id === "f_home")!.current as Extract<DesignNode, { type: "box" }>;
    home.children[0]!.style = { ...home.children[0]!.style, motion: { preset: "fade", trigger: "load" } };
    home.children.push(
      { id: "h_steps", type: "box", origin: "added", layout: { mode: "flex", gap: "$spacing.4" }, style: { motion: { preset: "scale", trigger: "scroll", stagger: 100, delay: 200 } }, children: [text("s1", "One"), text("s2", "Two")] },
      { id: "h_more", type: "link", origin: "added", targetFrameId: "f_about", style: { motion: { preset: "slide-left", trigger: "scroll-repeat" } }, children: [text("m1", "More")] },
    );
    return project;
  };
  const generate = async (project: Project, stack: "vite-react-router" | "next-app", motion?: "motion") => {
    const plan = await planApply({ project, layout: { stack, srcDir: stack.startsWith("vite"), tailwind: 4, ...(motion && { motion }) }, defaults, state: undefined, files: new Memory(), scaffold: { appName: "test" }, now: "2026-10-06T10:00:00.000Z" });
    const file = (pattern: RegExp) => plan.changes.find((c) => pattern.test(c.path))?.after;
    return { plan, page: file(/(pages\/Home|app\/page)\.tsx$/)!, css: file(/\.css$/)!, reveal: file(/ScrollReveal\.tsx$/) };
  };

  it("CSS apps: animation classes, keyframes in the CSS and ScrollReveal on pages with scroll-ins", async () => {
    const { page, css, reveal } = await generate(animated(), "vite-react-router");
    expect(page).toContain('import { ScrollReveal } from "../components/ScrollReveal";');
    expect(page).toMatch(/<>\n\s+<ScrollReveal \/>\n\s+<div className="flex flex-col/);
    expect(page).toContain("motion-safe:animate-[aps-fade_600ms_ease-out_both]");
    expect(page).toContain("aps-reveal aps-stagger [--aps-stagger:100ms] [--aps-delay:200ms] *:motion-safe:animate-[aps-scale_600ms_ease-out_both]");
    expect(page).toContain("aps-reveal-repeat motion-safe:animate-[aps-slide-left_600ms_ease-out_both]");
    expect(css).toContain("@keyframes aps-slide-left { from { opacity: 0; translate: 24px 0; } }");
    expect(css).toContain(":root[data-reveal] :is(.aps-reveal, .aps-reveal-repeat):not(.aps-stagger, [data-revealed])");
    expect(reveal).toContain("export function ScrollReveal()");
  });

  it("Motion apps: Motion code, with CSS kept for router links; React Server Components use the client entry", async () => {
    const vite = await generate(animated(), "vite-react-router", "motion");
    expect(vite.page).toContain('import { type Variants, MotionConfig, motion } from "motion/react";');
    expect(vite.page).toContain('<MotionConfig reducedMotion="user">');
    expect(vite.page).toContain('<motion.h1 className="text-4xl font-bold" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: "easeOut" }}>Welcome</motion.h1>');
    expect(vite.page).toContain('<motion.div className="flex gap-4" initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}>');
    expect(vite.page).toContain('<motion.p variants={scaleIn} transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}>One</motion.p>');
    expect(vite.page).toContain('<motion.p variants={scaleIn} transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}>Two</motion.p>');
    expect(vite.page).toContain("const scaleIn = {\n  hidden: { opacity: 0, scale: 0.92 },\n  show: { opacity: 1, scale: 1 },\n} satisfies Variants;");
    // a router link can't be a Motion element: its classes play it, so the page gets ScrollReveal and the CSS its keyframes
    expect(vite.page).toContain("aps-reveal-repeat motion-safe:animate-[aps-slide-left_600ms_ease-out_both]");
    expect(vite.page).toContain("<ScrollReveal />");
    expect(vite.css).toContain("@keyframes aps-slide-left");
    const next = await generate(animated(), "next-app", "motion");
    expect(next.page).toContain('import * as motion from "motion/react-client";');
    expect(next.page).toContain('import { type Variants, MotionConfig } from "motion/react";');
  });

  it("new apps with Motion depend on it; existing apps keep their own ScrollReveal", async () => {
    const { plan } = await generate(animated(), "vite-react-router", "motion");
    expect(JSON.parse(plan.changes.find((c) => c.path === "package.json")!.after!).dependencies.motion).toBe("^14.2.0");
    const project = animated();
    const mine = new Memory(new Map([["src/components/ScrollReveal.tsx", "export function ScrollReveal() { return null; }\n"]]));
    const again = await planApply({ project, layout, defaults, state: undefined, files: mine });
    expect(again.changes.map((c) => c.path)).not.toContain("src/components/ScrollReveal.tsx");
    expect(again.tasks.find((t) => t.file === "src/components/ScrollReveal.tsx")?.kind).toBe("setup");
  });
});

describe("interactions", () => {
  /** Home: a menu button opening an overlay, a link scrolling to a section, a list of data; a component switching its own property. */
  const interactive = () => {
    const project = design();
    const home = project.frames.find((f) => f.id === "f_home")!.current as Extract<DesignNode, { type: "box" }>;
    const menu: Frame = { id: "f_menu", name: "Mobile menu", kind: "new", platform: "web", overlay: true, target: { adapter: "react-vite" }, viewports: [{ id: "phone", width: 320 }], current: { id: "m_root", type: "box", origin: "added", layout: { mode: "flex", direction: "column" }, children: [{ id: "m_close", type: "box", origin: "added", name: "Close", interaction: { type: "close" }, children: [{ id: "m_x", type: "icon", origin: "added", icon: "x" }] }] } };
    home.children.push(
      { id: "h_menu", type: "box", origin: "added", name: "Menu", interaction: { type: "open", frameId: "f_menu", as: "drawer", side: "right" }, children: [{ id: "h_icon", type: "icon", origin: "added", icon: "menu" }] },
      text("h_jump", "See the plans", { interaction: { type: "scroll", nodeId: "h_plans" } }),
      { id: "h_plans", type: "list", origin: "added", name: "Plans", dataName: "plans", items: [{ name: "Free", price: "$0" }, { name: "Team", price: "$29" }], layout: { mode: "flex", gap: "$spacing.4" }, children: [{ id: "p_card", type: "box", origin: "added", children: [text("p_name", "Free", { bind: { text: "name" } }), text("p_price", "$0", { bind: { text: "price" } })] }] },
    );
    const toggle: Frame = {
      id: "f_toggle", name: "Toggle", kind: "component", platform: "web", target: { adapter: "react-vite" }, viewports: [{ id: "component", width: 200 }],
      component: { props: [{ name: "on", type: "boolean", default: false }] },
      current: { id: "t_root", type: "box", origin: "added", children: [{ id: "t_switch", type: "box", origin: "added", name: "Switch", interaction: { type: "variant", prop: "on", value: "toggle" }, children: [text("t_label", "Notifications")] }] },
    };
    project.frames.push(menu, toggle);
    return project;
  };
  const files = async (stack: "vite-react-router" | "next-app") => {
    const plan = await planApply({ project: interactive(), layout: { stack, srcDir: stack.startsWith("vite"), tailwind: 4 }, defaults, state: undefined, files: new Memory(), scaffold: { appName: "test" }, now: "2026-10-06T10:00:00.000Z" });
    return { plan, file: (pattern: RegExp) => plan.changes.find((c) => pattern.test(c.path))?.after ?? "" };
  };

  it("overlays are popovers, scrolling is a link to an id, lists of data map over a data file, switches are state", async () => {
    const { plan, file } = await files("vite-react-router");
    const page = file(/pages\/Home\.tsx$/);
    expect(page).toContain(`<button className="text-left" aria-label="Menu" type="button" popoverTarget="mobile-menu" aria-haspopup="dialog">`);
    expect(page).toContain(`<div id="mobile-menu" popover="auto" role="dialog" aria-label="Mobile menu" className="aps-overlay aps-drawer w-[320px]">\n        <MobileMenu />`);
    expect(page).toContain(`<a href="#plans">See the plans</a>`);
    expect(page).toContain(`<div id="plans" className="flex gap-4">\n        {plans.map((item) => (\n          <div key={item.name}>\n            <p>{item.name}</p>\n            <p>{item.price}</p>`);
    expect(file(/src\/data\/plans\.ts$/)).toContain(`export const plans = [\n  { name: "Free", price: "$0" },\n  { name: "Team", price: "$29" },\n];`);
    // the overlay is a component; its close button hides its popover
    expect(file(/components\/MobileMenu\.tsx$/)).toContain(`aria-label="Close" type="button" popoverTarget="mobile-menu" popoverTargetAction="hide"`);
    // no page for the overlay
    expect(plan.changes.map((c) => c.path)).not.toContain("src/pages/MobileMenu.tsx");
    const toggle = file(/components\/Toggle\.tsx$/);
    expect(toggle.startsWith(`"use client";\n`)).toBe(true);
    expect(toggle).toContain(`export function Toggle({ on: initialOn = false, className }: ToggleProps) {\n  const [on, setOn] = useState(initialOn);`);
    expect(toggle).toContain(`aria-expanded={on} onClick={() => setOn((on) => !on)}`);
    expect(file(/\.css$/)).toContain(".aps-drawer { inset: 0 0 0 auto;");
  });

  it("icons named by a list's data: a map in the data file, one component picked per item", async () => {
    const project = design();
    const home = project.frames.find((f) => f.id === "f_home")!.current as Extract<DesignNode, { type: "box" }>;
    home.children.push({
      id: "h_perks", type: "list", origin: "added", name: "Perks", dataName: "perks", items: [{ title: "Fast", icon: "zap" }, { title: "Safe", icon: "shield-check" }],
      children: [{ id: "k_card", type: "box", origin: "added", children: [{ id: "k_icon", type: "icon", origin: "added", icon: "zap", bind: { icon: "icon" } }, text("k_title", "Fast", { bind: { text: "title" } })] }],
    });
    const plan = await planApply({ project, layout: { stack: "vite-react-router", srcDir: true, tailwind: 4 }, defaults, state: undefined, files: new Memory(), scaffold: { appName: "test" }, now: "2026-10-06T10:00:00.000Z" });
    const file = (pattern: RegExp) => plan.changes.find((c) => pattern.test(c.path))?.after ?? "";
    const page = file(/pages\/Home\.tsx$/);
    expect(page).toContain(`import { perks, perksIcons } from "../data/perks";`);
    expect(page).toMatch(/\{perks\.map\(\(item\) => \{\n\s+const Icon = perksIcons\[item\.icon as keyof typeof perksIcons\] \?\? perksIcons\["zap"\];\n\s+return \(\n\s+<div key=\{item\.\w+\}>\n\s+<Icon className="size-\[1em\]" aria-hidden \/>/);
    expect(page).not.toContain("import { Zap");
    const data = file(/src\/data\/perks\.ts$/);
    expect(data).toContain(`import { ShieldCheck, Zap } from "lucide-react";`);
    expect(data).toContain(`export const perksIcons = {\n  "zap": Zap,\n  "shield-check": ShieldCheck,\n};`);
    // the code is valid TypeScript
    for (const code of [page, data]) {
      const source = ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      expect((source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    }
  });

  it("Next.js keeps data next to the app folder", async () => {
    const { file } = await files("next-app");
    expect(file(/^data\/plans\.ts$/)).toContain("export const plans");
    expect(file(/app\/page\.tsx$/)).toContain(`import { plans } from "../data/plans";`);
  });
});

describe("mergeImports", () => {
  it("adds names to existing imports and appends new ones", () => {
    const code = `import { ArrowRight } from "lucide-react";\n\nexport const x = 1;\n`;
    expect(mergeImports(code, [`import { ArrowRight, Star } from "lucide-react";`, `import { Button } from "./Button";`])).toBe(
      `import { ArrowRight, Star } from "lucide-react";\nimport { Button } from "./Button";\n\nexport const x = 1;\n`,
    );
  });

  it("writes page settings for every stack: title, description, share image, site icon", async () => {
    const project = design();
    const home = project.frames.find((f) => f.id === "f_home")!;
    home.meta = { title: "Acme — Ship faster", description: "Plans for teams of every size.", image: "asset:uploads/share-1a2b.png" };
    project.settings = { site: { favicon: "asset:uploads/icon-3c4d.svg" } };
    // a sentence with a bold word and a link
    (home.current as Extract<DesignNode, { type: "box" }>).children.push(text("h_rich", "Read the docs today.", { spans: [{ text: "Read the " }, { text: "docs", href: "/docs", style: { fontWeight: "$fontWeight.bold" } }, { text: " today." }] }));
    const page = async (stack: "vite-react-router" | "vite-tanstack" | "next-app" | "next-pages") => {
      const plan = await planApply({ project, layout: { stack, srcDir: stack.startsWith("vite"), tailwind: 4 }, defaults, state: undefined, files: new Memory(), scaffold: { appName: "test" }, now: "2026-10-06T10:00:00.000Z" });
      const file = plan.changes.find((c) => c.after?.includes("Welcome") && /(pages|routes|app)\//.test(c.path))!;
      return { code: file.after!, paths: plan.changes.map((c) => c.path) };
    };
    const vite = await page("vite-react-router");
    expect(vite.code).toContain("<title>Acme — Ship faster</title>");
    expect(vite.code).toContain('<meta name="description" content="Plans for teams of every size." />');
    expect(vite.code).toContain('<meta property="og:image" content="/images/share-1a2b.png" />');
    expect(vite.code).toContain('<link rel="icon" href="/images/icon-3c4d.svg" />');
    expect(vite.code).toContain('{"Read the "}<a href="/docs" className="font-bold">docs</a>{" today."}');
    expect(vite.paths).toEqual(expect.arrayContaining(["public/images/share-1a2b.png", "public/images/icon-3c4d.svg"]));
    expect((await page("vite-tanstack")).code).toContain("<title>Acme — Ship faster</title>");
    const pages = (await page("next-pages")).code;
    expect(pages).toContain('import Head from "next/head";');
    expect(pages).toMatch(/<Head>\n\s+<title>Acme — Ship faster<\/title>/);
    const app = (await page("next-app")).code;
    expect(app).toContain('import type { Metadata } from "next";');
    expect(app).toContain('export const metadata: Metadata = {\n  title: "Acme — Ship faster",\n  description: "Plans for teams of every size.",\n  openGraph: {');
    expect(app).toContain('icons: { icon: "/images/icon-3c4d.svg" },');
    expect(app).not.toContain("<title>");
  });
});
