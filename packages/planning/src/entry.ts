import { recordObservation } from "@tethr/founder-model";
import { sendInternal, type WorkflowEngine } from "@tethr/orchestration";
import { generateAndPersistPlan, type PlanningDeps } from "./pipeline";
import { resequencePlan } from "./resequence";

// The Planning workflows (Ch 12), wired to the Build 2 orchestration engine.
// Three consumers, all on internal events (§8.2), all carrying ids not bodies
// (§18.5.6):
//   research.completed  → generate the Plan (a verdict landing prompts Planning)
//   plan.action.pushback → record a deference observation + trigger re-sequencing
//   plan.resequence      → re-sequence the Plan (the ratchet, §12.4)
// The event-name constants are defined locally: Planning consumes these events
// and owns its consumer seams (Constitution XII) — it does not import Research,
// exactly as research/entry.ts defines onboarding.completed locally rather than
// importing onboarding.

export const RESEARCH_COMPLETED_EVENT = "research.completed";
export const PLAN_CREATED_EVENT = "plan.created";
export const PLAN_PUSHBACK_EVENT = "plan.action.pushback";
export const PLAN_RESEQUENCE_EVENT = "plan.resequence";

export const PLANNING_ENTRY_WORKFLOW_ID = "planning.generate";
export const PLANNING_PUSHBACK_WORKFLOW_ID = "planning.pushback";
export const PLANNING_RESEQUENCE_WORKFLOW_ID = "planning.resequence";

// Pushback is an override, i.e. LOW deference (§6.3, family C). Recorded on the
// revealed side (they actually overrode — revealed beats stated, §6.7).
const PUSHBACK_DEFERENCE_ESTIMATE = 0.2;
const DEFERENCE_DIMENSION = "deference";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

export type PlanningEntryDeps = PlanningDeps & {
  engine: WorkflowEngine;
  onPlan?: (planId: string, founderId: string) => void | Promise<void>;
};

/** research.completed → a sequenced Plan (§8.2). Idempotent on the verdict. */
export function registerPlanningEntry(engine: WorkflowEngine, deps: PlanningEntryDeps): void {
  engine.register({
    id: PLANNING_ENTRY_WORKFLOW_ID,
    trigger: { event: RESEARCH_COMPLETED_EVENT },
    handler: async (event, step) => {
      // Untrusted payload (ADR 0008 class): the founderId decides RLS scope.
      const founderId = requireUuid(event.data.founderId, "founderId");
      const verdictId = requireUuid(event.data.verdictId, "verdictId");
      // A pivot verdict re-enters at Planning (§11.4) exactly like strong/weak —
      // the Plan sequences the pivot direction; it does not bounce to Research.
      const planId = await generateAndPersistPlan(deps, { founderId, verdictId, step });
      // A plan forming prompts the first Validation design (§8.2) — the internal
      // intake carries ids only (§18.5.6); Validation owns the consumer.
      await step.run("emit-plan-created", () =>
        sendInternal(engine, {
          name: PLAN_CREATED_EVENT,
          id: `plan-created/${planId}`,
          data: { founderId, planId, verdictId },
        }),
      );
      await deps.onPlan?.(planId, founderId);
    },
  });
}

/**
 * Founder pushback on an Action (§12.2): (a) a Founder Model deference signal on
 * the write path (§6.3/§6.5), and (b) a re-sequence trigger through the internal
 * intake (§12.4) — the same shape as onboarding auto-triggering Research.
 */
export function registerPlanPushback(engine: WorkflowEngine, deps: PlanningEntryDeps): void {
  engine.register({
    id: PLANNING_PUSHBACK_WORKFLOW_ID,
    trigger: { event: PLAN_PUSHBACK_EVENT },
    handler: async (event, step) => {
      const founderId = requireUuid(event.data.founderId, "founderId");
      const planId = requireUuid(event.data.planId, "planId");
      const actionId = requireUuid(event.data.actionId, "actionId");

      await step.run("record-deference", async () => {
        // The RecordResult is intentionally discarded: a step result crosses a
        // durable JSON boundary, and the write itself is the effect we want.
        await deps.runScoped(founderId, (trx) =>
          recordObservation(trx, {
            family: "risk_decision",
            dimension: DEFERENCE_DIMENSION,
            source: "revealed",
            estimate: PUSHBACK_DEFERENCE_ESTIMATE,
            provenanceEpisodeIds: [],
          }),
        );
      });

      await step.run("trigger-resequence", () =>
        sendInternal(engine, {
          name: PLAN_RESEQUENCE_EVENT,
          id: `resequence/${planId}/${actionId}`,
          data: { founderId, planId, dropActionId: actionId },
        }),
      );
    },
  });
}

/** plan.resequence → drop the pushed-back Action and re-sequence the rest (§12.4). */
export function registerPlanResequence(engine: WorkflowEngine, deps: PlanningEntryDeps): void {
  engine.register({
    id: PLANNING_RESEQUENCE_WORKFLOW_ID,
    trigger: { event: PLAN_RESEQUENCE_EVENT },
    handler: async (event, step) => {
      const founderId = requireUuid(event.data.founderId, "founderId");
      const planId = requireUuid(event.data.planId, "planId");
      const dropActionId = requireUuid(event.data.dropActionId, "dropActionId");
      await step.run("resequence-plan", () =>
        deps.runScoped(founderId, (trx) => resequencePlan(trx, planId, dropActionId)),
      );
    },
  });
}
