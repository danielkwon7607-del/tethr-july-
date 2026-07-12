import { randomUUID } from "node:crypto";
import { readTrait, type TraitRead } from "@tethr/founder-model";
import type { QueryEmbedder } from "@tethr/model-router";
import type { TierRunner, WorkflowStep } from "@tethr/orchestration";
import { retrieveGrounding } from "@tethr/public-knowledge";
import type { Sql } from "postgres";
import type { CapacityRead } from "./capacity";
import { buildPlanActions, PLAN_GENERATION_SYSTEM, parseModelJson } from "./generate";

// Plan generation (Ch 12). Consumes the Research verdict, grounds against Public
// Knowledge (Ch 7 — this package is one of the two allowed consumers, enforced
// by access-boundary.test.ts), personalizes estimate sizing against the Founder
// Model's available_time read (§12.3), and persists a sequenced Plan of Actions.
// Tier-2 generation (Ch 20) writes the human content; the deterministic core
// (sequence.ts, capacity.ts) makes the structural decisions.

/** withFounderContext partially applied: every read/write stays under RLS. */
export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

export type PlanningDeps = {
  tierRunner: TierRunner;
  /** Pinned to the corpus embedding model (Ch 7); grounds generation. */
  embedder: QueryEmbedder;
  runScoped: FounderScopedRunner;
};

export type PlanningInput = {
  founderId: string;
  verdictId: string;
  step: WorkflowStep;
};

const AVAILABLE_TIME = "available_time";

// Prefer the revealed side for action policy (§6.7); fall back to stated; an
// absent trait sizes conservatively (capacity.ts).
function pickCapacity(trait: TraitRead | undefined): CapacityRead {
  if (!trait) return undefined;
  return trait.revealed.estimate !== null ? trait.revealed : trait.stated;
}

/**
 * Generate and persist a Plan for a landed verdict. Idempotent: a redelivered
 * verdict finds the existing active plan and does not create a second. Returns
 * the plan id (existing or new).
 */
export async function generateAndPersistPlan(
  deps: PlanningDeps,
  { founderId, verdictId, step }: PlanningInput,
): Promise<string> {
  const existing = await step.run("check-existing-plan", () =>
    deps.runScoped(
      founderId,
      (trx) =>
        trx<{ id: string }[]>`
        select id from plans where verdict_id = ${verdictId} and status = 'active' limit 1`,
    ),
  );
  if (existing.length > 0) return (existing[0] as { id: string }).id;

  // The step returns only JSON-serializable values — a durable engine memoizes
  // step results by JSON round-trip, so a Date/undefined here would corrupt on
  // replay (the WorkflowStep type enforces it).
  const context = await step.run("read-planning-context", () =>
    deps.runScoped(founderId, async (trx) => {
      const [verdict] = await trx<{ verdict: string; summary: string }[]>`
        select verdict, summary from verdicts where id = ${verdictId}`;
      if (!verdict) {
        // Degrade to asking, not a silent no-op (§8.5): the verdict must be
        // visible under this founder's scope or the seam is mis-wired.
        throw new Error(`verdict ${verdictId} is not visible for founder ${founderId}`);
      }
      const trait = await readTrait(trx, AVAILABLE_TIME);
      const grounding = await retrieveGrounding(trx, deps.embedder, verdict.summary, { limit: 6 });
      const capacity = pickCapacity(trait);
      return {
        verdict: verdict.verdict,
        summary: verdict.summary,
        groundingText: grounding.map((c) => `- ${c.title ?? c.source}: ${c.content}`).join("\n"),
        capacity: capacity
          ? { estimate: capacity.estimate, confidence: capacity.confidence }
          : null,
      };
    }),
  );

  const prompt =
    `Market verdict: ${context.verdict}\nSummary: ${context.summary}\n\n` +
    `Grounding (known startup practice):\n${context.groundingText || "(none retrieved)"}\n\n` +
    "Sequence the founder's next actions as a dependency-aware plan.";

  const rawText = await step.run("generate-plan", async () => {
    const result = await deps.tierRunner.tier2({ system: PLAN_GENERATION_SYSTEM, prompt });
    return result.text;
  });

  const prepared = buildPlanActions(parseModelJson(rawText), context.capacity ?? undefined);

  return step.run("persist-plan", () =>
    deps.runScoped(founderId, async (trx) => {
      const [plan] = await trx<{ id: string }[]>`
        insert into plans (verdict_id) values (${verdictId}) returning id`;
      const planId = (plan as { id: string }).id;
      const idByKey = new Map(prepared.map((p) => [p.key, randomUUID()]));
      for (const p of prepared) {
        const dependsOn = p.dependsOnKeys.map((k) => idByKey.get(k) as string);
        await trx`
          insert into actions (id, plan_id, sequence_index, depends_on_action_ids, action,
            founder_requirement, definition_of_done, estimated_time, status)
          values (${idByKey.get(p.key) as string}, ${planId}, ${p.sequenceIndex}, ${dependsOn},
            ${p.action}, ${p.founderRequirement}, ${p.definitionOfDone},
            make_interval(mins => ${p.estimatedMinutes}), 'pending')`;
      }
      return planId;
    }),
  );
}
