// Provider-agnostic model routing (handbook Ch 20). Every model call goes
// through this abstraction — never a provider SDK directly — so swapping a
// model is config, not a migration. Tier names route by judgment required,
// not task name; tier 3 sequences pick per-step, so only tiers 1–2 route here.

export type ModelTier = "tier1" | "tier2";

export type ModelRef = {
  provider: string;
  model: string;
};

export type TierRoute = {
  primary: ModelRef;
  /** Cross-provider by policy (§20.3), so one vendor's outage can't halt the loop. */
  fallback: ModelRef;
};

export type CompletionRequest = {
  tier: ModelTier;
  prompt: string;
  system?: string;
  /**
   * Present when this completion serves an irreversible action (§5.3). Failover
   * is refused unless the idempotency key travels with the request (§20.3) —
   * a cross-provider retry must not be able to cause double-contact.
   */
  irreversible?: { idempotencyKey?: string };
};

export type CompletionResult = ModelRef & {
  text: string;
};

export type ModelProvider = {
  id: string;
  complete(request: { model: string; prompt: string; system?: string }): Promise<{ text: string }>;
};

export class FallbackRefusedError extends Error {
  constructor(tier: ModelTier) {
    super(
      `Refusing ${tier} failover: irreversible request has no idempotency key (handbook §20.3)`,
    );
    this.name = "FallbackRefusedError";
  }
}

export type ModelRouterOptions = {
  providers: readonly ModelProvider[];
  routes: Record<ModelTier, TierRoute>;
};

export class ModelRouter {
  private readonly providers: ReadonlyMap<string, ModelProvider>;
  private readonly routes: Record<ModelTier, TierRoute>;

  constructor({ providers, routes }: ModelRouterOptions) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.routes = routes;
    // Fail fast on a mis-wired route (Constitution IX): a router that cannot
    // reach its fallback must not start, not fail during an outage.
    for (const [tier, route] of Object.entries(routes)) {
      for (const ref of [route.primary, route.fallback]) {
        if (!this.providers.has(ref.provider)) {
          throw new Error(`Route ${tier} names unregistered provider "${ref.provider}"`);
        }
      }
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const route = this.routes[request.tier];
    try {
      return await this.call(route.primary, request);
    } catch (primaryError) {
      if (request.irreversible && request.irreversible.idempotencyKey === undefined) {
        throw new FallbackRefusedError(request.tier);
      }
      try {
        return await this.call(route.fallback, request);
      } catch (fallbackError) {
        throw new AggregateError(
          [primaryError, fallbackError],
          `Both providers failed for ${request.tier}`,
        );
      }
    }
  }

  private async call(ref: ModelRef, request: CompletionRequest): Promise<CompletionResult> {
    // Constructor guarantees presence; the non-null keeps the hot path honest.
    const provider = this.providers.get(ref.provider);
    if (!provider) throw new Error(`Unregistered provider "${ref.provider}"`);
    const { text } = await provider.complete({
      model: ref.model,
      prompt: request.prompt,
      ...(request.system !== undefined ? { system: request.system } : {}),
    });
    return { text, provider: ref.provider, model: ref.model };
  }
}
