import type { WorkflowEngine } from "@tethr/orchestration";
import { type ExperimentOutcome, PLAN_CREATED_EVENT, VALIDATION_RESULT_EVENT } from "./events";
import {
  designAndPersistExperiment,
  type ExperimentDesignResult,
  ingestExperimentResult,
  type ValidationDeps,
} from "./pipeline";

// The Validation workflows (Ch 13), wired to the Build 2 engine on internal
// events (§8.2), ids only (§18.5.6):
//   plan.created       → design the first Experiment against the riskiest assumption
//   validation.result  → ingest a landed result and route it (§13.3)

export const VALIDATION_ENTRY_WORKFLOW_ID = "validation.design";
export const VALIDATION_RESULT_WORKFLOW_ID = "validation.result-ingest";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES: ReadonlySet<string> = new Set(["pass", "fail", "pivot"]);

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

export type ValidationEntryDeps = ValidationDeps & {
  onExperiment?: (result: ExperimentDesignResult | null, founderId: string) => void | Promise<void>;
};

/** plan.created → design the first Experiment against the single riskiest assumption. */
export function registerValidationEntry(engine: WorkflowEngine, deps: ValidationEntryDeps): void {
  engine.register({
    id: VALIDATION_ENTRY_WORKFLOW_ID,
    trigger: { event: PLAN_CREATED_EVENT },
    handler: async (event, step) => {
      const founderId = requireUuid(event.data.founderId, "founderId");
      const planId = requireUuid(event.data.planId, "planId");
      const result = await designAndPersistExperiment(deps, { founderId, planId, step });
      await deps.onExperiment?.(result, founderId);
    },
  });
}

/** validation.result → ingest a landed result and route it (pass/fail/pivot). */
export function registerValidationResult(engine: WorkflowEngine, deps: ValidationDeps): void {
  engine.register({
    id: VALIDATION_RESULT_WORKFLOW_ID,
    trigger: { event: VALIDATION_RESULT_EVENT },
    handler: async (event, step) => {
      const founderId = requireUuid(event.data.founderId, "founderId");
      const experimentId = requireUuid(event.data.experimentId, "experimentId");
      const outcome = event.data.outcome;
      if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) {
        throw new Error(`validation.result outcome must be one of pass|fail|pivot, got ${outcome}`);
      }
      const detail = typeof event.data.detail === "string" ? event.data.detail : undefined;
      await ingestExperimentResult(deps, {
        founderId,
        experimentId,
        outcome: outcome as ExperimentOutcome,
        detail,
        step,
      });
    },
  });
}
