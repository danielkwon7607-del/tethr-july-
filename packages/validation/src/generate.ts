import { z } from "zod";
import type { RiskCandidate } from "./select";

// Tier-2 validation generation boundary (§13.2, Ch 20). Two model calls, each
// validated at the boundary with Zod (untrusted model JSON): (1) candidate
// risk assumptions scored on the two axes the selector needs, each carrying an
// evidence reference so the chosen assumption traces to real plan/verdict
// content (B4), and (2) the Experiment design for the selected assumption. The
// DECISION (which assumption) is the deterministic selector (select.ts); the
// model only surfaces and describes.

// A candidate carries the two risk axes plus a grounding reference. impact and
// failure_likelihood are guarded to [0,1] here so a malformed score is rejected
// at the boundary, never silently defaulted into the selector (B2).
const candidateSchema = z.object({
  assumption: z.string().min(1).max(400),
  impact: z.number().min(0).max(1),
  failureLikelihood: z.number().min(0).max(1),
  /** What in the plan/verdict this assumption rests on — traceability (B4). */
  evidenceRef: z.string().min(1).max(400),
});

export const candidatesSchema = z.object({
  assumptions: z.array(candidateSchema).min(1).max(10),
});

export type ScoredAssumption = z.infer<typeof candidateSchema> & RiskCandidate;

// Success and failure criteria must both be set in advance and must differ — a
// cheap structural guard against the degenerate unfalsifiable case where any
// result can be read as success (B3, v0; fuller falsifiability scoring is
// tracked debt for a later handbook amendment).
export const experimentDesignSchema = z
  .object({
    hypothesis: z.string().min(1).max(1000),
    successCriteria: z.string().min(1).max(1000),
    failureCriteria: z.string().min(1).max(1000),
    durationDays: z.number().int().positive().max(365),
    sampleSize: z.number().int().positive().max(100_000),
  })
  .refine((d) => d.successCriteria.trim() !== d.failureCriteria.trim(), {
    message: "success and failure criteria must differ (a result must be interpretable, §13.2)",
    path: ["failureCriteria"],
  });

export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;

export const CANDIDATES_SYSTEM =
  "You surface the assumptions a founder's plan rests on, to find the riskiest one to " +
  'test first (§13.1). Return ONLY JSON {"assumptions":[{"assumption":string,' +
  '"impact":number,"failureLikelihood":number,"evidenceRef":string}]}. impact ∈ [0,1] is ' +
  "how cheaply the idea dies if this assumption is false; failureLikelihood ∈ [0,1] is the " +
  "probability the assumption is actually false; evidenceRef points to the plan/verdict " +
  "content it rests on. Max 10.";

export const EXPERIMENT_SYSTEM =
  "You design the cheapest experiment that tests one assumption before the founder builds " +
  '(§13.2). Return ONLY JSON {"hypothesis":string,"successCriteria":string,' +
  '"failureCriteria":string,"durationDays":int,"sampleSize":int}. Success and failure ' +
  "criteria are set NOW, before any result, and must be distinct and measurable.";

export function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

export function parseCandidates(rawModelJson: unknown): ScoredAssumption[] {
  return candidatesSchema.parse(rawModelJson).assumptions;
}

export function parseExperimentDesign(rawModelJson: unknown): ExperimentDesign {
  return experimentDesignSchema.parse(rawModelJson);
}
