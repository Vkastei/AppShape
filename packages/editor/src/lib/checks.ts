import type { Project } from "@appshape/ir";
import { checkProject, type Finding } from "@appshape/kit";
import { useMemo } from "react";
import { dispatch, selectNode, useEditor } from "../store";
import { saveUiState } from "./api";
import { newOpId } from "./board";
import { fitCamera } from "./view";

let cache: { frames: Project["frames"]; tokens: Project["tokens"]; findings: Finding[] } | undefined;

/** Design check findings for the whole project: computed once per change of designs or tokens, shared by every view. */
export function useFindings(): Finding[] {
  const frames = useEditor((s) => s.project?.frames);
  const tokens = useEditor((s) => s.project?.tokens);
  if (!frames || !tokens) return [];
  if (cache?.frames !== frames || cache.tokens !== tokens) cache = { frames, tokens, findings: checkProject({ frames, tokens }) };
  return cache.findings;
}

/** Findings that count (not ignored; errors and warnings), per screen. */
export function useFindingCounts(): Map<string, number> {
  const findings = useFindings();
  const ignored = useEditor((s) => s.ignoredChecks);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of findings) if (f.severity !== "info" && !ignored.includes(f.key)) counts.set(f.frameId, (counts.get(f.frameId) ?? 0) + 1);
    return counts;
  }, [findings, ignored]);
}

export function setIgnored(key: string, ignore: boolean): void {
  const { ignoredChecks, token } = useEditor.getState();
  const next = ignore ? [...new Set([...ignoredChecks, key])] : ignoredChecks.filter((k) => k !== key);
  useEditor.setState({ ignoredChecks: next });
  if (token) void saveUiState(token, { ignoredChecks: next }).catch(() => {});
}

/** Shows a finding's element (or its screen) on the board and selects it. */
export function showFinding(finding: Finding): void {
  const { project } = useEditor.getState();
  const placement = project?.board.items.find((i) => i.type === "frame" && i.frameId === finding.frameId);
  if (!project || !placement) return;
  const camera = fitCamera([placement]);
  if (camera) useEditor.setState({ camera });
  const frame = project.frames.find((f) => f.id === finding.frameId)!;
  selectNode({ itemId: placement.id, frameId: finding.frameId, nodeId: finding.nodeId ?? frame.current.id });
}

export function fixFinding(finding: Finding): void {
  // fresh op ids: the same fix can be applied again after an undo
  if (finding.fix) dispatch(finding.fix.ops.map((op) => ({ ...op, id: newOpId() })));
}

/** Applies every fix at once (one Ctrl+Z undoes them all). */
export function fixAll(findings: readonly Finding[]): void {
  const ops = findings.flatMap((f) => (f.fix ? f.fix.ops.map((op) => ({ ...op, id: newOpId() })) : []));
  if (ops.length > 0) dispatch(ops);
}
