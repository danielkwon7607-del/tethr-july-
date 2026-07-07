import { type ActionLedger, InMemoryActionLedger } from "@tethr/core";
import { describe, expect, it } from "vitest";
import { InMemoryWorkflowEngine, type WorkflowStep } from "./engine";
import { RECONCILIATION_EVENT, runExternalAction } from "./external-action";

// §18.5.7 at the orchestration layer: the wrapper every irreversible external
// action goes through. Audit-before-dispatch, no double-fire under retry,
// rejection without a valid audit row, and degrade-to-asking on uncertainty.

const directStep: WorkflowStep = {
  run: (_name, fn) => fn(),
  sleepUntil: async () => {},
};

function harness() {
  const engine = new InMemoryWorkflowEngine();
  const ledger = new InMemoryActionLedger();
  const asks: unknown[] = [];
  engine.register({
    id: "reconciliation.listener",
    trigger: { event: RECONCILIATION_EVENT },
    handler: async (event) => {
      asks.push(event.data);
    },
  });
  return { engine, ledger, asks };
}

describe("runExternalAction (§18.5.7 wrapper)", () => {
  it("writes the audit row before dispatching, and executes once", async () => {
    const { engine, ledger } = harness();
    let ledgerRowsAtDispatch = -1;
    const result = await runExternalAction({
      step: directStep,
      ledger,
      engine,
      actionType: "outreach.send",
      idempotencyKey: "founder-1/send-1",
      dispatch: async () => {
        ledgerRowsAtDispatch = (await ledger.list()).length;
        return "sent";
      },
    });

    expect(result).toEqual({ outcome: "executed", value: "sent" });
    expect(ledgerRowsAtDispatch).toBe(1); // intent row existed before dispatch
    expect((await ledger.list())[0]?.status).toBe("executed");
  });

  it("is rejected without dispatching when it cannot produce a valid audit row", async () => {
    const { engine } = harness();
    const downLedger: ActionLedger = {
      claimIntent: async () => {
        throw new Error("ledger unavailable");
      },
      recordOutcome: async () => {},
      list: async () => [],
    };
    let dispatched = 0;
    await expect(
      runExternalAction({
        step: directStep,
        ledger: downLedger,
        engine,
        actionType: "outreach.send",
        idempotencyKey: "founder-1/send-2",
        dispatch: async () => {
          dispatched += 1;
          return "sent";
        },
      }),
    ).rejects.toThrow("ledger unavailable");
    expect(dispatched).toBe(0);
  });

  it("an ambiguous dispatch surfaces for reconciliation immediately and cannot double-fire or double-ask under retry", async () => {
    const { engine, ledger, asks } = harness();
    let dispatched = 0;
    const attempt = () =>
      runExternalAction({
        step: directStep,
        ledger,
        engine,
        actionType: "outreach.send",
        idempotencyKey: "founder-1/send-3",
        dispatch: async () => {
          dispatched += 1;
          throw new Error("provider timeout — may have sent");
        },
      });

    // Ambiguity is a value, not a thrown error: the workflow does not depend
    // on the engine's step-retry budget to eventually surface the ask.
    const first = await attempt();
    expect(first.outcome).toBe("needs-reconciliation");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      actionType: "outreach.send",
      idempotencyKey: "founder-1/send-3",
    });

    // The event is redelivered as a fresh run: no re-dispatch, no second ask
    // (the reconciliation event id dedupes).
    const redelivered = await attempt();
    expect(redelivered.outcome).toBe("needs-reconciliation");
    expect(dispatched).toBe(1);
    expect(asks).toHaveLength(1);
  });

  it("a crash-orphaned pending claim surfaces for reconciliation, never as a silent duplicate", async () => {
    const { engine, ledger, asks } = harness();
    // A previous process wrote the intent row, then died mid-dispatch: the
    // claim is stuck 'pending' and nobody knows if the world was contacted.
    await ledger.claimIntent("outreach.send", "founder-1/send-6");

    let dispatched = 0;
    const result = await runExternalAction({
      step: directStep,
      ledger,
      engine,
      actionType: "outreach.send",
      idempotencyKey: "founder-1/send-6",
      dispatch: async () => {
        dispatched += 1;
        return "sent";
      },
    });

    expect(dispatched).toBe(0);
    expect(result).toEqual({ outcome: "needs-reconciliation", priorStatus: "pending" });
    expect(asks).toHaveLength(1);
  });

  it("a definite dispatch failure releases the claim so a deliberate retry executes", async () => {
    const { engine, ledger } = harness();
    const { DefiniteDispatchFailureError } = await import("@tethr/core");
    let attempts = 0;
    const attempt = () =>
      runExternalAction({
        step: directStep,
        ledger,
        engine,
        actionType: "outreach.send",
        idempotencyKey: "founder-1/send-4",
        dispatch: async () => {
          attempts += 1;
          if (attempts === 1) throw new DefiniteDispatchFailureError("connection refused");
          return "sent";
        },
      });

    await expect(attempt()).rejects.toThrow("connection refused");
    const retry = await attempt();
    expect(retry.outcome).toBe("executed");
    expect(attempts).toBe(2);
  });

  it("a duplicate of an already-executed action reports duplicate without asking", async () => {
    const { engine, ledger, asks } = harness();
    const run = () =>
      runExternalAction({
        step: directStep,
        ledger,
        engine,
        actionType: "outreach.send",
        idempotencyKey: "founder-1/send-5",
        dispatch: async () => "sent",
      });

    await run();
    const dup = await run();
    expect(dup.outcome).toBe("duplicate");
    expect(asks).toHaveLength(0);
  });
});
