import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { aiSdkProvider } from "./ai-sdk-provider";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

describe("aiSdkProvider", () => {
  it("completes a prompt through an AI SDK language model", async () => {
    const mock = new MockLanguageModelV4({
      modelId: "claude-opus-4-8",
      doGenerate: {
        content: [{ type: "text", text: "the plan: talk to ten founders" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const provider = aiSdkProvider("anthropic", () => mock);

    const result = await provider.complete({
      model: "claude-opus-4-8",
      prompt: "what should I do this week?",
      system: "you are a cofounder",
    });

    expect(provider.id).toBe("anthropic");
    expect(result.text).toBe("the plan: talk to ten founders");
  });

  it("resolves the requested model id through the factory", async () => {
    const requested: string[] = [];
    const provider = aiSdkProvider("anthropic", (model) => {
      requested.push(model);
      return new MockLanguageModelV4({
        modelId: model,
        doGenerate: {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      });
    });

    await provider.complete({ model: "claude-haiku-4-5", prompt: "route this" });

    expect(requested).toEqual(["claude-haiku-4-5"]);
  });
});
