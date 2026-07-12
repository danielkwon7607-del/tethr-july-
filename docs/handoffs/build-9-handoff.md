# Handoff → Build 9 (Outreach + entry-surface UI + MVP completion)

*Written 2026-07-11 at the end of the Build 8 session. Build 8
(`build-8-planning-validation`) is tagged and clean; 216 tests green. Next
session: follow EXECUTION.md's Startup Sequence, then read this in full.*

## ⚠️ Build 9 is larger than a normal build — decide combined-or-split FIRST

Build 9 as scoped in ENGINEERING_OS §7 is **Outreach (Ch 14) → MVP complete**.
But two deferred items have accreted onto it, and it now really covers **three**
things:

1. **Outreach (Ch 14):** prospect identification, drafting, the
   draft→approve→send path under the partial-autonomy model (Ch 5), conversation
   tracking, and automatic follow-up as a Tier-3 sequence. Sending to a real
   person is the most-guarded action class (§5.3) — this is the first build that
   touches irreversible external contact, so `/cso` is mandatory and the
   audit-before-dispatch ledger (§18.5.7) is load-bearing.
2. **The deferred entry-surface UI (Gate 1, Build 6/7 decisions):** the
   conversation surface that asks the founder the Path questions and calls
   `runOnboarding`, plus the OTP challenge/reply UX (§3.5). See mapping below.
3. **MVP completion:** the §2.7 loop must run end-to-end without the founder
   coordinating a handoff; mark the MVP complete in the handbook.

This is more than one build's worth. **Before writing the Build 9 prompt, make an
explicit combined-or-split decision** (per the general combined-build rule).
A defensible split: 9a = Outreach (the §7 critical path + MVP-complete), 9b =
entry-surface UI + OTP UX (founder-facing shell work, a different skill set —
this is where `/plan-design-review` and the design pipeline finally trigger,
since it's the first real UI). Surface this to the CEO as the first step.

## Entry-surface UI — the mapping is already worked out (carry it, don't rediscover)

`packages/onboarding` is a data-consuming library (Constitution XII); the entry
boundary owns the conversation. The onboarding-question → `OnboardingInput` field
mapping (from `packages/onboarding/src/entry-paths.ts`):

- **Path "idea"** → `ideaText` (→ `company_state.state.ideaHypothesis`)
- **Path "problem"** → `problemText` (→ `company_state.state.problem`)
- **Path "none"** → `surfacedDirection` (→ `company_state.state.surfacedDirection`;
  when empty, Research/Planning correctly no-op until a direction is drawn out)
- **Self-report (optional, all paths)** → `selfReport`, which carries
  `availableHoursPerWeek`, `workingRhythm`, `accountabilityStyle`, and the **two
  fields with no onboarding question yet**:
  - `customerContactComfort` — seeds `customer_contact_avoidance` (the
    highest-leverage first-time-founder dimension, §1.5). Currently defaults to
    NEUTRAL when absent.
  - `activeHourOfDay` — seeds `working_rhythm`. Defaults to NEUTRAL when absent.

**Decision owed at the entry surface:** either add an onboarding question for
`customerContactComfort` and `activeHourOfDay`, or make an explicit decision to
defer them to behavioral learning (revealed observations once the founder is
active). Both are load-bearing for the intervention policy (§6.12) — don't let
them silently stay NEUTRAL forever without a decision.

## Seams Build 9 inherits (all built and tested)

- **The full loop is wired through internal events** (Build 2 intake):
  `onboarding.completed` → Research → `research.completed` → Planning →
  `plan.created` → Validation → `validation.result` → {`plan.advance` /
  `plan.replan` / `validation.pivot`→Research}. Build 9 (Outreach) hangs off the
  Validation result path — the highest-risk assumption is usually about the
  customer, so the experiment often *is* the first outreach (§13.3, Ch 14).
- **`plan.advance` and `plan.replan` have no consumer yet** (ADR 0014) — Build 8
  built the routing; the plan-side follow-through (advance the plan / regenerate
  on failure) is Build 9's to wire. `validation.pivot`→Research is fully wired.
- **Outreach tables exist** (`outreach_threads`, migration 0004) with the
  draft/awaiting_approval/sent/replied/closed status vocabulary.
- **Model/grounding/Founder-Model patterns** to copy: `packages/planning` and
  `packages/validation` are the freshest examples of a Tier-2 grounded consumer
  (TierRunner + QueryEmbedder injection, Zod-at-boundary, `runScoped`, the
  `research.test.ts`-shaped scratch-DB harness).

## Tracked debt carried forward (do not silently drop)

1. **ADR 0013 — live-source verification (Build 7).** `http-sources.ts` (xAI,
   Serper) is written against documented APIs but is **not live-call-verified** —
   tested only against fakes, same posture as the Spectrum adapter. Deploy-time
   tracked debt; carried Build 7 → 8 → 9. Not fixed in Build 8 (explicitly out of
   scope). A live source smoke is a deploy-time step.
2. **ADR 0014 — /codex was not a true cross-model check.** The codex CLI is not
   installed on this machine; the mandated independent second opinion on the
   plan-sequencing and highest-risk-selection logic ran as a fresh-context Claude
   subagent (which did surface real P1s — strict `<` ordering, the argmax
   tie-break, the axis redefinition — all fixed). A genuine different-model pass
   is still owed. Install/authenticate `codex` and re-run `/codex review` on
   `packages/planning/src/sequence.ts` and `packages/validation/src/select.ts`.
3. **ADR 0014 — B3 falsifiability is a cheap guard only.** Experiment criteria
   immutability (migration 0013) + `success_criteria ≠ failure_criteria` is v0.
   Machine-evaluable disjoint/covering criteria regions and auto-computed
   verdicts would be **new product behavior** (the handbook models criteria as
   text) — needs a handbook amendment before building. Flagged here so Build 9
   can decide with the CEO whether the MVP needs it.
4. **Prior deploy-time debt** (unchanged): `deploy-staging` red since Build 0
   (Vercel secrets, CEO); live `ModelRouter` + http-source/embedder wiring in a
   runner (Build 6/7); provider keys + `OTP_VERIFICATION_SECRET` into the boot
   config schema (§18.5.5); the migration-baseline step for the `legacy_*`
   constraint-name collisions (ADR 0010); ADR 0008/0009 debt lists.
5. **Minor (ADR 0014):** `parseModelJson` is now duplicated in four packages
   (research, founder-model, planning, validation) — extract to `@tethr/core`
   when convenient.

## Definition-of-Done status for Build 8 (for the record)

Sequenced DAG plan that re-sequences on a trigger ✓; five Action fields with a
malformed-rejection test ✓; single highest-risk assumption with criteria
immutable once a result lands ✓; Ch 7 boundary test green with `@tethr/planning`
+ `@tethr/validation` whitelisted and nothing else ✓; founder-pushback →
Founder-Model deference write tested end-to-end ✓; /codex findings triaged, P1s
fixed before tagging ✓ (subagent stand-in — see debt #2). Handbook Ch 12/13,
Decision Log, §25.3 synced ✓.
