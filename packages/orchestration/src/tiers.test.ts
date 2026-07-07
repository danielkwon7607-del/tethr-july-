import { type ModelProvider, ModelRouter } from "@tethr/model-router";
import { describe, expect, it } from "vitest";
import { createTierRunner } from "./tiers";

// Ch 8 §8.3 / Ch 20: tier-1 and tier-2 work routes through the model router
// (never a provider SDK directly); tier 3 is the workflow itself, choosing a
// tier per step.

function stubProvider(id: string, reply: string): ModelProvider & { models: string[] } {
  const models: string[] = [];
  return {
    id,
    models,
    complete: async ({ model }) => {
      models.push(model);
      return { text: reply };
    },
  };
}

const routes = {
  tier1: {
    primary: { provider: "fast", model: "haiku" },
    fallback: { provider: "frontier", model: "gpt-mini" },
  },
  tier2: {
    primary: { provider: "frontier", model: "opus" },
    fallback: { provider: "fast", model: "haiku" },
  },
};

describe("createTierRunner", () => {
  it("routes tier-1 and tier-2 work to the tiers' models via the router", async () => {
    const fast = stubProvider("fast", "classified");
    const frontier = stubProvider("frontier", "planned");
    const router = new ModelRouter({ providers: [fast, frontier], routes });
    const tiers = createTierRunner(router);

    const t1 = await tiers.tier1({ prompt: "classify this reply" });
    const t2 = await tiers.tier2({ prompt: "draft the plan" });

    expect(t1.text).toBe("classified");
    expect(t2.text).toBe("planned");
    expect(fast.models).toEqual(["haiku"]);
    expect(frontier.models).toEqual(["opus"]);
  });

  it("carries the irreversible idempotency key through to the router (§20.3)", async () => {
    const fast = stubProvider("fast", "ok");
    const frontier = stubProvider("frontier", "ok");
    const router = new ModelRouter({ providers: [fast, frontier], routes });
    const tiers = createTierRunner(router);

    const result = await tiers.tier2({
      prompt: "draft outreach",
      irreversible: { idempotencyKey: "founder-1/send-9" },
    });
    expect(result.provider).toBe("frontier");
  });
});
