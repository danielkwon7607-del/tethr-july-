import type { ResearchVerdict, SignalType, SourceEvidence } from "./sources";

// Weighted synthesis (Ch 11 §11.2): sources are SYNTHESIZED, not averaged. The
// mechanism that makes that literal — demand and competition are computed from
// DISJOINT signal sets, each a weighted mean over only the signals that inform
// it, then combined by a non-linear verdict rule. A funded competitor
// (Crunchbase) and a wave of complaints (X) never get summed into one number:
// one moves competition, the other moves demand, and the rule weighs them
// against each other. v0 weights/thresholds recorded in ADR 0013.

export const DEMAND_WEIGHTS: Partial<Record<SignalType, number>> = {
  live_sentiment: 0.65, // freshest, highest-signal read of real demand
  technical_reception: 0.35, // early-adopter corroboration
};
export const COMPETITION_WEIGHTS: Partial<Record<SignalType, number>> = {
  funded_competition: 0.6, // funded entrants are the hardest competition
  web_presence: 0.4, // general market/competitor surface
};

export type SynthesisScores = { demand: number; competition: number };

/**
 * Weighted mean of the per-type average strengths for the signal types named in
 * `weights`. A signal type with no evidence is dropped and the remaining weights
 * renormalize, so a missing source does not drag the dimension toward zero. No
 * evidence at all for any weighted type → 0 (no signal, not "low signal").
 */
function dimension(
  evidence: SourceEvidence[],
  weights: Partial<Record<SignalType, number>>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [signalType, weight] of Object.entries(weights) as [SignalType, number][]) {
    const items = evidence.filter((e) => e.signalType === signalType);
    if (items.length === 0) continue;
    const avg = items.reduce((sum, e) => sum + e.strength, 0) / items.length;
    weightedSum += avg * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

export function synthesizeScores(evidence: SourceEvidence[]): SynthesisScores {
  return {
    demand: dimension(evidence, DEMAND_WEIGHTS),
    competition: dimension(evidence, COMPETITION_WEIGHTS),
  };
}

// Verdict thresholds (v0). The rule is deliberately non-linear: low demand kills
// an idea regardless of competition; a saturated field without exceptional
// demand is a pivot; strong demand with room is a strong signal.
export const STRONG_DEMAND = 0.6;
export const WEAK_DEMAND = 0.35;
export const SATURATION = 0.7;

export function deriveVerdict(scores: SynthesisScores): {
  verdict: ResearchVerdict;
  rationale: string;
} {
  const { demand, competition } = scores;
  const d = demand.toFixed(2);
  const c = competition.toFixed(2);
  if (demand < WEAK_DEMAND) {
    return {
      verdict: "pivot",
      rationale: `Demand is weak (${d}); the idea lacks a pull to build on.`,
    };
  }
  if (competition >= SATURATION && demand < STRONG_DEMAND) {
    return {
      verdict: "pivot",
      rationale: `A crowded field (competition ${c}) without exceptional demand (${d}) — find a sharper wedge.`,
    };
  }
  if (demand >= STRONG_DEMAND && competition < SATURATION) {
    return {
      verdict: "strong_signal",
      rationale: `Real demand (${d}) with room to enter (competition ${c}).`,
    };
  }
  return {
    verdict: "weak_signal",
    rationale: `Moderate demand (${d}) against competition ${c} — promising but unproven.`,
  };
}
