import { z } from "zod";
import { applyOps } from "./apply";
import { type Board, type BoardItem, BoardItemSchema } from "./board";
import { applyPatch, clone, deepEqual, diffObject } from "./deep";
import type { DiffOptions } from "./diff";
import type { Frame } from "./frame";
import { createId, IdSchema } from "./ids";
import { type JsonValue, JsonValueSchema } from "./json";
import { type Op, OpSchema } from "./ops";
import { type DesignRequest, DesignRequestSchema } from "./request";
import { EffectStyleSchema, StyleIdSchema, TextStyleSchema, ThemeIdSchema, type TokenGroup, type TokenGroups, TokenGroupSchema, type Tokens } from "./tokens";
import type { Project } from "./project";
import { diffFrame } from "./squash";

/**
 * Board ops arrange the planning board (frame placements, notes, arrows, sections). They are
 * applied together with frame ops in commands, but never become part of changesets.
 */
export const BoardOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ id: IdSchema, op: z.literal("addItem"), item: BoardItemSchema, index: z.int().min(0).optional() }),
  z.strictObject({
    id: IdSchema,
    op: z.literal("updateItem"),
    itemId: IdSchema,
    /** Shallow patch of the item; `null` removes a key. `id` and `type` cannot change. */
    patch: z.record(z.string(), JsonValueSchema),
  }),
  z.strictObject({ id: IdSchema, op: z.literal("removeItem"), itemId: IdSchema }),
  /** Moves an item in the z-order; `index` is counted after removing the item. */
  z.strictObject({ id: IdSchema, op: z.literal("reorderItem"), itemId: IdSchema, index: z.int().min(0) }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;

/** Design system edits. `value: null` removes the token. */
export const TokenOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    id: IdSchema,
    op: z.literal("setToken"),
    group: TokenGroupSchema,
    name: z.string().min(1),
    value: z.union([z.string(), z.number()]).nullable(),
    /** Sets the token's dark-mode value instead (null: the token looks the same in both schemes). */
    scheme: z.literal("dark").optional(),
    /** Sets the value in a named theme (screens with their own theme) instead of the project's. */
    theme: ThemeIdSchema.optional(),
  }),
  /** Creates or renames a named theme (`name`), or removes it with all its values (`null`). */
  z.strictObject({ id: IdSchema, op: z.literal("setTheme"), theme: ThemeIdSchema, name: z.string().min(1).nullable() }),
  /** Creates, replaces or (with `null`) removes a named text style. */
  z.strictObject({ id: IdSchema, op: z.literal("setTextStyle"), style: StyleIdSchema, value: TextStyleSchema.nullable() }),
  /** Creates, replaces or (with `null`) removes a named effect style. */
  z.strictObject({ id: IdSchema, op: z.literal("setEffectStyle"), style: StyleIdSchema, value: EffectStyleSchema.nullable() }),
]);
export type TokenOp = z.infer<typeof TokenOpSchema>;
export type SetTokenOp = Extract<TokenOp, { op: "setToken" }>;

/** Design requests (drawings on screens): created, changed or (with `null`) removed as a whole. */
export const RequestOpSchema = z.strictObject({ id: IdSchema, op: z.literal("setRequest"), requestId: IdSchema, request: DesignRequestSchema.nullable() });
export type RequestOp = z.infer<typeof RequestOpSchema>;

export type AnyOp = Op | BoardOp | TokenOp | RequestOp;
export const AnyOpSchema: z.ZodType<AnyOp> = z.union([OpSchema, BoardOpSchema, TokenOpSchema, RequestOpSchema]);

/** One user action, applied atomically. */
export const CommandSchema = z.strictObject({
  id: IdSchema,
  ops: z.array(AnyOpSchema).min(1),
});
export type Command = z.infer<typeof CommandSchema>;

const BOARD_OPS: ReadonlySet<string> = new Set(["addItem", "updateItem", "removeItem", "reorderItem"]);

export function isBoardOp(op: AnyOp): op is BoardOp {
  return BOARD_OPS.has(op.op);
}

export function isTokenOp(op: AnyOp): op is TokenOp {
  return op.op === "setToken" || op.op === "setTheme" || op.op === "setTextStyle" || op.op === "setEffectStyle";
}

export function isRequestOp(op: AnyOp): op is RequestOp {
  return op.op === "setRequest";
}

