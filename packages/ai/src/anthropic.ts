import Anthropic from "@anthropic-ai/sdk";
import { JSX_EDIT_OPS, type JsxEdit } from "@appshape/codegen";
import { AiError, type DesignAnswer, type DesignCall, type DesignProvider } from "./provider";

/**
 * AppShape's AI on the Claude API (the official TypeScript SDK). Streaming, with the final message
 * collected at the end; the answer is structured output (`{ jsx, summary, questions }`). The
 * request is laid out for prompt caching: the rules and the project's design system first (cached),
 * then the pictures and the screen (cached too), then the job and the message. *Try again* and the
 * repair round reuse both cached parts.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  /** The user's key; without one the SDK reads ANTHROPIC_API_KEY (or a CLI login) itself. */
  apiKey?: string;
  model: string;
  effort?: Effort;
  /** A client to use instead of a new one (tests). */
  client?: Pick<Anthropic, "messages">;
}

const CHANGES = {
  type: "array",
  description: "Only what changes, in order.",
  items: {
    type: "object",
    properties: {
      op: { type: "string", enum: [...JSX_EDIT_OPS] },
      target: { type: "string", description: "The data-id of the element (empty for screen)." },
      anchor: { type: "string", description: "For moves: the data-id to move next to (else empty)." },
      jsx: { type: "string", description: "The new JSX (empty for remove and moves)." },
    },
    required: ["op", "target", "anchor", "jsx"],
    additionalProperties: false,
  },
} as const;
const SUMMARY = { type: "array", items: { type: "string" }, description: "The changes, one short sentence each." } as const;
const QUESTIONS = { type: "array", items: { type: "string" }, description: "What you were unsure about (empty when nothing)." } as const;

/** The answer's shape (structured output). */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: { changes: CHANGES, summary: SUMMARY, questions: QUESTIONS },
  required: ["changes", "summary", "questions"],
  additionalProperties: false,
} as const;

/** The answer's shape for a review: findings about the screen, no changes. */
export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "The screen as a whole in one sentence, starting with what works." },
    findings: {
      type: "array",
      description: "At most 5, the most important first.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to improve, a few words." },
          why: { type: "string", description: "Why it matters to the people using the app, one sentence, no jargon." },
          fix: { type: "string", description: "What to change, one sentence, concrete enough to design it." },
          targets: { type: "array", items: { type: "string" }, description: "The data-ids of the elements it's about." },
          severity: { type: "string", enum: ["important", "nice"] },
        },
        required: ["title", "why", "fix", "targets", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "findings"],
  additionalProperties: false,
} as const;

/** The answer's shape when variants are asked for: each its own changes to the screen as sent. */
export const VARIANTS_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      description: "The variants, each a different design made from the screen as sent.",
      items: {
        type: "object",
        properties: { idea: { type: "string", description: "The variant's idea in a few words." }, changes: CHANGES, summary: SUMMARY },
        required: ["idea", "changes", "summary"],
        additionalProperties: false,
      },
    },
    questions: QUESTIONS,
  },
  required: ["variants", "questions"],
  additionalProperties: false,
} as const;

/** Up to 64k tokens: a long landing page's JSX plus the model's thinking. */
const MAX_TOKENS = 64_000;

const png = (data: Uint8Array): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(data).toString("base64") } });

/** The request as sent (exported for tests: the cached prefix must stay byte-identical). */
export function designParams(call: DesignCall, model: string, effort: Effort): Anthropic.MessageCreateParamsNonStreaming {
  const variants = call.variants ?? 1;
  const user: Anthropic.ContentBlockParam[] = [];
  const part = call.images.part;
  // a long screen: the pictures show the part around the drawing (the JSX is the whole screen)
  const where = part ? ` (the part from y ${part.top} to ${part.bottom} px of the ${part.height} px tall screen, around the drawing; the JSX below is the whole screen)` : "";
  if (call.images.clean) user.push({ type: "text", text: `The screen as it is${where}:` }, png(call.images.clean));
  if (call.images.marked) user.push({ type: "text", text: `The screen with the drawing on top${part ? " (the same part)" : ""}:` }, png(call.images.marked));
  // the screen ends the second cached part (pictures and screen stay the same on Try again and in the repair round); the message comes last
  if (call.screen) user.push({ type: "text", text: call.screen, cache_control: { type: "ephemeral" } });
  user.push({ type: "text", text: call.details });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  if (call.repair) {
    const previous = call.repair.previous.transcript as Anthropic.ContentBlock[] | undefined;
    messages.push(
      { role: "assistant", content: previous ?? [{ type: "text", text: JSON.stringify(answerJson(call.repair.previous)) }] },
      {
        role: "user",
        content: `AppShape couldn't use that answer as it is:\n${call.repair.problems.map((p) => `- ${p}`).join("\n")}\n\n${variants > 1 ? `Answer again with all ${variants} variants, corrected (the ones without problems as they were; the screen is still as it was sent).` : "Answer again with all the changes, corrected (the screen is still as it was sent)."}`,
      },
    );
  }
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: call.system },
      // the project's design system ends the cached prefix
      { type: "text", text: call.context, cache_control: { type: "ephemeral" } },
    ],
    messages,
    output_config: { effort, format: { type: "json_schema", schema: (call.mode === "review" ? REVIEW_SCHEMA : variants > 1 ? VARIANTS_SCHEMA : ANSWER_SCHEMA) as unknown as Record<string, unknown> } },
  };
}

