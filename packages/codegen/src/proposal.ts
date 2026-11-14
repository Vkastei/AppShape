import { componentSources, type DesignNode, type DesignRequest, describeMarkup, diffTree, type DiffOptions, findNode, type Frame, frameVersion, indexTree, type Op, type Project, type Proposal, type Review, themedTokens, walk } from "@appshape/ir";
import { checkFrame } from "@appshape/kit";
import { designComponents, designJsx, readDesignJsx } from "./design-jsx";
import { breakpointWidths, largerScreenChanges } from "./responsive";

/**
 * Draw & describe: an answer (design JSX) as a proposal for a screen: the ops that turn the screen
 * into the answer, the changes in plain words, and where the answer left the design system.
 */

export interface ProposalDraft {
  ops: Op[];
  summary: string[];
  /** The elements each change is about (by index of `summary`). */
  targets: string[][];
  warnings: string[];
  /** The screen as proposed. */
  root: DesignNode;
}

/** Reads an answer for a screen and works out what it changes. Throws `DesignJsxError` for answers that can't be read. */
export interface ProposeOptions extends DiffOptions {
  /** Larger screens (this width and up, in px) must look as they did: changes there become warnings. */
  keepFrom?: number;
}

export function proposeFromJsx(project: Project, frameId: string, jsx: string, options: ProposeOptions = {}): ProposalDraft {
  const frame = project.frames.find((f) => f.id === frameId);
  if (!frame) throw new Error(`unknown screen ${frameId}`);
  const { keepFrom, ...diffOptions } = options;
  const { root, warnings } = readDesignJsx(jsx, frame, project);
  const ops = diffTree(frame.id, frame.current, root, diffOptions) as Op[];
  const changes = changeList(frame, root, ops, project);
  const larger = keepFrom === undefined ? [] : largerScreenWarnings(project, frame, root, keepFrom);
  return { ops, summary: changes.map((c) => c.text), targets: changes.map((c) => c.ids), warnings: [...warnings, ...designSystemWarnings(frame.current, root, ops), ...contrastWarnings(project, frame, root), ...larger], root };
}

/** Text the proposal makes hard to read (the design checks' contrast findings that weren't there before). */
function contrastWarnings(project: Project, frame: Frame, after: DesignNode): string[] {
  const contrast = (f: Frame) => checkFrame(f, { tokens: project.tokens, frames: project.frames.map((x) => (x.id === f.id ? f : x)) }).filter((x) => x.rule === "contrast");
  const before = new Set(contrast(frame).map((x) => x.key));
  return contrast({ ...frame, current: after })
    .filter((x) => !before.has(x.key))
    .map((x) => `Hard to read: ${x.message}`);
}

/** How a request's answers are read: for "make it work on phones", larger screens must stay as they are. */
export function proposeOptionsFor(project: Project, request: DesignRequest): ProposeOptions {
  if (request.intent !== "phones") return {};
  const frame = project.frames.find((f) => f.id === request.frameId);
  return { keepFrom: breakpointWidths(themedTokens(project.tokens, frame?.theme)).md ?? 768 };
}

/** "Make it work on phones": what also changed on larger screens, in words. */
function largerScreenWarnings(project: Project, frame: Frame, after: DesignNode, from: number): string[] {
  const ids = largerScreenChanges(frame.current, after, themedTokens(project.tokens, frame.theme), from);
  if (ids.length === 0) return [];
  const sources = componentSources(project.frames);
  const name = (id: string) => sources.get(id)?.name ?? project.components.find((c) => c.id === id)?.name;
  const described = ids.slice(0, 6).map((id) => {
    const node = findNode(frame.current, id)?.node;
    return node ? `${describeNode(node, "the", name)} (${id})` : id;
  });
  return [`Also looks different on larger screens (${from}px and up), which must stay as they are: ${described.join(", ")}${ids.length > 6 ? ` and ${ids.length - 6} more` : ""}. Keep the current values there with md: and up.`];
}

