# Handoff → Build 9b (Outreach + MVP completion)

*Written 2026-07-12 at the end of the Build 9a session. Build 9a
(`build-9a-entry-surface`, commit `813b1a0`) is committed and tagged; 249 tests
green on a local pgvector cluster. Next session: follow EXECUTION.md's Startup
Sequence, then read this in full.*

## What Build 9a shipped (the entry surface — Gate 1, closed)

`packages/entry` — the web conversational surface that gathers a founder's
onboarding answers and drives `packages/onboarding`'s atomic seed (Constitution
XII: onboarding is the seed library, entry owns the conversation).

- **All four paths + branches, integration-verified:** A, A2 (via the stage
  branch), B (with the personal-moment origin story), C (Tier-2 candidate
  synthesis → pick → carryover re-entry as A or B, both directions).
- **Session persistence:** token-keyed drafts (migration 0014 `onboarding_sessions`,
  pre-founder / service-role only), resume at the next unanswered question,
  14-day expiry sweep, PII cleared on completion.
- **Idempotent completion** without auth via `founders.onboarding_session_id`
  (ADR 0015 §7). `runOnboarding` now persists `narrativeSeeds`/`buildingContext`
  into the onboarding episode with provenance, returns `verificationSent`, and
  supports a no-channel founder ("do not reach out" / "email only").
- **OTP:** challenge fires on completion; re-challenge/**resend** path built
  (ADR 0012 §9), resolving the founder's own channel (review /cso fix).
- **apps/web `/start`:** conversational surface + status view, builds clean.

Decisions in **ADR 0015** (11 of them): web surface over messaging-native
(§10.3 intact), Gap A deferred to behavioral learning, Path C carryover
re-entry, Path C origin preserves the §3.2 process-sophistication signal, plus
the two /cso fixes. Handbook Ch 3 §3.6 + §25.3 synced.

## ⚠️ Codex diagnostic (for 9b's mandated cross-model checks)

The Build 8 handoff said the codex CLI was absent. A read-only diagnostic this
session found it **present**:

```
which codex      → /Users/niranjandeshpande/.nvm/versions/node/v22.22.3/bin/codex
codex --version  → codex-cli 0.144.1
```

So Build 9b's mandated `/codex`/`/oracle` cross-model review CAN run for real
(no longer the ADR 0014 stand-in). 9a's /oracle ran as a Claude adversarial
self-review only, because the work was already done before the diagnostic — a
retroactive codex pass on `packages/entry` is cheap and worth doing early in 9b.

## Running the integration tests (important — env is fiddly)

The integration suites need a **superuser** Postgres (they `set role tethr_app`
and drop/recreate `public`). The Supabase scratch DB in `apps/web/.env`
(`TETHR_DATABASE_URL`) is **not** usable for them: its `postgres` role is
non-superuser and cannot `SET ROLE tethr_app`, and its direct host is IPv6-only.
The migrations' DDL applies fine over the Supabase **pooler**, but the RLS/role
tests do not. See the `tethr-db-connection` memory for the exact pooler string.

This session ran them against a **local PG 17 + pgvector cluster** (superuser),
which works cleanly and fast:

```bash
export PGDATA="$CLAUDE_JOB_DIR/tmp/pgdata"   # or any scratch dir
initdb -D "$PGDATA" -U postgres --auth=trust
pg_ctl -D "$PGDATA" -o "-p 5433 -k $PGDATA -c listen_addresses=127.0.0.1" -w start
psql postgresql://postgres@127.0.0.1:5433/postgres -c "create extension if not exists vector"
export TETHR_DATABASE_URL="postgresql://postgres@127.0.0.1:5433/postgres"
npx vitest run --testTimeout=90000 --hookTimeout=120000
```

`entry.integration.test.ts` grants `tethr_app to current_user` in setup, which
documents a **production requirement** (below).

## Build 9b scope (the original Build 9 §7 critical path)

Per the Build 9 handoff's split, 9a was the entry surface; **9b = Outreach (Ch
14) + MVP completion**:

1. **Outreach (Ch 14):** prospect identification, drafting, the
   draft→approve→send path under partial autonomy (Ch 5), conversation tracking,
   automatic follow-up as a Tier-3 sequence. Sending to a real person is the
   most-guarded action class (§5.3) — **`/cso` mandatory**, the audit-before-
   dispatch ledger (§18.5.7) load-bearing. `outreach_threads` (migration 0004)
   already exists. Outreach hangs off the Validation result path (§13.3).
2. **`plan.advance` / `plan.replan` consumers (ADR 0014):** Build 8 built the
   routing; the plan-side follow-through (advance / regenerate on failure) is
   still unbuilt. `validation.pivot`→Research is already wired.
3. **MVP completion:** the §2.7 loop runs end-to-end without the founder
   coordinating a handoff; mark the MVP complete in the handbook.

## Deploy-time debt carried into 9b (documented, do not silently drop)

1. **Entry-surface live wiring:** `apps/web/app/start/actions.ts` completes
   onboarding with a fresh `InMemoryWorkflowEngine` and no OTP — so in dev the
   seed happens but the code isn't sent and Research isn't cross-process. Swap in
   the real Inngest engine + Photon port + `OTP_VERIFICATION_SECRET` (§18.5.5,
   already tracked). Path C's candidate model (`surfaceCandidates`) throws until
   a Tier-2 model is wired (no Public Knowledge — Ch 7 boundary).
2. **Production DB role (real requirement):** the deployed app's DB role must be
   a **member of `tethr_app`** (runOnboarding does `set local role tethr_app`)
   and must reach `onboarding_sessions` (owner/bypass, service-role-only, no
   `tethr_app` grant). Joins the deploy-staging role wiring.
3. **Cookie `secure` flag** in production (HTTPS); httpOnly+sameSite=lax today.
4. **"Email only" is unmodeled** (ADR 0015 §10): `ChannelType` has no email, so
   it currently behaves like "do not reach out". A CEO decision on whether email
   becomes a real reach channel (§10.2 + messaging-substrate change).
5. **Prior deploy-time debt (unchanged):** ADR 0013 live-source verification;
   `deploy-staging` red since Build 0 (Vercel secrets); provider keys into the
   boot config; migration-baseline for `legacy_*` constraint collisions (ADR
   0010); `parseModelJson` duplicated in four packages (now five with none in
   entry — entry has no model call yet).
6. **Pre-existing biome warnings** (surfaced by the commit hook, not 9a's):
   `planning.test.ts` unused `entryDeps`; three `research/*` unused imports;
   a shell-CSS descending-specificity warning. Trivially fixable when touched.

## Definition-of-Done status for Build 9a (for the record)

Four paths + branches through conversational exchanges → fully-seeded Founder
Model incl. `narrativeSeeds` provenance ✓; A→A2 and Path-C candidate→re-entry ✓;
resume ✓; OTP challenge fires + verify round-trip + resend ✓; idempotent
completion ✓; "do not reach out" no-channel ✓; unrecognized-inbound during
in-progress onboarding handled by existing §10.3 (no channel until completion) ✓.
Tests: one integration per path (A/A2/B/C) + Path-C re-entry (both dirs) +
resume + OTP-gate + resend + narrativeSeeds-provenance + do-not-reach-out +
idempotency + the Path-C origin-signal test = 10 entry integration + 21 entry
unit + the seedProfile unit test; full suite 249 green. /review + /cso run,
two findings fixed; /oracle Claude-only (codex now available for 9b). ADR 0015,
Handbook Ch 3 §3.6 + §25.3 synced.
