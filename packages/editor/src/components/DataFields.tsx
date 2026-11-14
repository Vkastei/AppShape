import { boundKeys, type ContainerNode, createId, type DesignNode, type Frame, isContainer, type JsonValue, walk } from "@appshape/ir";
import { Plus, Trash2 } from "lucide-react";
import { newOpId } from "../lib/board";
import { dispatch, type NodeSelection, selectNode } from "../store";
import { Row, Section, TextInput } from "./Fields";

/**
 * Repeated content: a list shows one item design per item of its data (cards from an array). The
 * inspector edits the data as a table, binds an element of the item design to a field, and turns a
 * container of look-alike elements into one design plus data.
 */

type ListNode = Extract<DesignNode, { type: "list" }>;
type Item = Record<string, JsonValue>;

/** The field an element shows from the item (`text`, `src`, `href`, `icon`). */
export const mainField = (node: DesignNode): string | undefined => (node.type === "text" ? "text" : node.type === "image" ? "src" : node.type === "link" ? "href" : node.type === "icon" ? "icon" : undefined);

/** The list whose item design contains the node, if any. */
export function listOf(root: DesignNode, nodeId: string): ListNode | undefined {
  let found: ListNode | undefined;
  walk(root, (node) => {
    if (found) return "skip";
    if (node.type === "list" && node.items && node.children[0]) {
      walk(node.children[0], (inner) => {
        if (inner.id === nodeId) found = node;
      });
    }
  });
  return found;
}

/** The data of a list: a row per item, a column per field. */
export function DataSection({ node, sel }: { node: ListNode; sel: NodeSelection }) {
  const items = node.items ?? [];
  const keys = [...new Set([...boundKeys(node.children[0]!), ...items.flatMap((i) => Object.keys(i))])];
  const setItems = (next: Item[]) => dispatch([{ id: newOpId(), frameId: sel.frameId, nodeId: node.id, op: "setAttrs", attrs: { items: next } }]);
  return (
    <Section title="Data">
      <Row label="Name" hint="The data file and its name in the code (src/data/…)">
        <TextInput label="Data name" value={node.dataName ?? ""} placeholder="items" onCommit={(v) => /^[a-z][A-Za-z0-9]*$/.test(v.trim()) && dispatch([{ id: newOpId(), frameId: sel.frameId, nodeId: node.id, op: "setAttrs", attrs: { dataName: v.trim() } }])} />
      </Row>
      <p className="mb-1 text-[11px] text-zinc-500">One item per row; the first child is the design of an item.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]" aria-label="Items">
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} className="border-b border-zinc-200 px-1 py-0.5 text-left font-medium text-zinc-500">
                  {k}
                </th>
              ))}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, row) => (
              <tr key={row}>
                {keys.map((k) => (
                  <td key={k} className="px-0.5 py-0.5 align-top">
                    <TextInput label={`${k} of item ${row + 1}`} value={item[k] === undefined || item[k] === null ? "" : String(item[k])} onCommit={(v) => setItems(items.map((it, i) => (i === row ? { ...it, [k]: v } : it)))} />
                  </td>
                ))}
                <td className="align-top">
                  <button type="button" aria-label={`Remove item ${row + 1}`} disabled={items.length <= 1} onClick={() => setItems(items.filter((_, i) => i !== row))} className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setItems([...items, { ...items.at(-1) }])} className="mt-1 flex items-center gap-1 rounded px-1.5 py-1 text-xs text-accent-700 hover:bg-accent-50">
        <Plus size={12} /> Add an item
      </button>
    </Section>
  );
}

/** Inside a list's item design: which field of the item this element shows. */
export function BindRow({ node, list, sel }: { node: DesignNode; list: ListNode; sel: NodeSelection }) {
  const field = mainField(node);
  if (!field) return null;
  const items = list.items ?? [];
  const keys = [...new Set(items.flatMap((i) => Object.keys(i)))];
  const current = node.bind?.[field];
  const choose = (key: string) => {
    if (key === "") return dispatch([{ id: newOpId(), frameId: sel.frameId, nodeId: node.id, op: "setAttrs", attrs: { bind: null } }]);
    if (key === "new") {
      // a new field, filled with what the element shows now
      const name = uniqueKey(node.name ?? field, keys);
      const value = node.type === "text" ? node.text : node.type === "image" ? node.src : node.type === "link" ? (node.href ?? "") : node.type === "icon" ? node.icon : "";
      return dispatch([
        { id: newOpId(), frameId: sel.frameId, nodeId: list.id, op: "setAttrs", attrs: { items: items.map((i) => ({ ...i, [name]: value })) } },
        { id: newOpId(), frameId: sel.frameId, nodeId: node.id, op: "setAttrs", attrs: { bind: { ...node.bind, [field]: name } } },
      ]);
    }
    dispatch([{ id: newOpId(), frameId: sel.frameId, nodeId: node.id, op: "setAttrs", attrs: { bind: { ...node.bind, [field]: key } } }]);
  };
  return (
    <Row label="From data" hint="Each item shows its own value here (the list's data)">
      <select aria-label="From data" value={current ?? ""} onChange={(e) => choose(e.target.value)} className="w-full rounded border border-zinc-200 px-1 py-1 text-xs">
        <option value="">— the same in every item —</option>
        {keys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value="new">New field…</option>
      </select>
    </Row>
  );
}

function uniqueKey(label: string, taken: readonly string[]): string {
  const words = label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const base = words.length ? words.map((w, i) => (i === 0 ? w[0]!.toLowerCase() : w[0]!.toUpperCase()) + w.slice(1)).join("") : "field";
  const safe = /^[A-Za-z_$]/.test(base) ? base : `field${base}`;
  let key = safe;
  for (let i = 2; taken.includes(key); i++) key = `${safe}${i}`;
  return key;
}

/** Whether a container's children look alike (same kind of element), so they can become one design plus data. */
export function canRepeat(node: DesignNode): boolean {
  if (!isContainer(node) || node.type === "list" || node.type === "instance" || node.type === "slot" || node.children.length < 2) return false;
  const first = node.children[0]!;
  return node.children.every((c) => c.type === first.type && (c.type !== "instance" || (first.type === "instance" && c.componentId === first.componentId)));
}

/**
 * The container as a list of data: its first child becomes the item design, every child an item
 * (the texts of each child, in order, as fields the design binds).
 */
export function repeatWithData(frame: Frame, node: ContainerNode, parentId: string, index: number, itemId: string): void {
  const template = structuredClone(node.children[0]!);
  const texts = (n: DesignNode) => {
    const out: string[] = [];
    walk(n, (inner) => {
      if (inner.type === "text") out.push(inner.text);
    });
    return out;
  };
  const keys: string[] = [];
  walk(template, (inner) => {
    if (inner.type !== "text") return;
    const key = uniqueKey(inner.name ?? (keys.length === 0 ? "title" : "text"), keys);
    keys.push(key);
    inner.bind = { ...inner.bind, text: key };
  });
  const items = node.children.map((child) => {
    const values = texts(child);
    return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? texts(template)[i] ?? ""]));
  });
  const list = { ...node, id: createId("n"), type: "list", dataName: uniqueKey(node.name ?? "items", []), items, children: [template] } as DesignNode;
  if (dispatch([
    { id: newOpId(), frameId: frame.id, op: "delete", nodeId: node.id },
    { id: newOpId(), frameId: frame.id, op: "insert", parentId, index, node: list },
  ])) selectNode({ itemId, frameId: frame.id, nodeId: list.id });
}
