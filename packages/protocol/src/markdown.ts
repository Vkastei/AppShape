import type { NodeRef, SpecChange, SpecDocument, SpecFrame } from "./spec";

/**
 * Renders a spec as Markdown for agents. The wording of the workflow section is part of the
 * protocol: it tells any agent (MCP or not) how to work through a changeset.
 */
export function renderSpecMarkdown(doc: SpecDocument): string {
  const out: string[] = [];
  const { changeset, project } = doc;

  out.push(`# AppShape changeset \`${changeset.id}\`: ${changeset.title}`, "");
  out.push(
    `**Status:** ${changeset.status} · **Project:** ${project.name} (\`${project.root || "."}\`) · ` +
      `**Stack:** ${project.stack.join(", ")}`,
    "",
  );
  if (changeset.description) out.push(changeset.description, "");

  out.push("## How to implement this changeset", "");
  if (doc.mode === "handoff") {
    out.push(
      "AppShape already wrote the code it could generate exactly (pages, components, theme). These tasks are what is left: things that need judgment, or code that was changed by hand so AppShape did not touch it.",
      "",
      "1. Work through the tasks below. A **target** code block shows what AppShape would generate at that place now: merge it with the existing code there and keep existing logic, data flow and naming.",
      "2. Use the generated components and the theme classes. Do not replace generated Tailwind classes unless a task asks for it.",
      "3. Notes (behavior, data) describe what the design means; implement them in the generated code at the given location.",
      `4. Report progress per task: MCP \`set_change_status\` or \`appshape status ${changeset.id} <task> applied|failed|skipped\`. When everything is done, set the changeset to \`applied\` (MCP \`set_changeset_status\` or \`appshape status ${changeset.id} applied\`).`,
      "",
    );
  } else out.push(
    "1. Implement every change below in the codebase. Change only what is needed; keep existing logic, data flow and naming intact.",
    "2. Reuse the existing components and theme tokens listed here. Do not use arbitrary values (like `[13px]`) unless a change asks for one.",
    "3. **Scope** `component` means: edit the component's source so every instance changes. " +
      "**Scope** `instance` means: only the named instance changes; make it configurable (a prop or a data field) instead of duplicating the component.",
    "4. Source locations (`file:line:col`) point at the JSX element as it was captured. Treat them as strong hints and confirm before editing.",
    "5. `classes` lists the exact class changes on that element. Classes with a prefix (`md:`, `hover:`) are responsive or state variants.",
    `6. Report progress per change: MCP \`set_change_status\` or \`appshape status ${changeset.id} <change> applied|failed|skipped\`.`,
    `7. When done, verify: MCP \`verify_changeset\` or \`appshape verify ${changeset.id}\`. Fix what fails and verify again.`,
    "",
  );

  if (doc.components.length > 0) {
    out.push("## Reuse these components", "");
    out.push("| Component | File | Kind | Notes |", "|---|---|---|---|");
    for (const c of doc.components) out.push(`| \`${c.name}\` | \`${c.file}\` | ${c.kind} | ${c.usage ?? ""} |`);
    out.push("");
  }
  if (doc.tokens?.length) {
    out.push("## Theme tokens", "", ...doc.tokens.map((t) => `- ${t}`), "");
  }
  if (doc.requirements.length > 0) {
    out.push("## Requirements", "", ...doc.requirements.map((r) => `- ${r}`), "");
  }
  if (doc.hints.length > 0) {
    out.push(`## Hints for ${project.stack.join(" + ")}`, "", ...doc.hints.map((h) => `- ${h}`), "");
  }

  if (doc.general?.length) {
    out.push("## General", "");
    for (const change of doc.general) out.push(...renderChange(change));
  }
  for (const frame of doc.frames) out.push(...renderFrame(frame));

  if (doc.acceptance.length > 0) {
    out.push("## Acceptance criteria", "");
    for (const item of doc.acceptance) {
      out.push(`- [ ] ${item.changeId ? `**${item.changeId}**: ` : ""}${item.text}`);
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function renderFrame(frame: SpecFrame): string[] {
  const out: string[] = [];
  const where = [frame.target.route && `\`${frame.target.route}\``, frame.target.file && `\`${frame.target.file}\``]
    .filter(Boolean)
    .join(" · ");
  out.push(`## Frame: ${frame.name}${where ? ` (${where})` : ""}`, "");
  const kind = { imported: "Existing page", new: "New page", sketch: "Sketch", component: "Component" }[frame.kind];
  out.push(`${kind} · ${frame.platform} · viewports: ${frame.viewports.join(", ")}`, "");
  if (frame.screenshots?.before || frame.screenshots?.after) {
    if (frame.screenshots.before) out.push(`- Before: ${frame.screenshots.before}`);
    if (frame.screenshots.after) out.push(`- After (design): ${frame.screenshots.after}`);
    out.push("");
  }
  if (frame.notes?.length) out.push(...frame.notes.map((n) => `> ${n}`), "");
  for (const change of frame.changes) out.push(...renderChange(change));
  return out;
}

function renderChange(change: SpecChange): string[] {
  const out: string[] = [];
  const scope = change.scope
    ? ` · scope: ${change.scope}${change.instances ? ` (${change.instances.count} instances)` : ""}`
    : "";
  out.push(`### ${change.id} · ${change.kind}${scope}`, "", `**${change.title}**`, "");
  if (change.details) out.push(change.details, "");

  const facts: string[] = [];
  if (change.node) facts.push(`- **Node:** ${ref(change.node)}`);
  if (change.instances?.which) facts.push(`- **Which instance:** ${change.instances.which}`);
  if (change.position) {
    const parts = [`inside ${ref(change.position.parent)}`];
    if (change.position.after) parts.push(`after ${ref(change.position.after)}`);
    if (change.position.before) parts.push(`before ${ref(change.position.before)}`);
    facts.push(`- **Where:** ${parts.join(", ")}`);
  }
  if (change.classes) {
    const list = (items: string[]) => (items.length ? items.map((c) => `\`${c}\``).join(" ") : "–");
    facts.push(`- **Classes:** remove ${list(change.classes.remove)} · add ${list(change.classes.add)}`);
  } else if (change.kind === "move") {
    // agents tend to "tidy up" spacing on a moved element (M0: a margin changed on c7)
    facts.push("- **Classes:** unchanged. Only the position changes; keep the element's classes and spacing as they are.");
  }
  if (change.text) {
    facts.push(
      change.text.from !== undefined
        ? `- **Text:** "${change.text.from}" → "${change.text.to}"`
        : `- **Text:** "${change.text.to}"`,
    );
  }
  if (change.props) facts.push(`- **Props:** \`${JSON.stringify(change.props)}\``);
  if (change.link) facts.push(`- **Links to:** \`${change.link.route}\``);
  for (const note of change.annotations ?? []) facts.push(`- **Note:** ${note}`);
  if (change.image) facts.push(`- **Drawing:** \`${change.image}\` (the screen as drawn on; open the image)`);
  if (facts.length) out.push(...facts, "");

  if (change.tree) {
    if (change.opIds.length === 0) out.push("Target:", "");
    out.push("```tsx", change.tree.trimEnd(), "```", "");
  }
  if (change.opIds.length > 0) out.push(`<sub>ops: ${change.opIds.join(", ")}</sub>`, "");
  return out;
}

function ref(node: NodeRef): string {
  const label = node.name ?? node.id;
  const element = node.element ? `\`<${node.element}>\` ` : "";
  const source = node.source ? ` (\`${node.source.file}:${node.source.line}:${node.source.col}\`)` : "";
  return `${element}${label}${source}`;
}