export function isFrameOp(op: AnyOp): op is Op {
  return !isBoardOp(op) && !isTokenOp(op) && !isRequestOp(op);
}

export class RequestOpError extends Error {
  constructor(op: RequestOp, message: string) {
    super(`${op.op} ${op.id}: ${message}`);
    this.name = "RequestOpError";
  }
}

/** Applies request ops and returns the new list (in creation order). The input is never mutated. */
export function applyRequestOps(requests: readonly DesignRequest[], ops: readonly RequestOp[]): DesignRequest[] {
  let list = [...requests];
  for (const op of ops) {
    if (op.request && op.request.id !== op.requestId) throw new RequestOpError(op, `request id ${op.request.id} does not match ${op.requestId}`);
    const index = list.findIndex((r) => r.id === op.requestId);
    if (op.request === null) {
      if (index < 0) throw new RequestOpError(op, `unknown request ${op.requestId}`);
      list = list.filter((r) => r.id !== op.requestId);
    } else if (index < 0) list.push(clone(op.request));
    else list[index] = clone(op.request);
  }
  return list;
}

function setValue(target: TokenGroups, group: TokenGroup, name: string, value: string | number | null): void {
  const values = (target[group] ??= {});
  if (value === null) delete values[name];
  else values[name] = value;
  if (Object.keys(values).length === 0) delete target[group];
}

export function applyTokenOps(tokens: Tokens, ops: readonly TokenOp[]): Tokens {
  const groups = clone(tokens.groups);
  const dark = clone(tokens.dark ?? {});
  const themes = clone(tokens.themes ?? {});
  const textStyles = clone(tokens.textStyles ?? {});
  const effectStyles = clone(tokens.effectStyles ?? {});
  for (const op of ops) {
    if (op.op === "setTextStyle" || op.op === "setEffectStyle") {
      const target: Record<string, unknown> = op.op === "setTextStyle" ? textStyles : effectStyles;
      if (op.value === null) delete target[op.style];
      else target[op.style] = clone(op.value);
      continue;
    }
    if (op.op === "setTheme") {
      if (op.name === null) delete themes[op.theme];
      else themes[op.theme] = { ...(themes[op.theme] ?? { groups: {} }), name: op.name };
      continue;
    }
    const fail = (message: string) => new Error(`${op.op} ${op.id}: ${message}`);
    if (op.theme !== undefined) {
      const theme = themes[op.theme];
      if (!theme) throw fail(`unknown theme ${op.theme}`);
      // themes change tokens of the project; they don't add new ones (the code's classes need them)
      if (op.value !== null && groups[op.group]?.[op.name] === undefined) throw fail(`theme value for unknown token ${op.group}.${op.name}`);
      if (op.scheme === "dark") {
        theme.dark ??= {};
        setValue(theme.dark, op.group, op.name, op.value);
        if (Object.keys(theme.dark).length === 0) delete theme.dark;
      } else {
        setValue(theme.groups, op.group, op.name, op.value);
      }
      continue;
    }
    if (op.scheme === "dark") {
      if (op.value !== null && groups[op.group]?.[op.name] === undefined) throw fail(`dark value for unknown token ${op.group}.${op.name}`);
      setValue(dark, op.group, op.name, op.value);
    } else {
      setValue(groups, op.group, op.name, op.value);
      if (op.value === null) {
        // a removed token takes its dark and theme values with it
        if (dark[op.group]?.[op.name] !== undefined) setValue(dark, op.group, op.name, null);
        for (const theme of Object.values(themes)) {
          if (theme.groups[op.group]?.[op.name] !== undefined) setValue(theme.groups, op.group, op.name, null);
          if (theme.dark?.[op.group]?.[op.name] !== undefined) {
            setValue(theme.dark, op.group, op.name, null);
            if (Object.keys(theme.dark).length === 0) delete theme.dark;
          }
        }
      }
    }
  }
  const { dark: _dark, themes: _themes, textStyles: _text, effectStyles: _effect, ...rest } = tokens;
  return {
    ...rest,
    groups,
    ...(Object.keys(dark).length > 0 && { dark }),
    ...(Object.keys(themes).length > 0 && { themes }),
    ...(Object.keys(textStyles).length > 0 && { textStyles }),
    ...(Object.keys(effectStyles).length > 0 && { effectStyles }),
  };
}

/**
 * Token ops that turn `from` into `to`: light values first, so dark and theme values always have
 * a token; new themes before their values; removed themes as one `setTheme` null.
 */
