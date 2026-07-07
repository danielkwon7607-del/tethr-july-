import { migrateUp } from "@tethr/db";
import type { QueryEmbedder } from "@tethr/model-router";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORPUS_EMBEDDING_DIMENSIONS,
  CORPUS_EMBEDDING_MODEL,
  retrieveGrounding,
  WrongEmbeddingModelError,
} from "./grounding";

// Integration acceptance for Build 3 (ENGINEERING_OS §7): grounding retrieval
// returns relevant chunks, ordered by similarity, read-only. Runs against a
// real pgvector Postgres in its own database so it cannot race db.test.ts,
// which drops the public schema of the database TETHR_DATABASE_URL names.
const adminUrl = process.env.TETHR_DATABASE_URL;

const vec = (values: Record<number, number>) =>
  JSON.stringify(Array.from({ length: CORPUS_EMBEDDING_DIMENSIONS }, (_, i) => values[i] ?? 0));

/** Deterministic embedder: each known query maps to a fixed unit vector. */
const fakeEmbedder = (queries: Record<string, Record<number, number>>): QueryEmbedder => ({
  model: CORPUS_EMBEDDING_MODEL,
  embedQuery: async (text) => {
    const hot = queries[text];
    if (!hot) throw new Error(`unexpected query: ${text}`);
    return Array.from({ length: CORPUS_EMBEDDING_DIMENSIONS }, (_, i) => hot[i] ?? 0);
  },
});

describe.skipIf(!adminUrl)("grounding retrieval (requires TETHR_DATABASE_URL)", () => {
  let sql: Sql;

  beforeAll(async () => {
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_pk_test");
    await admin.unsafe("create database tethr_pk_test");
    await admin.end();
    const url = new URL(adminUrl as string);
    url.pathname = "/tethr_pk_test";
    sql = postgres(url.href, { max: 1, onnotice: () => {} });
    await migrateUp(sql);
    await sql`insert into rag_corpus (source, title, content, chunk_index, metadata, embedding) values
      ('paulgraham.com', 'Do things that don''t scale', 'Recruit users manually.', 0, '{"topic":"growth"}', ${vec({ 0: 1 })}),
      ('steveblank.com', 'Get out of the building', 'No facts inside the building.', 0, '{"topic":"validation"}', ${vec({ 0: 0.8, 1: 0.6 })}),
      ('saastr.com', 'Pricing is discovered', 'Price against value, not cost.', 0, '{"topic":"pricing"}', ${vec({ 5: 1 })}),
      ('firstround.com', 'Founder-led sales', 'The founder sells first.', 1, '{"topic":"sales"}', ${vec({ 6: 1 })})`;
  });

  afterAll(async () => {
    await sql?.end();
    // Drop the scratch database: a leftover copy holds grants to the
    // cluster-global tethr_app role, which would break db.test.ts's
    // migrate-down (drop role) on the next run.
    const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("drop database if exists tethr_pk_test");
    await admin.end();
  });

  it("returns the most relevant chunks first, with similarity and provenance fields", async () => {
    const embedder = fakeEmbedder({ "how do I get my first users?": { 0: 1 } });
    const chunks = await retrieveGrounding(sql, embedder, "how do I get my first users?", {
      limit: 2,
    });

    expect(chunks.map((chunk) => chunk.title)).toEqual([
      "Do things that don't scale",
      "Get out of the building",
    ]);
    const [top, second] = chunks;
    expect(top?.similarity).toBeCloseTo(1, 5);
    expect(second?.similarity).toBeCloseTo(0.8, 5);
    expect(top?.source).toBe("paulgraham.com");
    expect(top?.content).toContain("Recruit users manually");
    expect(top?.metadata).toEqual({ topic: "growth" });
  });

  it("respects the limit and defaults to a sane one", async () => {
    const embedder = fakeEmbedder({ pricing: { 5: 1 } });
    const chunks = await retrieveGrounding(sql, embedder, "pricing");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks[0]?.title).toBe("Pricing is discovered");
  });

  it("migration 0007 yields the HNSW index and the <=> query actually uses it", async () => {
    const indexes = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes where tablename = 'rag_corpus'`;
    expect(indexes.some((row) => /using hnsw.*vector_cosine_ops/i.test(row.indexdef))).toBe(true);

    // Tiny tables seq-scan by default; disabling it proves the query shape
    // (order by embedding <=> $1) matches the index opclass — the check that
    // catches a <-> / <=> operator-class mismatch.
    const plan = await sql.begin(async (trx) => {
      await trx`set local enable_seqscan = off`;
      return trx<{ "QUERY PLAN": string }[]>`
        explain select id from rag_corpus order by embedding <=> ${vec({ 0: 1 })} limit 2`;
    });
    const planText = (plan as { "QUERY PLAN": string }[])
      .map((row) => row["QUERY PLAN"])
      .join("\n");
    expect(planText).toMatch(/Index Scan using rag_corpus_embedding/);
  });

  it("refuses an embedder pinned to a different model — the exact-model guard (Ch 7)", async () => {
    const wrongModel: QueryEmbedder = {
      model: "text-embedding-3-large",
      embedQuery: async () => [],
    };
    await expect(retrieveGrounding(sql, wrongModel, "anything")).rejects.toThrow(
      WrongEmbeddingModelError,
    );
  });
});

if (!adminUrl) {
  it("grounding integration suite SKIPPED — set TETHR_DATABASE_URL to run it", () => {
    expect(adminUrl).toBeUndefined();
  });
}
