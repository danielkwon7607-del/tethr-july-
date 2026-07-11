# Handoff → Build 8 (Planning & Validation)

*Written 2026-07-10 at the end of the Build 7 session. Stopped here per the
combined-build stop clause: Build 7 is tagged and clean; Build 8 (Planning +
Validation) is a two-capability build too large to start without risking a
half-wired Research→Planning seam. Next session: follow EXECUTION.md's Startup
Sequence, then execute Build 8 per ENGINEERING_OS §7 and handbook Ch 12–13.*

## State you inherit

- **Milestones:** `build-0-foundation` → … → `build-6-onboarding` → **Gate 0**
  (commit `c6d6420`, ADR 0012) → **`build-7-research`** (commit `a9115ac`, ADR
  0013). All committed locally; **not yet pushed** (push was denied by the
  permission classifier this session — see "Push pending" below). 167 tests
  green on the scratch cluster; pre-commit hook (typecheck+lint+test) green.
- **Gate 0 shipped (ADR 0012):** OTP channel-ownership verification
  (`verify_channel_otp` security-definer, migration 0011; peppered code, challenge
  in onboarding's atomic tx, code sent post-commit) and unrecognized-inbound
  reply-and-discard (system-scoped null-founder `action_ledger` via
  `claim_system_action`, one reply per address, no stored message). Handbook
  §3.5 / §10.3 amended. Gate 1: entry-surface UI deferred to Build 9 (Decision
  Log). Gate 2: live DB + Photon creds confirmed.
- **Build 7 shipped (`packages/research`, ADR 0013):** the four-stage pipeline
  (stress-test → competitor landscape → market-signal synthesis → verdict) as
  durable steps, auto-triggered from `onboarding.completed`. Weighted synthesis
  (§11.2, disjoint demand/competition dims, `synthesis.ts`) → `strong_signal /
  weak_signal / pivot` verdict, evidence-linked. Rec #5 (cost budget
  `research_spend` + stop-and-ask back-pressure + burnout tie-in) and Rec #6
  (per-source 429 fail-fast, `research_cache` staleness TTLs, ToS) closed. Sources:
  xAI/HN/Serper + `serper_funding` (Crunchbase deferred on cost). Migration 0012.

## The seam to fill — DO NOT half-wire (brief's hard rule)

Build 7 is the PRODUCER. On a verdict it:
- writes a `verdicts` row (`verdict`, `summary`, `evidence` jsonb — migration 0004),
- advances `company_state.stage` `researching → planning` and stashes
  `{ verdictId, verdict }` in `company_state.state`,
- emits **`research.completed`** (`RESEARCH_COMPLETED_EVENT`, `packages/research`)
  with `{ founderId, verdictId, verdict }`.