/** The job of a request with an intent, for the model or the coding agent. */
function intentJob(request: DesignRequest, frame: Frame, viewport: { width: number }): string[] {
  switch (request.intent) {
    case "phones":
      return [
        "## The job: make this screen work on phones",
        "",
        `It was designed for larger screens. Change how it looks at phone size (the ${viewport.width}px screen in the pictures) so it reads and works well there: one column where needed, sizes and spacing that fit, nothing cut off or overflowing, tap targets large enough, the navigation usable. From \`md:\` up it must stay exactly as it is now. Tailwind is mobile-first: base classes are the phone, so where you change a base class, keep its current value for larger screens with \`md:\` (or the breakpoint it had).`,
        "",
      ];
    case "review":
      return ["## The job: review this screen", "", REVIEW_GUIDE, ""];
    case "section":
      return [
        "## The job: one new section",
        "",
        `Add one new section to ${frame.name} where the drawing marks it (the green box), as the message describes. Build it like the page's other sections: the same width, spacing and type, the project's components and tokens, and real copy that fits the page. Leave the other sections as they are.`,
        "",
      ];
    default:
      return [];
  }
}

/** Several variants asked for: how they should differ. */
function variantsJob(request: DesignRequest): string[] {
  const count = request.variants ?? 1;
  if (count < 2) return [];
  return [
    `## ${count} variants`,
    "",
    `Propose ${count} variants: ${count} different good answers to the same request, each with its own idea (a different layout, emphasis or structure), not small changes of one design. Each one is made from the screen as it is now, stands on its own, and follows all the rules. Name each idea in a few words ("Two columns with the image left").`,
    "",
  ];
}

/** Findings as a model or an agent writes them (before AppShape checks them). */
export interface RawReview {
  summary?: string;
  findings: { title?: string; why?: string; fix?: string; targets?: string[]; severity?: string }[];
}

/**
 * A review to store on a request: findings with a title and a fix (others dropped), numbered,
 * clipped to the schema's lengths, the important ones first, with only targets on the screen.
 */
export function reviewFrom(frame: Frame, raw: RawReview, by: string, at = new Date().toISOString()): Review {
  const ids = new Set<string>();
  walk(frame.current, (n) => void ids.add(n.id));
  const clip = (text: string | undefined, max: number) => (text ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const findings = raw.findings
    .map((f) => ({ title: clip(f.title, 160), why: clip(f.why, 500), fix: clip(f.fix, 500), severity: f.severity === "nice" ? ("nice" as const) : ("important" as const), targets: [...new Set((f.targets ?? []).filter((t) => ids.has(t)))] }))
    .filter((f) => f.title && f.fix)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "important" ? -1 : 1))
    .slice(0, 8)
    .map((f, i) => ({ id: `f${i + 1}`, title: f.title, why: f.why || f.title, fix: f.fix, severity: f.severity, ...(f.targets.length && { targets: f.targets }) }));
  const summary = clip(raw.summary, 500);
  return { ...(summary && { summary }), findings, by, at };
}

/** The proposal to store on a request (made from the screen as it is now). */
export function proposal(frame: Frame, draft: ProposalDraft, by: string, at = new Date().toISOString()): Proposal {
  return { baseVersion: frameVersion(frame), ops: draft.ops, summary: draft.summary, targets: draft.targets, ...(draft.warnings.length && { warnings: draft.warnings }), by, at };
}

const quote = (text: string, max = 40) => {
  const t = text.trim().replace(/\s+/g, " ");
  return `“${t.length > max ? `${t.slice(0, max)}…` : t}”`;
};

/** The first text inside an element (its label). */
function firstText(node: DesignNode): string | undefined {
  let found: string | undefined;
  walk(node, (n) => {
    if (found) return "skip";
    if (n.type === "text" && n.text.trim()) found = n.text;
  });
  return found;
}

