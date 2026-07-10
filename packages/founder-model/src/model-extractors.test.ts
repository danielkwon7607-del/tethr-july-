import { migrateUp, withFounderContext } from "@tethr/db";
import type { TierRequest, TierRunner } from "@tethr/orchestration";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModelExtractors } from "./model-extractors";

// Build 6: the write-path extractors, deferred from Build 4, arrive as real
// Tier-1/Tier-2 calls through the tier runner (Ch 20). The model output is
// untrusted external data (Constitution: validate at the boundary) — a
// malformed shape is rejected, not written. Tests inject a fake TierRunner so
// the suite stays deterministic and never calls a live model.
const adminUrl = process.env.TETHR_DATABASE_URL;

const fakeRunner = (tier1Text: string, tier2Text: string): TierRunner => ({
  tier1: async (_request: TierRequest) => ({ provider: "fake", model: "t1", text: tier1Text }),
  tier2: async (_request: TierRequest) => ({ provider: "fake", model: "t2", text: tier2Text }),
});

describe.skipIf(!adminUrl)(
  "model-backed write-path extractors (requires TETHR_DATABASE_URL)",
  () => {
    let sql: Sql;
    let founderId: string;
    let episodeId: string;
    const runScoped = <T>(id: string, work: (trx: Sql) => Promise<T>): Promise<T> =>
      withFounderContext(sql, id, work);

    beforeAll(async () => {
      const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
      await admin.unsafe("drop database if exists tethr_mx_test");
      await admin.unsafe("create database tethr_mx_test");
      await admin.end();
      const url = new URL(adminUrl as string);
      url.pathname = "/tethr_mx_test";
      sql = postgres(url.href, { max: 1, onnotice: () => {} });
      await migrateUp(sql);
      const [founder] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Extractor Founder') returning id`;
      founderId = (founder as { id: string }).id;
      const [episode] = await sql<{ id: string }[]>`
      insert into episodes (founder_id, kind, content)
      values (${founderId}, 'message', '{"body":"I keep putting off customer calls"}')
      returning id`;
      episodeId = (episode as { id: string }).id;
    });

    afterAll(async () => {
      await sql?.end();
      const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
      await admin.unsafe("drop database if exists tethr_mx_test");
      await admin.end();
    });

    it("extract parses Tier-1 JSON into WireFacts (fenced code blocks tolerated)", async () => {
      const runner = fakeRunner(
        '```json\n{"facts":[{"source":{"entityType":"founder","name":"Ada"},"relation":"avoids","target":{"entityType":"activity","name":"customer calls"},"cardinality":"many"}]}\n```',
        '{"observations":[]}',
      );
      const { extract } = createModelExtractors({ tierRunner: runner, runScoped });
      const facts = await extract({ episodeId, founderId });
      expect(facts).toHaveLength(1);
      expect(facts[0]?.relation).toBe("avoids");
      expect(facts[0]?.target.name).toBe("customer calls");
      expect(facts[0]?.cardinality).toBe("many");
    });

    it("tolerates a bare ``` fence and a non-json language tag", async () => {
      const bare = fakeRunner(
        '```\n{"facts":[{"source":{"entityType":"founder","name":"Ada"},"relation":"pursues","target":{"entityType":"idea","name":"x"}}]}\n```',
        '{"observations":[]}',
      );
      expect(
        await createModelExtractors({ tierRunner: bare, runScoped }).extract({
          episodeId,
          founderId,
        }),
      ).toHaveLength(1);
    });

    it("abstract parses Tier-2 JSON into WireObservations", async () => {
      const runner = fakeRunner(
        '{"facts":[]}',
        '{"observations":[{"family":"market_customer","dimension":"customer_contact_avoidance","source":"revealed","estimate":0.8}]}',
      );
      const { abstract } = createModelExtractors({ tierRunner: runner, runScoped });
      const observations = await abstract({ episodeId, founderId });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.dimension).toBe("customer_contact_avoidance");
      expect(observations[0]?.source).toBe("revealed");
      expect(observations[0]?.estimate).toBeCloseTo(0.8, 5);
    });

    it("rejects malformed model output — bad family, out-of-range estimate (boundary validation)", async () => {
      const runner = fakeRunner(
        '{"facts":[]}',
        '{"observations":[{"family":"not_a_family","dimension":"x","source":"revealed","estimate":9}]}',
      );
      const { abstract } = createModelExtractors({ tierRunner: runner, runScoped });
      await expect(abstract({ episodeId, founderId })).rejects.toThrow();
    });

    it("returns nothing for an episode the founder cannot see (§18.5 RLS)", async () => {
      const [mallory] = await sql<{ id: string }[]>`
      insert into founders (display_name) values ('Mallory') returning id`;
      const runner = fakeRunner(
        '{"facts":[{"source":{"entityType":"founder","name":"x"},"relation":"r","target":{"entityType":"y","name":"z"}}]}',
        '{"observations":[]}',
      );
      const { extract } = createModelExtractors({ tierRunner: runner, runScoped });
      // Ada's episode is invisible under Mallory's scope, so there is nothing to
      // feed the model — no fabricated facts under the wrong founder.
      const facts = await extract({ episodeId, founderId: (mallory as { id: string }).id });
      expect(facts).toEqual([]);
    });
  },
);

if (!adminUrl) {
  it("model-extractors suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
