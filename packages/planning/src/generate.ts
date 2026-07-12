import { z } from "zod";
import { type CapacityRead, sizeEstimateMinutes } from "./capacity";
import { sequenceActions } from "./sequence";

// Tier-2 plan generation boundary (§12.2, Ch 20). The model proposes candidate
// Actions with raw effort and dependency keys; this module validates that
// output at the boundary with Zod (untrusted model JSON — same posture as
// research/pipeline.ts and founder-model/model-extractors.ts), sequences it
// into a validated DAG, and sizes each estimate against the founder's capacity.
// The DECISION shape (sequence, dependency validity, estimate sizing) is
// deterministic and testable; the model only supplies the human-facing content.

// All five §12.2 Action fields are mandatory. Missing any one fails validation
// here before it can reach the (also NOT NULL) columns — a malformed Action is
// rejected, never persisted.
const candidateSchema = z.object({
  key: z.string().min(1).max(64),
  action: z.string().min(1).max(500),
  founderRequirement: z.string().min(1).max(500),
  definitionOfDone: z.string().min(1).max(500),
  effortMinutes: z.number().int().positive().max(100_000),
  dependsOn: z.array(z.string().min(1).max(64)).max(50).default([]),
});

export const planCandidateSchema = z.object({
  actions: z.array(candidateSchema).min(1).max(50),
});

export type PlanCandidate = z.infer<typeof candidateSchema>;

/** An Action ready to persist: sequenced, sized, keyed locally for dependency wiring. */
export type PreparedAction = {
  key: string;
  action: string;
  founderRequirement: string;
  definitionOfDone: string;
  estimatedMinutes: number;
  sequenceIndex: number;
  dependsOnKeys: string[];
};

export const PLAN_GENERATION_SYSTEM =
  "You are sequencing a first-time founder's next actions from a market verdict. " +
  'Return ONLY JSON {"actions":[{"key":string,"action":string,' +
  '"founderRequirement":string,"definitionOfDone":string,"effortMinutes":int,' +
  '"dependsOn":[key]}]}. Every action needs all five fields. definitionOfDone must ' +
  "be a concrete, checkable condition. dependsOn lists the keys of actions that must " +
  "finish first — encode real sequence, not a flat list. Max 50 actions.";

export function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Validate model output, sequence it into a dependency DAG (throws on cycle,
 * dangling dependency, or duplicate key — A1/A2/A3), and size each estimate
 * against the founder's available_time read. Pure: given the same model JSON
 * and capacity read, produces the same prepared actions.
 */
export function buildPlanActions(rawModelJson: unknown, capacity: CapacityRead): PreparedAction[] {
  const { actions } = planCandidateSchema.parse(rawModelJson);
  const sequenced = sequenceActions(actions.map((a) => ({ key: a.key, dependsOn: a.dependsOn })));
  const indexByKey = new Map(sequenced.map((n) => [n.key, n.sequenceIndex]));
  return actions.map((a) => ({
    key: a.key,
    action: a.action,
    founderRequirement: a.founderRequirement,
    definitionOfDone: a.definitionOfDone,
    estimatedMinutes: sizeEstimateMinutes(a.effortMinutes, capacity),
    sequenceIndex: indexByKey.get(a.key) as number,
    dependsOnKeys: a.dependsOn,
  }));
}
