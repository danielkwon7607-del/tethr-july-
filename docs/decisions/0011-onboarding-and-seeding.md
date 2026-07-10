# 0011 — Onboarding & Seeding: the `@tethr/onboarding` subsystem, cold-start seeding, and the Research auto-trigger

Date: 2026-07-09 (Build 6) · Status: accepted

## Context

Build 6 builds Chapter 3: the three entry paths, §6.13 cold-start seeding, and
the §3.4 auto-trigger into Research — the product's first proof it *initiates*.
It also folds in the four items the Build 5 handoff deferred into Build 6 (CEO
direction): the write-path extractors, Tier-2 initiation compose + response-
driven reweighting, the unrecognized-inbound consumer, and shell auth.

## Decisions

1. **A new owning subsystem, `packages/onboarding`** (Constitution XII). It
   composes existing seams — it invents no product behavior and no policy. It
   owns: the three entry paths, the cold-start seed profile, the founder-
   creation orchestration, the Research trigger stub, and the auth resolver.

2. **Founder creation + seeding are ONE atomic transaction; onboarding is
   idempotent.** The `founders` table has no insert policy by design (§18.5.4,
   migration 0001) — creation *precedes* the founder scope. `runOnboarding`
   therefore opens one transaction that inserts the founder as owner, then
   `set local role tethr_app` + sets `app.founder_id`, and does every seeded
   write under that scope — so creation and seeding commit or roll back
   together (no orphaned, half-seeded founder survives a mid-onboarding
   failure; pre-tag review finding). It is the same bootstrap shape as the
   inbound resolver (ADR 0009): identity cannot be established from inside the
   scope it establishes. **Idempotent resume:** an auth-linked call first
   checks `founderIdForAuthUser` and returns the existing founder, so a retry
   (the natural response to a thrown error, or a redelivered request) never
   collides on the unique `auth_user_id` and never double-seeds. The
   `onboarding.completed` event is emitted only after the write phase commits.

2a. **The onboarding channel is created UNVERIFIED** (pre-tag security
   finding). Onboarding proves no ownership of the address, so stamping
   `verified_at` would let a caller claim someone else's number — inbound
   resolution routes strictly by `(channel_type, address)` + `verified_at`
   (§18.5.2), and a false verified row is a channel-takeover primitive the
   moment onboarding gets a public entry point. **The channel-verification
   mechanism (OTP / proven inbound) is an un-handbooked gap** owed by the entry
   boundary — inventing it here would violate Constitution I. Onboarding sets
   `verified_at` once handed proof; until then the founder's channel is
   unverified and the first outbound (which requires a verified channel)
   correctly cannot fire. This is linked to the deferred text-first flow below.

3. **The seed set is the UNION of §3.3 and the initiation reads.** §3.3 names
   families A (capacity), G (process sophistication), D (customer-contact), F
   (communication). The Build 5 policy (`registerInitiation`) consumes
   `accountability_responsiveness`, `communication_cadence`, `working_rhythm`,
   `load_burnout`. Onboarding seeds the union — `available_time`,
   `working_rhythm`, `load_burnout`, `communication_cadence`,
   `accountability_responsiveness`, `customer_contact_avoidance`,
   `process_sophistication` — so the **harness link** holds: the very first
   proactive contact reads real seeded dimensions and is conservative because a
   single **stated** observation is low-confidence by the §6.15 math (verified
   end-to-end: the recorded `confidence_gate` is >0 but <0.3, and `nudge.hard`
   never acts). No new policy logic — the existing `decideAndRecord` does the
   gating.

4. **All seeds are `stated`, low-confidence** (§3.3 "stated-heavy"): revealed
   reads accrue only once the founder acts (§6.7). The entry path itself is a
   process-sophistication signal (§3.2: none < problem < idea). Self-reports
   are optional — an absent answer takes a neutral prior rather than forcing a
   behavior-irrelevant question (§3.1).

5. **Research is auto-triggered, stubbed.** Onboarding completion emits
   `onboarding.completed` through the internal-event intake; a registered stub
   advances the company to `researching` (§3.4 "already at work") and hands off
   to `onTriggered`. We wired the **trigger**, not the pipeline — Build 7
   replaces the stub body; the trigger contract stays. The founder never asks.

6. **The deferred-into-Build-6 items, resolved as follows:**
   - **Write-path extractors** — `createModelExtractors(tierRunner, runScoped)`
     (founder-model): Tier-1 extract / Tier-2 abstract, fetching the episode
     body under RLS (events carry ids, not bodies — §18.5.6) and validating the
     model's JSON at the boundary with Zod (model output is untrusted). Tested
     against a fake TierRunner.
   - **Tier-2 compose** — `createInitiationCompose(tierRunner)` (messaging),
     the injected `compose` for `registerInitiation`, replacing the template.
   - **Response-driven reweighting** — `registerResponseLearning` (messaging):
     a **separate workflow** on the inbound event (decoupled from execution,
     §10.4), crediting the most recent acted initiation in the window since the
     founder's previous reply. Delivery is not efficacy; a reply is (§6.9).
     Double-credit is prevented structurally: the next reply's window opens at
     this reply, excluding an already-credited act. **A credit also requires a
     `sent` outbound in the window** (pre-tag review finding): `decideAndRecord`
     logs `act` *before* the send, which can fail or resolve ambiguous — an act
     that never reached the founder earns nothing. Both event ids are
     UUID-guarded (ADR 0008's class).
   - **Shell auth — the data-layer half.** Onboarding links the founder to a
     Supabase Auth user (`founders.auth_user_id`); `founderIdForAuthUser`
     resolves session → founder (service role — pre-scope, same shape as
     inbound resolution). The remaining half — the Next.js session read via
     `@supabase/ssr` cookie plumbing — is deferred (uninstalled dep, requires a
     live browser session); the shell keeps the `TETHR_DEV_FOUNDER_ID` binding
     until it lands.

## Consequences / deferred (explicit, not silent)

- **The unrecognized-inbound consumer is deferred as a Confusion-Protocol stop,
  not a budget cut.** Correlating an unknown inbound to onboarding presupposes a
  "founder texts *before* onboarding binds their channel" flow. Chapter 3 does
  not specify that flow — onboarding binds the founder's own verified channel
  directly. Building the consumer requires inventing un-handbooked product
  behavior (a candidate-address store + verification timing), which Constitution
  I forbids. It needs a handbook amendment (a text-first onboarding path) before
  code. `UNRECOGNIZED_INBOUND_EVENT` still fires (Build 5) and drops the body.
- **Live model wiring in the runner is production-placement debt** (joins the
  deploy-staging item, ADR 0009). `createInitiationCompose` and
  `createModelExtractors` are done and tested against fakes, but constructing a
  live `ModelRouter` needs a concrete `@ai-sdk/*` provider binding + keys and is
  only exercisable on a deployed line. `registerResponseLearning` (no model) IS
  wired into the runner now.
- **Shell session plumbing** (`@supabase/ssr`) deferred with the auth item.
- Response-learning credits any acted `policy_decisions` row; today only
  initiation writes there (§6.12's sole actor). Revisit if another policy
  starts recording acts.
