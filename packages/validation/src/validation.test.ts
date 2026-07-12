import { migrateUp, withFounderContext } from "@tethr/db";
import type { QueryEmbedder } from "@tethr/model-router";
import { InMemoryWorkflowEngine, type TierRunner } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerValidationEntry, registerValidationResult } from "./entry";
import {
  PLAN_ADVANCE_EVENT,
  PLAN_CREATED_EVENT,
  PLAN_REPLAN_EVENT,
  VALIDATION_PIVOT_EVENT,
  VALIDATION_RESULT_EVENT,
} from "./events";
import type { ExperimentDesignResult } from "./pipeline";

// Build 8 Validation acceptance (Ch 13): a plan forming designs an Experiment
// against the SINGLE highest-risk assumption; its criteria are set in advance
// and frozen once a result lands (immutability trigger, migration 0013); and a
// landed result routes back into the loop — pass advances, fail re-plans, pivot
// re-enters Research (the loop never dead-ends). Fakes stand in for the model.
const adminUrl = process.env.TETHR_DATABASE_URL;

// Route Tier-2 by system prompt: candidate assumptions vs experiment design.
const fakeTierRunner = (): TierRunner => ({
  tier1: async () => ({ provider: "fake", model: "fake", text: "{}" }),
  tier2: async (req) => ({
    provider: "fake",
    model: "fake",
    text: (req.system ?? "").startsWith("You surface the assumptions")
      ? JSON.stringify({
          assumptions: [
            {
              assumption: "cheap to build",
              impact: 0.2,
              failureLikelihood: 0.3,
              evidenceRef: "build action",
            },
            // The riskiest: highest impact × failure_likelihood → must be selected.
            {
              assumption: "customers will pay",
              impact: 0.9,
              failureLikelihood: 0.8,
              evidenceRef: "pricing",
            },
          ],
        })
      : JSON.stringify({
          hypothesis: "Target customers will pre-pay for this",
          successCriteria: "≥ 30% of contacted prospects commit to pay",
          failureCriteria: "< 10% of contacted prospects show interest",
          durationDays: 7,
          sampleSize: 20,
        }),
  }),
});

const fakeEmbedder = (): QueryEmbedder => ({
  model: "text-embedding-3-small",
  embedQuery: async () => new Array(1536).fill(0),
});

