import { NO_USAGE } from "./models";
import type { DesignAnswer, DesignCall, DesignProvider } from "./provider";

/**
 * A provider without a model, for tests and demos: `answer` gets the call and returns the JSX
 * (or throws). By default it changes the first heading's text, like a tiny designer would.
 */
export function fakeProvider(
  answer: (call: DesignCall, round: number) => string | Partial<DesignAnswer> | Promise<string | Partial<DesignAnswer>> = defaultAnswer,
  options: { model?: string; delayMs?: number } = {},
): DesignProvider & { calls: DesignCall[] } {
  const calls: DesignCall[] = [];
  const model = options.model ?? "fake";
  return {
    model,
    calls,
    async design(call) {
      calls.push(call);
      if (options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, options.delayMs);
          call.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      const result = await answer(call, calls.length);
      const given = typeof result === "string" ? { jsx: result } : result;
      return { ...(given.edits ? { edits: given.edits } : { jsx: given.jsx ?? "" }), ...(given.variants && { variants: given.variants }), ...(given.review && { review: given.review }), summary: given.summary ?? [], questions: given.questions ?? [], usage: given.usage ?? { ...NO_USAGE, inputTokens: 1000, outputTokens: 200 }, model, transcript: given.transcript };
    },
  };
}

const FAKE_IDEAS = ["A bold headline", "A friendly headline", "A short headline"];

/** The screen's JSX (from the call's screen) with the first heading changed; with variants, once per variant. */
export function defaultAnswer(call: DesignCall): string | Partial<DesignAnswer> {
  const jsx = /```tsx\n([\s\S]+?)\n```/.exec(call.screen)?.[1] ?? "";
  const heading = (text: string) => jsx.replace(/(<h[1-6][^>]*>)[^<]*(<\/h[1-6]>)/, `$1${text}$2`);
  if (call.mode === "review") {
    // a finding about the first heading
    const id = /<h[1-6] data-id="([^"]+)"/.exec(jsx)?.[1];
    return { review: { summary: "A clear page; one thing stands out.", findings: [{ title: "A shorter main heading", why: "Visitors read the first words only.", fix: "Make the main heading shorter and more concrete.", severity: "important", targets: id ? [id] : [] }] } };
  }
  if ((call.variants ?? 1) < 2) return heading("Designed by the fake AI");
  return { variants: FAKE_IDEAS.slice(0, call.variants).map((idea, i) => ({ idea, jsx: heading(`Designed by the fake AI (${i + 1})`), summary: [idea] })) };
}
