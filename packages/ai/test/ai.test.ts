import Anthropic from "@anthropic-ai/sdk";
import { defaultTokens } from "@appshape/dialect-tailwind";
import type { DesignRequest, Project } from "@appshape/ir";
import { beforeAll, describe, expect, it } from "vitest";
import { landingProject } from "../../../examples/codegen-demo/src/landing";
import { designJsx } from "@appshape/codegen";
import { AI_MODELS, AiError, ANSWER_SCHEMA, anthropicProvider, asAiError, costOf, createProvider, defaultAnswer, designParams, designPrompt, designRequest, expectedCost, fakeProvider, REVIEW_SCHEMA, reviewRequest, VARIANTS_SCHEMA } from "../src";

let project: Project;
const at = "2026-10-14T10:00:00.000Z";
const request = (patch: Partial<DesignRequest> = {}): DesignRequest => ({
  id: "rq_1",
  frameId: project.frames.find((f) => f.name === "Home")!.id,
  viewportId: "desktop",
  message: "A shorter heading",
  status: "designing",
  route: "ai",
  shapes: [{ id: "s_1", kind: "ellipse", color: "change", x: 100, y: 200, w: 600, h: 80 }],
  createdAt: at,
  updatedAt: at,
  ...patch,
});
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

beforeAll(async () => {
  project = landingProject(await defaultTokens());
});

/** A client whose stream answers with the given message. */
function client(message: Partial<Anthropic.Message>, seen: Anthropic.MessageCreateParamsNonStreaming[] = []) {
  return {
    messages: {
      stream: (params: Anthropic.MessageCreateParamsNonStreaming) => {
        seen.push(params);
        return { finalMessage: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 900, output_tokens: 4000, cache_read_input_tokens: 12000, cache_creation_input_tokens: 0 }, content: [], ...message }) };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
}

