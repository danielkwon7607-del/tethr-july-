import type { Sql } from "postgres";

// Per-founder cost guardrail (Handbook Recommendation #5). Every costed call — a
// paid source fetch or a model completion — is charged against a per-founder
// budget, recorded in the research_spend ledger (the audit trail). Back-pressure
// is check-BEFORE-charge: if the next call would exceed the budget the pipeline
// pauses and surfaces to the founder (degrade-to-asking, §8.5) rather than
// silently overrunning. The SAME pause path serves the burnout veto (§6.14): an
// overloaded founder throttles the loop too. Both are injected/read here so one
// stop clause covers both signals.

export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

/** v0 cost constants (micro-dollars), recorded in ADR 0013. */
export const MODEL_COST_MICROS: Record<"tier1" | "tier2", number> = { tier1: 500, tier2: 4_000 };
/** v0 per-founder budget for one research run. */
export const DEFAULT_BUDGET_MICROS = 100_000;

export type PauseReason = "budget" | "burnout";

/** Thrown to STOP the pipeline when back-pressure trips. The pipeline catches it,
 * surfaces to the founder, and writes no verdict — never a silent degrade. */
export class ResearchPausedError extends Error {
  constructor(
    public readonly reason: PauseReason,
    public readonly spentMicros: number,
  ) {
    super(`research paused: ${reason} (spent ${spentMicros} micros)`);
    this.name = "ResearchPausedError";
  }
}

export type CostGuardDeps = {
  runScoped: FounderScopedRunner;
  founderId: string;
  budgetMicros?: number;
  /** Optional burnout back-pressure (§6.14), injected by the runner from the
   * Founder Model veto. Returns true when the founder is too overloaded to push. */
  burnoutPaused?: (founderId: string) => Promise<boolean>;
};

export type CostGuard = {
  /** Charge a costed call. Throws ResearchPausedError (budget or burnout) BEFORE
   * recording, so an over-budget call never runs. Call inside a durable step so
   * a replay does not double-charge. */
  charge(kind: "source" | "model", detail: string, costMicros: number): Promise<void>;
  spent(): Promise<number>;
};

async function sumSpend(trx: Sql): Promise<number> {
  const [row] = await trx<{ total: string | null }[]>`
    select coalesce(sum(cost_micros), 0)::bigint as total from research_spend`;
  return Number(row?.total ?? 0);
}

export function createCostGuard(deps: CostGuardDeps): CostGuard {
  const budget = deps.budgetMicros ?? DEFAULT_BUDGET_MICROS;
  const spent = () => deps.runScoped(deps.founderId, sumSpend);
  return {
    spent,
    async charge(kind, detail, costMicros) {
      // Burnout vetoes regardless of budget — wellbeing outranks velocity (§6.14).
      if (deps.burnoutPaused && (await deps.burnoutPaused(deps.founderId))) {
        throw new ResearchPausedError("burnout", await spent());
      }
      const current = await spent();
      if (current + costMicros > budget) {
        throw new ResearchPausedError("budget", current);
      }
      await deps.runScoped(
        deps.founderId,
        (trx) => trx`
        insert into research_spend (kind, detail, cost_micros)
        values (${kind}, ${detail}, ${costMicros})`,
      );
    },
  };
}
