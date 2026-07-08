import { migrateUp, withFounderContext } from "@tethr/db";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFact, liveFacts } from "./graph-store";
import { decideAndRecord, reweightPolicy } from "./policy-store";
import {
  applyCorrection,
  listTraits,
  readTrait,
  recordObservation,
  traitHistory,
} from "./trait-store";

// Build 4 acceptance (ENGINEERING_OS §7) against real Postgres: a corrected
// read updates and persists as the highest-weight signal; a superseded read
// is invalidated, not deleted; reads are inspectable with provenance; the
// burnout veto measurably caps intervention; decisions are instrumented.
// Own database (tethr_fm_test) so it cannot race db.test.ts; the suite is
// serialized by vitest fileParallelism=false under TETHR_DATABASE_URL.
const adminUrl = process.env.TETHR_DATABASE_URL;

describe.skipIf(!adminUrl)("founder-model stores (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;
  let founder: string;
  const episodes: string[] = [];

  const asFounder = <T>(work: (trx: Sql) => Promise<T>) => withFounderContext(sql, founder, work);

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_fm_test");
    await admin.unsafe("create database tethr_fm_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_fm_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
    const [row] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Calibration Founder') returning id`;
    founder = (row as { id: string }).id;
    for (let i = 0; i < 3; i++) {
      const [episode] = await sql<{ id: string }[]>`
        insert into episodes (founder_id, kind, content)
        values (${founder}, 'message', ${JSON.stringify({ i })}) returning id`;
      episodes.push((episode as { id: string }).id);
    }
  });

  afterAll(async () => {
    await sql?.end();
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_fm_test");
    await admin.end();
  });

  it("three fresh corroborating revealed observations yield ~0.65 confidence — the handbook's own example", async () => {
    for (const episodeId of episodes) {
      await asFounder((trx) =>
        recordObservation(trx, {
          family: "market_customer",
          dimension: "customer_contact_avoidance",
          source: "revealed",
          estimate: 0.7,
          provenanceEpisodeIds: [episodeId],
        }),
      );
    }
    const trait = await asFounder((trx) => readTrait(trx, "customer_contact_avoidance"));
    expect(trait?.revealed.estimate).toBeCloseTo(0.7, 5);
    expect(trait?.revealed.confidence).toBeCloseTo(0.65, 2);
    expect(trait?.stated.confidence).toBe(0);
  });

  it("supersession is bi-temporal: prior reads are invalidated, never deleted", async () => {
    const history = await asFounder((trx) => traitHistory(trx, "customer_contact_avoidance"));
    expect(history.length).toBe(3);
    const invalidated = history.filter((row) => row.invalidatedAt !== null);
    expect(invalidated.length).toBe(2);
    const live = history.filter((row) => row.invalidatedAt === null);
    expect(live.length).toBe(1);
  });

  it("stated stays separate from revealed, and the reconciliation gate fires on divergence (§6.7/§6.15)", async () => {
    // Founder says they love talking to customers (low avoidance)…
    const stated = await asFounder((trx) =>
      recordObservation(trx, {
        family: "market_customer",
        dimension: "customer_contact_avoidance",
        source: "stated",
        estimate: 0.1,
        provenanceEpisodeIds: [episodes[0] as string],
      }),
    );
    // …revealed (0.7, confidence ~0.65) vs stated (0.1): divergence 0.6 > 0.3
    // and revealed confidence > 0.5 — the gate fires.
    expect(stated.reconciliation.fires).toBe(true);
    expect(stated.reconciliation.divergence).toBeCloseTo(0.6, 5);
    const trait = await asFounder((trx) => readTrait(trx, "customer_contact_avoidance"));
    expect(trait?.stated.estimate).toBeCloseTo(0.1, 5);
    expect(trait?.revealed.estimate).toBeCloseTo(0.7, 5);
  });

  it("a founder correction updates the read immediately, dominates it, and persists with provenance (§6.5)", async () => {
    const before = await asFounder((trx) => readTrait(trx, "customer_contact_avoidance"));
    const correction = await asFounder((trx) =>
      applyCorrection(trx, {
        family: "market_customer",
        dimension: "customer_contact_avoidance",
        estimate: 0.2, // "I'm not avoiding customers, I've just been slammed"
        provenanceEpisodeIds: [episodes[1] as string],
      }),
    );
    const after = await asFounder((trx) => readTrait(trx, "customer_contact_avoidance"));

    // The revealed estimate moves strongly toward the correction (weight 1.0
    // beats each 0.7 observation), and behavior changes immediately.
    expect(after?.revealed.estimate).toBeLessThan((before?.revealed.estimate ?? 1) - 0.1);
    expect(correction.trait.revealed.estimate).toBeCloseTo(after?.revealed.estimate ?? -1, 5);

    // The correction is durable, highest-weight evidence with provenance.
    const rows = await asFounder(
      (trx) => trx<{ source: string; provenance_episode_ids: string[] }[]>`
        select source, provenance_episode_ids from trait_observations
        where dimension = 'customer_contact_avoidance' order by observed_at desc limit 1`,
    );
    expect(rows[0]?.source).toBe("correction");
    expect(rows[0]?.provenance_episode_ids).toContain(episodes[1]);
  });

  it("reads are inspectable with provenance and evidence counts (§6.16)", async () => {
    const traits = await asFounder((trx) => listTraits(trx));
    const avoidance = traits.find((trait) => trait.dimension === "customer_contact_avoidance");
    expect(avoidance).toBeDefined();
    expect(avoidance?.provenanceEpisodeIds.length).toBeGreaterThan(0);
    expect(avoidance?.observationCount).toBe(5);
    expect(avoidance?.revealed.confidence).toBeGreaterThan(0);
  });

  it("decay: an unreinforced load/burnout read loses half its confidence in a week (§6.6)", async () => {
    await asFounder((trx) =>
      recordObservation(trx, {
        family: "capacity",
        dimension: "load_burnout",
        source: "revealed",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      }),
    );
    const fresh = await asFounder((trx) => readTrait(trx, "load_burnout"));
    // Rewind the reinforcement clock one week (service role).
    await sql`update traits set last_reinforced_at = now() - interval '7 days'
      where dimension = 'load_burnout' and invalidated_at is null`;
    const stale = await asFounder((trx) => readTrait(trx, "load_burnout"));
    expect(stale?.revealed.confidence).toBeCloseTo((fresh?.revealed.confidence ?? 0) / 2, 2);
    // The estimate itself does not decay — only the confidence.
    expect(stale?.revealed.estimate).toBeCloseTo(fresh?.revealed.estimate ?? -1, 5);
  });

  it("policy learning persists: ×1.15 positive bounded at 2.0, in policy_state (§6.15)", async () => {
    const first = await asFounder((trx) => reweightPolicy(trx, "nudge.hard", "positive"));
    expect(first).toBeCloseTo(1.15, 5);
    const second = await asFounder((trx) => reweightPolicy(trx, "nudge.hard", "ignored"));
    expect(second).toBeCloseTo(1.15 * 0.85, 5);
    const [row] = await asFounder(
      (trx) => trx<{ learned_weight: number }[]>`
        select learned_weight from policy_state where behavior = 'nudge.hard'`,
    );
    expect(row?.learned_weight).toBeCloseTo(1.15 * 0.85, 5);
  });

  it("a multi-valued relation keeps facts side by side; identical re-assertion extends provenance", async () => {
    const ada = { entityType: "founder", name: "Ada" };
    const first = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "works_with",
        target: { entityType: "person", name: "Alice" },
        cardinality: "many",
        provenanceEpisodeIds: [episodes[0] as string],
      }),
    );
    const second = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "works_with",
        target: { entityType: "person", name: "Bob" },
        cardinality: "many",
      }),
    );
    // Bob does not supersede Alice — both facts are simultaneously true.
    expect(second.superseded).toEqual([]);
    const live = await asFounder((trx) => liveFacts(trx, { relation: "works_with" }));
    expect(live).toHaveLength(2);

    // Identical re-assertion extends provenance instead of duplicating.
    const again = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "works_with",
        target: { entityType: "person", name: "Alice" },
        cardinality: "many",
        provenanceEpisodeIds: [episodes[1] as string],
      }),
    );
    expect(again.id).toBe(first.id);
    const after = await asFounder((trx) => liveFacts(trx, { relation: "works_with" }));
    expect(after).toHaveLength(2);
    const alice = after.find((fact) => fact.target.name === "Alice");
    expect(alice?.provenanceEpisodeIds).toEqual(expect.arrayContaining([episodes[0], episodes[1]]));
  });

  it("a single-valued assertion supersedes every live edge for its (source, relation)", async () => {
    const ada = { entityType: "founder", name: "Ada" };
    // "works_with" currently has two live edges (Alice, Bob). A cardinality
    // 'one' assertion means "the state is now exactly this" — both go.
    const carol = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "works_with",
        target: { entityType: "person", name: "Carol" },
      }),
    );
    expect(carol.superseded).toHaveLength(2);
    const live = await asFounder((trx) => liveFacts(trx, { relation: "works_with" }));
    expect(live).toHaveLength(1);
    expect(live[0]?.target.name).toBe("Carol");
  });

  it("entity matching ignores case and surrounding whitespace — representation noise is not a pivot", async () => {
    const ada = { entityType: "founder", name: "Ada" };
    const first = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "pursues",
        target: { entityType: "idea", name: "AI Bookkeeping" },
      }),
    );
    const noisy = await asFounder((trx) =>
      assertFact(trx, {
        source: ada,
        relation: "pursues",
        target: { entityType: "idea", name: "  ai bookkeeping " },
      }),
    );
    // Same real-world entity: provenance-extend, never a false supersession.
    expect(noisy.id).toBe(first.id);
    expect(noisy.superseded).toEqual([]);
    const live = await asFounder((trx) => liveFacts(trx, { relation: "pursues" }));
    expect(live).toHaveLength(1);
    expect(live[0]?.target.name).toBe("AI Bookkeeping");
  });

  it("the database itself rejects a second live single-valued edge — concurrent asserts fail loudly", async () => {
    const ids = await asFounder(
      (trx) => trx<{ id: string; name: string }[]>`
        select id, name from graph_entities where name in ('Ada', 'Carol')`,
    );
    const ada = ids.find((row) => row.name === "Ada")?.id;
    const carol = ids.find((row) => row.name === "Carol")?.id;
    await expect(
      asFounder(
        (trx) => trx`
          insert into graph_edges (source_entity_id, target_entity_id, relation, valid_from, cardinality)
          values (${ada as string}, ${carol as string}, 'works_with', now(), 'one')`,
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("liveFacts caps its read at the requested limit, newest first", async () => {
    const ada = { entityType: "founder", name: "Ada" };
    for (let i = 0; i < 5; i++) {
      await asFounder((trx) =>
        assertFact(trx, {
          source: ada,
          relation: "mentions",
          target: { entityType: "topic", name: `topic-${i}` },
          cardinality: "many",
        }),
      );
    }
    const capped = await asFounder((trx) => liveFacts(trx, { relation: "mentions", limit: 3 }));
    expect(capped).toHaveLength(3);
  });

  it("the burnout veto measurably caps intervention and is instrumented (§6.15)", async () => {
    const candidates = [
      {
        behavior: "push.more-hours",
        baseFit: 1.0,
        dimensionConfidences: [0.9],
        learnedWeight: 1.5,
        paceIncreasing: true,
        intensity: 3 as const,
      },
      {
        behavior: "checkin.gentle",
        baseFit: 0.6,
        dimensionConfidences: [0.9],
        learnedWeight: 1.0,
        intensity: 1 as const,
      },
    ];

    // Without the veto read, the hard push wins.
    const unvetoed = await asFounder((trx) =>
      decideAndRecord(trx, candidates, { actionThreshold: 0.3 }),
    );
    expect(unvetoed).toEqual(expect.objectContaining({ kind: "act", behavior: "push.more-hours" }));

    // Corroborate the burnout read past the confidence gate (a lone revealed
    // observation sits at ~0.30 — deliberately below veto range: no veto on a
    // guess). Correction (1.0) + revealed (0.7) → net 1.7 → confidence ~0.57.
    await asFounder((trx) =>
      applyCorrection(trx, {
        family: "capacity",
        dimension: "load_burnout",
        estimate: 0.9,
        provenanceEpisodeIds: [],
      }),
    );
    const burnout = await asFounder((trx) => readTrait(trx, "load_burnout"));
    expect(burnout?.revealed.confidence).toBeGreaterThan(0.5);
    const vetoed = await asFounder((trx) =>
      decideAndRecord(trx, candidates, {
        actionThreshold: 0.3,
        ...(burnout
          ? {
              burnout: {
                estimate: burnout.revealed.estimate ?? 0,
                confidence: burnout.revealed.confidence,
              },
            }
          : {}),
      }),
    );
    expect(vetoed).toEqual(
      expect.objectContaining({ kind: "act", behavior: "checkin.gentle", vetoApplied: true }),
    );

    const decisions = await asFounder(
      (trx) => trx<{ behavior: string; veto_applied: boolean; decision: string }[]>`
        select behavior, veto_applied, decision from policy_decisions order by created_at`,
    );
    expect(decisions.length).toBe(2);
    expect(decisions[1]).toEqual(
      expect.objectContaining({ behavior: "checkin.gentle", veto_applied: true, decision: "act" }),
    );
  });
});

if (!adminUrl) {
  it("founder-model store suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
