import { type ActionLedger, type IrreversibleResult, runIrreversible } from "@tethr/core";
import type { WorkflowEngine, WorkflowStep } from "./engine";

// The one gate every irreversible external action passes through inside a
// workflow (handbook §18.5.7, §8.5). It composes the core audit-before-
// dispatch substrate with durable-step semantics and the degrade-to-asking
// rule: an ambiguous prior outcome is never blindly retried — it becomes a
// reconciliation event surfaced to the founder.

/** Internal event asking the founder to reconcile an ambiguous dispatch (§8.5). */
export const RECONCILIATION_EVENT = "action.reconciliation-needed";

export type ExternalActionResult<T> =
  | IrreversibleResult<T>
  | { outcome: "needs-reconciliation"; priorStatus: "ambiguous" };

export type RunExternalActionOptions<T> = {
  step: WorkflowStep;
  ledger: ActionLedger;
  engine: WorkflowEngine;
  actionType: string;
  idempotencyKey: string;
  /** The real external call; receives the key so the provider request carries it. */
  dispatch: (idempotencyKey: string) => Promise<T>;
};

export async function runExternalAction<T>(
  options: RunExternalActionOptions<T>,
): Promise<ExternalActionResult<T>> {
  const { step, ledger, engine, actionType, idempotencyKey, dispatch } = options;

  const result = await step.run(`external:${actionType}:${idempotencyKey}`, () =>
    runIrreversible({ actionType, idempotencyKey, ledger, action: dispatch }),
  );

  if (result.outcome === "duplicate" && result.priorStatus === "ambiguous") {
    // The prior attempt may or may not have reached the world. Retrying could
    // double-contact; dropping could silently lose the action. Degrade to
    // asking (§8.5): surface it and let the founder (or a reconciler) decide.
    await step.run(`reconcile:${actionType}:${idempotencyKey}`, () =>
      engine.send({
        name: RECONCILIATION_EVENT,
        data: { actionType, idempotencyKey },
        id: `${RECONCILIATION_EVENT}:${actionType}:${idempotencyKey}`,
      }),
    );
    return { outcome: "needs-reconciliation", priorStatus: "ambiguous" };
  }

  return result;
}
