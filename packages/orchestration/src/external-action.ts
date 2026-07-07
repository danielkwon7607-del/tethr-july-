import {
  type ActionLedger,
  type ActionStatus,
  DefiniteDispatchFailureError,
  runIrreversible,
} from "@tethr/core";
import type { JsonValue, WorkflowEngine, WorkflowStep } from "./engine";

// The one gate every irreversible external action passes through inside a
// workflow (handbook §18.5.7, §8.5). It composes the core audit-before-
// dispatch substrate with durable-step semantics and the degrade-to-asking
// rule: uncertainty is never blindly retried — it becomes a reconciliation
// event surfaced to the founder.

/** Internal event asking the founder to reconcile an uncertain dispatch (§8.5). */
export const RECONCILIATION_EVENT = "action.reconciliation-needed";

/** What the durable step memoizes; ambiguity is a value, not a thrown error,
 * so reconciliation does not depend on the engine's step-retry budget. */
type StepOutcome<T> =
  | { outcome: "executed"; value: T }
  | { outcome: "duplicate"; priorStatus: ActionStatus }
  | { outcome: "dispatch-ambiguous"; detail: string };

export type ExternalActionResult<T> =
  | { outcome: "executed"; value: T }
  | { outcome: "duplicate"; priorStatus: ActionStatus }
  /**
   * The dispatch may or may not have reached the world: either this attempt
   * failed ambiguously, or a prior claim was left "pending" (crash mid-
   * dispatch) or "ambiguous". Epistemically identical — all three surface to
   * the founder rather than retrying or silently completing (§18.5.7, §8.5).
   */
  | { outcome: "needs-reconciliation"; priorStatus: "ambiguous" | "pending" };

// T is strictly JsonValue (not void): the dispatch result is memoized across
// the durable boundary, and a void would replay as null — a quiet lie. Return
// null explicitly if there is nothing to say.
export type RunExternalActionOptions<T extends JsonValue> = {
  step: WorkflowStep;
  ledger: ActionLedger;
  engine: WorkflowEngine;
  actionType: string;
  idempotencyKey: string;
  /** The real external call; receives the key so the provider request carries it. */
  dispatch: (idempotencyKey: string) => Promise<T>;
};

export async function runExternalAction<T extends JsonValue>(
  options: RunExternalActionOptions<T>,
): Promise<ExternalActionResult<T>> {
  const { step, ledger, engine, actionType, idempotencyKey, dispatch } = options;

  const stepResult = await step.run(
    `external:${actionType}:${idempotencyKey}`,
    async (): Promise<StepOutcome<T>> => {
      let dispatchAttempted = false;
      try {
        return await runIrreversible({
          actionType,
          idempotencyKey,
          ledger,
          action: (key) => {
            dispatchAttempted = true;
            return dispatch(key);
          },
        });
      } catch (error) {
        // Before dispatch (no valid audit row) the action is rejected, not
        // attempted — rethrow so the run fails loudly (§18.5.7). A definite
        // dispatch failure released the claim, so a step retry may safely
        // re-dispatch — rethrow into the engine's retry/backoff.
        if (!dispatchAttempted || error instanceof DefiniteDispatchFailureError) throw error;
        // Ambiguous: recorded in the ledger, claim held. Return a value so
        // the step SUCCEEDS deterministically and reconciliation below never
        // depends on how many retries the engine grants.
        return {
          outcome: "dispatch-ambiguous",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const priorStatus =
    stepResult.outcome === "dispatch-ambiguous"
      ? "ambiguous"
      : stepResult.outcome === "duplicate" &&
          (stepResult.priorStatus === "ambiguous" || stepResult.priorStatus === "pending")
        ? stepResult.priorStatus
        : undefined;

  if (priorStatus !== undefined) {
    // Retrying could double-contact; dropping could silently lose the action.
    // Degrade to asking (§8.5). The event id is stable per (action, key) so a
    // redelivered run cannot double-ask about the same incident; when a
    // reconciler that RELEASES claims exists, add an incident nonce here so a
    // genuinely new incident on a reused key is not deduped away.
    await step.run(`reconcile:${actionType}:${idempotencyKey}`, () =>
      engine.send({
        name: RECONCILIATION_EVENT,
        data: { actionType, idempotencyKey },
        id: `${RECONCILIATION_EVENT}:${actionType}:${idempotencyKey}`,
      }),
    );
    return { outcome: "needs-reconciliation", priorStatus };
  }

  return stepResult as ExternalActionResult<T>;
}
