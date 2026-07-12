import { describe, expect, it } from "vitest";
import { sizeSampleForCapacity } from "./sizing";

// Experiment sample size is personalized to founder capacity: a constrained or
// unknown-capacity founder runs a smaller first experiment, never below 1.
describe("sizeSampleForCapacity", () => {
  it("keeps close to the base sample at ample, confident capacity", () => {
    expect(sizeSampleForCapacity(100, { estimate: 1, confidence: 0.9 })).toBeGreaterThan(90);
  });

  it("shrinks the sample for a constrained founder", () => {
    const ample = sizeSampleForCapacity(100, { estimate: 1, confidence: 0.9 });
    const constrained = sizeSampleForCapacity(100, { estimate: 0.1, confidence: 0.9 });
    expect(constrained).toBeLessThan(ample);
    expect(constrained).toBeGreaterThanOrEqual(1);
  });

  it("is conservative (smaller) when the trait is absent", () => {
    expect(sizeSampleForCapacity(100, undefined)).toBeLessThan(60);
  });

  it("never returns below 1 even at zero base", () => {
    expect(sizeSampleForCapacity(0, undefined)).toBe(1);
  });
});
