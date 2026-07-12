import { migrateUp, withFounderContext } from "@tethr/db";
import type { QueryEmbedder } from "@tethr/model-router";
import { InMemoryWorkflowEngine, type TierRunner } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PLAN_PUSHBACK_EVENT,
  RESEARCH_COMPLETED_EVENT,
  registerPlanningEntry,
  registerPlanPushback,
  registerPlanResequence,
} from "./entry";

// Build 8 Planning acceptance (Ch 12): research.completed → a sequenced,
// dependency-aware Plan whose Actions carry the five mandatory fields, sized
// against the founder's capacity; a malformed Action cannot persist; founder
// pushback re-sequences the Plan AND writes a deference observation to the
// Founder Model. Fakes stand in for the model/embedder (no keys in tests), the
// same posture as research.test.ts.
const adminUrl = process.env.TETHR_DATABASE_URL;

// A fixed two-action plan with a real dependency (landing depends on interview).
const fakeTierRunner = (): TierRunner => ({
  tier1: async () => ({ provider: "fake", model: "fake", text: "{}" }),
  tier2: async () => ({
    provider: "fake",
    model: "fake",
    text: JSON.stringify({
      actions: [
        {
          key: "interview",
          action: "Interview 5 target customers",
          founderRequirement: "Join the calls",
          definitionOfDone: "5 interview notes recorded",
          effortMinutes: 300,
          dependsOn: [],
        },
        {
          key: "landing",
          action: "Ship a landing page",
          founderRequirement: "Approve copy",
          definitionOfDone: "Page live with signup form",
          effortMinutes: 120,
          dependsOn: ["interview"],
        },
      ],
    }),
  }),
});

// Pinned to the corpus model; the scratch DB's rag_corpus is empty, so grounding
// returns [] — the real retrieval path runs, just over no chunks.
const fakeEmbedder = (): QueryEmbedder => ({
  model: "text-embedding-3-small",
  embedQuery: async () => new Array(1536).fill(0),
});

