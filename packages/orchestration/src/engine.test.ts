import { describe, expect, it } from "vitest";
import { InMemoryWorkflowEngine } from "./engine";

describe("InMemoryWorkflowEngine", () => {
  it("fires the handler whose event trigger matches a sent event", async () => {
    const engine = new InMemoryWorkflowEngine();
    const seen: unknown[] = [];
    engine.register({
      id: "research.start",
      trigger: { event: "onboarding.completed" },
      handler: async (event) => {
        seen.push(event.data);
      },
    });
    engine.register({
      id: "unrelated",
      trigger: { event: "other.event" },
      handler: async () => {
        seen.push("should not fire");
      },
    });

    await engine.send({ name: "onboarding.completed", data: { founderId: "f-1" } });

    expect(seen).toEqual([{ founderId: "f-1" }]);
  });

  it("runs named steps and returns their values", async () => {
    const engine = new InMemoryWorkflowEngine();
    let result: string | undefined;
    engine.register({
      id: "wf",
      trigger: { event: "go" },
      handler: async (_event, step) => {
        result = await step.run("fetch-verdict", async () => "strong");
        await step.sleepUntil("wait-a-day", new Date(Date.now() + 1000));
      },
    });

    await engine.send({ name: "go", data: {} });

    expect(result).toBe("strong");
    expect(engine.stepLog).toEqual(["wf:fetch-verdict", "wf:wait-a-day"]);
  });
});