export function diffTokens(from: Tokens, to: Tokens, options: DiffOptions = {}): TokenOp[] {
  const newOpId = options.createOpId ?? (() => createId("op"));
  const ops: TokenOp[] = [];
  const diff = (a: TokenGroups, b: TokenGroups, extra: { scheme?: "dark"; theme?: string }) => {
    for (const group of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<TokenGroup>) {
      const x = a[group] ?? {};
      const y = b[group] ?? {};
      for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (x[name] === y[name]) continue;
        // removing a token removes its dark and theme values too
        if ((extra.scheme || extra.theme) && y[name] === undefined && to.groups[group]?.[name] === undefined) continue;
        ops.push({ id: newOpId(), op: "setToken", group, name, value: y[name] ?? null, ...(extra.scheme && { scheme: extra.scheme }), ...(extra.theme && { theme: extra.theme }) });
      }
    }
  };
  diff(from.groups, to.groups, {});
  diff(from.dark ?? {}, to.dark ?? {}, { scheme: "dark" });
  const a = from.themes ?? {};
  const b = to.themes ?? {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const before = a[id];
    const after = b[id];
    if (!after) {
      ops.push({ id: newOpId(), op: "setTheme", theme: id, name: null });
      continue;
    }
    if (before?.name !== after.name) ops.push({ id: newOpId(), op: "setTheme", theme: id, name: after.name });
    diff(before?.groups ?? {}, after.groups, { theme: id });
    diff(before?.dark ?? {}, after.dark ?? {}, { theme: id, scheme: "dark" });
  }
  // named styles after the tokens they use, each as a whole
  for (const [op, x, y] of [
    ["setTextStyle", from.textStyles ?? {}, to.textStyles ?? {}],
    ["setEffectStyle", from.effectStyles ?? {}, to.effectStyles ?? {}],
  ] as const) {
    for (const style of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (deepEqual(x[style], y[style])) continue;
      ops.push({ id: newOpId(), op, style, value: (y[style] ?? null) as never });
    }
  }
  return ops;
}

export class BoardOpError extends Error {
  readonly op: BoardOp;
  constructor(op: BoardOp, message: string) {
    super(`${op.op} ${op.id}: ${message}`);
    this.name = "BoardOpError";
    this.op = op;
  }
}

/** Applies board ops and returns a new board. The input is never mutated. */
export function applyBoardOps(board: Board, ops: readonly BoardOp[]): Board {
  const items = clone(board.items);
  const indexOf = (op: BoardOp, itemId: string) => {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new BoardOpError(op, `unknown item ${itemId}`);
    return index;
  };
  for (const op of ops) {
    switch (op.op) {
      case "addItem": {
        if (items.some((item) => item.id === op.item.id)) throw new BoardOpError(op, `item ${op.item.id} already exists`);
        const index = op.index ?? items.length;
        if (index > items.length) throw new BoardOpError(op, `index ${index} out of range (0..${items.length})`);
        items.splice(index, 0, parseItem(op, op.item));
        break;
      }
      case "updateItem": {
        if ("id" in op.patch || "type" in op.patch) throw new BoardOpError(op, "id and type cannot be patched");
        const index = indexOf(op, op.itemId);
        items[index] = parseItem(op, applyPatch(items[index]!, op.patch)!);
        break;
      }
      case "removeItem":
        items.splice(indexOf(op, op.itemId), 1);
        break;
      case "reorderItem": {
        const [item] = items.splice(indexOf(op, op.itemId), 1);
        if (op.index > items.length) throw new BoardOpError(op, `index ${op.index} out of range (0..${items.length})`);
        items.splice(op.index, 0, item!);
        break;
      }
    }
  }
  return { items };
}

