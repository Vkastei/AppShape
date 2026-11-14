/**
 * The models AppShape's AI can use, who provides them, their prices (USD per million tokens) and
 * what a request costs. Opus 5.5 by default; Sonnet 5.5 and Haiku 5.5 as cheaper choices. Other
 * providers (OpenAI, …) can be added here with their own entry in `AI_PROVIDERS`.
 */

export interface AiProviderInfo {
  id: string;
  label: string;
  /** The environment variable the terminal's key comes from. */
  keyEnv: string;
}

export const AI_PROVIDERS: readonly AiProviderInfo[] = [{ id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" }];

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes. */
  cacheWrite: number;
}

export interface AiModel {
  id: string;
  label: string;
  /** An `AI_PROVIDERS` id. */
  provider: string;
  /** What it is good for, in a few words. */
  note: string;
  /** The effort it designs with (chosen with the evaluation, examples/draw-eval). */
  effort: "low" | "medium" | "high";
  /** USD per million tokens. */
  price: Price;
  /** Prices for the whole request when its prompt is longer than `tokens`. */
  longPrompt?: { tokens: number; price: Price };
}

export const AI_MODELS: readonly AiModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", note: "designs best", effort: "medium", price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", note: "about half the price", effort: "medium", price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    note: "fastest, under a cent",
    // as good as medium on the evaluation, and faster
    effort: "low",
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    longPrompt: { tokens: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
];

export const DEFAULT_MODEL = "claude-opus-5-5";

export function aiModel(id: string | undefined): AiModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0]!;
}

export function aiProvider(id: string): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]!;
}

export interface Usage {
  /** Input tokens not read from or written to the cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}

/** What a request cost, in USD. */
export function costOf(model: string, usage: Usage): number {
  const m = aiModel(model);
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const price = m.longPrompt && prompt > m.longPrompt.tokens ? m.longPrompt.price : m.price;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite) / 1_000_000;
}

/** Characters of a request (JSX, Tailwind classes, markdown) per token, as measured. */
const CHARS_PER_TOKEN = 2.2;

/** Tokens of a picture as the API counts them (it scales it down to 2576 px on the long edge and 3.75 megapixels). */
export function imageTokens(width: number, height: number): number {
  const scale = Math.min(1, 2576 / Math.max(width, height), Math.sqrt(3_750_000 / (width * height)));
  return Math.ceil((width * scale * height * scale) / 750);
}

/**
 * What a request is expected to cost before it runs: the text (about 4 characters per token), the
 * two pictures, and an answer of changes (a tenth of the screen's JSX at most, usually less) plus
 * the model's thinking. Measured on the evaluation's requests: JSX and Tailwind
 * classes come to about 2.2 characters a token; answers of changes are ~300 tokens typically.
 */
export function estimateCost(model: string, input: { textChars: number; jsxChars: number; images: { width: number; height: number }[]; variants?: number }): number {
  const inputTokens = Math.ceil(input.textChars / CHARS_PER_TOKEN) + input.images.reduce((sum, i) => sum + imageTokens(i.width, i.height), 0);
  // each variant is its own set of changes
  const outputTokens = (Math.ceil(input.jsxChars / CHARS_PER_TOKEN / 10) + 500) * (input.variants ?? 1);
  return costOf(model, { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
}