describe.skipIf(!adminUrl)("planning (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>) =>
    withFounderContext(sql, founderId, work);

  // Seed a founder that Research has already carried to a landed verdict.
  const seedToVerdict = async (): Promise<{ founderId: string; verdictId: string }> => {
    const [row] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Rae') returning id`;
    const founderId = (row as { id: string }).id;
    const verdictId = await runScoped(founderId, async (trx) => {
      await trx`
        insert into company_state (company_name, stage, state)
        values (null, 'planning', ${trx.json({ entryPath: "idea" })})`;
      const [v] = await trx<{ id: string }[]>`
        insert into verdicts (verdict, summary, evidence)
        values ('strong_signal', 'Real pull, room to enter', ${trx.json([])})
        returning id`;
      return (v as { id: string }).id;
    });
    return { founderId, verdictId };
  };

  const entryDeps = () => ({
    tierRunner: fakeTierRunner(),
    embedder: fakeEmbedder(),
    runScoped,
    engine: new InMemoryWorkflowEngine(),
  });

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_planning_test");
    await admin.unsafe("create database tethr_planning_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_planning_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_planning_test");
    await admin.end();
  });

  it("generates a sequenced, dependency-aware Plan on research.completed (§12.1)", async () => {
    const { founderId, verdictId } = await seedToVerdict();
    const engine = new InMemoryWorkflowEngine();
    let planId = "";
    registerPlanningEntry(engine, {
      tierRunner: fakeTierRunner(),
      embedder: fakeEmbedder(),
      runScoped,
      engine,
      onPlan: (id) => {
        planId = id;
      },
    });

    await engine.send({
      name: RESEARCH_COMPLETED_EVENT,
      id: `research/${founderId}/${verdictId}`,
      data: { founderId, verdictId, verdict: "strong_signal" },
    });

    expect(planId).not.toBe("");
    const actions = await runScoped(
      founderId,
      (trx) => trx<
        {
          action: string;
          sequence_index: number;
          depends_on_action_ids: string[];
          estimated_time: string;
        }[]
      >`select a.action, a.sequence_index, a.depends_on_action_ids, a.estimated_time::text as estimated_time
        from actions a join plans p on p.id = a.plan_id
        where p.id = ${planId} order by a.sequence_index`,
    );
    expect(actions).toHaveLength(2);
    expect(actions[0]?.sequence_index).toBe(0);
    expect(actions[1]?.sequence_index).toBe(1);
    // The dependency is wired: the second action depends on the first (not flat).
    expect(actions[1]?.depends_on_action_ids).toHaveLength(1);
    expect(actions.every((a) => a.estimated_time.length > 0)).toBe(true);
  });

  it("is idempotent: a redelivered verdict does not create a second Plan", async () => {
    const { founderId, verdictId } = await seedToVerdict();
    const engine = new InMemoryWorkflowEngine();
    registerPlanningEntry(engine, {
      tierRunner: fakeTierRunner(),
      embedder: fakeEmbedder(),
      runScoped,
      engine,
    });
    const send = () =>
      engine.send({
        name: RESEARCH_COMPLETED_EVENT,
        // Distinct event ids so the engine's dedup does not mask a real
        // second generation — the guard must be the plans-table check.
        id: `research/${founderId}/${verdictId}/${Math.random()}`,
        data: { founderId, verdictId, verdict: "strong_signal" },
      });
    await send();
    await send();
    const counts = await runScoped(
      founderId,
      (trx) =>
        trx<
          { count: string }[]
        >`select count(*)::text as count from plans where verdict_id = ${verdictId}`,
    );
    expect(counts[0]?.count).toBe("1");
  });

  it("rejects a malformed Action at the database (five NOT NULL fields, §12.2)", async () => {
    const { founderId, verdictId } = await seedToVerdict();
    await expect(
      runScoped(founderId, async (trx) => {
        const [plan] = await trx<{ id: string }[]>`
          insert into plans (verdict_id) values (${verdictId}) returning id`;
        // definition_of_done omitted → NOT NULL violation, cannot persist.
        await trx`
          insert into actions (plan_id, sequence_index, action, founder_requirement, estimated_time, status)
          values (${(plan as { id: string }).id}, 0, 'do a thing', 'nothing', make_interval(mins => 30), 'pending')`;
      }),
    ).rejects.toThrow();
  });

  it("founder pushback re-sequences the Plan and writes a deference observation (§12.2, §6.3)", async () => {
    const { founderId, verdictId } = await seedToVerdict();
    const engine = new InMemoryWorkflowEngine();
    const deps = {
      tierRunner: fakeTierRunner(),
      embedder: fakeEmbedder(),
      runScoped,
      engine,
    };
    let planId = "";
    registerPlanningEntry(engine, {
      ...deps,
      onPlan: (id) => {
        planId = id;
      },
    });
    registerPlanPushback(engine, deps);
    registerPlanResequence(engine, deps);

    await engine.send({
      name: RESEARCH_COMPLETED_EVENT,
      id: `research/${founderId}/${verdictId}`,
      data: { founderId, verdictId, verdict: "strong_signal" },
    });

    // Push back on the first action (the one the second depends on).
    const targets = await runScoped(
      founderId,
      (trx) => trx<{ id: string }[]>`
        select id from actions where plan_id = ${planId} and sequence_index = 0`,
    );
    const actionId = targets[0]?.id;
    if (!actionId) throw new Error("expected a first action to push back on");

    await engine.send({
      name: PLAN_PUSHBACK_EVENT,
      id: `pushback/${actionId}`,
      data: { founderId, planId, actionId },
    });

    // (a) a deference observation landed on the Founder Model write path.
    const obs = await runScoped(
      founderId,
      (trx) => trx<{ source: string }[]>`
        select source from trait_observations where dimension = 'deference'`,
    );
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0]?.source).toBe("revealed");

    // (b) the Plan re-sequenced: the pushed action is dropped, its dependent no
    // longer depends on it, and the remaining plan is still valid.
    const actions = await runScoped(
      founderId,
      (trx) => trx<{ status: string; depends_on_action_ids: string[] }[]>`
        select status, depends_on_action_ids from actions where plan_id = ${planId}`,
    );
    const dropped = actions.filter((a) => a.status === "dropped");
    expect(dropped).toHaveLength(1);
    // No surviving action still depends on the dropped one.
    const survivors = actions.filter((a) => a.status !== "dropped");
    expect(survivors.every((a) => a.depends_on_action_ids.length === 0)).toBe(true);
  });
});

if (!adminUrl) {
  it("planning suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
