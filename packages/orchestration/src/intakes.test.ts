import { describe, expect, it } from "vitest";
import { InMemoryWorkflowEngine } from "./engine";
import { sendInbound, sendInternal } from "./intakes";
import { registerScheduledScan } from "./scan";

// The three trigger intakes of §8.2/§18.3: inbound events (webhooks — dedup id
// mandatory), scheduled scans (cron), internal events (stage transitions).

describe("trigger intakes", () => {
  it("inbound events require a dedup id — a webhook retry must not re-trigger work (§18.5.7)", async () => {
    const engine = new InMemoryWorkflowEngine();
    const seen: unknown[] = [];
    engine.register({
      id: "inbound.handler",
      trigger: { event: "message.received" },
      handler: async (event) => {
        seen.push(event.id);
      },
    });

    await sendInbound(engine, {
      name: "message.received",
      data: { founderId: "f-1" },
      id: "webhook/msg-1",
    });
    expect(seen).toEqual(["webhook/msg-1"]);

    await expect(
      // @ts-expect-error — the id is mandatory for inbound events
      sendInbound(engine, { name: "message.received", data: {} }),
    ).rejects.toThrow(/dedup id/);
  });

  it("internal events flow through send", async () => {
    const engine = new InMemoryWorkflowEngine();
    const seen: string[] = [];
    engine.register({
      id: "planning.start",
      trigger: { event: "verdict.landed" },
      handler: async (event) => {
        seen.push(event.name);
      },
    });
    await sendInternal(engine, { name: "verdict.landed", data: { verdictId: "v-1" } });
    expect(seen).toEqual(["verdict.landed"]);
  });

  it("a scheduled scan sweeps in a durable step and emits one internal event per detected trigger", async () => {
    const engine = new InMemoryWorkflowEngine();
    const fired: Record<string, unknown>[] = [];
    engine.register({
      id: "intervention.consider",
      trigger: { event: "momentum.stall-detected" },
      handler: async (event) => {
        fired.push(event.data);
      },
    });

    registerScheduledScan(engine, {
      id: "scan.momentum",
      cron: "0 * * * *",
      sweep: async () => [
        {
          name: "momentum.stall-detected",
          data: { founderId: "f-1", actionId: "a-1" },
          id: "stall:a-1:2026-07-07",
        },
      ],
    });

    await engine.fireCron("scan.momentum");
    expect(fired).toEqual([{ founderId: "f-1", actionId: "a-1" }]);
    // The sweep and each emission ran as durable steps.
    expect(engine.stepLog).toContain("scan.momentum:sweep");
  });

  it("firing an unregistered cron workflow is an error, not a silent no-op", async () => {
    const engine = new InMemoryWorkflowEngine();
    await expect(engine.fireCron("scan.typo")).rejects.toThrow(/no cron workflow/);
  });
});