/** An element in words: "the button “Start”", "a search field". */
export function describeNode(node: DesignNode, article: "the" | "a", componentName: (id: string) => string | undefined): string {
  const a = (word: string) => (article === "the" ? `the ${word}` : `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`);
  const named = (word: string, text: string | undefined) => `${a(word)}${text ? ` ${quote(text)}` : ""}`;
  switch (node.type) {
    case "text":
      return named(node.semantic?.role === "heading" ? "heading" : "text", node.text);
    case "button":
      return named("button", node.name ?? firstText(node));
    case "link":
      return named("link", node.name ?? firstText(node));
    case "image":
      return named("image", node.name ?? node.alt);
    case "icon":
      return a(`${node.icon} icon`);
    case "input": {
      const kind = node.inputType === "text" ? "text field" : node.inputType === "textarea" ? "text area" : node.inputType === "checkbox" || node.inputType === "switch" || node.inputType === "radio" ? node.inputType : `${node.inputType} field`;
      return named(kind, node.name ?? node.label ?? node.placeholder);
    }
    case "instance": {
      // named by its label (a property), else by a text it holds
      const prop = ["label", "title", "text", "heading", "name"].map((k) => node.props[k]).find((v): v is string => typeof v === "string" && v.trim() !== "");
      const text = node.name ?? prop ?? firstText(node);
      return `${article === "the" ? "the" : "a"} ${componentName(node.componentId) ?? "component"}${text ? ` ${quote(text)}` : ""}`;
    }
    case "list":
      return named("list", node.name);
    default: {
      const role = node.semantic?.role;
      const word = role && ["nav", "header", "footer", "section", "form", "aside", "main"].includes(role) ? (role === "nav" ? "navigation" : role) : "group";
      return named(word, node.name ?? firstText(node));
    }
  }
}

