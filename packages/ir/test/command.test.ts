import { describe, expect, it } from "vitest";
import {
  type AnyOp,
  applyBoardOps,
  applyCommand,
  type Board,
  type BoardItem,
  BoardOpError,
  CommandSchema,
  type DesignState,
  diffBoard,
  type Frame,
  invertCommand,
  normalizeNode,
  OpError,
  resolveToken,
  themedTokens,
  type Tokens,
} from "../src";
import { box, counter, frame, type Rng, rng, text } from "./helpers";
import { randomOp, randomTree } from "./random";

function randomItem(r: Rng, id: string, itemIds: string[]): BoardItem {
  switch (r.int(5)) {
    case 0:
      return { type: "frame", id, frameId: "f", x: r.int(2000), y: r.int(2000), ...(r.chance(0.5) && { viewportId: "mobile" }) };
    case 1:
      return { type: "note", id, x: r.int(2000), y: r.int(2000), text: `note ${id}`, ...(r.chance(0.5) && { color: "yellow" }) };
    case 2:
      return itemIds.length >= 2
        ? { type: "arrow", id, kind: "flow", from: { itemId: r.pick(itemIds) }, to: { itemId: r.pick(itemIds) }, ...(r.chance(0.5) && { label: "next" }) }
        : { type: "text", id, x: 0, y: 0, text: "label" };
    case 3:
      return { type: "section", id, name: `Section ${id}`, x: r.int(100), y: r.int(100), w: 400 + r.int(400), h: 300 };
    default:
      return { type: "text", id, x: r.int(500), y: r.int(500), text: "label", ...(r.chance(0.5) && { size: 24 }) };
  }
}

function randomBoardOp(r: Rng, board: Board, nextId: () => string): AnyOp {
  const ids = board.items.map((item) => item.id);
  const id = nextId();
  if (ids.length === 0 || r.chance(0.3)) {
    return { id, op: "addItem", item: randomItem(r, `b_${id}`, ids), ...(r.chance(0.5) && { index: r.int(ids.length + 1) }) };
  }
  const itemId = r.pick(ids);
  switch (r.int(3)) {
    case 0:
      return { id, op: "removeItem", itemId };
    case 1:
      return { id, op: "reorderItem", itemId, index: r.int(ids.length) };
    default:
      return { id, op: "updateItem", itemId, patch: r.chance(0.5) ? { x: r.int(3000), y: r.int(3000) } : { color: r.chance(0.5) ? "blue" : null } };
  }
}

describe("board ops", () => {
  const board: Board = { items: [{ type: "note", id: "n1", x: 0, y: 0, text: "Hi" }] };

  it("validates items and patches", () => {
    expect(() => applyBoardOps(board, [{ id: "o", op: "addItem", item: { type: "note", id: "n1", x: 0, y: 0, text: "" } }])).toThrow(BoardOpError);
    expect(() => applyBoardOps(board, [{ id: "o", op: "updateItem", itemId: "n1", patch: { x: "far" } }])).toThrow(/invalid item/);
    expect(() => applyBoardOps(board, [{ id: "o", op: "updateItem", itemId: "n1", patch: { type: "text" } }])).toThrow(/cannot be patched/);
    expect(() => applyBoardOps(board, [{ id: "o", op: "removeItem", itemId: "nope" }])).toThrow(/unknown item/);
    expect(applyBoardOps(board, [{ id: "o", op: "updateItem", itemId: "n1", patch: { text: "Hello", color: "pink" } }]).items[0]).toEqual({
      type: "note", id: "n1", x: 0, y: 0, text: "Hello", color: "pink",
    });
    expect(board.items[0]).toEqual({ type: "note", id: "n1", x: 0, y: 0, text: "Hi" });
  });

  it("validates commands", () => {
    expect(CommandSchema.safeParse({ id: "c", ops: [{ id: "o", op: "removeItem", itemId: "n1" }] }).success).toBe(true);
    expect(CommandSchema.safeParse({ id: "c", ops: [] }).success).toBe(false);
  });

  it("diffBoard reproduces the target (property test)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const nextId = counter(`s${seed}`);
      let a: Board = { items: [] };
      let b: Board = { items: [] };
      for (let i = 0; i < 12; i++) {
        try {
          a = applyBoardOps(a, [randomBoardOp(r, a, nextId) as never]);
        } catch (e) {
          if (!(e instanceof BoardOpError)) throw e;
        }
      }
      b = a;
      for (let i = 0; i < 12; i++) {
        try {
          b = applyBoardOps(b, [randomBoardOp(r, b, nextId) as never]);
        } catch (e) {
          if (!(e instanceof BoardOpError)) throw e;
        }
      }
      expect(applyBoardOps(a, diffBoard(a, b)), `seed ${seed}`).toEqual(b);
    }
  });
});

