// Founder Model calibration v0 (handbook §6.15). The SHAPES here are design
// commitments recorded in the Decision Log (Ch 23); the CONSTANTS are v0 —
// meant to be tuned against real founder data via the instrumentation the
// trait/policy stores record. Pure functions only: everything is unit-tested
// against the handbook's own numbers, and recomputable from stored evidence.

export type ObservationSource = "correction" | "revealed" | "proxy" | "stated";

/** §6.15: corrections dominate and revealed beats stated, by design. */
export const SOURCE_WEIGHTS: Record<ObservationSource, number> = {
  correction: 1.0,
  revealed: 0.7,
  proxy: 0.5,
  stated: 0.4,
};

/** §6.15 per-family/per-dimension decay half-lives, in weeks (v0). */
export const HALF_LIFE_WEEKS = {
  // Capacity & availability — state-like; stale reads must not drive action.
  load_burnout: 1,
  available_time: 2,
  working_rhythm: 3,
  life_context: 4,
  // Families.
  execution: 6,
  market_customer: 6,
  communication: 8,
  risk_decision: 12,
  motivation_psychology: 14,
  // Skill & sophistication — gaps close; sophistication grows slowly.
  skill_gaps: 6,
  process_sophistication: 16,
} as const;

const CONFIDENCE_K = 0.5;

/** §6.6/§6.15: decay acts on confidence, not the estimate. */
export function decayedConfidence(
  confidence: number,
  weeksSinceReinforcement: number,
  halfLifeWeeks: number,
): number {
  return confidence * 2 ** (-weeksSinceReinforcement / halfLifeWeeks);
}

export type EvidenceObservation = {
  source: ObservationSource;
  /** Age of the observation at evaluation time. */
  ageWeeks: number;
};

/** w = source_weight × recency_factor (the decay term at the observation's age). */
export function evidenceWeight(observation: EvidenceObservation, halfLifeWeeks: number): number {
  return SOURCE_WEIGHTS[observation.source] * 2 ** (-observation.ageWeeks / halfLifeWeeks);
}

/** net_evidence = Σ w(corroborating) − Σ w(conflicting), floored at 0. */
export function netEvidence(
  observations: readonly (EvidenceObservation & { corroborating: boolean })[],
  halfLifeWeeks: number,
): number {
  const net = observations.reduce(
    (sum, observation) =>
      sum + (observation.corroborating ? 1 : -1) * evidenceWeight(observation, halfLifeWeeks),
    0,
  );
  return Math.max(0, net);
}

// "Confidence never reaches 1.0" (§6.15) — true of the formula, but exp(−x)
// underflows to 0 in float64, and the traits table enforces confidence < 1
// (real/float4). Ceiling chosen to survive the float4 round-trip.
const MAX_CONFIDENCE = 0.999999;

/** confidence = 1 − exp(−k · net_evidence), k = 0.5. Never reaches 1.0. */
export function confidenceFromEvidence(net: number): number {
  return Math.min(MAX_CONFIDENCE, 1 - Math.exp(-CONFIDENCE_K * Math.max(0, net)));
}

// v0 (not handbook-specified): an observation within this distance of the
// current estimate corroborates it; farther conflicts. Instrumented for tuning.
export const CORROBORATION_BAND = 0.25;

/** Classify a new observation against the current estimate (v0 mechanics). */
export function classifyObservation(
  observedEstimate: number,
  currentEstimate: number | null,
): boolean {
  if (currentEstimate === null) return true; // first evidence corroborates itself
  return Math.abs(observedEstimate - currentEstimate) <= CORROBORATION_BAND;
}

/** §6.15: fires when divergence > 0.3 AND revealed confidence > 0.5. */
export function reconciliationGate(input: {
  stated: number;
  revealed: number;
  revealedConfidence: number;
}): { fires: boolean; divergence: number } {
  const divergence = Math.abs(input.stated - input.revealed);
  return { divergence, fires: divergence > 0.3 && input.revealedConfidence > 0.5 };
}

