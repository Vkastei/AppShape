import { nodeClasses } from "@appshape/codegen/classes";
import { parseClasses } from "@appshape/dialect-tailwind/parse";
import { clone, type DesignNode, diffTree, findNode, type Frame, isContainer, type Project } from "@appshape/ir";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { newOpId } from "../lib/board";
import { forCopies } from "../lib/linked";
import { dispatch, useEditor } from "../store";
import { TextInput } from "./Fields";

const OPEN_KEY = "appshape.advanced";

function initiallyOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** The element's classes as the generated code writes them (its variant classes aside). */
export function classesOf(project: Project, node: DesignNode, parent: DesignNode | undefined): string[] {
  return nodeClasses(node, parent?.layout, { tokens: project.tokens, warnings: [] }).base;
}

/**
 * Ops that make an element's design what `classes` say: parsed like an import (layout, size, style,
 * per-size and state overrides); classes without a design equivalent are kept as they are. Variant
 * overrides (inside components) stay.
 */
export function classesOps(project: Project, frame: Frame, nodeId: string, classes: string[]) {
  const found = findNode(frame.current, nodeId);
  if (!found) return [];
  const { node, parent } = found;
  const parsed = parseClasses(classes, { tokens: project.tokens, ...(parent?.layout && { parent: parent.layout }) });
  const next = clone(node) as DesignNode;
  for (const key of ["layout", "box", "style", "hidden", "overrides"] as const) delete next[key];
  if (parsed.layout) next.layout = parsed.layout;
  if (parsed.box) next.box = parsed.box;
  if (parsed.style) next.style = parsed.style;
  if (parsed.hidden) next.hidden = true;
  const overrides = [...(parsed.overrides ?? []), ...(node.overrides ?? []).filter((o) => o.when.prop)];
  if (overrides.length) next.overrides = overrides;
  const raw = { ...node.platformRaw, unmapped: parsed.unmapped };
  if (raw.unmapped.length === 0) delete (raw as { unmapped?: string[] }).unmapped;
  if (Object.keys(raw).length) next.platformRaw = raw;
  else delete next.platformRaw;
  const root = clone(frame.current);
  if (!parent) return diffTree(frame.id, frame.current, next, { createOpId: newOpId });
  const into = findNode(root, parent.id)!.node;
  if (!isContainer(into)) return [];
  into.children[found.index] = next;
  return diffTree(frame.id, frame.current, root, { createOpId: newOpId });
}

/** Advanced: the element's Tailwind classes, editable (collapsed until opened once). */
export function ClassesSection({ node, frame, parent }: { node: DesignNode; frame: Frame; parent: DesignNode | undefined }) {
  const project = useEditor((s) => s.project)!;
  const [open, setOpen] = useState(initiallyOpen);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // storage blocked: open for this session
    }
  };
  const classes = classesOf(project, node, parent);
  const kept = node.platformRaw?.unmapped ?? [];
  const sketch = parent?.layout?.mode === "absolute";
  return (
    <section className="border-b border-zinc-200 px-3 py-2">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-ink">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Advanced
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 text-xs">
          <span className="text-zinc-500" title="Tailwind classes as the generated code writes them. Edit them: what the inspector knows becomes its settings, the rest is kept as it is.">
            Classes
          </span>
          {sketch ? (
            <p className="text-zinc-500">Elements in a sketch are placed by position; their classes aren't edited here.</p>
          ) : (
            <TextInput
              label="Classes"
              multiline
              value={classes.join(" ")}
              placeholder="e.g. backdrop-blur-md"
              onCommit={(text) => {
                const ops = classesOps(project, frame, node.id, text.split(/\s+/).filter(Boolean));
                if (ops.length) dispatch(forCopies(project, ops, useEditor.getState().codeScope));
              }}
            />
          )}
          {kept.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" title="No inspector setting for these yet: they are kept as they are, on the board and in the code" aria-label="Kept as they are">
              <span className="text-amber-700">Kept as they are:</span>
              {kept.map((cls) => (
                <span key={cls} className="rounded bg-amber-100 px-1 font-mono text-[10px] text-amber-900">
                  {cls}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