describe("commands", () => {
  it("undo restores the state for mixed board and frame commands (property test)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 31);
      const nextId = counter(`s${seed}`);
      const f: Frame = frame("f", randomTree(r, counter(`s${seed}n`)));
      let state: DesignState = { board: { items: [] }, frames: new Map([["f", f]]) };
      for (let step = 0; step < 15; step++) {
        const ops: AnyOp[] = [];
        for (let k = 0; k < 1 + r.int(3); k++) {
          ops.push(r.chance(0.5) ? randomBoardOp(r, state.board, nextId) : randomOp(r, state.frames.get("f")!, counter(`s${seed}x${step}k${k}`), nextId));
        }
        let after: DesignState;
        try {
          after = applyCommand(state, ops);
        } catch (e) {
          if (e instanceof BoardOpError || e instanceof OpError) continue;
          throw e;
        }
        const undone = applyCommand(after, invertCommand(state, ops));
        expect(undone.board, `seed ${seed} step ${step}`).toEqual(state.board);
        expect(normalizeNode(undone.frames.get("f")!.current)).toEqual(normalizeNode(state.frames.get("f")!.current));
        state = after;
      }
    }
  });

  it("inverts frame creation", () => {
    const created = frame("g", box("gr", [text("t", "Hi")]), "new");
    const before: DesignState = { board: { items: [] }, frames: new Map() };
    const ops: AnyOp[] = [
      { id: "o1", frameId: "g", op: "createFrame", frame: created },
      { id: "o2", op: "addItem", item: { type: "frame", id: "p1", frameId: "g", x: 0, y: 0 } },
    ];
    const after = applyCommand(before, ops);
    const undone = applyCommand(after, invertCommand(before, ops));
    expect(undone.frames.has("g")).toBe(false);
    expect(undone.board.items).toEqual([]);
  });
});