function parseItem(op: BoardOp, item: unknown): BoardItem {
  const parsed = BoardItemSchema.safeParse(item);
  if (!parsed.success) throw new BoardOpError(op, `invalid item: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Board ops that turn `from` into `to`: removals, then adds/reorders in final order, then updates. */
export function diffBoard(from: Board, to: Board, options: DiffOptions = {}): BoardOp[] {
  const newOpId = options.createOpId ?? (() => createId("op"));
  const ops: BoardOp[] = [];
  const target = new Map(to.items.map((item) => [item.id, item]));
  const source = new Map(from.items.map((item) => [item.id, item]));

  const kept = (item: BoardItem) => target.get(item.id)?.type === item.type;
  for (const item of from.items) {
    if (!kept(item)) ops.push({ id: newOpId(), op: "removeItem", itemId: item.id });
  }

  const work = from.items.filter(kept).map((item) => item.id);
  to.items.forEach((item, i) => {
    const before = source.get(item.id);
    if (!before || before.type !== item.type) {
      ops.push({ id: newOpId(), op: "addItem", item: clone(item), index: i });
      work.splice(i, 0, item.id);
      return;
    }
    const current = work.indexOf(item.id);
    if (current !== i) {
      ops.push({ id: newOpId(), op: "reorderItem", itemId: item.id, index: i });
      work.splice(current, 1);
      work.splice(i, 0, item.id);
    }
  });

  for (const item of to.items) {
    const before = source.get(item.id);
    if (!before || before.type !== item.type) continue;
    const patch = diffObject(before, item);
    if (patch) ops.push({ id: newOpId(), op: "updateItem", itemId: item.id, patch: patch as Record<string, JsonValue> });
  }
  return ops;
}

/** The parts of a project that commands change. */
export interface DesignState {
  board: Board;
  frames: ReadonlyMap<string, Frame>;
  /** Required only for commands with token ops. */
  tokens?: Tokens;
  /** Design requests (drawings); commands with request ops start from none when absent. */
  requests?: readonly DesignRequest[];
}

/** Applies a command's ops in order (consecutive frame ops are applied in one batch). */
export function applyCommand(state: DesignState, ops: readonly AnyOp[]): DesignState {
  let { board, frames, tokens, requests } = state;
  let batch: Op[] = [];
  const flush = () => {
    if (batch.length > 0) frames = applyOps(frames, batch);
    batch = [];
  };
  for (const op of ops) {
    if (isBoardOp(op)) {
      flush();
      board = applyBoardOps(board, [op]);
    } else if (isTokenOp(op)) {
      if (!tokens) throw new Error(`${op.op} ${op.id}: this command needs the project tokens`);
      tokens = applyTokenOps(tokens, [op]);
    } else if (isRequestOp(op)) {
      requests = applyRequestOps(requests ?? [], [op]);
    } else {
      batch.push(op);
    }
  }
  flush();
  return { board, frames, ...(tokens && { tokens }), ...(requests && { requests }) };
}

/**
 * The ops that undo `ops` when applied after them. Computed from the states before and after,
 * so every op kind is covered without per-op inverse rules.
 */
export function invertCommand(before: DesignState, ops: readonly AnyOp[], options: DiffOptions = {}): AnyOp[] {
  const after = applyCommand(before, ops);
  const inverse: AnyOp[] = [];
  const touched = new Set(ops.filter(isFrameOp).map((op) => op.frameId));
  for (const frameId of touched) {
    inverse.push(...diffFrame(frameId, after.frames.get(frameId), before.frames.get(frameId), options));
  }
  if (!deepEqual(after.board, before.board)) inverse.push(...diffBoard(after.board, before.board, options));
  if (after.tokens && before.tokens) inverse.push(...diffTokens(after.tokens, before.tokens, options));
  const newOpId = options.createOpId ?? (() => createId("op"));
  for (const requestId of new Set(ops.filter(isRequestOp).map((op) => op.requestId))) {
    const was = before.requests?.find((r) => r.id === requestId);
    const now = after.requests?.find((r) => r.id === requestId);
    if (!deepEqual(was, now)) inverse.push({ id: newOpId(), op: "setRequest", requestId, request: was ? clone(was) : null });
  }
  return inverse;
}

/** Applies a command to a whole project. Frame order is kept; new frames are appended. */
export function applyCommandToProject(project: Project, ops: readonly AnyOp[]): Project {
  const next = applyCommand({ board: project.board, frames: new Map(project.frames.map((f) => [f.id, f])), tokens: project.tokens, ...(project.requests && { requests: project.requests }) }, ops);
  const frames = project.frames.filter((f) => next.frames.has(f.id)).map((f) => next.frames.get(f.id)!);
  const known = new Set(frames.map((f) => f.id));
  for (const [id, frame] of next.frames) if (!known.has(id)) frames.push(frame);
  const { requests: _requests, ...rest } = project;
  const requests = next.requests ?? project.requests;
  return { ...rest, board: next.board, frames, tokens: next.tokens ?? project.tokens, ...(requests && requests.length > 0 && { requests: [...requests] }) };
}
