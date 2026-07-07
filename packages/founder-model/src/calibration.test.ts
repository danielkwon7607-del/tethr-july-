import { describe, expect, it } from "vitest";
import {
  applyBurnoutVeto,
  BURNOUT_VETO,
  classifyObservation,
  confidenceFromEvidence,
  decayedConfidence,
  decidePolicy,
  evidenceWeight,
  HALF_LIFE_WEEKS,
  netEvidence,
  POLICY_LEARNING,
  reconciliationGate,
  SOURCE_WEIGHTS,
  scoreBehavior,
  updatedLearnedWeight,
} from "./calibration";

// These tests pin handbook §6.15 literally. The SHAPES are design commitments
// (Ch 23); a failing test here means either a bug or an unrecorded decision.

describe("source weights (§6.15)", () => {
  it("matches the handbook table: correction 1.0 / revealed 0.7 / proxy 0.5 / stated 0.4", () => {
    expect(SOURCE_WEIGHTS).toEqual({
      correction: 1.0,
      revealed: 0.7,
      proxy: 0.5,
      stated: 0.4,
    });
  });

  it("evidence weight is source_weight × recency_factor", () => {
    // A revealed observation 6 weeks old on a 6-week half-life dimension.
    expect(evidenceWeight({ source: "revealed", ageWeeks: 6 }, 6)).toBeCloseTo(0.7 * 0.5, 10);
    // A fresh correction carries its full 1.0.
    expect(evidenceWeight({ source: "correction", ageWeeks: 0 }, 6)).toBeCloseTo(1.0, 10);
  });
});

describe("saturating confidence (§6.15)", () => {
  it("confidence = 1 − exp(−0.5 · net_evidence)", () => {
    // ~3 corroborating revealed observations (~2.1 net) → ~0.65.
    expect(confidenceFromEvidence(2.1)).toBeCloseTo(0.65, 2);
    // A lone correction → ~0.39.
    expect(confidenceFromEvidence(1.0)).toBeCloseTo(0.3935, 3);
    expect(confidenceFromEvidence(0)).toBe(0);
  });

  it("never reaches 1.0 — no read is certain", () => {
    expect(confidenceFromEvidence(1000)).toBeLessThan(1);
  });

  it("net evidence is corroborating minus conflicting, floored at 0", () => {
    const observations = [
      { source: "revealed" as const, ageWeeks: 0, corroborating: true },
      { source: "stated" as const, ageWeeks: 0, corroborating: false },
    ];
    expect(netEvidence(observations, 6)).toBeCloseTo(0.7 - 0.4, 10);
    const conflictingOnly = [{ source: "correction" as const, ageWeeks: 0, corroborating: false }];
    expect(netEvidence(conflictingOnly, 6)).toBe(0);
  });
});

describe("decay half-lives (§6.15), acting on confidence not the estimate", () => {
  it("matches the per-family v0 table", () => {
    expect(HALF_LIFE_WEEKS.load_burnout).toBe(1);
    expect(HALF_LIFE_WEEKS.available_time).toBe(2);
    expect(HALF_LIFE_WEEKS.working_rhythm).toBe(3);
    expect(HALF_LIFE_WEEKS.life_context).toBe(4);
    expect(HALF_LIFE_WEEKS.execution).toBe(6);
    expect(HALF_LIFE_WEEKS.market_customer).toBe(6);
    expect(HALF_LIFE_WEEKS.communication).toBe(8);
    expect(HALF_LIFE_WEEKS.risk_decision).toBe(12);
    expect(HALF_LIFE_WEEKS.motivation_psychology).toBe(14);
    expect(HALF_LIFE_WEEKS.skill_gaps).toBe(6);
    expect(HALF_LIFE_WEEKS.process_sophistication).toBe(16);
  });

  it("confidence(t) = confidence · 2^(−Δt / half_life)", () => {
    expect(decayedConfidence(0.8, 1, 1)).toBeCloseTo(0.4, 10);
    expect(decayedConfidence(0.8, 0, 1)).toBe(0.8);
    expect(decayedConfidence(0.6, 12, 12)).toBeCloseTo(0.3, 10);
  });
});

describe("stated-vs-revealed reconciliation gate (§6.15)", () => {
  it("fires only when divergence > 0.3 AND revealed confidence > 0.5", () => {
    expect(reconciliationGate({ stated: 0.2, revealed: 0.7, revealedConfidence: 0.6 }).fires).toBe(
      true,
    );
    // Divergence exactly 0.3: held.
    expect(reconciliationGate({ stated: 0.4, revealed: 0.7, revealedConfidence: 0.9 }).fires).toBe(
      false,
    );
    // Noisy early revealed read: held despite huge divergence.
    expect(reconciliationGate({ stated: 0.0, revealed: 1.0, revealedConfidence: 0.5 }).fires).toBe(
      false,
    );
    expect(
      reconciliationGate({ stated: 0.2, revealed: 0.7, revealedConfidence: 0.6 }).divergence,
    ).toBeCloseTo(0.5, 10);
  });
});

