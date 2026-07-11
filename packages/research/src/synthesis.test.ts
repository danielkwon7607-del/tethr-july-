import { describe, expect, it } from "vitest";
import type { SourceEvidence } from "./sources";
import { deriveVerdict, synthesizeScores } from "./synthesis";

// Ch 11 §11.2: sources are synthesized, not averaged. These tests pin the two
// load-bearing properties — demand and competition are computed from disjoint
// signal sets, and the verdict rule is non-linear.

const ev = (
  source: string,
  signalType: SourceEvidence["signalType"],
  strength: number,
): SourceEvidence => ({
  source,
  signalType,
  title: `${source} evidence`,
  url: `https://example.com/${source}`,
  strength,
});

describe("synthesizeScores", () => {
  it("draws demand and competition from DISJOINT signal sets — not one average", () => {
    // Strong demand signals, strong competition signals. A naive average would
    // blend them toward the middle; synthesis keeps them on separate axes.
    const evidence = [
      ev("xai", "live_sentiment", 0.9),
      ev("hackernews", "technical_reception", 0.8),
      ev("crunchbase", "funded_competition", 0.85),
      ev("serper", "web_presence", 0.75),
    ];
    const { demand, competition } = synthesizeScores(evidence);
    // demand = 0.65*0.9 + 0.35*0.8 = 0.865; competition = 0.6*0.85 + 0.4*0.75 = 0.81
    expect(demand).toBeCloseTo(0.865, 3);
    expect(competition).toBeCloseTo(0.81, 3);
    // The two axes are independent — competition evidence never moved demand.
    expect(demand).not.toBeCloseTo(competition, 2);
  });

  it("renormalizes over present signal types — a missing source doesn't zero the axis", () => {
    // Only live_sentiment present for demand; demand should equal its strength,
    // not be halved by the absent technical_reception weight.
    const { demand } = synthesizeScores([ev("xai", "live_sentiment", 0.8)]);
    expect(demand).toBeCloseTo(0.8, 5);
  });

  it("is 0 (no signal) when no evidence informs a dimension", () => {
    const { competition } = synthesizeScores([ev("xai", "live_sentiment", 0.9)]);
    expect(competition).toBe(0);
  });
});

describe("deriveVerdict", () => {
  it("strong demand with room → strong_signal", () => {
    expect(deriveVerdict({ demand: 0.8, competition: 0.4 }).verdict).toBe("strong_signal");
  });

  it("weak demand → pivot regardless of competition", () => {
    expect(deriveVerdict({ demand: 0.2, competition: 0.1 }).verdict).toBe("pivot");
  });

  it("saturated field without exceptional demand → pivot", () => {
    expect(deriveVerdict({ demand: 0.5, competition: 0.85 }).verdict).toBe("pivot");
  });

  it("strong demand in a saturated field → weak_signal (not strong, not pivot)", () => {
    expect(deriveVerdict({ demand: 0.8, competition: 0.85 }).verdict).toBe("weak_signal");
  });

  it("moderate demand, moderate competition → weak_signal", () => {
    expect(deriveVerdict({ demand: 0.5, competition: 0.5 }).verdict).toBe("weak_signal");
  });

  it("every verdict carries an evidence-based rationale", () => {
    expect(deriveVerdict({ demand: 0.8, competition: 0.4 }).rationale).toMatch(/demand/i);
  });
});
