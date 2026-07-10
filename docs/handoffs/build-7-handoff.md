# Handoff → Build 7 (Research Pipeline)

*Written 2026-07-09 at the end of the Build 6 session. Next session: follow
EXECUTION.md's Startup Sequence, then execute Build 7 per ENGINEERING_OS §7 and
handbook Chapter 11.*

## State you inherit

- **Milestones:** `build-0-foundation` → … → `build-5-messaging` →
  `build-6-onboarding`, all pushed; 140 tests green locally on the scratch
  cluster; CI `checks` green, `deploy-staging` still red (Build 0 debt).
- **G2/G3 closed (ADR 0010).** Live DB password reset; the working DSN is the
  IPv4 session pooler (`aws-1-us-east-1.pooler.supabase.com:5432`). `rag_corpus`
  index verified live; the 18 prototype tables are `legacy_`-quarantined.
- **Build 6 (`packages/onboarding`, ADR 0011):** three entry paths + §6.13
  cold-start seeding (stated, low-confidence, on the union of §3.3's dimensions
  and the four `registerInitiation` reads), the §3.4 Research auto-trigger via
  `onboarding.completed` → `registerResearchEntryStub` (advances the company to
  `researching`; **this is where Build 7's pipeline lands**). Folded-in extras,
  all tested against fakes: `createModelExtractors` (founder-model, Tier-1/2 +
  Zod), `createInitiationCompose` (messaging, Tier-2), `registerResponseLearning`
  (messaging, a decoupled workflow on the inbound event), and shell-auth's
  data-layer half (`founders.auth_user_id` + `founderIdForAuthUser`).

## Build 7 scope (ENGINEERING_OS §7 + handbook Ch 11)

Live signal → verdict. Typed source integration (xAI X Search primary; HN,
Serper, Crunchbase supporting) within provider budgets; weighted synthesis
(sources are synthesized, not averaged — §11.2, Decision Log); the four-stage
pipeline; the `strong/weak/pivot` verdict with evidence links (§11.4). Depends
on Build 2 (orchestration) and Build 6 (onboarding's seeded Company State).

**The seam to fill:** `registerResearchEntryStub` (packages/onboarding) is the
stubbed entry point — replace its body with the real pipeline (keep the trigger
contract: it fires on `onboarding.completed`, no user prompt). The verdict it
produces should write a `verdicts` row (migration 0004 already has the table:
`verdict ∈ {strong_signal, weak_signal, pivot}`, evidence jsonb) and advance
Company State — the shell already renders the latest verdict.

## Deferred from Build 6 (do not re-defer silently — pick these up deliberately)

- **Channel-ownership verification is an un-handbooked gap** (raised by the
  Build 6 security gate, ADR 0011 §2a). Onboarding now creates the founder's
  channel **unverified** — it proves no ownership of the address, and a false
  `verified_at` is a channel-takeover primitive (inbound routes by
  `(channel_type, address)` + `verified_at`, §18.5.2). The verification
  mechanism (OTP challenge, or treating a proven inbound as the proof) is not
  specified in Chapter 3/10 and must be **decided with the CEO** before the
  onboarding entry point (HTTP route / shell) goes live — otherwise a
  freshly-onboarded founder has an unverified channel and cannot be contacted,
  and can't be recognized on inbound. This is the same product decision as the
  text-first flow below (a proven inbound IS a verification signal).
- **The `messaging.unrecognized-inbound` consumer** is a **Confusion-Protocol
  stop, not a budget cut** (ADR 0011): it presupposes a founder texting the
  tethr number *before* onboarding binds their channel. Chapter 3 specifies no
  such flow — onboarding binds the founder's own (now unverified) channel
  directly. Building the consumer needs a handbook amendment first (a
  text-before-onboarding path + a candidate-address store + verification
  timing) — and it dovetails with the channel-verification gap above. Raise
  both with the CEO before writing code (Constitution I). The event still fires
  (Build 5) and drops the body.
- **Live model-router wiring in `scripts/messaging-runner.ts`** (production
  placement, joins deploy-staging): `createInitiationCompose` and
  `createModelExtractors` are done and tested against fakes, but a live
  `ModelRouter` needs a concrete `@ai-sdk/*` provider binding + keys and is only
  exercisable on a deployed line. `registerResponseLearning` (no model) IS wired
  in the runner. The write-path itself (`registerFounderModelWritePath`) is also
  not yet registered in the runner — wire it with the model extractors when the
  router lands, so onboarding's episodes actually flow extract→abstract in prod.
- **Shell session plumbing** (`@supabase/ssr` cookie read → `founderIdForAuthUser`
  in `apps/web/lib/data.ts`), replacing the `TETHR_DEV_FOUNDER_ID` binding. The
  resolver and the linkage are done; only the Next.js session read remains.

## Session-start facts that save time

- Scratch cluster: `postgres://tethr@127.0.0.1:54329/tethr_test` (receipt in
  `packages/db/README.md`). NEVER point `TETHR_DATABASE_URL` at the live DB.
- Bundle scripts with esbuild `--external:postgres`, NOT `--packages=external`
  (that externalizes the workspace `@tethr/*` symlinks and Node then fails on
  their extensionless TS imports — cost a debugging loop this session).
- The §6.15 policy math: a single `stated` observation → confidence ~0.18, which
  is why cold-start policy is conservative. Build 7's verdicts will start
  producing revealed reads once the founder acts on a plan.
- Research must NOT touch Public Knowledge (`rag_corpus`) — the Ch 7 boundary is
  test-enforced (ADR 0006); grounding is Planning/Validation only. Research
  needs *live* signal.
- Provider quotas/caching/ToS for the research sources were flagged as an open
  decision "before the research build" (Ch 23) — resolve it in Build 7's design.

## Open debt (tracked, not blocking)

- `deploy-staging` red since Build 0 (Vercel secrets, CEO).
- First live deploy needs a migration-baseline step (ADR 0010): the `legacy_*`
  tables keep unprefixed constraint names (`founders_pkey`-class) that our
  migration 0001 will collide with.
- Per-address inbound rate limiting; per-line send counter; agent-echo filtering
  on a real line (ADR 0009 debt list) — before production traffic.
- ADR 0008/0009 debt lists (graph attribute drift, trait-ledger windowing,
  filtered-ANN under-fill, `readSide` stale-revealed nuance).
- response-learning credits any acted `policy_decisions` row; today only
  initiation writes there. Revisit if another policy records acts (ADR 0011).