describe("the request to the Claude API", () => {
  it("puts the rules and the design system first (cached), then the pictures and the request", () => {
    const prompt = designPrompt(project, request());
    const params = designParams({ ...prompt, images: { clean: png, marked: png } }, "claude-opus-5-5", "medium");
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: ANSWER_SCHEMA } });
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system.map((b) => b.cache_control)).toEqual([undefined, { type: "ephemeral" }]);
    expect(system[0]!.text).toContain("## How to write the JSX");
    // AppShape's AI answers with changes by data-id, not the whole screen
    expect(system[0]!.text).toContain('"changes" lists only what changes');
    expect(system[0]!.text).not.toContain("Answer with the whole screen");
    expect(system[1]!.text).toContain("### Design tokens");
    const content = params.messages[0]!.content as Anthropic.TextBlockParam[];
    expect(content.map((b) => b.type)).toEqual(["text", "image", "text", "image", "text", "text"]);
    // the pictures and the screen are the second cached part; the job and the message come last
    expect(content[4]!.text).toContain("## The screen now");
    expect(content[4]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[5]!.text).toContain("A shorter heading");
    expect(content[5]!.text).not.toContain("```tsx");
    expect(content[5]!).not.toHaveProperty("cache_control");
    expect(params).not.toHaveProperty("thinking");
  });

  it("says which part of a long screen the pictures show", () => {
    const params = designParams({ ...designPrompt(project, request()), images: { clean: png, marked: png, part: { top: 1200, bottom: 3776, height: 5200 } } }, "claude-opus-5-5", "medium");
    const content = params.messages[0]!.content as Anthropic.TextBlockParam[];
    expect(content[0]!.text).toBe("The screen as it is (the part from y 1200 to 3776 px of the 5200 px tall screen, around the drawing; the JSX below is the whole screen):");
    expect(content[2]!.text).toBe("The screen with the drawing on top (the same part):");
  });

  it("keeps the pictures and the screen byte-identical on Try again (only the message changes)", () => {
    const first = designParams({ ...designPrompt(project, request()), images: { clean: png, marked: png } }, "claude-opus-5-5", "medium");
    const again = designParams({ ...designPrompt(project, request({ message: "Even shorter", history: [{ message: "A shorter heading", at }] })), images: { clean: png, marked: png } }, "claude-opus-5-5", "medium");
    const upToScreen = (p: typeof first) => JSON.stringify([p.system, (p.messages[0]!.content as unknown[]).slice(0, 5)]);
    expect(upToScreen(again)).toBe(upToScreen(first));
    expect(JSON.stringify(again.messages)).not.toBe(JSON.stringify(first.messages));
  });

  it("keeps the cached prefix byte-identical across requests of the project", () => {
    const a = designParams({ ...designPrompt(project, request()), images: {} }, "claude-opus-5-5", "medium");
    const other = project.frames.find((f) => f.name === "Components")!;
    const b = designParams({ ...designPrompt(project, request({ id: "rq_2", frameId: other.id, message: "Something else", history: [{ message: "before", at }] })), images: {} }, "claude-opus-5-5", "medium");
    expect(JSON.stringify(b.system)).toBe(JSON.stringify(a.system));
    expect(JSON.stringify(b.messages)).not.toBe(JSON.stringify(a.messages));
  });

  it("reads the structured answer and what it cost", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const changes = [{ op: "replace", target: "n_1", anchor: "", jsx: "<h1>Short</h1>" }, { op: "nonsense", target: "n_2", anchor: "", jsx: "" }];
    const provider = anthropicProvider({ model: "claude-opus-5-5", client: client({ content: [{ type: "text", text: JSON.stringify({ changes, summary: ["Shorter"], questions: [] }), citations: null }] }, seen) });
    const answer = await provider.design({ ...designPrompt(project, request()), images: {} });
    // unknown kinds of change are dropped
    expect(answer).toMatchObject({ edits: [changes[0]], summary: ["Shorter"], questions: [], usage: { inputTokens: 900, outputTokens: 4000, cacheReadTokens: 12000, cacheWriteTokens: 0 } });
    expect(answer.jsx).toBeUndefined();
    expect(costOf("claude-opus-5-5", answer.usage)).toBeCloseTo((900 * 4 + 4000 * 20 + 12000 * 0.2) / 1e6);
    expect(seen).toHaveLength(1);
  });

  it("asks for variants with their own answer shape, and reads each with its idea", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const variants = [
      { idea: "A bolder headline", changes: [{ op: "replace", target: "n_1", anchor: "", jsx: "<h1>Bold</h1>" }], summary: ["Bolder"] },
      { idea: "", changes: [{ op: "remove", target: "n_2", anchor: "", jsx: "" }], summary: [] },
    ];
    const provider = anthropicProvider({ model: "claude-opus-5-5", client: client({ content: [{ type: "text", text: JSON.stringify({ variants, questions: ["Which tone?"] }), citations: null }] }, seen) });
    const answer = await provider.design({ ...designPrompt(project, request({ variants: 3 })), images: {}, variants: 3 });
    expect(seen[0]!.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: VARIANTS_SCHEMA } });
    expect(answer.variants).toEqual([
      { idea: "A bolder headline", edits: [variants[0]!.changes[0]], summary: ["Bolder"] },
      { idea: "A variant", edits: [variants[1]!.changes[0]], summary: [] },
    ]);
    expect(answer.questions).toEqual(["Which tone?"]);
    // the request says how many and how they differ; the rules (cached) stay the same
    expect(designPrompt(project, request({ variants: 3 })).details).toContain("## 3 variants");
    expect(designPrompt(project, request({ variants: 3 })).system).toBe(designPrompt(project, request()).system);
  });

  it("reports refusals, cut-off answers and API errors in words", async () => {
    const design = (message: Partial<Anthropic.Message>) => anthropicProvider({ model: "claude-opus-5-5", client: client(message) }).design({ system: "", context: "", screen: "", details: "", images: {} });
    await expect(design({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "Not this." } as never })).rejects.toMatchObject({ kind: "refusal", message: "The model declined to design this: Not this." });
    await expect(design({ stop_reason: "max_tokens" })).rejects.toMatchObject({ kind: "cut-off" });
    await expect(design({ content: [{ type: "text", text: "not json", citations: null }] })).rejects.toMatchObject({ kind: "answer" });
    expect(asAiError(new Anthropic.APIUserAbortError())).toMatchObject({ kind: "cancelled" });
    expect(asAiError(new Anthropic.APIConnectionError({ message: "offline" }))).toMatchObject({ kind: "network" });
  });
});