describe.skipIf(!adminUrl)("validation (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>) =>
    withFounderContext(sql, founderId, work);

  const seedPlan = async (): Promise<{ founderId: string; planId: string }> => {
    const [row] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Rae') returning id`;
    const founderId = (row as { id: string }).id;
    const planId = await runScoped(founderId, async (trx) => {
      await trx`
        insert into company_state (company_name, stage, state)
        values (null, 'planning', ${trx.json({ ideaHypothesis: "AI standups for remote teams" })})`;
      const [v] = await trx<{ id: string }[]>`
        insert into verdicts (verdict, summary, evidence)
        values ('strong_signal', 'Real pull', ${trx.json([])}) returning id`;
      const [p] = await trx<{ id: string }[]>`
        insert into plans (verdict_id) values (${(v as { id: string }).id}) returning id`;
      const planId = (p as { id: string }).id;
      await trx`
        insert into actions (plan_id, sequence_index, action, founder_requirement,
          definition_of_done, estimated_time, status)
        values (${planId}, 0, 'Test pricing with 5 prospects', 'Join calls',
          '5 prospects asked to pay', make_interval(mins => 120), 'pending')`;
      return planId;
    });
    return { founderId, planId };
  };

  const deps = () => ({
    tierRunner: fakeTierRunner(),
    embedder: fakeEmbedder(),
    runScoped,
    engine: new InMemoryWorkflowEngine(),
  });

  // Design an experiment and return its id + the founder/plan context.
  const design = async () => {
    const { founderId, planId } = await seedPlan();
    const engine = new InMemoryWorkflowEngine();
    let result: ExperimentDesignResult | null = null;
    registerValidationEntry(engine, {
      tierRunner: fakeTierRunner(),
      embedder: fakeEmbedder(),
      runScoped,
      engine,
      onExperiment: (r) => {
        result = r;
      },
    });
    await engine.send({
      name: PLAN_CREATED_EVENT,
      id: `plan-created/${planId}`,
      data: { founderId, planId },
    });
    return { founderId, planId, result: result as ExperimentDesignResult | null };
  };

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_validation_test");
    await admin.unsafe("create database tethr_validation_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_validation_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_validation_test");
    await admin.end();
  });

  it("designs an Experiment against the single highest-risk assumption (§13.1)", async () => {
    const { founderId, result } = await design();
    expect(result?.assumption).toBe("customers will pay"); // 0.9×0.8 beats 0.2×0.3
    const rows = await runScoped(
      founderId,
      (trx) =>
        trx<
          {
            hypothesis: string;
            success_criteria: string;
            failure_criteria: string;
            sample_size: number;
            status: string;
          }[]
        >`select hypothesis, success_criteria, failure_criteria, sample_size, status from experiments`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("designed");
    // Criteria set in advance and distinct (§13.2, B3 guard).
    expect(rows[0]?.success_criteria).not.toBe(rows[0]?.failure_criteria);
    expect(rows[0]?.sample_size).toBeGreaterThan(0);
  });

  it("freezes criteria once the experiment leaves design (immutability, migration 0013)", async () => {
    const { founderId } = await design();
    const rows = await runScoped(
      founderId,
      (trx) => trx<{ id: string }[]>`select id from experiments`,
    );
    const experimentId = rows[0]?.id;
    if (!experimentId) throw new Error("expected an experiment");

    // A status transition without a criteria change is allowed.
    await expect(
      runScoped(
        founderId,
        (trx) => trx`update experiments set status = 'running' where id = ${experimentId}`,
      ),
    ).resolves.toBeDefined();

    // Editing a criterion after it has left design is rejected by the trigger.
    await expect(
      runScoped(
        founderId,
        (trx) =>
          trx`update experiments set success_criteria = 'moved goalposts' where id = ${experimentId}`,
      ),
    ).rejects.toThrow();
  });

  it("routes a pass result to plan advancement (§13.3)", async () => {
    const { founderId, result } = await design();
    const engine = new InMemoryWorkflowEngine();
    const advanced: string[] = [];
    engine.register({
      id: "test.advance",
      trigger: { event: PLAN_ADVANCE_EVENT },
      handler: async (e) => advanced.push(e.data.experimentId as string),
    });
    registerValidationResult(engine, { ...deps(), engine, runScoped });
    await engine.send({
      name: VALIDATION_RESULT_EVENT,
      id: `result/${result?.experimentId}/pass`,
      data: { founderId, experimentId: result?.experimentId as string, outcome: "pass" },
    });
    expect(advanced).toEqual([result?.experimentId]);
    const rows = await runScoped(
      founderId,
      (trx) =>
        trx<
          { status: string }[]
        >`select status from experiments where id = ${result?.experimentId as string}`,
    );
    expect(rows[0]?.status).toBe("passed");
  });

  it("routes a pivot result back into Research so the loop never dead-ends (§13.3, Ch 11)", async () => {
    const { founderId, result } = await design();
    const engine = new InMemoryWorkflowEngine();
    const pivots: string[] = [];
    engine.register({
      id: "test.pivot",
      trigger: { event: VALIDATION_PIVOT_EVENT },
      handler: async (e) => pivots.push(e.data.experimentId as string),
    });
    registerValidationResult(engine, { ...deps(), engine, runScoped });
    await engine.send({
      name: VALIDATION_RESULT_EVENT,
      id: `result/${result?.experimentId}/pivot`,
      data: { founderId, experimentId: result?.experimentId as string, outcome: "pivot" },
    });
    expect(pivots).toEqual([result?.experimentId]);
    const rows = await runScoped(
      founderId,
      (trx) =>
        trx<
          { status: string }[]
        >`select status from experiments where id = ${result?.experimentId as string}`,
    );
    expect(rows[0]?.status).toBe("aborted");
  });

  it("routes a fail result to re-planning (§13.3)", async () => {
    const { founderId, result } = await design();
    const engine = new InMemoryWorkflowEngine();
    const replans: string[] = [];
    engine.register({
      id: "test.replan",
      trigger: { event: PLAN_REPLAN_EVENT },
      handler: async (e) => replans.push(e.data.experimentId as string),
    });
    registerValidationResult(engine, { ...deps(), engine, runScoped });
    await engine.send({
      name: VALIDATION_RESULT_EVENT,
      id: `result/${result?.experimentId}/fail`,
      data: { founderId, experimentId: result?.experimentId as string, outcome: "fail" },
    });
    expect(replans).toEqual([result?.experimentId]);
  });

  it("is idempotent under replay: the same result redelivered is a no-op, not an error", async () => {
    const { founderId, result } = await design();
    const experimentId = result?.experimentId as string;
    const engine = new InMemoryWorkflowEngine();
    registerValidationResult(engine, { ...deps(), engine, runScoped });
    const send = (nonce: string) =>
      engine.send({
        name: VALIDATION_RESULT_EVENT,
        // Distinct event ids so the engine's dedup does not mask the step-level
        // replay — the idempotency must come from record-result itself.
        id: `result/${experimentId}/pass/${nonce}`,
        data: { founderId, experimentId, outcome: "pass" },
      });
    await send("a");
    // A durable retry re-runs the step; it must not throw on the already-passed row.
    await expect(send("b")).resolves.toBeUndefined();
    const rows = await runScoped(
      founderId,
      (trx) => trx<{ status: string }[]>`select status from experiments where id = ${experimentId}`,
    );
    expect(rows[0]?.status).toBe("passed");
  });

  it("rejects a conflicting result after the experiment is already resolved", async () => {
    const { founderId, result } = await design();
    const experimentId = result?.experimentId as string;
    const engine = new InMemoryWorkflowEngine();
    registerValidationResult(engine, { ...deps(), engine, runScoped });
    await engine.send({
      name: VALIDATION_RESULT_EVENT,
      id: `result/${experimentId}/pass`,
      data: { founderId, experimentId, outcome: "pass" },
    });
    // A different outcome on an already-resolved experiment is a real conflict.
    await expect(
      engine.send({
        name: VALIDATION_RESULT_EVENT,
        id: `result/${experimentId}/fail`,
        data: { founderId, experimentId, outcome: "fail" },
      }),
    ).rejects.toThrow(/already resolved/);
  });
});

if (!adminUrl) {
  it("validation suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