describe("bounded multiplicative policy learning (§6.15)", () => {
  it("×1.15 on positive, ×0.85 on ignored/negative, clamped to [0.5, 2.0]", () => {
    expect(POLICY_LEARNING).toEqual({
      positiveFactor: 1.15,
      negativeFactor: 0.85,
      min: 0.5,
      max: 2.0,
      decayHalfLifeWeeks: 10,
    });
    expect(updatedLearnedWeight(1.0, "positive", 0)).toBeCloseTo(1.15, 10);
    expect(updatedLearnedWeight(1.0, "ignored", 0)).toBeCloseTo(0.85, 10);
    expect(updatedLearnedWeight(1.0, "negative", 0)).toBeCloseTo(0.85, 10);
    expect(updatedLearnedWeight(1.9, "positive", 0)).toBe(2.0);
    expect(updatedLearnedWeight(0.55, "negative", 0)).toBe(0.5);
  });

  it("decays toward 1.0 with a 10-week half-life before the outcome applies", () => {
    // A weight of 1.8 left alone 10 weeks is 1.4 (halfway back to 1.0);
    // a positive outcome then multiplies from there.
    expect(updatedLearnedWeight(1.8, "positive", 10)).toBeCloseTo(1.4 * 1.15, 10);
    expect(updatedLearnedWeight(0.6, "ignored", 10)).toBeCloseTo(0.8 * 0.85, 10);
  });
});

describe("policy scoring (§6.15)", () => {
  it("score = base_fit × confidence_gate × learned_weight, gate = mean confidence", () => {
    expect(
      scoreBehavior({ baseFit: 0.8, dimensionConfidences: [0.6, 0.2], learnedWeight: 1.5 }),
    ).toBeCloseTo(0.8 * 0.4 * 1.5, 10);
  });

  it("low confidence suppresses aggressive behavior — cold start is conservative", () => {
    const bold = scoreBehavior({
      baseFit: 0.9,
      dimensionConfidences: [0.05, 0.1],
      learnedWeight: 1.0,
    });
    expect(bold).toBeLessThan(0.1);
  });

  it("decidePolicy takes the top scorer only above the action threshold, else asks", () => {
    const act = decidePolicy(
      [
        { behavior: "nudge.hard", baseFit: 0.9, dimensionConfidences: [0.9], learnedWeight: 1.2 },
        { behavior: "nudge.soft", baseFit: 0.5, dimensionConfidences: [0.9], learnedWeight: 1.0 },
      ],
      { actionThreshold: 0.5 },
    );
    expect(act).toEqual(expect.objectContaining({ kind: "act", behavior: "nudge.hard" }));

    const ask = decidePolicy(
      [{ behavior: "nudge.hard", baseFit: 0.9, dimensionConfidences: [0.1], learnedWeight: 1.0 }],
      { actionThreshold: 0.5 },
    );
    expect(ask.kind).toBe("ask");
  });
});

describe("burnout veto — hard gate, not a weight (§6.15, §6.14)", () => {
  const highBurnout = { estimate: 0.9, confidence: 0.7 };

  it("engages when burnout confidence > 0.5 and the estimate is in the top band", () => {
    expect(applyBurnoutVeto(highBurnout).vetoed).toBe(true);
    expect(applyBurnoutVeto({ estimate: 0.9, confidence: 0.5 }).vetoed).toBe(false);
    expect(applyBurnoutVeto({ estimate: 0.5, confidence: 0.9 }).vetoed).toBe(false);
    expect(applyBurnoutVeto(undefined).vetoed).toBe(false);
    expect(BURNOUT_VETO.confidenceGate).toBe(0.5);
  });

  it("caps intervention intensity and suppresses pace-increasing actions REGARDLESS of score", () => {
    const candidates = [
      {
        behavior: "push.more-hours",
        baseFit: 1.0,
        dimensionConfidences: [0.95],
        learnedWeight: 2.0,
        paceIncreasing: true,
        intensity: 3,
      },
      {
        behavior: "checkin.intense",
        baseFit: 0.9,
        dimensionConfidences: [0.95],
        learnedWeight: 1.5,
        intensity: 3,
      },
      {
        behavior: "checkin.gentle",
        baseFit: 0.6,
        dimensionConfidences: [0.95],
        learnedWeight: 1.0,
        intensity: 1,
      },
    ] as const;

    const unvetoed = decidePolicy([...candidates], { actionThreshold: 0.3 });
    expect(unvetoed).toEqual(expect.objectContaining({ kind: "act", behavior: "push.more-hours" }));

    // With the veto: the top scorer is pace-increasing (suppressed) and the
    // runner-up exceeds the intensity cap (excluded) — the gentle behavior
    // wins despite the lowest score. Wellbeing outranks velocity.
    const vetoed = decidePolicy([...candidates], { actionThreshold: 0.3, burnout: highBurnout });
    expect(vetoed).toEqual(
      expect.objectContaining({ kind: "act", behavior: "checkin.gentle", vetoApplied: true }),
    );
  });
});
