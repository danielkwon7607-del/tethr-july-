import { describe, expect, it } from "vitest";
import {
  type ActionLedger,
  DefiniteDispatchFailureError,
  InMemoryActionLedger,
  runIrreversible,
} from "./irreversible";

describe("runIrreversible (§18.5.7: the audit row precedes the dispatch)", () => {
  it("writes the intent row before dispatch, then records executed", async () => {
    const ledger = new InMemoryActionLedger();
    let statusDuringDispatch: string | undefined;
    const result = await runIrreversible({
      actionType: "outreach.send.stub",
      idempotencyKey: "founder-1/send-42",
      ledger,
      action: async () => {
        statusDuringDispatch = (await ledger.list())[0]?.status;
        return "sent";
      },
    });

    expect(statusDuringDispatch).toBe("pending");
    expect(result).toEqual({ outcome: "executed", value: "sent" });
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("executed");
    expect(records[0]?.idempotencyKey).toBe("founder-1/send-42");
  });

  it("rejects the action without dispatching when the intent row cannot be written", async () => {
    const failingLedger: ActionLedger = {
      claimIntent: async () => {
        throw new Error("ledger unavailable");
      },
      recordOutcome: async () => {},
      list: async () => [],
    };
    let sends = 0;
    await expect(
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-42",
        ledger: failingLedger,
        action: async () => {
          sends += 1;
        },
      }),
    ).rejects.toThrow("ledger unavailable");
    expect(sends).toBe(0);
  });

  it("rejects empty actionType or idempotencyKey without dispatching", async () => {
    const ledger = new InMemoryActionLedger();
    let sends = 0;
    const run = (actionType: string, idempotencyKey: string) =>
      runIrreversible({
        actionType,
        idempotencyKey,
        ledger,
        action: async () => {
          sends += 1;
        },
      });

    await expect(run("outreach.send.stub", "")).rejects.toThrow(/non-empty/);
    await expect(run("", "founder-1/send-42")).rejects.toThrow(/non-empty/);
    expect(sends).toBe(0);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("a retry with the same key cannot double-fire", async () => {
    const ledger = new InMemoryActionLedger();
    let sends = 0;
    const run = () =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-42",
        ledger,
        action: async () => {
          sends += 1;
          return "sent";
        },
      });

    await run();
    const retry = await run();

    expect(sends).toBe(1);
    expect(retry).toEqual({ outcome: "duplicate", priorStatus: "executed" });
  });

  it("the same key under a different actionType executes independently (namespaced claims)", async () => {
    const ledger = new InMemoryActionLedger();
    let sends = 0;
    const run = (actionType: string) =>
      runIrreversible({
        actionType,
        idempotencyKey: "shared-key",
        ledger,
        action: async () => {
          sends += 1;
        },
      });

    await run("outreach.send.stub");
    await run("voice.call.stub");
    expect(sends).toBe(2);
  });

  it("a definite dispatch failure releases the claim so a retry can execute", async () => {
    const ledger = new InMemoryActionLedger();
    let attempts = 0;
    const run = () =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-9",
        ledger,
        action: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new DefiniteDispatchFailureError("connection refused before send");
          }
          return "sent";
        },
      });

    await expect(run()).rejects.toThrow("connection refused");
    const retry = await run();

    expect(attempts).toBe(2);
    expect(retry.outcome).toBe("executed");
    const statuses = (await ledger.list()).map((record) => record.status);
    expect(statuses).toEqual(["failed", "executed"]);
  });

  it("an ambiguous failure keeps the claim: a retry cannot re-dispatch", async () => {
    const ledger = new InMemoryActionLedger();
    let attempts = 0;
    const run = () =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-13",
        ledger,
        action: async () => {
          attempts += 1;
          throw new Error("provider timeout — send may have happened");
        },
      });

    await expect(run()).rejects.toThrow("timeout");
    const retry = await run();

    expect(attempts).toBe(1);
    expect(retry).toEqual({ outcome: "duplicate", priorStatus: "ambiguous" });
    const records = await ledger.list();
    expect(records[0]?.status).toBe("ambiguous");
  });
});