describe("designing a request", () => {
  it("turns the answer into a proposal with the model, its cost and questions", async () => {
    const provider = fakeProvider((call) => ({ jsx: (/```tsx\n([\s\S]+?)\n```/.exec(call.screen)![1]!).replace(/(<h1[^>]*>)[^<]*/, "$1Ship faster"), questions: ["Is “faster” right?"] }), { model: "claude-sonnet-5-5" });
    const result = await designRequest({ project, request: request(), provider, images: { marked: png } });
    expect(result.rounds).toBe(1);
    expect(result.proposal).toMatchObject({ by: "claude-sonnet-5-5", questions: ["Is “faster” right?"], usage: { inputTokens: 1000, outputTokens: 200 } });
    expect(result.proposal.summary[0]).toMatch(/to “Ship faster”$/);
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6);
    expect(provider.calls[0]!.images.marked).toBe(png);
  });

  it("applies an answer of changes to the screen that was sent, and repairs changes it can't apply", async () => {
    const h1 = () => /<h1 data-id="([^"]+)"/.exec(designJsx(project.frames.find((f) => f.name === "Home")!, project))![1]!;
    const provider = fakeProvider((_call, round) => ({
      edits: [{ op: "replace", target: round === 1 ? "n_missing" : h1(), anchor: "", jsx: `<h1 data-id="${h1()}" className="type-h1 text-center">Ship faster</h1>` }],
      usage: { inputTokens: 1000, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }));
    const result = await designRequest({ project, request: request(), provider, images: {} });
    expect(result.rounds).toBe(2);
    expect(provider.calls[1]!.repair?.problems[0]).toContain('no element with data-id "n_missing"');
    expect(result.proposal.summary[0]).toMatch(/to “Ship faster”$/);
    expect(result.proposal.usage?.outputTokens).toBe(240);
  });

  it("sends what it couldn't use back for one repair round", async () => {
    const provider = fakeProvider((call, round) => (round === 1 ? "I would make it shorter." : (/```tsx\n([\s\S]+?)\n```/.exec(call.screen)![1]!).replace("</h1>", "</h1>\n<p>Fast.</p>")));
    const result = await designRequest({ project, request: request(), provider, images: {} });
    expect(result.rounds).toBe(2);
    expect(provider.calls[1]!.repair?.problems).toEqual(["The answer has no JSX element."]);
    expect(provider.calls[1]!.repair?.previous.jsx).toBe("I would make it shorter.");

    const unknown = fakeProvider((call, round) => (/```tsx\n([\s\S]+?)\n```/.exec(call.screen)![1]!).replace("</h1>", round === 1 ? "</h1>\n<Hero />" : "</h1>\n<p>Fast.</p>"));
    expect((await designRequest({ project, request: request(), provider: unknown, images: {} })).rounds).toBe(2);
    expect(unknown.calls[1]!.repair?.problems).toEqual(["<Hero> is not a component of this project: read as a plain element."]);

    await expect(designRequest({ project, request: request(), provider: fakeProvider(() => "still no jsx"), images: {} })).rejects.toBeInstanceOf(AiError);
    await expect(designRequest({ project, request: request(), provider: fakeProvider((call) => /```tsx\n([\s\S]+?)\n```/.exec(call.screen)![1]!), images: {} })).rejects.toMatchObject({ message: "The AI answered with the screen unchanged. Try again with more detail." });
  });

  it("designs three variants in one request: the first is the proposal, the others its alternatives", async () => {
    const provider = fakeProvider(defaultAnswer, { model: "claude-sonnet-5-5" });
    const result = await designRequest({ project, request: request({ variants: 3 }), provider, images: {} });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.variants).toBe(3);
    expect(result.proposal).toMatchObject({ variant: 1, idea: "A bold headline" });
    expect(result.alternatives.map((p) => [p.variant, p.idea])).toEqual([
      [2, "A friendly headline"],
      [3, "A short headline"],
    ]);
    expect(result.alternatives[1]!.summary[0]).toMatch(/“Designed by the fake AI \(3\)”$/);
    // one cost for the request, on each of them
    expect(result.alternatives[0]!.usage).toEqual(result.proposal.usage);
  });

  it("repairs variants that are the same or can't be used, and leaves out the ones that still fail", async () => {
    const jsx = (call: { screen: string }) => /```tsx\n([\s\S]+?)\n```/.exec(call.screen)![1]!;
    const heading = (call: { screen: string }, text: string) => jsx(call).replace(/(<h1[^>]*>)[^<]*/, `$1${text}`);
    const provider = fakeProvider((call, round) => ({
      variants: [
        { idea: "One", jsx: heading(call, "Ship faster"), summary: [] },
        { idea: "Same", jsx: heading(call, round === 1 ? "Ship faster" : "Build calmer"), summary: [] },
        { idea: "Broken", jsx: "no jsx", summary: [] },
      ],
    }));
    const result = await designRequest({ project, request: request({ variants: 3 }), provider, images: {} });
    expect(result.rounds).toBe(2);
    expect(provider.calls[1]!.repair?.problems).toEqual(["Variant 3: The answer has no JSX element.", "Variants 1 and 2 are the same design: make each one different."]);
    expect([result.proposal, ...result.alternatives].map((p) => [p.variant, p.idea])).toEqual([
      [1, "One"],
      [2, "Same"],
    ]);
  });

  it("reviews a screen: findings in plain words, only elements on the screen, the important ones first", async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const h1 = /<h1 data-id="([^"]+)"/.exec(designJsx(project.frames.find((f) => f.name === "Home")!, project))![1]!;
    const findings = [
      { title: "Tighter spacing", why: "It feels loose.", fix: "Use less space between the sections.", targets: ["n_nowhere"], severity: "nice" },
      { title: "One main message", why: "Visitors read only the heading.", fix: "Make the heading shorter.", targets: [h1], severity: "important" },
    ];
    const provider = anthropicProvider({ model: "claude-sonnet-5-5", client: client({ content: [{ type: "text", text: JSON.stringify({ summary: "Clean and calm.", findings }), citations: null }] }, seen) });
    const result = await reviewRequest({ project, request: request({ intent: "review", message: "", shapes: [] }), provider, images: { clean: png } });
    expect(seen[0]!.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } });
    expect((seen[0]!.system as Anthropic.TextBlockParam[])[0]!.text).toContain("Write for someone without design experience");
    expect(result.review).toMatchObject({ summary: "Clean and calm.", by: "claude-opus-5-5" });
    expect(result.review.findings.map((f) => [f.id, f.title, f.severity, f.targets])).toEqual([
      ["f1", "One main message", "important", [h1]],
      ["f2", "Tighter spacing", "nice", undefined],
    ]);
    // the fake reviews too (for the board's tests)
    const fake = await reviewRequest({ project, request: request({ intent: "review", message: "", shapes: [] }), provider: fakeProvider(defaultAnswer), images: {} });
    expect(fake.review.findings[0]).toMatchObject({ title: "A shorter main heading", targets: [h1] });
  });

  it("estimates the cost before it runs", () => {
    const opus = expectedCost(project, request(), "claude-opus-5-5");
    expect(opus).toBeGreaterThan(0.05);
    expect(opus).toBeLessThan(1);
    expect(expectedCost(project, request(), "claude-sonnet-5-5")).toBeCloseTo(opus / 2, 2);
    // three variants: the request is sent once, the answer is three times as long
    const three = expectedCost(project, request({ variants: 3 }), "claude-opus-5-5");
    expect(three).toBeGreaterThan(opus * 1.1);
    expect(three).toBeLessThan(opus * 2);
  });
});

