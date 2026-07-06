import { describe, expect, it } from "vitest";
import { InMemoryAuditLog, InMemoryIdempotencyStore, runIrreversible } from "./irreversible";

function makeSubstrate() {
  return {
    store: new InMemoryIdempotencyStore(),
    audit: new InMemoryAuditLog(),
  };
}

describe("runIrreversible", () => {
  it("executes the action once and audits it as executed", async () => {
    const { store, audit } = makeSubstrate();
    let sends = 0;
    const result = await runIrreversible({
      actionType: "outreach.send.stub",
      idempotencyKey: "founder-1/send-42",
      store,
      audit,
      action: async () => {
        sends += 1;
        return "sent";
      },
    });

    expect(result).toEqual({ outcome: "executed", value: "sent" });
    expect(sends).toBe(1);
    const entries = await audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("executed");
    expect(entries[0]?.idempotencyKey).toBe("founder-1/send-42");
  });

  it("a retry with the same key cannot double-fire, and the duplicate is audited", async () => {
    const { store, audit } = makeSubstrate();
    let sends = 0;
    const run = () =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-42",
        store,
        audit,
        action: async () => {
          sends += 1;
          return "sent";
        },
      });

    await run();
    const retry = await run();

    expect(sends).toBe(1);
    expect(retry.outcome).toBe("duplicate");
    const entries = await audit.list();
    expect(entries.map((entry) => entry.status)).toEqual(["executed", "duplicate"]);
  });

  it("different keys execute independently", async () => {
    const { store, audit } = makeSubstrate();
    let sends = 0;
    const send = (key: string) =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: key,
        store,
        audit,
        action: async () => {
          sends += 1;
        },
      });

    await send("founder-1/send-1");
    await send("founder-1/send-2");
    expect(sends).toBe(2);
  });

  it("a failed action releases its key so a retry can execute, and the failure is audited", async () => {
    const { store, audit } = makeSubstrate();
    let attempts = 0;
    const run = () =>
      runIrreversible({
        actionType: "outreach.send.stub",
        idempotencyKey: "founder-1/send-9",
        store,
        audit,
        action: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("provider outage");
          return "sent";
        },
      });

    await expect(run()).rejects.toThrow("provider outage");
    const retry = await run();

    expect(attempts).toBe(2);
    expect(retry.outcome).toBe("executed");
    const entries = await audit.list();
    expect(entries.map((entry) => entry.status)).toEqual(["failed", "executed"]);
  });
});
