# Handoff → Build 3 (Public Knowledge Corpus & Grounding)

*Written 2026-07-07 at the end of the Builds 1+2 session. Next session: follow
EXECUTION.md's Startup Sequence, then execute Build 3 per ENGINEERING_OS §7.*

## State you inherit

- **Milestones:** `build-0-foundation` → `build-1-data` → `build-2-orchestration`, all pushed; main green (58 tests).
- **Handbook v0.5** with Ch 18.5 (Security & Authorization) and §6.16 (privacy/deletion/export) adopted and *implemented*: forced per-table RLS (§18.5.4) and the audit-before-dispatch ledger (§18.5.7) are live in `packages/db` and enforced by tests.
- **packages/db:** the full Ch 19 schema as six paired reversible migrations; `withFounderContext` (drops privileges itself — do not bypass it); `PgActionLedger`. Integration suite needs `TETHR_DATABASE_URL` (CI provides pgvector:pg17; local scratch-cluster receipt in `packages/db/README.md` — a cluster may already be running on port 54329).
- **packages/orchestration:** three §18.2 intakes (`sendInbound` requires a dedup id), `registerScheduledScan`, `createTierRunner`, and `runExternalAction` — the ONLY sanctioned path for irreversible external actions inside workflows.

## Build 3 scope (ENGINEERING_OS §7)

Ingest the ~19k-chunk Public Knowledge corpus, embed it, and build the
grounding-retrieval path used *only* by Planning and Validation (Ch 7).
Acceptance: retrieval returns relevant chunks; **Research cannot access the
corpus — the separation is enforced, not documented**; retrieval-relevance
checks + an access-boundary test.

## Session-start facts that will save you time

- `public_knowledge_chunks` already exists (migration 0003): founder-free, HNSW cosine index, SELECT-only for `tethr_app` — ingestion must run as the service role. Embeddings are `vector(1536)`.
- The corpus source material is **not in the repo** — surfacing/locating it is the session's first Confusion-Protocol item if the CEO hasn't provided it.
- Embedding provider choice routes through `packages/model-router` conventions (no direct SDK calls; Ch 20). An embeddings capability does not exist in the router yet — adding one is in-scope architecture (Decision Log entry required).
- The Ch 7 access boundary ("Research cannot access") wants a structural seam, not a comment — e.g., grounding retrieval exported only from a module Planning/Validation own, with a test proving Research's surface has no path to it.

## Open debt (do not silently absorb)

- **CI's `deploy-staging` job is red on every push since Build 0** — the repo has no `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` secrets. Only the CEO can provision the Vercel project and add them. The `checks` job (the correctness gate) is green throughout. Do not "fix" this by skipping the job silently — it is the Build 0 staging-deploy acceptance criterion, awaiting credentials.
- Vercel "staging" deploy job actually targets the preview environment (ops decision needed, same conversation as the secrets).
- Reconciliation-event id needs an incident nonce once a reconciler that *releases* claims exists (`external-action.ts` comment).
- Live Inngest dev-server e2e deferred to the first deployed environment.
- Per-founder cost budgets (Handbook Recommendation #5) still open — bites at Build 7, worth drafting sooner.

## Process notes that proved out

- Run the fresh-context adversarial review before every tag; it caught P1s all three times this session.
- Don't trust piped `| tail` output for pass/fail — check exit codes.
