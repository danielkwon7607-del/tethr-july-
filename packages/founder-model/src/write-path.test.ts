import { migrateUp, withFounderContext } from "@tethr/db";
import type { QueryEmbedder } from "@tethr/model-router";
import { InMemoryWorkflowEngine } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveFacts } from "./graph-store";
import { retrieveFounderContext } from "./retrieval";
import { readTrait } from "./trait-store";
import {
  EPISODE_LOGGED_EVENT,
  RECONCILIATION_FLAGGED_EVENT,
  registerFounderModelWritePath,
  type WireFact,
  type WireObservation,
  WRITE_PATH_WORKFLOW_ID,
} from "./write-path";

// Build 4: the §6.5 write path runs extract→abstract→reconcile as durable
// steps on the Build 2 engine, off the hot path; retrieval is the §6.8
// hybrid. Own scratch database; serialized with the other integration suites.
const adminUrl = process.env.TETHR_DATABASE_URL;

const DIMS = 1536;
const embedding = (hot: number) =>
  JSON.stringify(Array.from({ length: DIMS }, (_, i) => (i === hot ? 1 : 0)));

describe.skipIf(!adminUrl)(
  "founder-model write path & retrieval (requires TETHR_DATABASE_URL)",
  () => {
    let sql: Sql;
    let founder: string;
    let episodeId: string;

    beforeAll(async () => {
      const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
      await admin.unsafe("drop database if exists tethr_wp_test");
      await admin.unsafe("create database tethr_wp_test");
      await admin.end();
      const url = new URL(adminUrl as string);
      url.pathname = "/tethr_wp_test";
      sql = postgres(url.href, { max: 1, onnotice: () => {} });
      await migrateUp(sql);
      const [row] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Write Path Founder') returning id`;
      founder = (row as { id: string }).id;
      const [episode] = await sql<{ id: string }[]>`
      insert into episodes (founder_id, kind, content, embedding)
      values (${founder}, 'message', '{"text":"we talked pricing"}', ${embedding(3)})
      returning id`;
      episodeId = (episode as { id: string }).id;
    });

    afterAll(async () => {
      await sql?.end();
      const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
      await admin.unsafe("drop database if exists tethr_wp_test");
      await admin.end();
    });

    it("extract→abstract→reconcile runs as durable steps off the hot path, under RLS", async () => {
      const engine = new InMemoryWorkflowEngine();
      const facts: WireFact[] = [
        {
          source: { entityType: "founder", name: "Ada" },
          relation: "pursues",
          target: { entityType: "idea", name: "B2B scheduling" },
        },
      ];
      const observations: WireObservation[] = [
        // Stated low avoidance…
        {
          family: "market_customer",
          dimension: "customer_contact_avoidance",
          source: "stated",
          estimate: 0.1,
        },
        // …but revealed high avoidance, three times: confidence clears the gate.
        ...Array.from({ length: 3 }, () => ({
          family: "market_customer" as const,
          dimension: "customer_contact_avoidance",
          source: "revealed" as const,
          estimate: 0.8,
        })),
      ];
      registerFounderModelWritePath(engine, {
        runScoped: (founderId, work) => withFounderContext(sql, founderId, work),
        extract: async () => facts,
        abstract: async () => observations,
      });
      const reconciliations: string[] = [];
      engine.register({
        id: "test.reconciliation-listener",
        trigger: { event: RECONCILIATION_FLAGGED_EVENT },
        handler: async (event) => {
          reconciliations.push(event.data.dimension as string);
        },
      });

      // The hot path does exactly one thing: emit the event.
      await engine.send({
        name: EPISODE_LOGGED_EVENT,
        id: `episode/${episodeId}`,
        data: { founderId: founder, episodeId },
      });

      // All four §6.5 stages ran as durable, memoized steps.
      expect(engine.stepLog).toEqual([
        `${WRITE_PATH_WORKFLOW_ID}:extract`,
        `${WRITE_PATH_WORKFLOW_ID}:write-graph`,
        `${WRITE_PATH_WORKFLOW_ID}:abstract`,
        `${WRITE_PATH_WORKFLOW_ID}:update-traits`,
      ]);

      // Graph got the fact with episode provenance.
      const written = await withFounderContext(sql, founder, (trx) => liveFacts(trx));
      expect(written).toHaveLength(1);
      expect(written[0]?.provenanceEpisodeIds).toContain(episodeId);

      // Traits got the observations; stated stayed separate from revealed.
      const trait = await withFounderContext(sql, founder, (trx) =>
        readTrait(trx, "customer_contact_avoidance"),
      );
      expect(trait?.stated.estimate).toBeCloseTo(0.1, 5);
      expect(trait?.revealed.estimate).toBeCloseTo(0.8, 5);

      // The stated-vs-revealed gate fired and became an internal event (§6.7).
      expect(reconciliations).toEqual(["customer_contact_avoidance"]);

      // A redelivered event (same id) is deduped — the write path is idempotent
      // at the intake, so observations are not double-counted.
      await engine.send({
        name: EPISODE_LOGGED_EVENT,
        id: `episode/${episodeId}`,
        data: { founderId: founder, episodeId },
      });
      const [count] = await withFounderContext(
        sql,
        founder,
        (trx) => trx<{ n: number }[]>`
        select count(*)::int as n from trait_observations
        where dimension = 'customer_contact_avoidance'`,
      );
      expect(count?.n).toBe(4);
    });

    it("a superseded graph fact is invalidated, not deleted (§6.4)", async () => {
      const engine = new InMemoryWorkflowEngine();
      registerFounderModelWritePath(engine, {
        runScoped: (founderId, work) => withFounderContext(sql, founderId, work),
        extract: async () => [
          {
            source: { entityType: "founder", name: "Ada" },
            relation: "pursues",
            target: { entityType: "idea", name: "AI bookkeeping" }, // the pivot
          },
        ],
        abstract: async () => [],
      });
      await engine.send({
        name: EPISODE_LOGGED_EVENT,
        data: { founderId: founder, episodeId },
      });

      const live = await withFounderContext(sql, founder, (trx) =>
        liveFacts(trx, { relation: "pursues" }),
      );
      expect(live).toHaveLength(1);
      expect(live[0]?.target.name).toBe("AI bookkeeping");

      // The old fact survives, invalidated — tethr can explain how its read changed.
      const all = await withFounderContext(
        sql,
        founder,
        (trx) => trx<{ invalidated_at: Date | null; valid_to: Date | null }[]>`
        select invalidated_at, valid_to from graph_edges where relation = 'pursues'
        order by ingested_at`,
      );
      expect(all).toHaveLength(2);
      expect(all[0]?.invalidated_at).not.toBeNull();
      expect(all[0]?.valid_to).not.toBeNull();
      expect(all[1]?.invalidated_at).toBeNull();
    });

    it("hybrid retrieval fuses graph facts, semantic episodes, and traits — and respects tombstones", async () => {
      const embedder: QueryEmbedder = {
        model: "text-embedding-3-small",
        embedQuery: async () => Array.from({ length: DIMS }, (_, i) => (i === 3 ? 1 : 0)),
      };
      const context = await withFounderContext(sql, founder, (trx) =>
        retrieveFounderContext(trx, { query: { text: "pricing discussion", embedder } }),
      );
      expect(context.facts.length).toBeGreaterThan(0);
      expect(context.traits.some((trait) => trait.dimension === "customer_contact_avoidance")).toBe(
        true,
      );
      expect(context.episodes[0]?.id).toBe(episodeId);
      expect(context.episodes[0]?.similarity).toBeCloseTo(1, 5);

      // §6.16 layer 1: a tombstoned episode disappears from retrieval at once.
      await sql`update episodes set tombstoned_at = now() where id = ${episodeId}`;
      const afterDeletion = await withFounderContext(sql, founder, (trx) =>
        retrieveFounderContext(trx, { query: { text: "pricing discussion", embedder } }),
      );
      expect(afterDeletion.episodes.map((episode) => episode.id)).not.toContain(episodeId);
    });
  },
);

if (!adminUrl) {
  it("founder-model write-path suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
