import { applyJsxEdits, DESIGN_RULES, DesignJsxError, designJsx, JsxEditError, type ProposalDraft, projectContext, proposal, proposeFromJsx, proposeOptionsFor, REVIEW_GUIDE, requestSplit, reviewFrom } from "@appshape/codegen";
import type { DesignRequest, Project, Proposal, Review } from "@appshape/ir";
import { addUsage, costOf, estimateCost, NO_USAGE, type Usage } from "./models";
import { AiError, type DesignAnswer, type DesignImages, type DesignProvider } from "./provider";

/**
 * Designing a drawn request with AppShape's AI: the rules, the project's design system, the
 * pictures and the request go to the model; its JSX becomes a proposal. When AppShape can't use
 * the answer (JSX it can't read, things that aren't in the project), the problems go back to the
 * model for one repair round.
 */

/** Who the model is. Naming the patterns to avoid works better than "make it look good". */
export const DESIGNER = `You are the designer inside AppShape, a visual editor for React + Tailwind apps. Someone marked up a screen of their app the way people mark up a printout and described the change. You get the screen as "design JSX" (React + Tailwind as AppShape writes it, with a data-id on every element) and answer with the changes to it.

Design like the rest of the app: use its components, its design tokens, its spacing and type, and keep its visual language. Make exactly the change asked for, well; everything else stays as it is. Avoid what makes designs look generic: new colors or shadows outside the tokens, arbitrary values, emoji as icons, lorem ipsum, centering everything, decorative gradients nobody asked for. Write real, short copy that fits the app when new text is needed. When something is unclear, make the most sensible choice and say what you assumed in "questions".

Answer as JSON with "changes", "summary" (the changes in words, one short sentence each) and "questions" (what you were unsure about; empty when nothing).

"changes" lists only what changes, in order, each with "op", "target", "anchor" and "jsx" (empty strings where unused):
- "update": only the classes or properties of the element "target" change; "jsx" is its new opening tag (e.g. <div data-id="…" className="…">) and its children stay as they are.
- "replace": the element with data-id "target" becomes "jsx" (its whole new version, children included; keep the data-id of everything you keep inside it).
- "insertBefore" / "insertAfter": new elements ("jsx") go right before or after the element "target".
- "append": new elements ("jsx") go at the end, inside the element "target".
- "remove": the element "target" goes.
- "moveBefore" / "moveAfter": the element "target" moves right before or after the element "anchor", unchanged.
- "screen": "jsx" is the whole new screen; only when most of it changes.
Keep changes small: replace the innermost element that contains a change, not its section or the page.

When the request asks for variants, answer with "variants" (each with "idea": its idea in a few words, "changes" and "summary") and "questions" instead; every variant's changes apply to the screen as it was sent.`;

/** Who the model is for a review (Ask AI → Review this page). */
export const REVIEWER = `You are the designer inside AppShape, a visual editor for React + Tailwind apps, reviewing one screen of an app. You get the screen as a picture and as "design JSX" (React + Tailwind, a data-id on every element), and the app's design system.

${REVIEW_GUIDE}

Answer as JSON with "summary" and "findings" (each with "title", "why", "fix", "targets" and "severity"). Don't design anything yourself: the owner picks which findings to fix.`;

export interface ReviewResult {
  review: Review;
  usage: Usage;
  costUsd: number;
}

/** Reviews a screen: findings in plain words, each of which can become a change (`fixing`). */
export async function reviewRequest(input: { project: Project; request: DesignRequest; provider: DesignProvider; images: DesignImages; signal?: AbortSignal; now?: () => string }): Promise<ReviewResult> {
  const { project, request, provider } = input;
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new AiError("The screen of this review doesn't exist any more.", "answer");
  const { screen, ask } = requestSplit(project, request);
  const answer = await provider.design({ system: REVIEWER, context: projectContext(project, frame), screen, details: ask, images: input.images, mode: "review", ...(input.signal && { signal: input.signal }) });
  if (!answer.review) throw new AiError("The answer wasn't a review.", "answer");
  const by = answer.model || provider.model;
  const costUsd = costOf(by, answer.usage);
  const review = reviewFrom(frame, answer.review, by, input.now?.());
  return {
    review: { ...review, usage: { inputTokens: answer.usage.inputTokens + answer.usage.cacheReadTokens + answer.usage.cacheWriteTokens, outputTokens: answer.usage.outputTokens, costUsd: Math.round(costUsd * 10000) / 10000 } },
    usage: answer.usage,
    costUsd,
  };
}

export interface DesignResult {
  /** The proposal; with variants, the first one. */
  proposal: Proposal;
  /** The other variants (empty without). */
  alternatives: Proposal[];
  usage: Usage;
  costUsd: number;
  /** 1, or 2 with a repair round. */
  rounds: number;
}

/** Answer warnings that mean the model left the project's vocabulary (worth one more round). */
const REPAIRABLE = [/^Hard to read: /, /looks different on larger screens/, /is not a component of this project/, /has no property/, /has no slot/, /takes no children/, /isn't a plain value/, /was left out/, /Colors that aren't tokens/];

/** The parts of a request for the model (the first two are the cached prefix; the screen is cached with the pictures). */
export function designPrompt(project: Project, request: DesignRequest): { system: string; context: string; screen: string; details: string } {
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) throw new AiError("The screen of this drawing doesn't exist any more.", "answer");
  const { screen, ask } = requestSplit(project, request);
  return { system: `${DESIGNER}\n\n${DESIGN_RULES}`, context: projectContext(project, frame), screen, details: ask };
}

