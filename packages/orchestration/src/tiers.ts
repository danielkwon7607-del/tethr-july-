import type { CompletionRequest, CompletionResult, ModelRouter } from "@tethr/model-router";

// The three execution tiers (handbook §8.3, Ch 20). Tier 1 and tier 2 are
// model-router tiers; tier 3 is not a model call — it is the long-running
// workflow itself, choosing tier 1/2 per step. Workflows call these instead
// of the router directly so the tier is named at the call site.

export type TierRequest = Omit<CompletionRequest, "tier">;

export type TierRunner = {
  /** Fast, low-judgment: classify, extract, summarize, route (§8.3). */
  tier1(request: TierRequest): Promise<CompletionResult>;
  /** High-judgment generation: planning, synthesis, drafting (§8.3). */
  tier2(request: TierRequest): Promise<CompletionResult>;
};

export function createTierRunner(router: ModelRouter): TierRunner {
  return {
    tier1: (request) => router.complete({ ...request, tier: "tier1" }),
    tier2: (request) => router.complete({ ...request, tier: "tier2" }),
  };
}
