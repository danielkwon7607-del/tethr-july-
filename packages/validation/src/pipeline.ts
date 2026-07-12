import { readTrait, type TraitRead } from "@tethr/founder-model";
import type { QueryEmbedder } from "@tethr/model-router";
import {
  sendInternal,
  type TierRunner,
  type WorkflowEngine,
  type WorkflowStep,
} from "@tethr/orchestration";
import { retrieveGrounding } from "@tethr/public-knowledge";
import type { Sql } from "postgres";
import {
  type ExperimentOutcome,
  PLAN_ADVANCE_EVENT,
  PLAN_REPLAN_EVENT,
  VALIDATION_PIVOT_EVENT,
} from "./events";
import {
  CANDIDATES_SYSTEM,
  EXPERIMENT_SYSTEM,
  parseCandidates,
  parseExperimentDesign,
  parseModelJson,
} from "./generate";
import { selectHighestRisk } from "./select";
import { type CapacityRead, sizeSampleForCapacity } from "./sizing";

// Validation (Ch 13). From the current Plan + Company State, surface the
// riskiest assumption (grounded, §13.1), design an Experiment whose criteria are
// set in advance and frozen by the DB (§13.2, migration 0013), and route landed
// results back into the loop (§13.3). Tier-2 generation (Ch 20); the selection
// DECISION is the deterministic selector.

export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

export type ValidationDeps = {
  tierRunner: TierRunner;
  embedder: QueryEmbedder;
  runScoped: FounderScopedRunner;
  engine: WorkflowEngine;
};

const AVAILABLE_TIME = "available_time";

function pickCapacity(trait: TraitRead | undefined): CapacityRead {
  if (!trait) return undefined;
  return trait.revealed.estimate !== null ? trait.revealed : trait.stated;
}

export type ExperimentDesignResult = {
  experimentId: string;
  assumption: string;
  risk: number;
};

/**
 * Design and persist the first Experiment for a plan, targeting the single
 * highest-risk assumption. Idempotent: a plan that already has an experiment is
 * not re-designed. Returns the experiment id and the selected assumption.
 */
export async function designAndPersistExperiment(
  deps: ValidationDeps,
  { founderId, planId, step }: { founderId: string; planId: string; step: WorkflowStep },
): Promise<ExperimentDesignResult | null> {
  const existing = await step.run("check-existing-experiment", () =>
    deps.runScoped(
      founderId,
      (trx) =>
        trx<{ id: string }[]>`
        select e.id from experiments e where e.plan_id = ${planId} limit 1`,
    ),
  );
  if (existing.length > 0) return null;

  const context = await step.run("read-validation-context", () =>
    deps.runScoped(founderId, async (trx) => {
      const [state] = await trx<{ summary: string | null }[]>`
        select cs.state->>'ideaHypothesis' as summary from company_state cs limit 1`;
      const actions = await trx<{ action: string }[]>`
        select action from actions where plan_id = ${planId} order by sequence_index`;
      const trait = await readTrait(trx, AVAILABLE_TIME);
      const query = `${state?.summary ?? ""} ${actions.map((a) => a.action).join("; ")}`.trim();
      const grounding = await retrieveGrounding(trx, deps.embedder, query || "startup validation", {
        limit: 6,
      });
      const capacity = pickCapacity(trait);
      return {
        planText: actions.map((a) => `- ${a.action}`).join("\n"),
        groundingText: grounding.map((c) => `- ${c.title ?? c.source}: ${c.content}`).join("\n"),
        capacity: capacity
          ? { estimate: capacity.estimate, confidence: capacity.confidence }
          : null,
      };
    }),
  );

  const grounding = context.groundingText || "(none retrieved)";
  const candidatesRaw = await step.run("generate-candidates", async () => {
    const result = await deps.tierRunner.tier2({
      system: CANDIDATES_SYSTEM,
      prompt: `Plan actions:\n${context.planText}\n\nGrounding:\n${grounding}\n\nList the assumptions this plan rests on.`,
    });
    return result.text;
  });
  const selection = selectHighestRisk(parseCandidates(parseModelJson(candidatesRaw)));

  const designRaw = await step.run("design-experiment", async () => {
    const result = await deps.tierRunner.tier2({
      system: EXPERIMENT_SYSTEM,
      prompt:
        `Assumption to test: ${selection.candidate.assumption}\n` +
        `Rests on: ${selection.candidate.evidenceRef}\n\nGrounding:\n${grounding}\n\n` +
        "Design the cheapest experiment that tests it before the founder builds.",
    });
    return result.text;
  });
  const design = parseExperimentDesign(parseModelJson(designRaw));
  const sampleSize = sizeSampleForCapacity(design.sampleSize, context.capacity ?? undefined);

  const experimentId = await step.run("persist-experiment", () =>
    deps.runScoped(founderId, async (trx) => {
      const [row] = await trx<{ id: string }[]>`
        insert into experiments (plan_id, hypothesis, success_criteria, failure_criteria,
          duration, sample_size, status)
        values (${planId}, ${design.hypothesis}, ${design.successCriteria}, ${design.failureCriteria},
          make_interval(days => ${design.durationDays}), ${sampleSize}, 'designed')
        returning id`;
      return (row as { id: string }).id;
    }),
  );

  return { experimentId, assumption: selection.candidate.assumption, risk: selection.risk };
}

