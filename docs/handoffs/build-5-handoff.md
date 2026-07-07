# Handoff → Build 5 (Messaging Substrate & Interaction Shell)

*Written 2026-07-07 at the end of the Builds 3+4 session. Next session: follow
EXECUTION.md's Startup Sequence, then execute Build 5 per ENGINEERING_OS §7.*

## State you inherit

- **Milestones:** `build-0-foundation` → … → `build-3-knowledge` →
  `build-4-founder-model`, all pushed; main green (95 tests locally with the
  scratch cluster; CI `checks` green, `deploy-staging` still red — see debt).
- **packages/public-knowledge** (Build 3): `retrieveGrounding(sql, embedder,
  query)` over the LIVE `rag_corpus` (21,349 chunks, `text-embedding-3-small`,
  1536-dim). The Ch 7 boundary (Planning/Validation only) is enforced by
  `access-boundary.test.ts` three ways — package deps, imports, and a raw-SQL
  `rag_corpus` scan. Do not weaken it; extending the allowlist is a handbook
  amendment.
- **packages/founder-model** (Build 4): §6.15 calibration (pure, tested
  against the handbook's worked examples), trait store with the
  `trait_observations` evidence ledger (migration 0008), bi-temporal graph
  store, §6.8 hybrid retrieval, §6.5 write path
  (`registerFounderModelWritePath`, event `founder.episode-logged`, emits
  `founder.reconciliation-flagged`), policy store with instrumented
  `decideAndRecord` and the burnout veto. ADR 0007 records the v0 choices.
- **model-router** now has an embeddings capability: `createQueryEmbedder` +
  `aiSdkEmbeddingProvider`, NO cross-provider fallback by design (ADR 0006).

## Session-start facts that will save you time

- **Credentials:** `apps/web/.env` (gitignored) holds
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. There is still NO Postgres
  DSN for the live database and no Vercel secrets.
- **Local integration testing:** scratch cluster receipt in
  `packages/db/README.md` (port 54329). The suites create/drop their own
  scratch databases (`tethr_pk_test`, `tethr_fm_test`, `tethr_wp_test`) and
  vitest serializes files when `TETHR_DATABASE_URL` is set.
- **Never point `TETHR_DATABASE_URL` at the live database** — db.test.ts
  drops the public schema. Live SQL checks use `TETHR_LIVE_DATABASE_URL`
  (only consumed by `scripts/verify-build-3.ts`).
- Run the Build 3 verifier with:
  `npx esbuild scripts/verify-build-3.ts --bundle --platform=node --format=esm
  --external:postgres --external:ai --outfile=node_modules/.tethr/verify.mjs
  && node node_modules/.tethr/verify.mjs` (node here is v22 — no native TS).
- **The live Supabase project contains a pre-existing prototype schema**
  (`founder_profile`, `waitlist`, `messages`, `outreach`, …) that does NOT
  match our migrations. First deploy needs a migration-baseline/reconcile
  decision (Confusion Protocol with the CEO). Also a `match_rag_corpus` RPC
  exists there — ingestion-side, not the app path.

## Build 5 scope (ENGINEERING_OS §7)

Photon/Spectrum (`spectrum-ts`) over its gRPC stream, per-founder dedicated
lines, inbound resolution to one founder (§19.4 — schema already live in
migration 0005), ordered/deduped threads, delivery status with SMS/RCS
fallback, and the Next.js shell showing Plan/Experiment/Company State.
Acceptance: a founder moving across channels stays one thread; execution
continues while the founder replies. §18.5.2 binds inbound auth (verified
channel identities only); `sendInbound` (orchestration) already requires a
dedup id.

## Open debt (do not silently absorb)

- **`deploy-staging` red since Build 0** — needs CEO-provisioned Vercel
  secrets (`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`); also the
  job targets the preview env, an ops decision pending the same conversation.
- **Live vector-index verification skipped** (needs
  `TETHR_LIVE_DATABASE_URL`): index existence/usage on the live `rag_corpus`
  is unproven; `verify-build-3.ts` prints the exact `create index` statement
  if it turns out absent.
- Write-path model wiring (extract/abstract as Tier-1/2 calls through the
  tier runner) intentionally deferred to Build 6 onboarding, which produces
  the first real episodes.
- Reconciliation-event nonce note in `external-action.ts` still stands.
- Per-founder cost budgets (Recommendation #5) still open; bites at Build 7.

## Process notes that proved out (again)

- The adversarial review gate caught two P1-class issues this session (raw-SQL
  boundary bypass; live-DSN wipe footgun) — run it before every tag. Subagent
  quota was exhausted this session; a disciplined in-context review with an
  explicit hunt list worked as the fallback.
- pgvector cosine ties: orthogonal one-hot test vectors tie at distance 1 and
  order nondeterministically — make "second nearest" vectors actually near.
- `pg_indexes.indexdef` casing (`USING hnsw`) — regex case-insensitively.
