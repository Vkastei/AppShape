import { type Changeset, type ChangesetTask, componentSources, type Project, type Tokens } from "@appshape/ir";
import { SPEC_VERSION, type SpecChange, type SpecDocument } from "@appshape/protocol";
import type { AgentTask } from "./apply";
import { pascalCase } from "./names";
import { type AppLayout, STACKS } from "./stacks";
import { darkDeclarations, themeDeclarations } from "./theme";

/** The agent tasks of an apply as a changeset, ready for the agent. */
export function handoffChangeset(tasks: readonly (AgentTask & { image?: string })[], options: { id: string; now: string; title?: string }): Changeset {
  const numbered: ChangesetTask[] = tasks.map((t, i) => ({
    id: `c${i + 1}`,
    kind: t.kind,
    title: t.summary,
    ...(t.file && { file: t.file }),
    ...(t.line && { line: t.line }),
    ...(t.frameId && { frameId: t.frameId }),
    ...(t.nodeId && { nodeId: t.nodeId }),
    ...(t.code && { code: t.code }),
    ...(t.details && { details: t.details }),
    ...(t.image && { image: t.image }),
    ...(t.drawn?.length && { drawn: t.drawn }),
  }));
  return {
    id: options.id,
    title: options.title ?? `Handoff ${options.now.slice(0, 16).replace("T", " ")}`,
    description: "What is left after AppShape applied the design to the code.",
    status: "ready",
    ops: [],
    tasks: numbered,
    history: [{ status: "ready", at: options.now, by: "user" }],
    createdAt: options.now,
    updatedAt: options.now,
  };
}

const STACK_TEXT: Record<AppLayout["stack"], string[]> = {
  "vite-react-router": ["React 19", "Vite", "React Router 7"],
  "next-app": ["React 19", "Next.js (App Router)"],
  "next-pages": ["React 19", "Next.js (Pages Router)"],
  "vite-tanstack": ["React 19", "Vite", "TanStack Router (file routes)"],
};

/** The agent-facing spec of a handoff changeset. */
export function handoffSpec(changeset: Changeset, project: Project, layout: AppLayout, defaults: Tokens, now: string, dataPrefix = ".appshape"): SpecDocument {
  const stack = STACKS[layout.stack];
  const frames = new Map(project.frames.map((f) => [f.id, f]));
  const toChange = (task: ChangesetTask): SpecChange => ({
    id: task.id,
    opIds: [],
    kind: task.kind,
    title: task.title,
    ...((task.file || task.nodeId) && {
      node: {
        id: task.nodeId ?? task.frameId ?? "app",
        ...(task.file && task.line ? { source: { file: task.file, line: task.line, col: 1 } } : {}),
      },
    }),
    ...((task.details || (task.file && !task.line)) && { details: [task.details, task.file && !task.line && `File: \`${task.file}\``].filter(Boolean).join("\n\n") }),
    ...(task.code && { tree: task.code }),
    ...(task.image && { image: `${dataPrefix}/${task.image}` }),
  });

  const byFrame = new Map<string, SpecChange[]>();
  const general: SpecChange[] = [];
  for (const task of changeset.tasks ?? []) {
    const frame = task.frameId ? frames.get(task.frameId) : undefined;
    if (!frame) general.push(toChange(task));
    else byFrame.set(frame.id, [...(byFrame.get(frame.id) ?? []), toChange(task)]);
  }

  const components = [...componentSources(project.frames).values()].map((source) => {
    const name = pascalCase(source.name);
    return {
      name,
      file: stack.componentPath(name, layout),
      kind: "user" as const,
      usage: source.def.props.map((p) => p.name).join(", ") || undefined,
    };
  });

  return {
    specVersion: SPEC_VERSION,
    generatedAt: now,
    mode: "handoff",
    changeset: { id: changeset.id, title: changeset.title, ...(changeset.description && { description: changeset.description }), status: changeset.status },
    project: { name: project.name, root: ".", stack: [...STACK_TEXT[layout.stack], `Tailwind CSS v${layout.tailwind}`], adapter: layout.stack, styleDialect: `tailwind-v${layout.tailwind}` },
    tokens: [...themeDeclarations(project.tokens, defaults), ...darkDeclarations(project.tokens).map((d) => `${d.variable}: ${d.dark}; (dark mode)`)],
    components: components.map((c) => (c.usage ? c : { name: c.name, file: c.file, kind: c.kind })),
    frames: [...byFrame].map(([frameId, changes]) => {
      const frame = frames.get(frameId)!;
      return {
        frameId,
        name: frame.name,
        kind: frame.kind,
        platform: frame.platform,
        target: frame.target,
        viewports: frame.viewports.map((v) => `${v.id} ${v.width}${v.height ? `×${v.height}` : ""}`),
        changes,
      };
    }),
    ...(general.length && { general }),
    requirements: [],
    acceptance: [],
    hints: [
      `Pages: ${stack.pagePath("/example", "Example", layout).replace(/example|Example/, "<route>")}; components: ${stack.componentPath("<Name>", layout)}.`,
      `Components merge class names with \`cn()\` from ${stack.utilsPath(layout)} and use \`cva\` for variants.`,
      `Design tokens live in the \`@theme\` block of ${stack.cssPath(layout)} (managed by AppShape).`,
    ],
  };
}
