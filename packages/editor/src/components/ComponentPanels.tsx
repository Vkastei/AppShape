import {
  type ComponentDef,
  type ComponentProp,
  createId,
  type DesignNode,
  type Frame,
  type InstanceNode,
  instancesOf,
  isContainer,
  type JsonValue,
  propDefault,
  walk,
} from "@appshape/ir";
import { Link2Off, Plus, RotateCcw, Trash2, Unlink } from "lucide-react";
import { newOpId } from "../lib/board";
import { detachInstance, editComponent } from "../lib/actions";
import {
  addVariantOps,
  boundProp,
  exposableFields,
  exposeDef,
  FIELD_LABELS,
  placementError,
  removePropOps,
  renamePropOps,
  sourcesOf,
  unexposeDef,
  updateDefOp,
  variantPreviewOps,
} from "../lib/components";
import { cloneWithNewIds } from "../lib/nodes";
import { dispatch, type NodeSelection, useEditor } from "../store";
import { Row, Section, Segmented, TextInput } from "./Fields";

const buttonClass = "rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:border-accent-400 hover:bg-accent-50";

/** Screens a link property can open. */
function ScreenSelect({ value, onChange, label }: { value: string | undefined; onChange: (v: string | null) => void; label: string }) {
  const frames = useEditor((s) => s.project!.frames).filter((f) => f.kind !== "component");
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="w-full min-w-0 rounded border border-zinc-200 px-1 py-1 text-xs">
      <option value="">— none —</option>
      {frames.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name} {f.target.route ? `(${f.target.route})` : ""}
        </option>
      ))}
    </select>
  );
}