/** The changes of a proposal in plain words, one per element (in the order of the screen). */
export function changeList(frame: Frame, after: DesignNode, ops: readonly Op[], project: Pick<Project, "frames" | "components">): { text: string; ids: string[] }[] {
  const sources = componentSources(project.frames);
  const componentName = (id: string) => sources.get(id)?.name ?? project.components.find((c) => c.id === id)?.name;
  const routes = new Map(project.frames.map((f) => [f.id, f.target.route ?? f.name]));
  const before = indexTree(frame.current);
  const now = indexTree(after);
  const out: { text: string; ids: string[] }[] = [];
  const push = (text: string, id: string) => {
    const same = out.find((o) => o.text === text);
    if (!same) out.push({ text, ids: [id] });
    else if (!same.ids.includes(id)) same.ids.push(id);
  };
  const inserted = new Set<string>();
  const perNode = new Map<string, Set<string>>();
  const label = (id: string, article: "the" | "a" = "the") => {
    const node = now.get(id)?.node ?? before.get(id)?.node;
    return node ? describeNode(node, article, componentName) : "an element";
  };
  const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);
  const note = (nodeId: string, what: string) => (perNode.get(nodeId) ?? perNode.set(nodeId, new Set()).get(nodeId)!).add(what);

  for (const op of ops) {
    if (!("nodeId" in op) && op.op !== "insert") continue;
    switch (op.op) {
      case "insert": {
        // a new element with everything inside it is one change
        walk(op.node, (n) => void inserted.add(n.id));
        const where = findNode(after, op.node.id)?.parent;
        push(`Added ${label(op.node.id, "a")}${where && where.id !== after.id ? ` in ${label(where.id)}` : ""}`, op.node.id);
        break;
      }
      case "delete":
        push(`Removed ${label(op.nodeId)}`, op.nodeId);
        break;
      case "move":
        if (!inserted.has(op.nodeId)) push(`Moved ${label(op.nodeId)}`, op.nodeId);
        break;
      case "retext": {
        const was = before.get(op.nodeId)?.node;
        push(was?.type === "text" ? `Changed the text ${quote(was.text)} to ${quote(op.text)}` : `Changed the text of ${label(op.nodeId)}`, op.nodeId);
        break;
      }
      case "replaceImage":
        push(`Changed the picture of ${label(op.nodeId)}`, op.nodeId);
        break;
      case "setLink":
        push(op.targetFrameId ? `${capital(label(op.nodeId))} now goes to ${routes.get(op.targetFrameId) ?? "another screen"}` : op.href ? `${capital(label(op.nodeId))} now links to ${op.href}` : `${capital(label(op.nodeId))} no longer goes anywhere`, op.nodeId);
        break;
      case "setProps":
        push(`${capital(label(op.nodeId))}: ${Object.entries(op.props).map(([k, v]) => `${k} ${v === null ? "reset" : `= ${typeof v === "string" ? v : JSON.stringify(v)}`}`).join(", ")}`, op.nodeId);
        break;
      case "swapComponent":
        push(`${capital(describeNode(before.get(op.nodeId)!.node, "the", componentName))} became ${componentName(op.componentId) ?? "another component"}`, op.nodeId);
        break;
      case "setVisibility":
        note(op.nodeId, op.hidden ? (op.when ? "hid at some sizes" : "hid") : "showed");
        break;
      case "restyle":
      case "setClasses":
        note(op.nodeId, "look");
        break;
      case "relayout":
        note(op.nodeId, "layout");
        break;
      case "setAttrs":
      case "rename":
        note(op.nodeId, op.op === "rename" ? "name" : "settings");
        break;
      default:
        break;
    }
  }
  for (const [nodeId, what] of perNode) {
    if (inserted.has(nodeId)) continue;
    const parts = [...what];
    if (parts.includes("hid")) push(`Hid ${label(nodeId)}`, nodeId);
    else if (parts.includes("showed")) push(`Showed ${label(nodeId)}`, nodeId);
    const look = parts.filter((p) => p === "look" || p === "layout" || p === "hid at some sizes");
    if (look.length) push(`${look.includes("look") && look.includes("layout") ? "Restyled" : look.includes("layout") ? "Changed the layout of" : look.includes("look") ? "Changed the look of" : "Changed the sizes that show"} ${label(nodeId)}`, nodeId);
    else if (parts.includes("settings")) push(`Changed ${label(nodeId)}`, nodeId);
    else if (parts.length === 1 && parts[0] === "name") push(`Renamed ${label(nodeId)}`, nodeId);
  }
  return out;
}

/** The changes of a proposal in plain words, one per element (in the order of the screen). */
export function summarizeChanges(frame: Frame, after: DesignNode, ops: readonly Op[], project: Pick<Project, "frames" | "components">): string[] {
  return changeList(frame, after, ops, project).map((c) => c.text);
}

const COLOR_KEYS = ["background", "color", "borderColor", "outlineColor", "fill", "stroke"] as const;

/** Values in new or restyled elements that aren't the design system's tokens (raw colors). */
export function designSystemWarnings(_before: DesignNode, after: DesignNode, ops: readonly Op[]): string[] {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.op === "insert") walk(op.node, (n) => void touched.add(n.id));
    else if ((op.op === "restyle" || op.op === "relayout") && "nodeId" in op) touched.add(op.nodeId);
  }
  const raw = new Set<string>();
  walk(after, (node) => {
    if (!touched.has(node.id)) return;
    const styles = [node.style, ...(node.overrides ?? []).map((o) => o.style)];
    for (const style of styles) {
      for (const key of COLOR_KEYS) {
        const value = (style as Record<string, unknown> | undefined)?.[key];
        if (typeof value === "string" && !value.startsWith("$") && !["transparent", "currentColor", "inherit"].includes(value)) raw.add(value);
      }
    }
  });
  return raw.size ? [`Colors that aren't tokens of the design system: ${[...raw].join(", ")}`] : [];
}

/** Ids of the elements a proposal adds or changes (to highlight them). */
export function touchedIds(ops: readonly Op[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === "insert") ids.add(op.node.id);
    else if ("nodeId" in op && op.nodeId && op.op !== "delete") ids.add(op.nodeId);
  }
  return [...ids];
}


