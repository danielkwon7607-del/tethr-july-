import { migrateUp, withFounderContext } from "@tethr/db";
import { InMemoryWorkflowEngine, type TierRunner } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCostGuard } from "./budget";
import {
  ONBOARDING_COMPLETED_EVENT,
  registerResearchEntry,
  registerResearchPivotEntry,
  VALIDATION_PIVOT_EVENT,
} from "./entry";
import { RESEARCH_COMPLETED_EVENT, RESEARCH_PAUSED_EVENT, type ResearchResult } from "./pipeline";
import { QuotaExceededError, withCache } from "./quota";
import {
  createFakeSource,
  type ResearchSource,
  SOURCE_SPECS,
  type SourceEvidence,
} from "./sources";

// Build 7 acceptance (Ch 11): the auto-triggered pipeline turns typed, weighted
// signals into an evidence-linked verdict; back-pressure (budget/burnout) stops
// and asks rather than overrunning (Rec #5); a source quota error fails fast
// without killing research (Rec #6); the cache saves a repeat fetch (Rec #6).
// Fakes stand in for live sources (no keys in tests), same posture as messaging.
const adminUrl = process.env.TETHR_DATABASE_URL;

function specFor(source: string) {
  const spec = SOURCE_SPECS[source];
  if (!spec) throw new Error(`unknown source ${source}`);
  return spec;
}

const evidence = (source: string, strength: number): SourceEvidence => ({
  source,
  signalType: specFor(source).signalType,
  title: `${source} says`,
  url: `https://example.com/${source}`,
  strength,
});

// Route Tier-2 by system prompt: the stress-test vs the synthesis narrative.
const fakeTierRunner = (): TierRunner => ({
  tier1: async () => ({ provider: "fake", model: "fake", text: "{}" }),
  tier2: async (req) => ({
    provider: "fake",
    model: "fake",
    text: req.system?.startsWith("Pressure-test")
      ? '{"assumptions":["founders want this"]}'
      : '{"summary":"real pull, room to enter","complaintThemes":["too slow today"],"pivotSuggestions":[]}',
  }),
});

