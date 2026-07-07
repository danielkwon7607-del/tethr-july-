import type { Sql } from "postgres";
import {
  type BehaviorCandidate,
  type BurnoutRead,
  decidePolicy,
  type PolicyDecision,
  type PolicyOutcome,
  scoreBehavior,
  updatedLearnedWeight,
} from "./calibration";

// The Policy layer's persistence (§6.9, §6.15): learned weights live in
// policy_state; every decision — act, ask, veto — lands in policy_decisions,
// the instrumentation that will tune the v0 constants. Founder-scoped
// transactions only, like the trait store.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Feed a behavior outcome back: decay-toward-1.0 then ×1.15/×0.85, bounded. */
export async function reweightPolicy(
  sql: Sql,
  behavior: string,
  outcome: PolicyOutcome,
): Promise<number> {
  const [row] = await sql<{ learned_weight: number; updated_at: Date }[]>`
    select learned_weight, updated_at from policy_state where behavior = ${behavior}`;
  const weeksSince = row ? (Date.now() - row.updated_at.getTime()) / MS_PER_WEEK : 0;
  const next = updatedLearnedWeight(row?.learned_weight ?? 1.0, outcome, weeksSince);
  await sql`
    insert into policy_state (behavior, learned_weight)
    values (${behavior}, ${next})
    on conflict (founder_id, behavior)
    do update set learned_weight = ${next}, updated_at = now()`;
  return next;
}

/** The stored learned weight (1.0 when the behavior has no history yet). */
export async function learnedWeight(sql: Sql, behavior: string): Promise<number> {
  const [row] = await sql<{ learned_weight: number }[]>`
    select learned_weight from policy_state where behavior = ${behavior}`;
  return row?.learned_weight ?? 1.0;
}

/**
 * §6.15 policy decision with instrumentation: score, veto, threshold — and a
 * policy_decisions row recording what was decided and why, so the constants
 * can be tuned against outcomes instead of intuition.
 */
export async function decideAndRecord(
  sql: Sql,
  candidates: readonly BehaviorCandidate[],
  options: { actionThreshold: number; burnout?: BurnoutRead },
): Promise<PolicyDecision> {
  const decision = decidePolicy(candidates, options);
  const chosen =
    decision.kind === "act"
      ? candidates.find((candidate) => candidate.behavior === decision.behavior)
      : undefined;
  const top = chosen ?? candidates[0];
  if (top) {
    const gate =
      top.dimensionConfidences.length === 0
        ? 0
        : top.dimensionConfidences.reduce((sum, value) => sum + value, 0) /
          top.dimensionConfidences.length;
    await sql`
      insert into policy_decisions (behavior, base_fit, confidence_gate, learned_weight, score, decision, veto_applied)
      values (${top.behavior}, ${top.baseFit}, ${gate}, ${top.learnedWeight},
        ${scoreBehavior(top)}, ${decision.kind}, ${decision.vetoApplied})`;
  }
  return decision;
}