export function anthropicProvider(options: AnthropicProviderOptions): DesignProvider {
  const client = options.client ?? new Anthropic({ ...(options.apiKey && { apiKey: options.apiKey }) });
  const effort = options.effort ?? "medium";
  return {
    model: options.model,
    async design(call: DesignCall): Promise<DesignAnswer> {
      let message: Anthropic.Message;
      try {
        message = await client.messages.stream(designParams(call, options.model, effort), { ...(call.signal && { signal: call.signal }) }).finalMessage();
      } catch (error) {
        throw asAiError(error);
      }
      if (message.stop_reason === "refusal") {
        throw new AiError(`The model declined to design this${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : "."}`, "refusal");
      }
      if (message.stop_reason === "max_tokens") throw new AiError("The answer was cut off (the screen is very long). Try a smaller change, or Sonnet.", "cut-off");
      const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
      let parsed: { changes?: unknown; jsx?: unknown; summary?: unknown; questions?: unknown; variants?: unknown };
      try {
        parsed = JSON.parse(text ?? "") as typeof parsed;
      } catch {
        throw new AiError("The answer wasn't in the expected form.", "answer");
      }
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
      const editsOf = (v: unknown) => (Array.isArray(v) ? v.filter(isEdit) : []);
      const u = message.usage;
      const usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
      if (call.mode === "review") {
        const findings = (Array.isArray((parsed as { findings?: unknown }).findings) ? (parsed as { findings: unknown[] }).findings : []).filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object");
        const text = (v: unknown) => (typeof v === "string" ? v : undefined);
        const review = {
          ...(text((parsed as { summary?: unknown }).summary) && { summary: text((parsed as { summary?: unknown }).summary) }),
          findings: findings.map((f) => ({ title: text(f.title), why: text(f.why), fix: text(f.fix), severity: text(f.severity), targets: Array.isArray(f.targets) ? f.targets.filter((t): t is string => typeof t === "string") : [] })),
        };
        return { review, summary: [], questions: [], usage, model: message.model, transcript: message.content };
      }
      if ((call.variants ?? 1) > 1) {
        const variants = (Array.isArray(parsed.variants) ? parsed.variants : []).map((v: { idea?: unknown; changes?: unknown; summary?: unknown } | null) => ({
          idea: typeof v?.idea === "string" && v.idea.trim() ? v.idea.trim().slice(0, 120) : "A variant",
          edits: editsOf(v?.changes),
          summary: strings(v?.summary),
        }));
        if (!variants.some((v) => v.edits.length)) throw new AiError("The answer has no changes.", "answer");
        return { variants, summary: variants.flatMap((v) => v.summary), questions: strings(parsed.questions), usage, model: message.model, transcript: message.content };
      }
      const edits = editsOf(parsed.changes);
      if (!edits.length && typeof parsed.jsx !== "string") throw new AiError("The answer has no changes.", "answer");
      return {
        ...(edits.length ? { edits } : { jsx: parsed.jsx as string }),
        summary: strings(parsed.summary),
        questions: strings(parsed.questions),
        usage,
        model: message.model,
        transcript: message.content,
      };
    },
  };
}

/** An answer as the model would have written it (a repair round without the original transcript). */
function answerJson(answer: DesignAnswer): unknown {
  const changes = (a: { edits?: JsxEdit[]; jsx?: string }) => a.edits ?? [{ op: "screen", target: "", anchor: "", jsx: a.jsx ?? "" }];
  if (answer.variants) return { variants: answer.variants.map((v) => ({ idea: v.idea, changes: changes(v), summary: v.summary })), questions: answer.questions };
  return { changes: changes(answer), summary: answer.summary, questions: answer.questions };
}

function isEdit(value: unknown): value is JsxEdit {
  const v = value as Record<string, unknown> | null;
  return Boolean(v) && (JSX_EDIT_OPS as readonly unknown[]).includes(v!.op) && typeof v!.target === "string" && typeof v!.anchor === "string" && typeof v!.jsx === "string";
}

/** SDK errors in words for the person. */
export function asAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new AiError("Cancelled.", "cancelled");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiError("The API key wasn't accepted. Check it in the settings.", "key");
  if (error instanceof Anthropic.RateLimitError) return new AiError("Too many requests right now (rate limit). Try again in a minute; the drawing is kept.", "rate");
  if (error instanceof Anthropic.APIConnectionError) return new AiError("Couldn't reach the Claude API. Check the internet connection; the drawing is kept.", "network");
  if (error instanceof Anthropic.APIError) return new AiError(`The Claude API answered with an error${error.status ? ` (${error.status})` : ""}: ${error.message}`, "api");
  if (error instanceof Error && error.name === "AbortError") return new AiError("Cancelled.", "cancelled");
  return new AiError(error instanceof Error ? error.message : String(error), "api");
}
