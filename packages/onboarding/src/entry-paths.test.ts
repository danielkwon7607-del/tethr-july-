import { describe, expect, it } from "vitest";
import { companyStateSeed, type OnboardingInput, seedProfile } from "./entry-paths";

// §3.2/§3.3: the three entry paths, and the highest-leverage dimensions each
// seeds. These are pure functions (no DB) — the shape of the cold-start model
// before anything is persisted. The seed set is the UNION of §3.3's families
// (A capacity, G process, D customer-contact, F communication) and the four
// dimensions the Build 5 initiation policy reads (accountability, cadence,
// rhythm, burnout), so first contact is personalized from message one.

const base = (path: OnboardingInput["path"]): OnboardingInput => ({
  path,
  channel: { channelType: "imessage", address: "+15551234567" },
});

// The four dimensions registerInitiation consumes — every path must seed them.
const INITIATION_DIMENSIONS = [
  "accountability_responsiveness",
  "communication_cadence",
  "working_rhythm",
  "load_burnout",
];

describe("cold-start seed profile (§3.3, §6.13)", () => {
  it("every path seeds all four dimensions the initiation policy reads", () => {
    for (const path of ["idea", "problem", "none"] as const) {
      const dims = seedProfile(base(path)).map((seed) => seed.dimension);
      for (const dimension of INITIATION_DIMENSIONS) {
        expect(dims).toContain(dimension);
      }
    }
  });

  it("seeds the §3.3 highest-leverage dimensions too (capacity, process, customer-contact)", () => {
    const dims = seedProfile(base("idea")).map((seed) => seed.dimension);
    expect(dims).toContain("available_time");
    expect(dims).toContain("process_sophistication");
    expect(dims).toContain("customer_contact_avoidance");
  });

  it("all seeds are in [0,1] — normalized estimates", () => {
    for (const seed of seedProfile(base("problem"))) {
      expect(seed.estimate).toBeGreaterThanOrEqual(0);
      expect(seed.estimate).toBeLessThanOrEqual(1);
    }
  });

  it("the path itself is a process-sophistication signal (§3.2): none < problem < idea", () => {
    const proc = (path: OnboardingInput["path"]) =>
      seedProfile(base(path)).find((seed) => seed.dimension === "process_sophistication")
        ?.estimate ?? 0;
    expect(proc("none")).toBeLessThan(proc("problem"));
    expect(proc("problem")).toBeLessThan(proc("idea"));
  });

  it("a Path-C origin lowers ONLY process_sophistication vs a native Path A founder (§3.2, ADR 0015)", () => {
    const nativeIdea = seedProfile(base("idea"));
    // Identical input except the Path-C origin marker — all else equal.
    const fromPathC = seedProfile({ ...base("idea"), originPath: "none" });
    const proc = (seeds: ReturnType<typeof seedProfile>) =>
      seeds.find((s) => s.dimension === "process_sophistication")?.estimate ?? 0;

    // C-origin starts below the native idea default, but above the raw "none"
    // prior — they arrived with nothing yet now hold an idea.
    expect(proc(fromPathC)).toBeLessThan(proc(nativeIdea));
    expect(proc(fromPathC)).toBeGreaterThan(0.2);

    // Every OTHER dimension is byte-for-byte identical — the marker touches one.
    for (const seed of fromPathC) {
      if (seed.dimension === "process_sophistication") continue;
      const native = nativeIdea.find((s) => s.dimension === seed.dimension);
      expect(native?.estimate).toBe(seed.estimate);
    }
  });

  it("self-reported signals override the neutral defaults", () => {
    const withReport: OnboardingInput = {
      ...base("idea"),
      selfReport: { availableHoursPerWeek: 40, communicationCadence: 0.9 },
    };
    const seeds = seedProfile(withReport);
    const time = seeds.find((s) => s.dimension === "available_time")?.estimate;
    const cadence = seeds.find((s) => s.dimension === "communication_cadence")?.estimate;
    expect(time).toBeGreaterThan(0.9); // 40/40h → ~1.0, well above the 0.5 default
    expect(cadence).toBeCloseTo(0.9, 5);
  });
});

describe("company state seed (§3.3)", () => {
  it("records the idea as a hypothesis, not a fact (§3.2)", () => {
    const seed = companyStateSeed({ ...base("idea"), ideaText: "AI for dentists" });
    expect(seed.state.entryPath).toBe("idea");
    expect(seed.state.ideaHypothesis).toBe("AI for dentists");
    // Deliberately NOT stored as a settled 'idea' fact.
    expect((seed.state as Record<string, unknown>).idea).toBeUndefined();
  });

  it("frames the problem space for the problem path", () => {
    const seed = companyStateSeed({ ...base("problem"), problemText: "scheduling is broken" });
    expect(seed.state.entryPath).toBe("problem");
    expect(seed.state.problem).toBe("scheduling is broken");
  });

  it("the none path carries a surfaced direction, not an invented business", () => {
    const seed = companyStateSeed({ ...base("none"), surfacedDirection: "developer tools" });
    expect(seed.state.entryPath).toBe("none");
    expect(seed.state.surfacedDirection).toBe("developer tools");
  });
});
