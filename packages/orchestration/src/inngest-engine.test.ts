import { Inngest } from "inngest";
import { describe, expect, it } from "vitest";
import { type InngestClientLike, InngestWorkflowEngine } from "./inngest-engine";

type CreateFunctionCall = {
  options: { id: string; triggers: readonly unknown[] };
  handler: (input: {
    event: { name: string; data: Record<string, unknown> };
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
      sleepUntil: (name: string, until: Date) => Promise<void>;
    };
  }) => Promise<unknown>;
};

function stubClient() {
  const created: CreateFunctionCall[] = [];
  const sent: unknown[] = [];
  const client: InngestClientLike = {
    createFunction: (options, handler) => {
      created.push({ options, handler } as CreateFunctionCall);
      return { options };
    },
    send: async (payload) => {
      sent.push(payload);
    },
  };
  return { client, created, sent };
}

describe("InngestWorkflowEngine", () => {
  it("maps an event trigger to an Inngest event-triggered function", () => {
    const { client, created } = stubClient();
    const engine = new InngestWorkflowEngine(client);

    engine.register({
      id: "research.start",
      trigger: { event: "onboarding.completed" },
      handler: async () => undefined,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.options.id).toBe("research.start");
    expect(created[0]?.options.triggers).toEqual([{ event: "onboarding.completed" }]);
  });

  it("maps a cron trigger to an Inngest scheduled function", () => {
    const { client, created } = stubClient();
    const engine = new InngestWorkflowEngine(client);

    engine.register({
      id: "scan.momentum",
      trigger: { cron: "0 * * * *" },
      handler: async () => undefined,
    });

    expect(created[0]?.options.triggers).toEqual([{ cron: "0 * * * *" }]);
  });

  it("translates the Inngest context into the workflow event and step contract", async () => {
    const { client, created } = stubClient();
    const engine = new InngestWorkflowEngine(client);
    const observed: unknown[] = [];

    engine.register({
      id: "wf",
      trigger: { event: "go" },
      handler: async (event, step) => {
        observed.push(event);
        observed.push(await step.run("compute", async () => 42));
      },
    });

    const stepRuns: string[] = [];
    await created[0]?.handler({
      event: { name: "go", data: { founderId: "f-1" } },
      step: {
        run: async (name, fn) => {
          stepRuns.push(name);
          return fn();
        },
        sleepUntil: async () => undefined,
      },
    });

    expect(observed).toEqual([{ name: "go", data: { founderId: "f-1" } }, 42]);
    expect(stepRuns).toEqual(["compute"]);
  });

  it("forwards send to the Inngest client", async () => {
    const { client, sent } = stubClient();
    const engine = new InngestWorkflowEngine(client);

    await engine.send({ name: "onboarding.completed", data: { founderId: "f-1" } });

    expect(sent).toEqual([{ name: "onboarding.completed", data: { founderId: "f-1" } }]);
  });

  it("forwards the event dedup id so a retried send cannot re-trigger workflows", async () => {
    const { client, sent } = stubClient();
    const engine = new InngestWorkflowEngine(client);

    await engine.send({
      name: "message.received",
      data: { founderId: "f-1" },
      id: "webhook/msg-42",
    });

    expect(sent).toEqual([
      { name: "message.received", data: { founderId: "f-1" }, id: "webhook/msg-42" },
    ]);
  });

  it("accepts a real Inngest client and exposes registered functions for serving", () => {
    const engine = new InngestWorkflowEngine(new Inngest({ id: "tethr-test" }));
    engine.register({
      id: "wf",
      trigger: { event: "go" },
      handler: async () => undefined,
    });
    expect(engine.functions).toHaveLength(1);
  });
});
