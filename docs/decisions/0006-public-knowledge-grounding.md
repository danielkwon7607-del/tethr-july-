# 0006 — Public Knowledge grounding: rag_corpus, a dedicated package, and a pinned embedding model

Date: 2026-07-07 (Build 3) · Status: accepted

## Context

The Public Knowledge corpus (handbook Ch 7) turned out to already exist in the
live Supabase project as `rag_corpus` — 21,349 chunks, embedded with OpenAI
`text-embedding-3-small` (1536-dim), metadata `{date, stage, topic,
content_hash}` — ingested outside this repo's migration chain. Build 3 needed
to (a) reconcile the repo's canonical schema with that reality, (b) wire
similarity retrieval, and (c) make the Ch 7 access boundary (Planning and
Validation only; never Research) a tested guarantee.

## Decisions

1. **`rag_corpus` is the canonical Public Knowledge table; migration 0007
   supersedes 0003's never-populated `public_knowledge_chunks`.** The
   migration is adoption-safe (`create table/index if not exists`) so the same
   chain is correct both on fresh databases and against the live one where the
   table pre-exists. Shape verified against production 2026-07-07
   (`scripts/verify-build-3.ts`).
2. **Grounding retrieval lives in a new `packages/public-knowledge`, not
   `packages/db`.** `db` is substrate every package depends on; exporting
   grounding from it would hand Research a path to the corpus through a
   dependency it already has. A dedicated package makes the dependency edge
   itself the access control, enforced by `access-boundary.test.ts`: any
   workspace outside {`@tethr/planning`, `@tethr/validation`} that depends on
   or imports the package fails the suite, and `db`'s exported surface is
   scanned for `rag_corpus` leakage. *Rejected:* `packages/db` (no seam),
   runtime capability tokens (ceremony without stronger guarantees).
3. **Embeddings are a model-router capability with NO cross-provider
   fallback.** Unlike completions, an embedding "fallback" to another model
   produces vectors in a different space — well-formed garbage against this
   corpus. `createQueryEmbedder` pins one model and hard-fails on a dimension
   mismatch (`EmbeddingDimensionError`, expects 1536);
   `retrieveGrounding` additionally refuses any embedder not pinned to
   `text-embedding-3-small` (`WrongEmbeddingModelError`). *Rejected:* routing
   embeddings through `ModelRouter`'s tier/fallback machinery.
4. **The app's retrieval path is SQL via the `postgres` client (`embedding
   <=> query` under the HNSW index), not the live DB's `match_rag_corpus`
   RPC.** The RPC is an ingestion-side artifact; the app already speaks SQL to
   this database for everything else, and one access path beats two. The
   verification script uses the RPC only as a REST-reachable fallback when no
   Postgres DSN is available.

## Consequences

- Planning/Validation (Build 8) consume `retrieveGrounding(sql, embedder,
  query)` by adding a dependency on `@tethr/public-knowledge` — the only two
  packages allowed to.
- The live database was not created by this migration chain; first deploy
  needs a baseline step (record 0001–0007 as applied or reconcile schemas).
  The live project also carries unrelated prototype tables (`founder_profile`,
  `waitlist`, …) — out of scope, untouched.
- SQL-level live checks (vector index existence/usage) remain unverified until
  a `TETHR_LIVE_DATABASE_URL` DSN for the live project is provided (a distinct
  name from `TETHR_DATABASE_URL`, which the test suite treats as disposable);
  `scripts/verify-build-3.ts` runs them the moment it is.
