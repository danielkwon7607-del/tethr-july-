import { describe, expect, it } from "vitest";
import { FallbackRefusedError, type ModelProvider, ModelRouter } from "./router";

function stubProvider(
  id: string,
  behavior: (model: string) => Promise<{ text: string }>,
): ModelProvider & { calls: string[]; keys: (string | undefined)[] } {
  const calls: string[] = [];
  const keys: (string | undefined)[] = [];
  return {
    id,
    calls,
    keys,
    complete: async ({ model, idempotencyKey }) => {
      calls.push(model);
      keys.push(idempotencyKey);
      return behavior(model);
    },
  };
}

const routes = {
  tier1: {
    primary: { provider: "anthropic", model: "claude-haiku-4-5" },
    fallback: { provider: "openai", model: "gpt-5.4-mini" },
  },
  tier2: {
    primary: { provider: "anthropic", model: "claude-opus-4-8" },
    fallback: { provider: "openai", model: "gpt-5.5" },
  },
};

describe("ModelRouter", () => {
  it("routes a tier to its primary provider and model", async () => {
    const anthropic = stubProvider("anthropic", async () => ({ text: "ok" }));
    const openai = stubProvider("openai", async () => ({ text: "nope" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    const result = await router.complete({ tier: "tier2", prompt: "plan my week" });

    expect(result).toEqual({ text: "ok", provider: "anthropic", model: "claude-opus-4-8" });
    expect(openai.calls).toHaveLength(0);
  });

  it("fails over cross-provider when the primary fails", async () => {
    const anthropic = stubProvider("anthropic", async () => {
      throw new Error("rate limited");
    });
    const openai = stubProvider("openai", async () => ({ text: "fallback ok" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    const result = await router.complete({ tier: "tier1", prompt: "classify this" });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-5.4-mini");
  });

  it("refuses failover for an irreversible request without an idempotency key (§20.3)", async () => {
    const anthropic = stubProvider("anthropic", async () => {
      throw new Error("outage");
    });
    const openai = stubProvider("openai", async () => ({ text: "must not run" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    await expect(
      router.complete({ tier: "tier2", prompt: "draft outreach", irreversible: {} }),
    ).rejects.toBeInstanceOf(FallbackRefusedError);
    expect(openai.calls).toHaveLength(0);
  });

  it("permits failover for an irreversible request that carries its idempotency key", async () => {
    const anthropic = stubProvider("anthropic", async () => {
      throw new Error("outage");
    });
    const openai = stubProvider("openai", async () => ({ text: "fallback ok" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    const result = await router.complete({
      tier: "tier2",
      prompt: "draft outreach",
      irreversible: { idempotencyKey: "founder-1/send-42" },
    });

    expect(result.provider).toBe("openai");
  });

  it("refuses failover when the idempotency key is an empty string (§20.3)", async () => {
    const anthropic = stubProvider("anthropic", async () => {
      throw new Error("outage");
    });
    const openai = stubProvider("openai", async () => ({ text: "must not run" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    await expect(
      router.complete({
        tier: "tier2",
        prompt: "draft outreach",
        irreversible: { idempotencyKey: "" },
      }),
    ).rejects.toBeInstanceOf(FallbackRefusedError);
    expect(openai.calls).toHaveLength(0);
  });

  it("transmits the idempotency key to the provider, on primary and on failover", async () => {
    const anthropic = stubProvider("anthropic", async () => {
      throw new Error("outage");
    });
    const openai = stubProvider("openai", async () => ({ text: "fallback ok" }));
    const router = new ModelRouter({ providers: [anthropic, openai], routes });

    await router.complete({
      tier: "tier2",
      prompt: "draft outreach",
      irreversible: { idempotencyKey: "founder-1/send-42" },
    });

    expect(anthropic.keys).toEqual(["founder-1/send-42"]);
    expect(openai.keys).toEqual(["founder-1/send-42"]);
  });

  it("fails fast at construction when a route names an unregistered provider", () => {
    const anthropic = stubProvider("anthropic", async () => ({ text: "ok" }));
    expect(() => new ModelRouter({ providers: [anthropic], routes })).toThrow(/openai/);
  });
});
