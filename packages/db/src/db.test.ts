import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgActionLedger } from "./action-ledger";
import { withFounderContext } from "./client";
import { migrateDown, migrateUp } from "./migrate";

// Integration acceptance for Build 1 (ENGINEERING_OS §7): migrations apply and
// roll back cleanly; RLS is the enforced isolation guarantee (§18.5.4);
// pgvector retrieval returns on seeded data. Runs against a real Postgres —
// TETHR_DATABASE_URL must point at a pgvector-enabled database (CI provides
// one; locally see the db package README).
const databaseUrl = process.env.TETHR_DATABASE_URL;

// Every table that must carry founder_id + forced RLS. The catalog test below
// also discovers new tables mechanically; this list pins today's schema.
const FOUNDER_SCOPED_TABLES = [
  "episodes",
  "graph_entities",
  "graph_edges",
  "traits",
  "trait_observations",
  "policy_state",
  "policy_decisions",
  "company_state",
  "verdicts",
  "plans",
  "actions",
  "experiments",
  "outreach_threads",
  "channel_identities",
  "messages",
  "action_ledger",
] as const;

// §18.5.4: a table is founder-scoped by default; opting out is enumerated.
// rag_corpus is Public Knowledge (Ch 7): shared, founder-free, read-only —
// deliberately the opposite of every founder-scoped table (no RLS, no writes).
const RLS_EXCEPTIONS = ["rag_corpus", "schema_migrations"] as const;

const embedding = (hot: number) =>
  JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i === hot ? 1 : 0)));

/** First row, asserted present — seed queries must return what they inserted. */
const one = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (!row) throw new Error("expected a returned row");
  return row;
};