/** One property value field (instances) — by type and binding. */
function PropField({ prop, value, fallback, onChange }: { prop: ComponentProp; value: JsonValue | undefined; fallback: JsonValue | undefined; onChange: (v: JsonValue | null) => void }) {
  const label = `Property ${prop.name}`;
  if (prop.type === "enum") {
    const options = prop.options ?? [];
    const current = String(value ?? fallback ?? options[0] ?? "");
    return options.length <= 3 ? (
      <Segmented label={label} value={current} options={options.map((o) => ({ value: o, label: o }))} onChange={(v) => onChange(v === fallback ? null : v)} />
    ) : (
      <select aria-label={label} value={current} onChange={(e) => onChange(e.target.value === fallback ? null : e.target.value)} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (prop.type === "boolean") {
    const current = (value ?? fallback ?? true) !== false;
    return <Segmented label={label} value={current ? "on" : "off"} options={[{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }]} onChange={(v) => onChange((v === "on") === (fallback !== false) ? null : v === "on")} />;
  }
  if (prop.bindings?.[0]?.field === "target") {
    return <ScreenSelect label={label} value={(value ?? fallback ?? undefined) as string | undefined} onChange={(v) => onChange(v === (fallback ?? null) ? null : (v ?? ""))} />;
  }
  return (
    <TextInput
      label={label}
      value={value === undefined || value === null ? "" : String(value)}
      placeholder={fallback === undefined || fallback === null ? "" : String(fallback)}
      onCommit={(v) => onChange(v === "" ? null : v)}
    />
  );
}

/** Slots of a component tree. */
function slotsOf(root: DesignNode): Extract<DesignNode, { type: "slot" }>[] {
  const slots: Extract<DesignNode, { type: "slot" }>[] = [];
  walk(root, (node) => {
    if (node !== root && node.type === "instance") return "skip";
    if (node.type === "slot") slots.push(node);
  });
  return slots;
}

/** Inspector for an instance: its component, property values and slots. */
export function InstanceSection({ node, sel }: { node: InstanceNode; sel: NodeSelection }) {
  const project = useEditor((s) => s.project)!;
  const sources = sourcesOf(project);
  const source = sources.get(node.componentId);
  if (!source) {
    const catalog = project.components.find((c) => c.id === node.componentId);
    return (
      <Section title="Component">
        <p className="text-xs text-zinc-600">{catalog ? `${catalog.name} (from the app's code)` : `Unknown component ${node.componentId}`}</p>
      </Section>
    );
  }
  const base = { frameId: sel.frameId, nodeId: node.id };
  const setProp = (name: string, value: JsonValue | null) => dispatch([{ id: newOpId(), ...base, op: "setProps", props: { [name]: value } }]);
  const swap = (componentId: string) => dispatch([{ id: newOpId(), ...base, op: "swapComponent", componentId, props: {} }]);
  const fills = new Map(node.children.filter((c) => c.type === "slot").map((c) => [(c as Extract<DesignNode, { type: "slot" }>).slotName, c]));
  const customize = (slot: Extract<DesignNode, { type: "slot" }>) => {
    const fill: DesignNode = { id: createId("n"), type: "slot", origin: "added", slotName: slot.slotName, children: slot.children.map(cloneWithNewIds) };
    dispatch([{ id: newOpId(), frameId: sel.frameId, op: "insert", parentId: node.id, index: node.children.length, node: fill }]);
  };
  const swappable = [...sources.values()].filter((s) => s.id === node.componentId || !placementError(project, sel.frameId, s.id));

  return (
    <Section title="Component">
      <div className="mb-2 flex items-center gap-1">
        <select aria-label="Component" value={node.componentId} onChange={(e) => swap(e.target.value)} className="min-w-0 flex-1 rounded border border-pink-200 bg-pink-50 px-1 py-1 text-xs font-medium text-pink-900" title="Swap for another component">
          {swappable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => editComponent(node.componentId)} className={buttonClass}>
          Edit component
        </button>
        <button type="button" onClick={detachInstance} title="Detach (Ctrl+Alt+B): turn into plain elements" aria-label="Detach instance" className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-zinc-100">
          <Link2Off size={14} />
        </button>
      </div>
      {source.def.props.length === 0 && <p className="text-xs text-zinc-500">No properties. Expose texts, images or links in the component to vary them per instance.</p>}
      {source.def.props.map((prop) => {
        const fallback = propDefault(source.root, prop);
        const set = node.props[prop.name] !== undefined;
        return (
          <Row key={prop.name} label={prop.name} hint={prop.description}>
            <PropField prop={prop} value={node.props[prop.name]} fallback={fallback} onChange={(v) => setProp(prop.name, v)} />
            {set && (
              <button type="button" title="Reset to the component's value" aria-label={`Reset ${prop.name}`} onClick={() => setProp(prop.name, null)} className="shrink-0 text-zinc-400 hover:text-accent-700">
                <RotateCcw size={12} />
              </button>
            )}
          </Row>
        );
      })}
      {slotsOf(source.root).map((slot) => {
        const fill = fills.get(slot.slotName);
        return (
          <Row key={slot.slotName} label={`Slot ${slot.slotName}`}>
            {fill ? (
              <button type="button" className={buttonClass} onClick={() => dispatch([{ id: newOpId(), frameId: sel.frameId, op: "delete", nodeId: fill.id }])}>
                Reset to default content
              </button>
            ) : (
              <button type="button" className={buttonClass} onClick={() => customize(slot)}>
                Customize content
              </button>
            )}
          </Row>
        );
      })}
    </Section>
  );
}

/** Inspector for a component's root: description, properties, variants, preview width. */
export function ComponentSection({ frame }: { frame: Frame & { component: ComponentDef } }) {
  const project = useEditor((s) => s.project)!;
  const sizes = useEditor((s) => s.sizes);
  const def = frame.component;
  const uses = instancesOf(project.frames, frame.id).length;
  const update = (next: ComponentDef) => dispatch([updateDefOp(frame.id, next)]);
  const setProp = (name: string, patch: Partial<ComponentProp>) => update({ ...def, props: def.props.map((p) => (p.name === name ? { ...p, ...patch } : p)) });
  const viewport = frame.viewports[0]!;

  return (
    <Section title="Component" actions={<span className="text-[11px] text-zinc-500">{uses === 1 ? "1 instance" : `${uses} instances`}</span>}>
      <Row label="Description">
        <TextInput label="Component description" value={def.description} placeholder="What it is for (for the AI)" onCommit={(v) => update({ ...def, description: v.trim() || undefined })} />
      </Row>
      <Row label="Preview width">
        <TextInput
          label="Preview width"
          value={String(viewport.width)}
          onCommit={(v) => {
            const width = Math.round(Number(v));
            if (width > 0) dispatch([{ id: newOpId(), frameId: frame.id, op: "updateFrame", patch: { viewports: [{ ...viewport, width }, ...frame.viewports.slice(1)] } }]);
          }}
        />
      </Row>
      <div className="mt-2 mb-1 text-[11px] font-semibold text-zinc-500">Properties</div>
      {def.props.length === 0 && <p className="text-xs text-zinc-500">Select a text, image or link inside the component to expose it.</p>}
      {def.props.map((prop) => (
        <div key={prop.name} className="mb-1.5 rounded border border-zinc-100 p-1.5">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <TextInput label={`Property name ${prop.name}`} value={prop.name} onCommit={(v) => /^[A-Za-z][A-Za-z0-9_]*$/.test(v.trim()) && dispatch(renamePropOps(project, frame.id, prop.name, v.trim()))} />
            </div>
            <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-600">
              {prop.type === "enum" ? "variant" : prop.bindings?.map((b) => FIELD_LABELS[b.field]).join(", ") || prop.type}
            </span>
            <button type="button" aria-label={`Remove property ${prop.name}`} onClick={() => dispatch(removePropOps(project, frame.id, prop.name))} className="shrink-0 text-zinc-400 hover:text-red-600">
              <Trash2 size={12} />
            </button>
          </div>
          {prop.type === "enum" && (
            <div className="mt-1 flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <TextInput
                  label={`Options of ${prop.name}`}
                  value={(prop.options ?? []).join(", ")}
                  onCommit={(v) => {
                    const options = [...new Set(v.split(",").map((o) => o.trim()).filter(Boolean))];
                    if (options.length === 0) return;
                    setProp(prop.name, { options, default: options.includes(String(prop.default)) ? prop.default : options[0] });
                  }}
                />
              </div>
              <button
                type="button"
                title="Place a preview of every option on the board"
                className={buttonClass}
                onClick={() => dispatch(variantPreviewOps(project, frame.id, prop.name, (prop.options ?? []).filter((o) => o !== String(propDefault(frame.current, prop))), sizes))}
              >
                Show all
              </button>
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={() => dispatch(addVariantOps(project, frame.id, sizes))} className={`${buttonClass} mt-1 flex items-center gap-1`}>
        <Plus size={12} /> Add variant property
      </button>
    </Section>
  );
}

/** Inside a component: which properties drive this element; expose fields; make slots. */
export function PropertySection({ frame, node, sel }: { frame: Frame & { component: ComponentDef }; node: DesignNode; sel: NodeSelection }) {
  const def = frame.component;
  const bound = def.props.flatMap((prop) => (prop.bindings ?? []).filter((b) => b.nodeId === node.id).map((b) => ({ prop, field: b.field })));
  const free = exposableFields(node).filter((field) => !boundProp(def, node.id, field));
  const update = (next: ComponentDef) => dispatch([updateDefOp(frame.id, next)]);
  const isRoot = node.id === frame.current.id;

  const makeSlot = () => {
    if (!isContainer(node) || isRoot) return;
    const parent = findParentOf(frame.current, node.id);
    if (!parent) return;
    const taken = new Set(slotsOf(frame.current).map((s) => s.slotName));
    let slotName = node.name ? node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "content";
    for (let i = 2; taken.has(slotName); i++) slotName = `content-${i}`;
    const { children, id: _id, type: _type, ...rest } = node as Extract<DesignNode, { type: "box" }>;
    const slot = { ...structuredClone(rest), id: createId("n"), type: "slot" as const, slotName, children: [] };
    const ops = [
      { id: newOpId(), frameId: frame.id, op: "insert" as const, parentId: parent.parent.id, index: parent.index, node: slot },
      ...children.map((child, i) => ({ id: newOpId(), frameId: frame.id, op: "move" as const, nodeId: child.id, parentId: slot.id, index: i })),
      { id: newOpId(), frameId: frame.id, op: "delete" as const, nodeId: node.id },
    ];
    if (dispatch(ops)) useEditor.setState({ node: { ...sel, nodeId: slot.id } });
  };

  return (
    <Section title="Property">
      {bound.map(({ prop, field }) => (
        <div key={`${prop.name}-${field}`} className="mb-1 flex items-center gap-1 rounded bg-pink-50 px-2 py-1 text-xs text-pink-900">
          <span className="flex-1">
            {FIELD_LABELS[field]} → <span className="font-semibold">{prop.name}</span>
          </span>
          <button type="button" title="Stop exposing" aria-label={`Unlink ${prop.name}`} onClick={() => update(unexposeDef(def, prop.name, node.id))} className="text-pink-600 hover:text-red-600">
            <Unlink size={12} />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-zinc-500">Expose:</span>
          {free.map((field) => (
            <button key={field} type="button" className={buttonClass} onClick={() => update(exposeDef(def, node, field))}>
              {FIELD_LABELS[field]}
            </button>
          ))}
        </div>
      )}
      {node.type === "slot" ? (
        <Row label="Slot name">
          <TextInput label="Slot name" value={node.slotName} onCommit={(v) => v.trim() && dispatch([{ id: newOpId(), frameId: frame.id, op: "setAttrs", nodeId: node.id, attrs: { slotName: v.trim() } }])} />
        </Row>
      ) : (
        isContainer(node) &&
        !isRoot &&
        node.type === "box" && (
          <button type="button" className={`${buttonClass} mt-1.5`} onClick={makeSlot} title="Instances can fill a slot with their own content">
            Make slot
          </button>
        )
      )}
    </Section>
  );
}

function findParentOf(root: DesignNode, id: string): { parent: Extract<DesignNode, { children: DesignNode[] }>; index: number } | undefined {
  if (!isContainer(root)) return undefined;
  const index = root.children.findIndex((c) => c.id === id);
  if (index >= 0) return { parent: root, index };
  for (const child of root.children) {
    const found = findParentOf(child, id);
    if (found) return found;
  }
  return undefined;
}
