import { InMemoryActionLedger } from "@tethr/core";
import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowEngine, WorkflowEvent, WorkflowStep } from "./engine";
import { runExternalAction } from "./external-action";

// Build 2 acceptance: a workflow survives a process restart, and an
// irreversible action cannot double-fire across that restart. Durability
// itself is Inngest's guarantee; what WE must prove is that our workflows are
// written against the memoization contract — completed steps are skipped on
// replay, so side effects run exactly once even when the process dies
// mid-workflow. This harness implements that contract: a step-result store
// that outlives the "process" (engine instance), exactly as Inngest's does.

class CrashError extends Error {}

/** Test double honoring the durable contract: memoized steps, replay on retry. */
class DurableTestEngine implements WorkflowEngine {
  private readonly definitions: WorkflowDefinition[] = [];
  readonly sideEffects: string[] = [];

  constructor(
    /** Survives "restarts": pass the same store to a new engine instance. */
    private readonly stepStore: Map<string, unknown>,
    /** Simulated crash point: step name that kills the process on first run. */
    private crashOn?: string,
  ) {}

  register(definition: WorkflowDefinition): void {
    this.definitions.push(definition);
  }

  async send(event: WorkflowEvent): Promise<void> {
    for (const definition of this.definitions) {
      if ("event" in definition.trigger && definition.trigger.event === event.name) {
        await definition.handler(event, this.stepFor(definition.id));
      }
    }
  }

  private stepFor(workflowId: string): WorkflowStep {
    return {
      run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const key = `${workflowId}:${name}`;
        if (this.stepStore.has(key)) return this.stepStore.get(key) as T; // memoized replay
        const value = await fn();
        this.stepStore.set(key, value);
        if (this.crashOn === name) {
          this.crashOn = undefined;
          throw new CrashError(`process died after step ${name}`);
        }
        return value;
      },
      sleepUntil: async () => {},
    };
  }
}

describe("durable execution contract (Build 2 acceptance)", () => {
  it("a workflow killed mid-run resumes after restart with completed steps memoized, side effects once", async () => {
    const stepStore = new Map<string, unknown>();
    const effects: string[] = [];

    const scanWorkflow: WorkflowDefinition = {
      id: "scan.momentum",
      trigger: { event: "scan.tick" },
      handler: async (_event, step) => {
        await step.run("detect-stalls", async () => {
          effects.push("detect");
          return ["a-1"];
        });
        await step.run("emit-intervention", async () => {
          effects.push("emit");
          return "emitted";
        });
        await step.run("record-scan", async () => {
          effects.push("record");
          return "done";
        });
      },
    };

    // Process 1: dies after the second step.
    const process1 = new DurableTestEngine(stepStore, "emit-intervention");
    process1.register(scanWorkflow);
    await expect(process1.send({ name: "scan.tick", data: {} })).rejects.toThrow(CrashError);
    expect(effects).toEqual(["detect", "emit"]);

    // Process 2 (the restart): same durable store, fresh process. The retry
    // replays the workflow; completed steps are skipped; the tail completes.
    const process2 = new DurableTestEngine(stepStore);
    process2.register(scanWorkflow);
    await process2.send({ name: "scan.tick", data: {} });

    expect(effects).toEqual(["detect", "emit", "record"]);
  });

  it("an irreversible action cannot double-fire across a crash-and-restart retry", async () => {
    const stepStore = new Map<string, unknown>();
    const ledger = new InMemoryActionLedger();
    let dispatched = 0;

    const outreach: WorkflowDefinition = {
      id: "outreach.deliver",
      trigger: { event: "outreach.approved" },
      handler: async (event, step) => {
        await runExternalAction({
          step,
          ledger,
          engine: process2, // reconciliation events (none expected here)
          actionType: "outreach.send",
          idempotencyKey: String(event.data.sendId),
          dispatch: async () => {
            dispatched += 1;
            return "sent";
          },
        });
        await step.run("after-send", async () => "noted");
      },
    };

    // Process 1 dispatches successfully, then dies before the workflow ends.
    const process1 = new DurableTestEngine(stepStore, "external:outreach.send:send-77");
    const process2 = new DurableTestEngine(stepStore);
    process1.register(outreach);
    process2.register(outreach);

    await expect(
      process1.send({ name: "outreach.approved", data: { sendId: "send-77" } }),
    ).rejects.toThrow(CrashError);
    expect(dispatched).toBe(1);

    // Restart: the durable engine retries the run; the external step is
    // memoized, so the world is not contacted again.
    await process2.send({ name: "outreach.approved", data: { sendId: "send-77" } });
    expect(dispatched).toBe(1);
    expect((await ledger.list()).map((r) => r.status)).toEqual(["executed"]);
  });

  it("even without step memoization (event redelivered, no run state), the ledger stops the double-fire", async () => {
    // Belt and braces: Inngest memoization is layer 1; the §18.5.7 claim is
    // layer 2. If an event is redelivered as a brand-new run, the claim holds.
    const ledger = new InMemoryActionLedger();
    let dispatched = 0;
    const run = (store: Map<string, unknown>) => {
      const engine = new DurableTestEngine(store);
      engine.register({
        id: "outreach.deliver",
        trigger: { event: "outreach.approved" },
        handler: async (event, step) => {
          await runExternalAction({
            step,
            ledger,
            engine,
            actionType: "outreach.send",
            idempotencyKey: String(event.data.sendId),
            dispatch: async () => {
              dispatched += 1;
              return "sent";
            },
          });
        },
      });
      return engine.send({ name: "outreach.approved", data: { sendId: "send-88" } });
    };

    await run(new Map()); // fresh run state
    await run(new Map()); // redelivered event, fresh run state again
    expect(dispatched).toBe(1);
  });
});
