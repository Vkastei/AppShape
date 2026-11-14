import type { DesignNode, JsonValue, NodeBase } from "@appshape/ir";

/** Small constructors for hand-written IR. `cls` is the captured Tailwind class string. */
type Extra = Partial<Omit<NodeBase, "id" | "platformRaw">> & { tag?: string; cls?: string };

function base(id: string, extra: Extra) {
  const { tag, cls, ...rest } = extra;
  const platformRaw = tag || cls ? { ...(tag && { tag }), ...(cls && { classes: cls.split(/\s+/) }) } : undefined;
  return { id, origin: "imported" as const, ...rest, ...(platformRaw && { platformRaw }) };
}

export const box = (id: string, extra: Extra, children: DesignNode[]): DesignNode => ({
  ...base(id, extra),
  type: "box",
  children,
});

export const text = (id: string, value: string, extra: Extra = {}): DesignNode => ({
  ...base(id, extra),
  type: "text",
  text: value,
});

export const link = (id: string, href: string, extra: Extra, children: DesignNode[]): DesignNode => ({
  ...base(id, extra),
  type: "link",
  href,
  children,
});

export const button = (id: string, extra: Extra, children: DesignNode[]): DesignNode => ({
  ...base(id, extra),
  type: "button",
  children,
});

export const list = (id: string, dataHint: string, extra: Extra, children: DesignNode[]): DesignNode => ({
  ...base(id, extra),
  type: "list",
  dataHint,
  children,
});

export const instance = (
  id: string,
  componentId: string,
  props: Record<string, JsonValue>,
  extra: Extra,
  children: DesignNode[],
): DesignNode => ({ ...base(id, extra), type: "instance", componentId, props, children });

export const input = (
  id: string,
  inputType: "text" | "email" | "textarea",
  attrs: { label: string; placeholder: string },
  extra: Extra,
): DesignNode => ({ ...base(id, extra), type: "input", inputType, ...attrs });

/** Marks a subtree as created in AppShape. */
export function added(node: DesignNode): DesignNode {
  const copy = { ...node, origin: "added" as const };
  if ("children" in copy) copy.children = copy.children.map(added);
  return copy as DesignNode;
}

export const sp = (n: string | number) => `$spacing.${n}`;
export const color = (name: string) => `$color.${name}`;
export const xAuto = { left: "auto", right: "auto" };