describe.skipIf(!adminUrl)("research pipeline (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  const runScoped = <T>(founderId: string, work: (trx: Sql) => Promise<T>) =>
    withFounderContext(sql, founderId, work);

  const seedFounder = async (idea: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Rae') returning id`;
    const founderId = (row as { id: string }).id;
    await runScoped(
      founderId,
      (trx) => trx`
      insert into company_state (company_name, stage, state)
      values (null, 'onboarding', ${trx.json({ entryPath: "idea", ideaHypothesis: idea })})`,
    );
    return founderId;
  };

  // Strong-demand, low-competition evidence → a strong_signal verdict.
  const strongSources = (onFetch?: (id: string) => void): ResearchSource[] => [
    createFakeSource("xai", [evidence("xai", 0.9)], { onFetch: () => onFetch?.("xai") }),
    createFakeSource("hackernews", [evidence("hackernews", 0.8)], {
      onFetch: () => onFetch?.("hackernews"),
    }),
    createFakeSource("serper", [evidence("serper", 0.3)], { onFetch: () => onFetch?.("serper") }),
    createFakeSource("serper_funding", [evidence("serper_funding", 0.2)], {
      onFetch: () => onFetch?.("serper_funding"),
    }),
  ];

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_research_test");
    await admin.unsafe("create database tethr_research_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_research_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_research_test");
    await admin.end();
  });

  it("auto-triggers on onboarding.completed and writes an evidence-linked verdict (§3.4, §11.4)", async () => {
    const founderId = await seedFounder("AI standups for remote teams");
    const engine = new InMemoryWorkflowEngine();
    const completed: string[] = [];
    engine.register({
      id: "test.completed",
      trigger: { event: RESEARCH_COMPLETED_EVENT },
      handler: async (event) => completed.push(event.data.verdict as string),
    });
    const results: ResearchResult[] = [];
    registerResearchEntry(engine, {
      sources: strongSources(),
      tierRunner: fakeTierRunner(),
      runScoped,
      engine,
      onComplete: (result) => {
        results.push(result);
      },
    });

    // The founder never asked — onboarding's event drives the whole pipeline.
    await engine.send({
      name: ONBOARDING_COMPLETED_EVENT,
      id: `onboarding/${founderId}`,
      data: { founderId },
    });

    expect(results[0]?.outcome).toBe("verdict");
    const verdicts = await runScoped(
      founderId,
      (trx) =>
        trx<
          { verdict: string; summary: string; evidence: { url: string }[] }[]
        >`select verdict, summary, evidence from verdicts`,
    );
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe("strong_signal");
    // Evidence-linked (§11.4): every source's url is carried on the verdict.
    const urls = (verdicts[0]?.evidence ?? []).map((e) => e.url);
    expect(urls).toContain("https://example.com/xai");
    expect(urls.length).toBe(4);
    // Company State advanced (a verdict prompts Planning, §8.2) + event fired.
    const [state] = await runScoped(
      founderId,
      (trx) => trx<{ stage: string }[]>`select stage from company_state`,
    );
    expect(state?.stage).toBe("planning");
    expect(completed).toEqual(["strong_signal"]);
    // Spend recorded in the ledger (Rec #5): every costed call is audited — the
    // 2 Tier-2 models + all 4 source fetches (HN records a 0-cost row too, so
    // the audit is complete; only its cost is 0, so the budget SUM is unchanged).
    const [spend] = await runScoped(
      founderId,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from research_spend`,
    );
    expect(spend?.n).toBe(6);
    const [cost] = await runScoped(
      founderId,
      (trx) =>
        trx<
          { total: string }[]
        >`select coalesce(sum(cost_micros),0)::bigint as total from research_spend`,
    );
    expect(Number(cost?.total)).toBe(15_000); // 4000+4000 models + 5000+1000+1000 sources (hn 0)
  });

  it("stops and asks the founder when the budget is exhausted — no verdict (Rec #5, §8.5)", async () => {
    const founderId = await seedFounder("crowded idea");
    const engine = new InMemoryWorkflowEngine();
    const paused: { reason: string }[] = [];
    engine.register({
      id: "test.paused",
      trigger: { event: RESEARCH_PAUSED_EVENT },
      handler: async (event) => paused.push({ reason: event.data.reason as string }),
    });
    const results: ResearchResult[] = [];
    registerResearchEntry(engine, {
      sources: strongSources(),
      tierRunner: fakeTierRunner(),
      runScoped,
      engine,
      budgetMicros: 100, // less than one Tier-2 call — the first charge trips it
      onComplete: (result) => {
        results.push(result);
      },
    });

    await engine.send({
      name: ONBOARDING_COMPLETED_EVENT,
      id: `onboarding/${founderId}`,
      data: { founderId },
    });

    expect(results[0]).toEqual({ outcome: "paused", reason: "budget" });
    expect(paused).toEqual([{ reason: "budget" }]);
    // Graceful stop, not silent degrade: NO verdict was written.
    const [v] = await runScoped(
      founderId,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from verdicts`,
    );
    expect(v?.n).toBe(0);
  });

  it("the burnout veto stops the pipeline the same way (Rec #5 tie-in, §6.14)", async () => {
    const founderId = await seedFounder("fine idea");
    const engine = new InMemoryWorkflowEngine();
    const results: ResearchResult[] = [];
    registerResearchEntry(engine, {
      sources: strongSources(),
      tierRunner: fakeTierRunner(),
      runScoped,
      engine,
      burnoutPaused: async () => true, // an overloaded founder throttles the loop
      onComplete: (result) => {
        results.push(result);
      },
    });
    await engine.send({
      name: ONBOARDING_COMPLETED_EVENT,
      id: `onboarding/${founderId}`,
      data: { founderId },
    });
    expect(results[0]).toEqual({ outcome: "paused", reason: "burnout" });
  });

  it("fails fast on a source quota error and still produces a verdict from the rest (Rec #6)", async () => {
    const founderId = await seedFounder("resilient idea");
    const engine = new InMemoryWorkflowEngine();
    const fetches: string[] = [];
    // xai hits its quota; the pipeline skips it and synthesizes over the rest.
    const quotaSource: ResearchSource = {
      id: "xai",
      signalType: "live_sentiment",
      fetch: async () => {
        fetches.push("xai");
        throw new QuotaExceededError("xai");
      },
    };
    const results: ResearchResult[] = [];
    registerResearchEntry(engine, {
      sources: [
        quotaSource,
        createFakeSource("hackernews", [evidence("hackernews", 0.9)], {
          onFetch: () => fetches.push("hackernews"),
        }),
        createFakeSource("serper", [evidence("serper", 0.3)]),
        createFakeSource("serper_funding", [evidence("serper_funding", 0.2)]),
      ],
      tierRunner: fakeTierRunner(),
      runScoped,
      engine,
      onComplete: (result) => {
        results.push(result);
      },
    });

    await engine.send({
      name: ONBOARDING_COMPLETED_EVENT,
      id: `onboarding/${founderId}`,
      data: { founderId },
    });

    // The verdict was produced despite the quota'd source (graceful degrade).
    expect(results[0]?.outcome).toBe("verdict");
    expect(fetches).toContain("xai"); // it was attempted once — not hammered
    expect(fetches.filter((f) => f === "xai")).toHaveLength(1);
    const [v] = await runScoped(
      founderId,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from verdicts`,
    );
    expect(v?.n).toBe(1);
  });

  it("the staleness cache serves a repeat query without re-fetching or re-charging (Rec #6)", async () => {
    const founderId = await seedFounder("cached idea");
    let fetches = 0;
    const source = createFakeSource("serper", [evidence("serper", 0.5)], {
      onFetch: () => (fetches += 1),
    });
    const costGuard = createCostGuard({ runScoped, founderId, budgetMicros: 1_000_000 });
    const cached = withCache(source, { runScoped, founderId, costGuard });

    await cached.fetch({ idea: "cached idea" });
    await cached.fetch({ idea: "cached idea" }); // within TTL → cache hit
    expect(fetches).toBe(1);
    // Cost charged once (the hit was free).
    const [spend] = await runScoped(
      founderId,
      (trx) =>
        trx<{ n: number }[]>`select count(*)::int as n from research_spend where kind = 'source'`,
    );
    expect(spend?.n).toBe(1);
  });

  it("re-enters Research on a validation pivot so the loop never dead-ends (§13.3, Ch 11)", async () => {
    const founderId = await seedFounder("idea that needs a pivot");
    // The founder has already passed research and is in planning/validation.
    await runScoped(founderId, (trx) => trx`update company_state set stage = 'planning'`);
    const engine = new InMemoryWorkflowEngine();
    const completed: string[] = [];
    engine.register({
      id: "test.pivot-completed",
      trigger: { event: RESEARCH_COMPLETED_EVENT },
      handler: async (event) => completed.push(event.data.verdict as string),
    });
    const results: ResearchResult[] = [];
    registerResearchPivotEntry(engine, {
      sources: strongSources(),
      tierRunner: fakeTierRunner(),
      runScoped,
      engine,
      onComplete: (result) => {
        results.push(result);
      },
    });

    // Validation emits the pivot; Research consumes it and re-researches.
    await engine.send({
      name: VALIDATION_PIVOT_EVENT,
      id: `validation-pivot/${founderId}`,
      data: { founderId, experimentId: `exp-${founderId}` },
    });

    expect(results[0]?.outcome).toBe("verdict");
    expect(completed).toEqual(["strong_signal"]);
    const [v] = await runScoped(
      founderId,
      (trx) => trx<{ n: number }[]>`select count(*)::int as n from verdicts`,
    );
    expect(v?.n).toBe(1);
    // Company State ended back at planning (research advanced it after re-entry).
    const [state] = await runScoped(
      founderId,
      (trx) => trx<{ stage: string }[]>`select stage from company_state`,
    );
    expect(state?.stage).toBe("planning");
  });
});

if (!adminUrl) {
  it("research suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
