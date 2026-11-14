import { type Effort, anthropicProvider } from "./anthropic";
import { aiModel } from "./models";
import type { DesignProvider } from "./provider";

/**
 * A model's provider by the model's id. Each provider in `AI_PROVIDERS` has an entry here; a new
 * one (OpenAI, …) implements `DesignProvider` and is added to both.
 */
export function createProvider(model: string, options: { apiKey?: string; effort?: Effort } = {}): DesignProvider {
  const { provider, id, effort } = aiModel(model);
  switch (provider) {
    case "anthropic":
      return anthropicProvider({ model: id, effort, ...options });
    default:
      throw new Error(`No provider "${provider}" for ${id}`);
  }
}
