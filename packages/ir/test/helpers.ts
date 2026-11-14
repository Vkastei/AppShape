import { clone, type DesignNode, type Frame } from "../src";

export function box(id: string, children: DesignNode[] = [], extra: Partial<DesignNode> = {}): DesignNode {
  return { id, type: "box", origin: "imported", children, ...extra } as DesignNode;
}

export function text(id: string, value: string, extra: Partial<DesignNode> = {}): DesignNode {
  return { id, type: "text", origin: "imported", text: value, ...extra } as DesignNode;
}

export function frame(id: string, root: DesignNode, kind: Frame["kind"] = "imported"): Frame {
  return {
    id,
    name: id,
    kind,
    platform: "web",
    target: { adapter: "react-vite", route: "/" },
    viewports: [{ id: "desktop", width: 1280 }],
    ...(kind === "imported" ? { baseline: clone(root) } : {}),
    current: root,
  };
}

export function counter(prefix: string): () => string {
  let i = 0;
  return () => `${prefix}_${++i}`;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;
