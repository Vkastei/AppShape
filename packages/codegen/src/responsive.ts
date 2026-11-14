import { deepEqual, type DesignNode, type Tokens } from "@appshape/ir";

/**
 * What a change does to larger screens: the elements that look different from a width up (for
 * "make it work on phones", where tablets and desktops must stay exactly as they were). Styles are
 * mobile-first: the base is the phone, `md:` and up add to it.
 */

/** Tailwind's breakpoints in px (a project's own `breakpoint` tokens win). */
const DEFAULT_BREAKPOINTS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };

function px(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const m = /^([\d.]+)(px|rem|em)?$/.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === "rem" || m[2] === "em" ? 16 : 1);
}

export function breakpointWidths(tokens: Pick<Tokens, "groups">): Record<string, number> {
  const own = Object.entries(tokens.groups.breakpoint ?? {})
    .map(([name, value]) => [name, px(value)] as const)
    .filter((e): e is readonly [string, number] => e[1] !== undefined);
  return own.length ? Object.fromEntries(own) : DEFAULT_BREAKPOINTS;
}

/** Overrides add to the base side by side: an override's `padding: { top }` keeps the base's left and right. */
function merge<T extends object>(base: T, patch: object | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current) ? { ...current, ...value } : value;
  }
  return out as T;
}

const kids = (node: DesignNode): DesignNode[] => ("children" in node && Array.isArray(node.children) ? (node.children as DesignNode[]) : []);

/** How a node looks at a width: its base with the breakpoint overrides that apply, and its other conditions. */
function lookAt(node: DesignNode, width: number, breakpoints: Record<string, number>) {
  const active = (bp: string | undefined) => bp === undefined || (breakpoints[bp] ?? Infinity) <= width;
  let layout = { ...node.layout };
  let box = { ...node.box };
  let style = { ...node.style };
  let hidden = node.hidden ?? false;
  const other: unknown[] = [];
  const sorted = [...(node.overrides ?? [])].sort((a, b) => (breakpoints[a.when.viewport ?? ""] ?? 0) - (breakpoints[b.when.viewport ?? ""] ?? 0));
  for (const o of sorted) {
    const onlySize = o.when.viewport !== undefined && !o.when.state && !o.when.scheme && !o.when.prop;
    if (onlySize) {
      if (!active(o.when.viewport)) continue;
      layout = merge(layout, o.layout);
      box = merge(box, o.box);
      style = merge(style, o.style);
      if (o.hidden !== undefined) hidden = o.hidden;
    } else if (active(o.when.viewport)) {
      // hover, dark mode, variants: as they are, without the size
      const { viewport: _v, ...when } = o.when;
      other.push({ ...o, when });
    }
  }
  const { overrides: _o, children: _c, layout: _l, box: _b, style: _s, hidden: _h, name: _n, annotations: _a, source: _src, platformRaw, ...own } = node as DesignNode & { children?: unknown };
  // classes kept as they are: those only for smaller screens (`max-md:`) don't show at this width
  const below = (cls: string) => {
    const bp = /^max-([\w-]+):/.exec(cls)?.[1];
    return bp !== undefined && (breakpoints[bp] ?? 0) <= width;
  };
  const { unmapped, ...rest } = platformRaw ?? {};
  const shown = (unmapped ?? []).filter((c) => !below(c));
  const raw = { ...rest, ...(shown.length && { unmapped: shown }) };
  return { own, raw, layout, box, style, hidden, other };
}

/**
 * The elements (ids, from `before`) that look different at `width` or wider after the change: their
 * own look, or which of their children show. Elements hidden at those widths don't count.
 */
export function largerScreenChanges(before: DesignNode, after: DesignNode, tokens: Pick<Tokens, "groups">, width: number): string[] {
  const breakpoints = breakpointWidths(tokens);
  // every breakpoint from `width` up, plus `width` itself
  const widths = [...new Set([width, ...Object.values(breakpoints).filter((w) => w >= width)])];
  const index = (root: DesignNode) => {
    const map = new Map<string, DesignNode>();
    const visit = (n: DesignNode) => {
      map.set(n.id, n);
      kids(n).forEach(visit);
    };
    visit(root);
    return map;
  };
  const now = index(after);
  const changed: string[] = [];
  const visit = (node: DesignNode) => {
    const other = now.get(node.id);
    if (!other) return; // removed: counted by its parent's children
    let differs = false;
    let shown = false;
    for (const w of widths) {
      const a = lookAt(node, w, breakpoints);
      const b = lookAt(other, w, breakpoints);
      if (a.hidden && b.hidden) continue;
      shown = true;
      const visibleKids = (n: DesignNode) => kids(n).filter((k) => !lookAt(k, w, breakpoints).hidden).map((k) => k.id);
      if (!deepEqual(a, b) || !deepEqual(visibleKids(node), visibleKids(other))) differs = true;
    }
    if (differs) changed.push(node.id);
    if (shown) kids(node).forEach(visit);
  };
  visit(before);
  return changed;
}