/** Token names per group as Tailwind uses them (`bg-primary`, `p-4`), for the brief. */
function tokenOverview(project: Project, frame: Frame): string[] {
  const groups = themedTokens(project.tokens, frame.theme).groups;
  const line = (label: string, names: string[] | undefined) => (names?.length ? [`- ${label}: ${names.join(", ")}`] : []);
  const keys = (group: keyof typeof groups) => Object.keys(groups[group] ?? {});
  return [
    ...line("Colors (bg-*, text-*, border-*)", keys("color").filter((k) => !/^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-/.test(k))),
    ...line("Spacing (p-*, gap-*, m-*)", keys("spacing")),
    ...line("Radius (rounded-*)", keys("radius")),
    ...line("Font sizes (text-*)", keys("fontSize")),
    ...line("Fonts (font-*)", keys("fontFamily")),
    ...line("Shadows (shadow-*)", keys("shadow")),
    ...line("Text styles (type-*)", Object.keys(project.tokens.textStyles ?? {})),
  ];
}

/** How an answer is written: the same for every request and project (the AI's cached prefix starts here). */
/**
 * How a screen is reviewed (Ask AI → Review this page), for AppShape's AI and the coding agent:
 * the few changes a good product designer would point out first, in words a non-designer follows.
 */
export const REVIEW_GUIDE = [
  "Review it for its owner, who isn't a designer. Find the few changes that would make it clearly better, what a good product designer would point out first: a clear focus and one main action; hierarchy (what is read first); spacing and alignment; readable text with enough contrast; consistent use of the app's components and design tokens; copy that says something concrete; how it works on phones. Skip matters of taste and anything that is fine. At most 5 findings, the most important first; fewer is fine.",
  "",
  "Write for someone without design experience: plain words, no jargon. For each finding: a title (what to improve, a few words), why (one sentence: why it matters to the people using the app), fix (one sentence: what to change, concrete enough for a designer to do it), the data-ids of the elements it's about, and severity: important or nice. Also a one-sentence summary of the screen as a whole that starts with what works.",
].join("\n");

/** How the coding agent answers a review: its findings, not a design. */
const REVIEW_ANSWER = "## How to answer\n\nDon't change the screen or the code. Call `submit_review` with the summary and the findings (each with `title`, `why`, `fix`, `targets` and `severity`); or write them as JSON and run `appshape review <id> <file.json>`. The person turns findings into changes on the board.";

/** How the coding agent answers: the whole screen (AppShape's own AI answers with changes, see @appshape/ai). */
const WHOLE_SCREEN = "## How to answer\n\nAnswer with the whole screen as JSX (one outermost element), changed as asked.";
const wholeScreens = (count: number) =>
  `## How to answer\n\nAnswer with ${count} whole screens as JSX (one outermost element each), one per variant, and propose them together (propose_design with \`variants\`, each with its idea in a few words; or \`appshape propose <id> a.tsx b.tsx${count > 2 ? " c.tsx" : ""}\`).`;

export const DESIGN_RULES = [
  "## How to write the JSX",
  "",
  "Write JSX in the same form as the screen you get, changed as asked:",
  "",
  "- Keep the `data-id` of every element you keep (also when you move or restyle it); new elements have none. Leave out elements that should go.",
  "- Change only what the drawing and the message ask for. Everything else stays exactly as it is.",
  "- Style with Tailwind classes of the design system below; no arbitrary values (`[13px]`, `#hex`) when a token fits. Prefixes (`md:`, `hover:`, `dark:`) work as in Tailwind; changes for one screen size use them.",
  "- Reuse the project's components (below) with their properties instead of rebuilding them; `<Slot name=\"…\">` fills a component's named slot.",
  "- Everything must read well where it sits: on a colored background (`bg-primary`, …) text uses that color's `-foreground` token, and components use a variant made for it (not one whose text is dark on dark).",
  "- Icons: `<Icon name=\"lucide-icon-name\" />`. Links and buttons go to another screen with `href=\"/its-route\"`.",
  "- Lists of data: `{[{…}, {…}].map((item) => (…{item.field}…))}`; `data-name` names an element in the layers.",
  "",
  "The drawing's legend: red = remove, green = add, blue = change or move; other colors have no fixed meaning. Coordinates are the screen's design pixels.",
].join("\n");

