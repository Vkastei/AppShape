import type { Op } from "@appshape/ir";
import type { Check, EvalCase } from "./cases";
import type { Screen } from "./tree";

/**
 * Scoring a proposal: the case's checks, and whether it changed only what was marked (changes
 * outside the case's scope are "collateral": what the evaluation counts against a model).
 */

export interface Score {
  checks: Check[];
  passed: number;
  /** Elements changed outside the scope (described). */
  collateral: string[];
  /** Design-system warnings of the proposal (colors that aren't tokens, unknown components, …). */
  warnings: string[];
  /** 0–1: checks passed, minus a little per collateral change and per warning. */
  score: number;
}

export function outOfScope(c: EvalCase, before: Screen, refs: Record<string, string>, ops: readonly Op[]): string[] {
  const roots = new Set(c.scope.map((r) => refs[r]!));
  const into = new Set((c.into ?? []).map((r) => refs[r]!));
  const fresh = new Set<string>();
  for (const op of ops) if (op.op === "insert") for (const id of ids(op.node)) fresh.add(id);
  const inScope = (id: string) => fresh.has(id) || roots.has(id) || before.ancestors(id).some((a) => roots.has(a.id));
  const outside = new Map<string, string>();
  const note = (id: string, what: string) => {
    const node = before.byId(id);
    outside.set(id, `${what} ${node?.name ?? node?.type ?? "element"} ${id}`);
  };
  for (const op of ops) {
    switch (op.op) {
      case "insert":
        if (!inScope(op.parentId) && !into.has(op.parentId)) note(op.parentId, "added into");
        break;
      case "move":
        if (!inScope(op.nodeId) && !(into.has(op.parentId) && into.has(before.parentOf(op.nodeId)?.id ?? ""))) note(op.nodeId, "moved");
        break;
      case "delete":
        if (!inScope(op.nodeId)) note(op.nodeId, "deleted");
        break;
      default:
        if ("nodeId" in op && typeof op.nodeId === "string" && !inScope(op.nodeId)) note(op.nodeId, `${op.op} on`);
    }
  }
  return [...outside.values()];
}

function ids(node: { id: string; children?: unknown }): string[] {
  const kids = Array.isArray(node.children) ? (node.children as { id: string }[]) : [];
  return [node.id, ...kids.flatMap((k) => ids(k))];
}

/** Variants: every one scored with the case's checks, and as many different ones as asked for. */
export function scoreVariants(scores: Score[], wanted: number): Score {
  const label = (i: number, text: string) => `${i + 1}: ${text}`;
  const checks = [...scores.flatMap((s, i) => s.checks.map((k) => ({ name: label(i, k.name), pass: k.pass }))), { name: `${wanted} different variants`, pass: scores.length === wanted }];
  const value = (scores.reduce((sum, s) => sum + s.score, 0) / Math.max(1, scores.length)) * (scores.length / wanted);
  return {
    checks,
    passed: checks.filter((k) => k.pass).length,
    collateral: scores.flatMap((s, i) => s.collateral.map((x) => label(i, x))),
    warnings: scores.flatMap((s, i) => s.warnings.map((x) => label(i, x))),
    score: Math.round(value * 100) / 100,
  };
}

export function score(c: EvalCase, before: Screen, after: Screen, refs: Record<string, string>, ops: readonly Op[], warnings: readonly string[]): Score {
  const checks = c.checks(after, before, refs);
  const passed = checks.filter((k) => k.pass).length;
  const collateral = outOfScope(c, before, refs, ops);
  const value = Math.max(0, passed / Math.max(1, checks.length) - 0.1 * collateral.length - 0.05 * warnings.length);
  return { checks, passed, collateral, warnings: [...warnings], score: Math.round(value * 100) / 100 };
}