describe("models and providers", () => {
  it("offers Opus, Sonnet and Haiku from Anthropic, each with a provider for its id", () => {
    expect(AI_MODELS.map((m) => [m.id, m.provider])).toEqual([
      ["claude-opus-5-5", "anthropic"],
      ["claude-sonnet-5-5", "anthropic"],
      ["claude-haiku-5-5", "anthropic"],
    ]);
    expect(createProvider("claude-haiku-5-5", { apiKey: "sk-test" }).model).toBe("claude-haiku-5-5");
    // the effort each designs with, chosen with the evaluation
    expect(AI_MODELS.map((m) => m.effort)).toEqual(["medium", "medium", "low"]);
  });

  it("prices Haiku by the prompt's length", () => {
    const usage = { inputTokens: 20_000, outputTokens: 4_000, cacheReadTokens: 1_000, cacheWriteTokens: 0 };
    expect(costOf("claude-haiku-5-5", usage)).toBeCloseTo((20_000 * 0.1 + 4_000 * 0.5 + 1_000 * 0.01) / 1e6);
    expect(costOf("claude-haiku-5-5", { ...usage, inputTokens: 120_000 })).toBeCloseTo((120_000 * 0.5 + 4_000 * 2.5 + 1_000 * 0.05) / 1e6);
  });
});