const OUTCOME_STATUS: Record<ExperimentOutcome, string> = {
  pass: "passed",
  fail: "failed",
  pivot: "aborted",
};

/**
 * Ingest an experiment result and route it (§13.3): pass → the Plan advances;
 * fail → re-planning; pivot → back into Research (Ch 11) through the Build 2
 * intake, so the loop never dead-ends. Writing the result + status leaves the
 * frozen criteria untouched, so the immutability trigger allows it. The
 * customer-facing send that produces the real result is Build 9; here the
 * outcome is stubbed / founder-reported.
 */
export async function ingestExperimentResult(
  deps: ValidationDeps,
  {
    founderId,
    experimentId,
    outcome,
    detail,
    step,
  }: {
    founderId: string;
    experimentId: string;
    outcome: ExperimentOutcome;
    detail: string | undefined;
    step: WorkflowStep;
  },
): Promise<void> {
  const planId = await step.run("record-result", () =>
    deps.runScoped(founderId, async (trx) => {
      const [current] = await trx<{ plan_id: string | null; status: string }[]>`
        select plan_id, status from experiments where id = ${experimentId}`;
      if (!current) {
        throw new Error(`experiment ${experimentId} not found under this founder`);
      }
      // Idempotent under at-least-once replay: a retry after the write committed
      // but before the step was checkpointed finds the row already in the target
      // status — treat that as done, not an error (the planning check-existing
      // pattern). A DIFFERENT terminal status is a genuine conflicting result.
      if (current.status === OUTCOME_STATUS[outcome]) return current.plan_id;
      if (current.status !== "designed" && current.status !== "running") {
        throw new Error(`experiment ${experimentId} already resolved as ${current.status}`);
      }
      const [row] = await trx<{ plan_id: string | null }[]>`
        update experiments
        set status = ${OUTCOME_STATUS[outcome]},
          result = ${trx.json({ outcome, detail: detail ?? null, at: new Date().toISOString() })}
        where id = ${experimentId} and status in ('designed', 'running')
        returning plan_id`;
      return (row as { plan_id: string | null }).plan_id;
    }),
  );

  if (outcome === "pivot") {
    // The one path that must reach Research (Ch 11) — Research owns the consumer.
    await step.run("route-pivot", () =>
      sendInternal(deps.engine, {
        name: VALIDATION_PIVOT_EVENT,
        id: `validation-pivot/${experimentId}`,
        data: { founderId, experimentId },
      }),
    );
    return;
  }

  const routed = outcome === "pass" ? PLAN_ADVANCE_EVENT : PLAN_REPLAN_EVENT;
  await step.run("route-result", () =>
    sendInternal(deps.engine, {
      name: routed,
      id: `${routed}/${experimentId}`,
      data: { founderId, planId, experimentId },
    }),
  );
}