describe.skipIf(!databaseUrl)("data substrate (requires TETHR_DATABASE_URL)", () => {
  // One connection so SET ROLE / set_config stay on the session under test.
  let sql: Sql;
  let founderA: string;
  let founderB: string;

  const asApp = async (founderId: string | null) => {
    await sql`set role tethr_app`;
    await sql`select set_config('app.founder_id', ${founderId ?? ""}, false)`;
  };
  const asService = async () => {
    await sql`reset role`;
    await sql`select set_config('app.founder_id', '', false)`;
  };

  beforeAll(async () => {
    sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    // Deterministic clean slate for the run.
    await sql.unsafe("drop schema public cascade; create schema public;");
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("applies all migrations, rolls back cleanly, and re-applies", async () => {
    const applied = await migrateUp(sql);
    expect(applied.length).toBeGreaterThanOrEqual(6);

    const tables = async () =>
      (
        await sql<{ relname: string }[]>`
          select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by relname`
      ).map((row) => row.relname);

    expect(await tables()).toEqual(
      expect.arrayContaining([...FOUNDER_SCOPED_TABLES, "founders", "rag_corpus"]),
    );
    // 0007 supersedes the 0003 store: one Public Knowledge table, not two.
    expect(await tables()).not.toContain("public_knowledge_chunks");

    const reverted = await migrateDown(sql, applied.length);
    expect(reverted).toEqual([...applied].reverse());
    expect(await tables()).toEqual(["schema_migrations"]);

    const reapplied = await migrateUp(sql);
    expect(reapplied).toEqual(applied);
  });

  it("every founder_id table has forced RLS and an isolation policy; every other table is an enumerated exception", async () => {
    const rows = await sql<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;

    for (const table of rows) {
      const hasFounderId =
        (
          await sql`select 1 from information_schema.columns
            where table_schema = 'public' and table_name = ${table.relname} and column_name = 'founder_id'`
        ).length > 0;
      if (hasFounderId || table.relname === "founders") {
        expect(table.relrowsecurity, `${table.relname} must have RLS enabled`).toBe(true);
        expect(table.relforcerowsecurity, `${table.relname} must FORCE RLS`).toBe(true);
        expect(table.policies, `${table.relname} must have a policy`).toBeGreaterThan(0);
      } else {
        expect(
          RLS_EXCEPTIONS,
          `${table.relname} has no founder_id and is not an enumerated §18.5.4 exception`,
        ).toContain(table.relname);
      }
    }
    expect(rows.map((r) => r.relname)).toEqual(expect.arrayContaining([...FOUNDER_SCOPED_TABLES]));
  });

  it("seeds one row in every founder-scoped table for founder A (service role)", async () => {
    await asService();
    founderA = one(
      await sql<{ id: string }[]>`
        insert into founders (display_name) values ('Founder A') returning id`,
    ).id;
    founderB = one(
      await sql<{ id: string }[]>`
        insert into founders (display_name) values ('Founder B') returning id`,
    ).id;

    const episode = one(
      await sql<{ id: string }[]>`
        insert into episodes (founder_id, kind, content, embedding)
        values (${founderA}, 'message', '{"text":"hello"}', ${embedding(0)})
        returning id`,
    );
    const entity = one(
      await sql<{ id: string }[]>`
        insert into graph_entities (founder_id, entity_type, name)
        values (${founderA}, 'company', 'Acme') returning id`,
    );
    const entity2 = one(
      await sql<{ id: string }[]>`
        insert into graph_entities (founder_id, entity_type, name)
        values (${founderA}, 'idea', 'B2B scheduling') returning id`,
    );
    await sql`
      insert into graph_edges (founder_id, source_entity_id, target_entity_id, relation, valid_from, provenance_episode_ids)
      values (${founderA}, ${entity.id}, ${entity2.id}, 'pursues', now(), ${[episode.id]})`;
    await sql`
      insert into traits (founder_id, family, dimension, revealed_estimate, revealed_confidence, half_life_weeks, provenance_episode_ids)
      values (${founderA}, 'market_customer', 'customer_contact_avoidance', '0.7', 0.4, 6, ${[episode.id]})`;
    await sql`
      insert into trait_observations (founder_id, family, dimension, source, observed_estimate, corroborating, provenance_episode_ids)
      values (${founderA}, 'market_customer', 'customer_contact_avoidance', 'revealed', 0.7, true, ${[episode.id]})`;
    await sql`
      insert into policy_state (founder_id, behavior) values (${founderA}, 'nudge.hard')`;
    await sql`
      insert into policy_decisions (founder_id, behavior, base_fit, confidence_gate, learned_weight, score, decision, veto_applied)
      values (${founderA}, 'nudge.hard', 0.8, 0.6, 1.0, 0.48, 'act', false)`;
    await sql`
      insert into company_state (founder_id, company_name) values (${founderA}, 'Acme')`;
    const verdict = one(
      await sql<{ id: string }[]>`
        insert into verdicts (founder_id, verdict, summary)
        values (${founderA}, 'strong_signal', 'live demand observed') returning id`,
    );
    const plan = one(
      await sql<{ id: string }[]>`
        insert into plans (founder_id, verdict_id) values (${founderA}, ${verdict.id}) returning id`,
    );
    await sql`
      insert into actions (founder_id, plan_id, sequence_index, action, founder_requirement, definition_of_done, estimated_time)
      values (${founderA}, ${plan.id}, 1, 'Draft 10 prospect messages', 'none', '10 drafts approved', interval '2 hours')`;
    await sql`
      insert into experiments (founder_id, plan_id, hypothesis, success_criteria, failure_criteria, duration, sample_size)
      values (${founderA}, ${plan.id}, 'SMBs will book a demo', '3+ demos booked', '0 demos after 20 contacts', interval '7 days', 20)`;
    await sql`
      insert into outreach_threads (founder_id, prospect_name) values (${founderA}, 'Jane Prospect')`;
    const identity = one(
      await sql<{ id: string }[]>`
        insert into channel_identities (founder_id, channel_type, address, verified_at)
        values (${founderA}, 'imessage', '+15551230001', now()) returning id`,
    );
    await sql`
      insert into messages (founder_id, channel_identity_id, direction, body, channel_message_id, status)
      values (${founderA}, ${identity.id}, 'in', 'hey tethr', 'prov-msg-1', 'received')`;
    await sql`
      insert into action_ledger (founder_id, action_type, idempotency_key, status)
      values (${founderA}, 'outreach.send', 'seed/send-1', 'executed')`;

    for (const table of FOUNDER_SCOPED_TABLES) {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from ${sql(table)} where founder_id = ${founderA}`;
      expect(row?.n, `${table} should have seed data`).toBeGreaterThan(0);
    }
  });

  it("RLS: founder B sees zero rows of founder A's data, in every founder-scoped table", async () => {
    await asApp(founderB);
    for (const table of FOUNDER_SCOPED_TABLES) {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
      expect(row?.n, `${table} must be invisible cross-founder`).toBe(0);
    }
    // The founders root is self-scoped: B sees exactly one row — their own.
    const founders = await sql<{ id: string }[]>`select id from founders`;
    expect(founders.map((row) => row.id)).toEqual([founderB]);

    await asApp(founderA);
    for (const table of FOUNDER_SCOPED_TABLES) {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
      expect(row?.n, `${table} must be visible to its own founder`).toBeGreaterThan(0);
    }
    await asService();
  });

  it("RLS: founder B cannot write rows for founder A, and a context-less connection cannot write at all", async () => {
    await asApp(founderB);
    await expect(
      sql`insert into episodes (founder_id, kind, content) values (${founderA}, 'message', '{}')`,
    ).rejects.toThrow(/row-level security/);

    await asApp(null);
    await expect(
      sql`insert into episodes (kind, content) values ('message', '{}')`,
    ).rejects.toThrow();
    await asService();
  });

  it("withFounderContext drops privileges and scopes identity to the transaction — even on a superuser connection", async () => {
    // The connection under test is the superuser; the helper itself must make
    // RLS bite (SET LOCAL ROLE), not rely on the DSN being low-privilege.
    await asService();
    const seenAsA = await withFounderContext(sql, founderA, async (trx) => {
      return (await trx`select id from episodes`).length;
    });
    expect(seenAsA).toBeGreaterThan(0);

    const seenAsB = await withFounderContext(sql, founderB, async (trx) => {
      return (await trx`select id from episodes`).length;
    });
    expect(seenAsB).toBe(0);

    // Neither the role nor the context leaks past the transaction.
    const [after] = await sql<{ ctx: string | null; usr: string }[]>`
      select current_setting('app.founder_id', true) as ctx, current_user as usr`;
    expect(after?.ctx ?? "").toBe("");
    expect(after?.usr).not.toBe("tethr_app");
  });

  it("a malformed founder context is a clean deny, not an error on every query", async () => {
    await sql`set role tethr_app`;
    await sql`select set_config('app.founder_id', 'not-a-uuid', false)`;
    const rows = await sql`select id from episodes`;
    expect(rows.length).toBe(0);
    await expect(
      sql`insert into episodes (kind, content) values ('message', '{}')`,
    ).rejects.toThrow();
    await asService();
  });

  it("messaging identity: one address has one owner, and duplicate provider messages land once (§19.4)", async () => {
    await asService();
    // Same phone number on a second channel: a distinct identity, same founder.
    await sql`
      insert into channel_identities (founder_id, channel_type, address, verified_at)
      values (${founderA}, 'sms', '+15551230001', now())`;
    // But the same (channel, address) cannot belong to a second founder.
    await expect(
      sql`insert into channel_identities (founder_id, channel_type, address)
          values (${founderB}, 'imessage', '+15551230001')`,
    ).rejects.toThrow(/duplicate key/);

    const identity = one(
      await sql<{ id: string }[]>`
        select id from channel_identities where channel_type = 'imessage' and address = '+15551230001'`,
    );
    // Webhook retry delivers the same provider message id: rejected, not duplicated.
    await expect(
      sql`insert into messages (founder_id, channel_identity_id, direction, body, channel_message_id, status)
          values (${founderA}, ${identity.id}, 'in', 'hey tethr (retry)', 'prov-msg-1', 'received')`,
    ).rejects.toThrow(/duplicate key/);
  });

  it("episodes are append-only: content rewrites rejected; embedding backfill and tombstoning allowed", async () => {
    await asService();
    const episode = one(
      await sql<{ id: string }[]>`
        insert into episodes (founder_id, kind, content) values (${founderA}, 'message', '{"text":"original"}')
        returning id`,
    );

    await expect(
      sql`update episodes set content = '{"text":"rewritten"}' where id = ${episode.id}`,
    ).rejects.toThrow(/append-only/);

    await sql`update episodes set embedding = ${embedding(1)} where id = ${episode.id}`;
    await expect(
      sql`update episodes set embedding = ${embedding(2)} where id = ${episode.id}`,
    ).rejects.toThrow(/backfilled/);

    await sql`update episodes set tombstoned_at = now() where id = ${episode.id}`;
  });

  it("pgvector retrieval returns nearest chunks on seeded data (Ch 7 grounding path)", async () => {
    await asService();
    await sql`insert into rag_corpus (source, url, title, content, chunk_index, metadata, embedding) values
      ('pg-essays', 'https://paulgraham.com/ds.html', 'Do things that don''t scale', 'Recruit users manually...', 0, '{"topic":"growth"}', ${embedding(0)}),
      ('steve-blank', null, 'Get out of the building', 'No facts inside the building...', 0, '{}', ${embedding(500)}),
      ('first-round', null, 'Founder-led sales', 'The founder sells first...', 0, '{}',
        ${JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i <= 1 ? 1 : 0)))})`;

    // Grounding retrieval runs as the app role: readable, never writable.
    await asApp(founderA);
    const nearest = await sql<{ title: string }[]>`
      select title from rag_corpus
      order by embedding <=> ${embedding(0)} limit 2`;
    expect(nearest.map((row) => row.title)).toEqual([
      "Do things that don't scale",
      "Founder-led sales",
    ]);
    await expect(
      sql`insert into rag_corpus (source, content, embedding)
          values ('x', 'y', ${embedding(2)})`,
    ).rejects.toThrow(/permission denied/);
    await asService();
  });

  it("rag_corpus embeddings are vector(1536) — the text-embedding-3-small dimension guard", async () => {
    // A mismatched embedding model would produce a different dimension; the
    // column type is the structural guard, and this pins it (Ch 7, Build 3).
    const [dim] = await sql<{ dim: number }[]>`
      select atttypmod as dim from pg_attribute
      where attrelid = 'rag_corpus'::regclass and attname = 'embedding'`;
    expect(dim?.dim).toBe(1536);
    await expect(
      sql`select embedding <=> ${JSON.stringify([1, 0, 0])} from rag_corpus limit 1`,
    ).rejects.toThrow(/dimensions/);
  });

  describe("PgActionLedger (§18.5.7 against real Postgres)", () => {
    it("claims atomically, dedupes retries, and namespaces by action type", async () => {
      await asApp(founderA);
      const ledger = new PgActionLedger(sql);

      expect(await ledger.claimIntent("outreach.send", "founder-a/send-1")).toBe("claimed");
      expect(await ledger.claimIntent("outreach.send", "founder-a/send-1")).toBe("pending");
      expect(await ledger.claimIntent("voice.call", "founder-a/send-1")).toBe("claimed");
      await asService();
    });

    it("idempotency keys are a per-founder namespace: one founder's claim never blocks another's", async () => {
      const ledger = new PgActionLedger(sql);
      await asApp(founderA);
      expect(await ledger.claimIntent("outreach.send", "shared-key-1")).toBe("claimed");
      await asApp(founderB);
      expect(await ledger.claimIntent("outreach.send", "shared-key-1")).toBe("claimed");
      await asService();
    });

    it("a definite failure releases the claim; ambiguous keeps it (§18.5.7)", async () => {
      await asApp(founderA);
      const ledger = new PgActionLedger(sql);

      expect(await ledger.claimIntent("outreach.send", "founder-a/send-2")).toBe("claimed");
      await ledger.recordOutcome(
        "outreach.send",
        "founder-a/send-2",
        "failed",
        "connection refused",
      );
      expect(await ledger.claimIntent("outreach.send", "founder-a/send-2")).toBe("claimed");
      await ledger.recordOutcome(
        "outreach.send",
        "founder-a/send-2",
        "ambiguous",
        "provider timeout",
      );
      expect(await ledger.claimIntent("outreach.send", "founder-a/send-2")).toBe("ambiguous");
      await asService();
    });

    it("the database rejects empty keys and outcome-without-claim", async () => {
      await asApp(founderA);
      const ledger = new PgActionLedger(sql);
      await expect(ledger.claimIntent("outreach.send", "")).rejects.toThrow();
      await expect(
        ledger.recordOutcome("outreach.send", "never-claimed", "executed"),
      ).rejects.toThrow(/outcome without claim/);
      await asService();
    });

    it("the app role cannot delete ledger rows — the trail survives (§18.5.7, §6.16)", async () => {
      await asApp(founderA);
      await expect(sql`delete from action_ledger`).rejects.toThrow(/permission denied/);
      await asService();
    });
  });
});

if (!databaseUrl) {
  it("db integration suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(databaseUrl).toBeUndefined();
  });
}
