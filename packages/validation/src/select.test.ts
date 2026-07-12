import { describe, expect, it } from "vitest";
import { type RiskCandidate, selectHighestRisk } from "./select";

// Validation targets the SINGLE highest-risk assumption (§13.1): the one whose
// failure would most cheaply kill the idea. risk = impact × failure_likelihood
// = expected lethality (the /codex-fallback B1 axis fix: failure_likelihood =
// P(assumption fails), not raw "uncertainty" which conflates unknown with
// likely-false). The selector is a pure argmax with an explicit multi-key
// comparator — the B2 finding was that a naive scalar argmax provably returns
// the SECOND-highest on ties.

const c = (assumption: string, impact: number, failureLikelihood: number): RiskCandidate => ({
  assumption,
  impact,
  failureLikelihood,
});

describe("selectHighestRisk", () => {
  it("picks the candidate with the highest expected lethality", () => {
    const r = selectHighestRisk([
      c("cheap to build", 0.2, 0.2),
      c("customers will pay", 0.9, 0.8),
      c("channel works", 0.5, 0.5),
    ]);
    expect(r.candidate.assumption).toBe("customers will pay");
    expect(r.index).toBe(1);
  });

  it("breaks a risk tie by higher impact — NOT lowest index (B2)", () => {
    // Both products = 0.30. A naive scalar argmax keeps index 0 (impact 0.5),
    // which is the wrong pick — the tiebreak must prefer higher impact (0.6).
    const r = selectHighestRisk([c("A", 0.5, 0.6), c("B", 0.6, 0.5)]);
    expect(r.candidate.assumption).toBe("B");
    expect(r.index).toBe(1);
  });

  it("treats near-equal products (float noise) as a tie, then uses impact (B2)", () => {
    // 0.1*0.3 vs 0.3*0.1 differ only in the last bits; must not let float noise
    // decide — the impact tiebreak (0.3 > 0.1) governs.
    const r = selectHighestRisk([c("low-impact", 0.1, 0.3), c("high-impact", 0.3, 0.1)]);
    expect(r.candidate.assumption).toBe("high-impact");
  });

  it("selects genuinely-higher expected lethality over raw impact (B1 axis)", () => {
    // X: 1.0×0.4 = 0.40 (idea-defining but probably holds).
    // Y: 0.5×0.9 = 0.45 (less lethal, but very likely to fail) → higher expected
    // damage, so Y is tested first. This is the axis redefinition, made explicit.
    const r = selectHighestRisk([c("X", 1.0, 0.4), c("Y", 0.5, 0.9)]);
    expect(r.candidate.assumption).toBe("Y");
  });

  it("falls back to lowest index when risk and impact are equal", () => {
    const r = selectHighestRisk([c("first", 0.5, 0.5), c("second", 0.5, 0.5)]);
    expect(r.index).toBe(0);
  });

  it("throws on an empty candidate set (no assumption to test)", () => {
    expect(() => selectHighestRisk([])).toThrow();
  });

  it("throws on a non-finite score rather than silently selecting it", () => {
    expect(() => selectHighestRisk([c("nan", Number.NaN, 0.5)])).toThrow();
  });

  it("returns the computed risk for inspectability", () => {
    const r = selectHighestRisk([c("only", 0.4, 0.5)]);
    expect(r.risk).toBeCloseTo(0.2, 10);
  });
});