/** What a request is expected to cost (shown before it runs). */
export function expectedCost(project: Project, request: DesignRequest, model: string): number {
  const frame = project.frames.find((f) => f.id === request.frameId);
  if (!frame) return 0;
  const prompt = designPrompt(project, request);
  const viewport = frame.viewports.find((v) => v.id === request.viewportId) ?? frame.viewports[0]!;
  // the pictures: as tall as the screen (guessed from its JSX: ~0.15 px a character), at most one picture's height
  const jsxChars = designJsx(frame, project).length;
  const tallest = Math.floor(2576 / Math.min(1, 2576 / viewport.width));
  const picture = { width: viewport.width, height: Math.min(tallest, Math.max(viewport.height ?? 800, Math.round(jsxChars * 0.15))) };
  return estimateCost(model, { textChars: prompt.system.length + prompt.context.length + prompt.screen.length + prompt.details.length, jsxChars, images: [picture, picture], variants: request.variants ?? 1 });
}

/** The answer as the whole screen's JSX: its changes applied to the screen that was sent. */
function answerJsx(answer: Pick<DesignAnswer, "edits" | "jsx">, sent: string): string {
  if (answer.edits?.length) return applyJsxEdits(sent, answer.edits);
  if (answer.jsx?.trim()) return answer.jsx;
  throw new JsxEditError(["The answer has no changes."]);
}

/** One design of an answer read into a proposal draft, or the problems that stopped it. */
interface Read {
  draft?: ProposalDraft;
  problems: string[];
  idea?: string;
}

function readDesign(project: Project, request: DesignRequest, sent: string, design: Pick<DesignAnswer, "edits" | "jsx">, idea?: string): Read {
  const frame = project.frames.find((f) => f.id === request.frameId)!;
  try {
    const draft = proposeFromJsx(project, frame.id, answerJsx(design, sent), proposeOptionsFor(project, request));
    const problems = draft.warnings.filter((w) => REPAIRABLE.some((r) => r.test(w)));
    if (draft.ops.length === 0) problems.push("The answer is the screen as it was: nothing changed.");
    return { draft, problems, ...(idea && { idea }) };
  } catch (error) {
    if (!(error instanceof DesignJsxError) && !(error instanceof JsxEditError)) throw error;
    return { problems: error instanceof JsxEditError ? error.problems : [error.message], ...(idea && { idea }) };
  }
}

/** Every design of an answer (one, or each variant), and what's wrong with the answer as a whole. */
function readAnswer(project: Project, request: DesignRequest, sent: string, answer: DesignAnswer): { reads: Read[]; problems: string[] } {
  const count = request.variants ?? 1;
  if (count < 2 || !answer.variants) {
    const read = readDesign(project, request, sent, answer);
    return { reads: [read], problems: read.problems };
  }
  const reads = answer.variants.slice(0, count).map((v) => readDesign(project, request, sent, v, v.idea));
  const problems = reads.flatMap((r, i) => r.problems.map((p) => `Variant ${i + 1}: ${p}`));
  if (reads.length < count) problems.push(`The answer has ${reads.length} variant${reads.length === 1 ? "" : "s"} instead of ${count}.`);
  const seen = new Map<string, number>();
  reads.forEach((r, i) => {
    if (!r.draft?.ops.length) return;
    const key = designKey(r.draft);
    const same = seen.get(key);
    if (same !== undefined) problems.push(`Variants ${same + 1} and ${i + 1} are the same design: make each one different.`);
    else seen.set(key, i);
  });
  return { reads, problems };
}

/** What a design makes of the screen (two variants with the same one are the same design). */
const designKey = (draft: ProposalDraft) => JSON.stringify(draft.root, (key, value) => (key === "id" ? undefined : value));

export async function designRequest(input: { project: Project; request: DesignRequest; provider: DesignProvider; images: DesignImages; signal?: AbortSignal; now?: () => string }): Promise<DesignResult> {
  const { project, request, provider } = input;
  const frame = project.frames.find((f) => f.id === request.frameId)!;
  const prompt = designPrompt(project, request);
  const sent = designJsx(frame, project);
  const count = request.variants ?? 1;
  let usage = NO_USAGE;
  let answer: DesignAnswer | undefined;
  let reads: Read[] = [];
  let problems: string[] = [];
  let rounds = 0;
  for (let round = 1; round <= 2; round++) {
    rounds = round;
    answer = await provider.design({ ...prompt, images: input.images, ...(count > 1 && { variants: count }), ...(round > 1 && answer && { repair: { previous: answer, problems } }), ...(input.signal && { signal: input.signal }) });
    usage = addUsage(usage, answer.usage);
    ({ reads, problems } = readAnswer(project, request, sent, answer));
    if (problems.length === 0 || round === 2) break;
  }
  // the designs that can be used, each different (variants that still fail after the repair round are left out)
  const seen = new Set<string>();
  const usable = reads.filter((r): r is Read & { draft: ProposalDraft } => {
    if (!r.draft?.ops.length) return false;
    const key = designKey(r.draft);
    return !seen.has(key) && Boolean(seen.add(key));
  });
  if (usable.length === 0) {
    if (reads.some((r) => r.draft)) throw new AiError("The AI answered with the screen unchanged. Try again with more detail.", "answer");
    throw new AiError(`AppShape couldn't use the design: ${problems.join(" ")}`, "answer");
  }
  const by = answer!.model || provider.model;
  const costUsd = costOf(by, usage);
  const made = usable.map((r, i): Proposal => ({
    ...proposal(frame, r.draft, by, input.now?.()),
    ...(count > 1 && { variant: i + 1, ...(r.idea && { idea: r.idea }) }),
    ...(answer!.questions.length && { questions: answer!.questions }),
    usage: { inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens, costUsd: Math.round(costUsd * 10000) / 10000 },
  }));
  return { proposal: made[0]!, alternatives: made.slice(1), usage, costUsd, rounds };
}
