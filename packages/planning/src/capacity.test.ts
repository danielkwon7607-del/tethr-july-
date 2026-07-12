import { describe, expect, it } from "vitest";
import { capacityFactor, sizeEstimateMinutes } from "./capacity";

// Estimated time is sized against the available_time read, not defaulted (§12.2,
// §6.9). Two properties matter: a low-capacity founder gets larger estimates,
// and a LOW-CONFIDENCE read is treated more conservatively than a high-confidence
// one at the same estimate (cold-start conservatism, Build 6).

describe("capacityFactor", () => {
  it("does not inflate estimates for an ample, confident capacity", () => {
    expect(capacityFactor({ estimate: 1, confidence: 0.9 })).toBeCloseTo(1, 5);
  });

  it("inflates estimates for a confidently low capacity", () => {
    expect(capacityFactor({ estimate: 0.1, confidence: 0.9 })).toBeGreaterThan(2.5);
  });

  it("is conservative when the trait is absent entirely", () => {
    const absent = capacityFactor(undefined);
    expect(absent).toBeGreaterThan(1.5);
    expect(absent).toBeLessThanOrEqual(3);
  });

  it("treats a low-confidence read more conservatively than a high-confidence one", () => {
    // Same estimate (0.5); the uncertain read allots more time.
    const lowConf = capacityFactor({ estimate: 0.5, confidence: 0.2 });
    const highConf = capacityFactor({ estimate: 0.5, confidence: 0.9 });
    expect(lowConf).toBeGreaterThan(highConf);
  });
});

describe("sizeEstimateMinutes", () => {
  it("leaves a base estimate roughly intact at full capacity", () => {
    expect(sizeEstimateMinutes(60, { estimate: 1, confidence: 0.9 })).toBe(60);
  });

  it("scales up for a constrained founder and never returns below 1", () => {
    expect(sizeEstimateMinutes(60, { estimate: 0.1, confidence: 0.9 })).toBeGreaterThan(120);
    expect(sizeEstimateMinutes(0, undefined)).toBe(1);
  });
});