/** The project's components and design tokens (the same for every request on the screen's theme). */
export function projectContext(project: Project, frame: Frame): string {
  const components = designComponents(project);
  return [
    ...(components.length ? ["### Components", "", ...components.map((c) => `- \`<${c.name}>\`${c.props.length ? ` ${c.props.join("; ")}` : ""}${c.slots.length ? ` · slots: ${c.slots.join(", ")}` : ""}`), ""] : []),
    "### Design tokens",
    "",
    ...tokenOverview(project, frame),
  ].join("\n");
}

/** The parts of a request: which screen (`head`), what to do (`ask`), and the screen as design JSX (`screen`). */
function requestParts(project: Project, request: DesignRequest): { head: string[]; ask: string[]; screen: string[] } {
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new Error(`The screen of request ${request.id} doesn't exist any more.`);
  const viewport = frame.viewports.find((v) => v.id === request.viewportId) ?? frame.viewports[0]!;
  const sources = componentSources(project.frames);
  const others = frame.viewports.filter((v) => v.id !== viewport.id).map((v) => `${v.id} ${v.width}px`);
  return {
    head: [
      `# Design request \`${request.id}\`: ${frame.name}${frame.target.route ? ` (${frame.target.route})` : ""}`,
      "",
      `Drawn on the screen at ${viewport.width}px (${viewport.id})${others.length ? `; it also has ${others.join(", ")}` : ""}.`,
      "",
    ],
    ask: [
      ...intentJob(request, frame, viewport),
      ...variantsJob(request),
      "## What should change",
      "",
      request.message.trim() || (request.intent ? "(no message: the job above)" : "(no message: see the drawing)"),
      ...(request.history?.length ? ["", "Earlier messages (the latest one above wins):", ...request.history.map((h) => `- ${h.message}`)] : []),
      "",
      "## The drawing",
      "",
      ...(request.shapes.length ? describeMarkup(request, frame, (id) => sources.get(id)?.name).map((l) => `- ${l}`) : ["(nothing drawn)"]),
      "",
    ],
    screen: ["## The screen now", "", "```tsx", designJsx(frame, project).trimEnd(), "```", ""],
  };
}

/** The request itself: the message, the drawing in words, and the screen as design JSX. */
export function requestDetails(project: Project, request: DesignRequest): string {
  const { head, ask, screen } = requestParts(project, request);
  return [...head, ...ask, ...screen].join("\n");
}

/**
 * The request in two parts for AppShape's AI: the screen (the same on *Try again*, so it can be
 * cached with the pictures) and what to do (the message last).
 */
export function requestSplit(project: Project, request: DesignRequest): { screen: string; ask: string } {
  const { head, ask, screen } = requestParts(project, request);
  return { screen: [...head, ...screen].join("\n"), ask: ask.join("\n") };
}

/**
 * Everything needed to design a request, as Markdown: the message, the drawing in words, the
 * rules of the answer, the components and tokens, and the screen as design JSX. For the coding
 * agent (MCP, CLI); AppShape's AI gets the same parts in a cache-friendly order.
 */
export function requestBrief(project: Project, request: DesignRequest): string {
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new Error(`The screen of request ${request.id} doesn't exist any more.`);
  const answer = request.intent === "review" ? REVIEW_ANSWER : (request.variants ?? 1) > 1 ? wholeScreens(request.variants!) : WHOLE_SCREEN;
  return [requestDetails(project, request).trimEnd(), "", answer, "", DESIGN_RULES, "", projectContext(project, frame), ""].join("\n");
}