describe("token ops", () => {
  const tokens = { source: "manual" as const, groups: { color: { brand: "#4f46e5" } } };
  const state: DesignState = { board: { items: [] }, frames: new Map(), tokens };

  it("creates, changes and removes named text and effect styles, and undoes that", () => {
    const h2 = { name: "H2", fontSize: "$fontSize.3xl", sizes: { md: { fontSize: "$fontSize.4xl" } } };
    const ops: AnyOp[] = [
      { id: "s1", op: "setTextStyle", style: "h2", value: h2 },
      { id: "s2", op: "setEffectStyle", style: "card", value: { name: "Card", shadow: "$shadow.sm" } },
    ];
    const after = applyCommand(state, ops);
    expect(after.tokens?.textStyles).toEqual({ h2 });
    expect(after.tokens?.effectStyles?.card?.shadow).toBe("$shadow.sm");
    // changing H2 is one op for every element that uses it
    const bigger = applyCommand(after, [{ id: "s3", op: "setTextStyle", style: "h2", value: { ...h2, sizes: { md: { fontSize: "$fontSize.5xl" } } } }]);
    expect(bigger.tokens?.textStyles?.h2?.sizes?.md?.fontSize).toBe("$fontSize.5xl");
    const undo = invertCommand(after, [{ id: "s4", op: "setTextStyle", style: "h2", value: null }]);
    expect(applyCommand(applyCommand(after, [{ id: "s4", op: "setTextStyle", style: "h2", value: null }]), undo).tokens).toEqual(after.tokens);
    expect(applyCommand(after, invertCommand(state, ops)).tokens).toEqual(tokens);
    expect(() => CommandSchema.parse({ id: "c", ops: [{ id: "x", op: "setTextStyle", style: "Bad Id", value: null }] })).toThrow();
  });

  it("sets, changes and removes tokens, and undoes that", () => {
    const ops: AnyOp[] = [
      { id: "o1", op: "setToken", group: "color", name: "brand", value: "#7c3aed" },
      { id: "o2", op: "setToken", group: "radius", name: "card", value: "1rem" },
    ];
    const after = applyCommand(state, ops);
    expect(after.tokens?.groups).toEqual({ color: { brand: "#7c3aed" }, radius: { card: "1rem" } });
    expect(applyCommand(after, invertCommand(state, ops)).tokens).toEqual(tokens);
    const removed = applyCommand(state, [{ id: "o3", op: "setToken", group: "color", name: "brand", value: null }]);
    expect(removed.tokens?.groups).toEqual({});
  });

  it("keeps dark-mode values next to the light ones, and undoes them", () => {
    const ops: AnyOp[] = [
      { id: "o1", op: "setToken", group: "color", name: "background", value: "#ffffff" },
      { id: "o2", op: "setToken", group: "color", name: "background", value: "#09090b", scheme: "dark" },
    ];
    const after = applyCommand(state, ops);
    expect(after.tokens?.dark).toEqual({ color: { background: "#09090b" } });
    expect(resolveToken(after.tokens!, "$color.background", "dark")).toBe("#09090b");
    expect(resolveToken(after.tokens!, "$color.brand", "dark")).toBe("#4f46e5");
    expect(applyCommand(after, invertCommand(state, ops)).tokens).toEqual(tokens);
    // removing the token removes its dark value; undo brings both back
    const remove: AnyOp[] = [{ id: "o3", op: "setToken", group: "color", name: "background", value: null }];
    const removed = applyCommand(after, remove);
    expect(removed.tokens).toEqual(tokens);
    expect(applyCommand(removed, invertCommand(after, remove)).tokens).toEqual(after.tokens);
    expect(() => applyCommand(state, [{ id: "o4", op: "setToken", group: "color", name: "nope", value: "#000", scheme: "dark" }])).toThrow(/unknown token/);
  });

  it("keeps named themes for screens, and undoes them", () => {
    const base: Tokens = { source: "manual", groups: { color: { primary: "#4f46e5", background: "#fff" } }, dark: { color: { primary: "#818cf8", background: "#000" } } };
    const start: DesignState = { board: { items: [] }, frames: new Map(), tokens: base };
    const ops: AnyOp[] = [
      { id: "t1", op: "setTheme", theme: "landing", name: "Landing" },
      { id: "t2", op: "setToken", theme: "landing", group: "color", name: "primary", value: "#e11d48" },
      { id: "t3", op: "setToken", theme: "landing", group: "color", name: "background", value: "#fafafa" },
      { id: "t4", op: "setToken", theme: "landing", group: "color", name: "background", value: "#111", scheme: "dark" },
    ];
    const after = applyCommand(start, ops).tokens!;
    expect(after.themes).toEqual({ landing: { name: "Landing", groups: { color: { primary: "#e11d48", background: "#fafafa" } }, dark: { color: { background: "#111" } } } });
    // a screen with the theme: its values on top; a value without a dark one is used in dark mode too
    const themed = themedTokens(after, "landing");
    expect(resolveToken(themed, "$color.primary")).toBe("#e11d48");
    expect(resolveToken(themed, "$color.primary", "dark")).toBe("#e11d48");
    expect(resolveToken(themed, "$color.background", "dark")).toBe("#111");
    expect(themedTokens(after, undefined)).toBe(after);
    expect(applyCommand({ ...start, tokens: after }, invertCommand(start, ops)).tokens).toEqual(base);
    // themes only change tokens the project has; removing a token removes it from themes too
    expect(() => applyCommand({ ...start, tokens: after }, [{ id: "t5", op: "setToken", theme: "landing", group: "color", name: "new", value: "#000" }])).toThrow(/unknown token/);
    const removed = applyCommand({ ...start, tokens: after }, [{ id: "t6", op: "setToken", group: "color", name: "primary", value: null }]).tokens!;
    expect(removed.themes?.landing?.groups.color).toEqual({ background: "#fafafa" });
    // removing the theme is one op, undone completely
    const drop: AnyOp[] = [{ id: "t7", op: "setTheme", theme: "landing", name: null }];
    const dropped = applyCommand({ ...start, tokens: after }, drop);
    expect(dropped.tokens!.themes).toBeUndefined();
    expect(applyCommand(dropped, invertCommand({ ...start, tokens: after }, drop)).tokens).toEqual(after);
  });

  it("needs tokens in the state", () => {
    expect(() => applyCommand({ board: { items: [] }, frames: new Map() }, [{ id: "o", op: "setToken", group: "color", name: "x", value: "red" }])).toThrow(/tokens/);
  });
});

describe("buttons as links", () => {
  it("lets buttons target screens but not URLs", () => {
    const f = frame("f", box("r", [{ id: "b", type: "button", origin: "added", children: [] }]));
    const frames = new Map([["f", f]]);
    const next = applyCommand({ board: { items: [] }, frames }, [{ id: "o", frameId: "f", op: "setLink", nodeId: "b", targetFrameId: "g" }]);
    expect(next.frames.get("f")!.current).toMatchObject({ children: [{ targetFrameId: "g" }] });
    expect(() => applyCommand({ board: { items: [] }, frames }, [{ id: "o", frameId: "f", op: "setLink", nodeId: "b", href: "/x" }])).toThrow(/screens/);
  });
});
