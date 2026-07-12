import { describe, expect, it } from "vitest";
import { buildPlanActions } from "./generate";

// buildPlanActions is the deterministic core of Tier-2 plan generation: it
// validates the five mandatory fields, sequences into a DAG, and sizes
// estimates. The DB test covers persistence; these cover the boundary logic.

const validModel = {
  actions: [
    {
      key: "interview",
      action: "Interview 5 target customers",
      founderRequirement: "Founder joins the calls",
      definitionOfDone: "5 completed interview notes recorded",
      effortMinutes: 300,
      dependsOn: [],
    },
    {
      key: "landing",
      action: "Build a landing page to test demand",
      founderRequirement: "Approve the copy",
      definitionOfDone: "Page live with a signup form",
      effortMinutes: 120,
      dependsOn: ["interview"],
    },
  ],
};

const highCapacity = { estimate: 1, confidence: 0.9 };

describe("buildPlanActions", () => {
  it("prepares a sequenced, dependency-aware plan (not flat)", () => {
    const out = buildPlanActions(validModel, highCapacity);
    const bySeq = Object.fromEntries(out.map((a) => [a.key, a.sequenceIndex]));
    expect(bySeq.interview).toBe(0);
    expect(bySeq.landing).toBe(1);
    expect(out.find((a) => a.key === "landing")?.dependsOnKeys).toEqual(["interview"]);
  });

  it("sizes estimates against capacity", () => {
    const ample = buildPlanActions(validModel, highCapacity);
    const constrained = buildPlanActions(validModel, { estimate: 0.1, confidence: 0.9 });
    const ampleMin = ample.find((a) => a.key === "landing")?.estimatedMinutes as number;
    const constrainedMin = constrained.find((a) => a.key === "landing")?.estimatedMinutes as number;
    expect(constrainedMin).toBeGreaterThan(ampleMin);
  });

  it("rejects a malformed Action missing a mandatory field", () => {
    const bad = {
      actions: [{ key: "x", action: "do", founderRequirement: "y", effortMinutes: 10 }],
    };
    expect(() => buildPlanActions(bad, highCapacity)).toThrow();
  });

  it("rejects model output whose dependencies form a cycle", () => {
    const cyclic = {
      actions: [
        { ...validModel.actions[0], key: "a", dependsOn: ["b"] },
        { ...validModel.actions[1], key: "b", dependsOn: ["a"] },
      ],
    };
    expect(() => buildPlanActions(cyclic, highCapacity)).toThrow();
  });

  it("rejects a dependency key that is not in the plan", () => {
    const dangling = {
      actions: [{ ...validModel.actions[0], key: "a", dependsOn: ["ghost"] }],
    };
    expect(() => buildPlanActions(dangling, highCapacity)).toThrow();
  });
});