**Build 8 registers the Planning workflow on `research.completed`** (§8.2 "a
verdict landing prompts Planning") — the consumer side. Either the
Research→Planning chain is tested end-to-end (emit `research.completed` → a Plan
is generated) or Build 8 does not start (brief). A `pivot` verdict must route
back into the loop (Ch 11 §11.4 / Ch 12 §12.4), not dead-end.

## Build 8 scope (ENGINEERING_OS §7 + handbook Ch 12–13)

**New owning subsystems** (Constitution XII, §6 layout): `packages/planning`,
`packages/validation` (siblings of `packages/research`). Both are Tier-2
generation **grounded in Public Knowledge** and **personalized by the Founder
Model**.

**Planning (Ch 12):**
- Generate a **Plan** as a sequenced, dependency-aware ordering of **Actions** —
  never a flat checklist (§12.1). Tables exist (migration 0004): `plans`,
  `actions` with `sequence_index` + `depends_on_action_ids`.
- All **five §12.2 Action fields are mandatory** and already NOT NULL in the
  schema: `action`, `founder_requirement`, `definition_of_done`, `estimated_time`
  (interval), `status`. Estimated time is sized against the founder's
  **available_time** read from the Founder Model (§6.9, §6.15) so the plan fits
  real capacity.
- **Grounded in Public Knowledge** via the Build 3 retrieval path
  (`packages/public-knowledge` — Planning is ONE OF THE TWO allowed consumers;
  the `access-boundary.test.ts` allowlist is `{@tethr/planning, @tethr/validation}`,
  so those package NAMES are already whitelisted — use them exactly).
- **Founder pushback** on any Action re-sequences the Plan through the
  orchestration loop (§12.4) AND is a Founder Model signal for deference/conviction
  (§6.3) — so it feeds the write path too.

**Validation (Ch 13):**
- From the current Plan + Company State, identify the **single highest-risk
  assumption** (not a set — the one whose failure most cheaply kills the idea,
  §13.1) and design an **Experiment** with the five mandatory §13.2 fields:
  `hypothesis`, `success_criteria`, `failure_criteria`, `duration`, `sample_size`
  (all NOT NULL in the `experiments` table, migration 0004). Success/failure
  criteria are set **before** the experiment runs.
- **Result-ingestion path in scope:** when results land, route them — pass →
  advances the Plan; fail → re-planning or a `pivot` routed back into Ch 11.
- The **customer-facing experiment is a STUB** here; the actual send is Build 9.

## Seams & facts that save time

- **Model/Tier pattern:** copy `packages/research` — inject a `TierRunner`
  (Tier-2 for generation), validate model JSON at the boundary with Zod (see
  `research/pipeline.ts` + `founder-model/model-extractors.ts`). Never a raw SDK.
- **Public Knowledge retrieval:** `packages/public-knowledge` exports the
  grounding path (pinned-model + dimension guards). Import it ONLY from planning/
  validation — any other package importing it fails `access-boundary.test.ts`.
- **Founder Model reads:** `available_time` for Action sizing; the pushback write
  goes through the founder-model write path (deference/conviction, §6.3). See
  `packages/founder-model` (`listTraits`, `recordObservation`, `applyCorrection`).
- **DB test harness:** copy the `research.test.ts` / `messaging.test.ts` shape —
  own scratch DB (`tethr_planning_test` etc.), `migrateUp`, `withFounderContext`,
  `describe.skipIf(!adminUrl)`. Scratch cluster:
  `postgres://tethr@127.0.0.1:54329/tethr_test`. NEVER point `TETHR_DATABASE_URL`
  at the live DB.
- **`/codex` is mandated on Build 8's plan-generation logic** (brief) — plan
  sequencing and highest-risk-assumption selection are the "seems right on first
  read, subtly wrong on second" category. Route: /office-hours → /plan-ceo-review
  → /plan-eng-review → Superpowers writing-plans + TDD; /codex as the independent
  second opinion; /review + /oracle on every diff; Ponytail throughout.
- **End-of-Session:** DoD (§9), /ship, tag `build-8-planning-validation`, /retro,
  then write the **Build 9 handoff** — flag Build 9's larger scope explicitly:
  outreach (Ch 14) + the deferred entry-surface UI (Gate 1) + MVP completion.

## Push pending (do first next session)

Gate 0 (`c6d6420`), Build 7 (`a9115ac`), and the tags `build-7-research` are
committed locally but **not pushed** — `git push origin main` was denied by the
permission classifier this session. Push `main` + `--tags` first thing (or the
user pushes), so origin is current before Build 8 work.

## Open debt (tracked, not blocking)

- `deploy-staging` red since Build 0 (Vercel secrets, CEO).
- Build 7 deploy-time wiring: live `ModelRouter` + `createHttpSources` in a runner;
  `XAI_API_KEY`/`SERPER_API_KEY` into the boot config schema (§18.5.5); a live
  source smoke; pause-vs-durable-retry hardening; budget SUM/insert atomicity
  (ADR 0013). Gate 0 deploy-time: `OTP_VERIFICATION_SECRET` into the config schema,
  a global cap on unrecognized replies, `FOR UPDATE` on the OTP challenge select
  (ADR 0012).
- First live deploy still needs the migration-baseline step for the `legacy_*`
  constraint-name collisions (ADR 0010).
- Prior ADR 0008/0009 debt lists (graph attribute drift, trait-ledger windowing,
  filtered-ANN under-fill, per-line send counter, agent-echo filtering).
