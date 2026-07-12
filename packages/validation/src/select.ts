// Highest-risk-assumption selection (§13.1). Mirrors the Research synthesis
// split (ADR 0013): the Tier-2 model SURFACES scored candidates, this pure
// deterministic rule DECIDES — so the decision is inspectable and unit-testable,
// exactly the "seems right on first read, subtly wrong on second" surface the
// brief mandates /codex probe.
//
// risk = impact × failure_likelihood = expected lethality. failure_likelihood is
// P(the assumption fails), NOT raw "uncertainty" — the /codex-fallback B1 fix:
// "uncertainty" conflates unknown with likely-false, and the assumption you are
// fairly sure is FALSE is the one to test first, yet it would score low
// uncertainty. Expected lethality gets that right.

/** A model-surfaced candidate assumption with its two risk axes, each in [0,1]. */
export type RiskCandidate = {
  assumption: string;
  /** How cheaply its failure kills the idea (lethality), [0,1]. */
  impact: number;
  /** P(the assumption fails) — how likely it is to be wrong, [0,1]. */
  failureLikelihood: number;
};

export type RiskSelection<T extends RiskCandidate = RiskCandidate> = {
  index: number;
  candidate: T;
  /** impact × failure_likelihood — the expected lethality, surfaced for audit. */
  risk: number;
};

// Two products from independent [0,1] pairs can differ only in the last mantissa
// bits; without an epsilon band that float noise would decide between two
// policy-equal candidates and skip the intended impact tiebreak (B2).
const RISK_EPSILON = 1e-9;

/**
 * Select the single highest-risk assumption. Multi-key ordering (B2): expected
 * lethality descending, then impact descending, then lowest index — a naive
 * scalar argmax keeps the first max seen and so returns the SECOND-highest on a
 * tie. Rejects an empty set (no assumption to test) and any non-finite score
 * (a malformed candidate must not be silently selected).
 */
export function selectHighestRisk<T extends RiskCandidate>(
  candidates: readonly T[],
): RiskSelection<T> {
  if (candidates.length === 0) {
    throw new Error("selectHighestRisk requires at least one candidate assumption (§13.1)");
  }

  const scored = candidates.map((candidate, index) => {
    const risk = candidate.impact * candidate.failureLikelihood;
    if (!Number.isFinite(risk) || !Number.isFinite(candidate.impact)) {
      throw new Error(`candidate ${index} ("${candidate.assumption}") has a non-finite risk score`);
    }
    return { index, candidate, risk };
  });

  return scored.reduce((best, next) => {
    const riskGap = next.risk - best.risk;
    if (riskGap > RISK_EPSILON) return next; // clearly riskier
    if (riskGap < -RISK_EPSILON) return best; // clearly less risky
    // Tie on expected lethality → prefer higher impact, then lower index.
    if (next.candidate.impact > best.candidate.impact) return next;
    return best;
  });
}
