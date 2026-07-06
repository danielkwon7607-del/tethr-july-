import { generateText, type LanguageModel } from "ai";
import type { ModelProvider } from "./router";

// The one place a provider SDK is touched (handbook §20.1). The factory maps a
// model id to an AI SDK language model (e.g. anthropic("claude-opus-4-8")), so
// providers stay config: new vendor = new factory, not new call sites.
export function aiSdkProvider(
  id: string,
  resolveModel: (model: string) => LanguageModel,
): ModelProvider {
  return {
    id,
    async complete({ model, prompt, system }) {
      const result = await generateText({
        model: resolveModel(model),
        prompt,
        ...(system !== undefined ? { system } : {}),
      });
      return { text: result.text };
    },
  };
}