/** §6.15 policy-learning constants: multiplicative, bounded, decaying to 1.0. */
export const POLICY_LEARNING = {
  positiveFactor: 1.15,
  negativeFactor: 0.85,
  min: 0.5,
  max: 2.0,
  decayHalfLifeWeeks: 10,
} as const;

export type PolicyOutcome = "positive" | "ignored" | "negative";

/** Decay the stale weight toward 1.0, then apply the outcome, then clamp. */
export function updatedLearnedWeight(
  current: number,
  outcome: PolicyOutcome,
  weeksSinceUpdate: number,
): number {
  const decayed = 1 + (current - 1) * 2 ** (-weeksSinceUpdate / POLICY_LEARNING.decayHalfLifeWeeks);
  const factor =
    outcome === "positive" ? POLICY_LEARNING.positiveFactor : POLICY_LEARNING.negativeFactor;
  return Math.min(POLICY_LEARNING.max, Math.max(POLICY_LEARNING.min, decayed * factor));
}

export type BehaviorCandidate = {
  behavior: string;
  /** How well the behavior fits the dimensions it reads, in [0, 1]. */
  baseFit: number;
  /** Decayed confidences of the dimensions this candidate reads. */
  dimensionConfidences: readonly number[];
  learnedWeight: number;
  /** §6.15 veto semantics: suppressed entirely under burnout. */
  paceIncreasing?: boolean;
  /** Intervention intensity band: 1 gentle · 2 moderate · 3 hard. */
  intensity?: 1 | 2 | 3;
};

/** score = base_fit × confidence_gate × learned_weight (gate = mean confidence). */
export function scoreBehavior(
  candidate: Pick<BehaviorCandidate, "baseFit" | "dimensionConfidences" | "learnedWeight">,
): number {
  const confidences = candidate.dimensionConfidences;
  const gate =
    confidences.length === 0
      ? 0
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  return candidate.baseFit * gate * candidate.learnedWeight;
}

export type BurnoutRead = {
  /** Normalized [0,1] load/burnout estimate. */
  estimate: number;
  /** Decayed confidence of that read. */
  confidence: number;
};

/** §6.15 burnout veto constants (v0): gate at confidence > 0.5, top band ≥ 0.7. */
export const BURNOUT_VETO = {
  confidenceGate: 0.5,
  topBand: 0.7,
  /** Under veto, intervention intensity is capped to gentle. */
  intensityCap: 1,
} as const;

export function applyBurnoutVeto(burnout: BurnoutRead | undefined): {
  vetoed: boolean;
} {
  if (!burnout) return { vetoed: false };
  return {
    vetoed:
      burnout.confidence > BURNOUT_VETO.confidenceGate && burnout.estimate >= BURNOUT_VETO.topBand,
  };
}

export type PolicyDecision =
  | { kind: "act"; behavior: string; score: number; vetoApplied: boolean }
  | { kind: "ask"; vetoApplied: boolean };

/**
 * §6.15 policy decision: score candidates, apply the burnout veto as a hard
 * gate (not a weight), take the top scorer only if it clears the action
 * threshold — otherwise degrade to asking (§8.5).
 */
export function decidePolicy(
  candidates: readonly BehaviorCandidate[],
  options: { actionThreshold: number; burnout?: BurnoutRead },
): PolicyDecision {
  const { vetoed } = applyBurnoutVeto(options.burnout);
  const eligible = vetoed
    ? candidates.filter(
        (candidate) =>
          !candidate.paceIncreasing && (candidate.intensity ?? 1) <= BURNOUT_VETO.intensityCap,
      )
    : candidates;

  let best: { candidate: BehaviorCandidate; score: number } | undefined;
  for (const candidate of eligible) {
    const score = scoreBehavior(candidate);
    if (!best || score > best.score) best = { candidate, score };
  }
  if (!best || best.score < options.actionThreshold) return { kind: "ask", vetoApplied: vetoed };
  return {
    kind: "act",
    behavior: best.candidate.behavior,
    score: best.score,
    vetoApplied: vetoed,
  };
}
