# Build 9a — Entry-Surface UI & Onboarding Activation (Plan)

*Branch `build-9a-entry-surface`. Governed by ADR 0015 (CEO-approved). Tag on
done: `build-9a-entry-surface`. Ponytail throughout — build exactly the four
paths, not a configurable question engine.*

## Objective (tied to acceptance criteria)

A founder completes each of Paths A, A2, B, C entirely through a turn-based
conversational surface and lands in a fully-seeded Founder Model (including
`narrativeSeeds`) with a verified channel. The A→A2 branch and Path C's
candidate-surfacing → re-entry-as-A-or-B both work end to end. An incomplete
onboarding resumes without re-answering. The OTP challenge fires and blocks
contact until verified. Unrecognized inbound during an in-progress onboarding is
handled correctly (it is not on the founder's channel — the web surface owns the
draft; the messaging runtime's §10.3 reply-and-discard is unchanged).

## Architecture (per ADR 0015)

- **`packages/entry`** — new owning subsystem. The conversation, not the seed.
  - `questions.ts` — the verbatim Q1–Q8 set for A/A2/B/C as data (copy is final,
    never rewritten). Tap options carry their enum/banded target values.
  - `machine.ts` — pure state machine: `(path, answers) → nextQuestion | complete`.
    Encodes the A→A2 branch (Path A Q4 "already building" → Path A2) and Path C's
    Q1–Q4/Q6 → candidate synthesis → founder pick → re-enter as A or B.
  - `mapping.ts` — pure `answers → OnboardingInput` (free-text → annotated
    fields; taps → enum/banded values; `narrativeSeeds`, `buildingContext`).
  - `session.ts` — `onboarding_sessions` persistence: create/load/append-answer/
    complete, keyed by opaque token; 14-day TTL; idempotent completion stores
    `founderId`.
  - `candidates.ts` — Path C Tier-2 synthesis (injected TierRunner), 3–5
    candidates from the founder's OWN answers. **No Public Knowledge** — Ch 7 is
    Planning/Validation-only, test-enforced (ADR 0006); entry must not import
    `@tethr/public-knowledge`.
  - `resend.ts` — OTP re-challenge (ADR 0012 §9): mint a fresh challenge + send,
    idempotency-guarded.
  - `run.ts` — completion orchestrator: map answers → `OnboardingInput` → call
    `runOnboarding` with `{otp, port, runScoped}` wired → record `founderId` on
    the session.
  - `index.ts` — public API.
- **migration 0014** `onboarding_sessions` (reversible, pre-founder / no RLS
  scope — there is no `founder_id` to scope by yet; access is via the package's
  service-role boundary only, mirroring ADR 0012's pre-identification pattern).
  Columns: `id uuid pk`, `token text unique` (CSPRNG ≥128-bit), `path`,
  `answers jsonb`, `current_step`, `founder_id uuid null`, `completed_at`,
  `created_at`, `updated_at`, `expires_at`. Plus a reversible scheduled sweep.
  **Same migration** adds `founders.onboarding_session_id uuid unique null`.
- **Idempotent completion (eng-lens, Constitution X).** `runOnboarding` gains an
  optional `onboardingSessionId`; when present it is stored on the founder row
  in the creation tx and checked on retry exactly like `authUserId` today — a
  double-submit or post-commit-send-failure retry returns the existing founder,
  never a second. `runOnboarding` also **catches** the post-commit OTP-send
  failure and returns `{ founderId, verificationSent }` instead of throwing, so
  the entry layer (which owns resend) always gets the founderId. Atomicity of
  the founder+seed tx is unchanged.
- **`OnboardingInput`** gains `narrativeSeeds?` and `buildingContext?`;
  `runOnboarding` writes them into the onboarding episode content (provenance).
- **apps/web** — thin conversational onboarding route (`/start`) rendering
  `packages/entry`'s API via server actions/route handlers, plus a minimal
  onboarding-status view. Design pipeline applies here.

## Build ordering (hard commitment — founder-lens finding)

Build and test in this order so budget exhaustion leaves the higher-traffic
paths complete and Path C is the clean handoff boundary:
**migration + OnboardingInput fields → mapping/machine (pure) → Path A →
resume/session → OTP-gate + resend → Path B → Path A2 → Path C (synthesis +
re-entry) → web UI**. Path C is last because its Tier-2 synthesis + re-entry
loop is the most complex slice and carries the only live-model dependency.

## State machine (explicit, not configurable)

- Path A: Q1(idea)→Q2(origin)→Q3(fear tap)→Q4(stage tap). Q4 "already building"
  branches to Path A2; else Q5(hours tap)→Q6(regret)→Q7(builder-self)→Q8(channel).
- Path A2 (from A Q4): Q1(what built)→Q2(who uses)→Q3(response)→Q4(stuck)→
  Q5(hours)→Q6(fear tap)→Q7(channel).
- Path B: Q1(problem)→Q2(lived/watched tap; "personally"/"both" → origin-story
  branch)→Q3(underserved)→Q4(existing/opening)→Q5(hours)→Q6(regret)→Q7(channel).
- Path C: Q1–Q4(+Q6) → candidate synthesis (3–5) → founder picks one → re-enter
  as Path A or B at the appropriate question set; Q5(hours) and Q7(channel) as A.
- Q8/Q7 channel: `Do not reach out` is a valid terminal channel choice — still
  seeds the model; no channel/OTP created (nothing to verify). iMessage/WhatsApp
  require a phone number; SMS/Email use the address.

## Field mapping (exact)

- Free text: A Q1→`ideaText`; A Q2→`narrativeSeeds.originStory`;
  A Q6→`narrativeSeeds.oneYearRegret`; A Q7→`narrativeSeeds.statedBuilderSelf`;
  A2 Q1→`buildingContext` (extends idea context); A2 Q2/Q3/Q4→`buildingContext`
  (structured); B Q1→`problemText`; B Q2-branch→`narrativeSeeds.originStory`;
  B Q3/Q4→support `problemText`; B Q6→`narrativeSeeds.oneYearRegret`;
  C Q1-Q4→candidate synthesis inputs; C Q6→`narrativeSeeds.oneYearRegret`.
- Taps: A Q3 / A2 Q6 → `narrativeSeeds.fearedOutcome` (the chosen option text);
  A Q4 → `company_state` stage / A2 branch; Q5 hours → `selfReport
  .availableHoursPerWeek` (banded: full-time→ e.g. 10h, school→15h, uncertainty
  →20h, all-in→40h — banded constants, documented); Q8 → `channel`.
- `customerContactComfort`, `activeHourOfDay`: omitted → NEUTRAL (Gap A).

## OTP integration (verified signatures — do not assume)

- Completion passes `{otp, port, runScoped}` to `runOnboarding` (already wired);
  the challenge is inserted in-tx and the code sent post-commit.
- Verification is inbound on the channel via existing `handleInbound`
  (`resolved.kind === "unverified"` → `verifyChannelOtp`). The surface polls
  `channel_identities.verified_at` and blocks "contact-ready" until stamped.
- Resend/re-challenge (`resend.ts`): `createVerificationChallenge` + insert +
  `sendVerificationCode`, idempotency-keyed so a retry cannot double-send.
- `/cso` on all OTP touchpoints specifically.

## Testing (TDD — red first). Required set:

1. Path A integration → seeded Founder Model + narrativeSeeds + channel+challenge.
2. Path A2 integration (via A→A2 branch).
3. Path B integration (incl. personal-branch origin story).
4. Path C integration (synthesis → pick → re-enter).
5. Path C re-entry-as-A-or-B (both directions).
6. State-persistence/resume: go quiet mid-flow, resume at next question, no re-ask.
7. OTP-gate: challenge fires, contact blocked until verified; resend path.
8. `narrativeSeeds` provenance: persisted in the onboarding episode, linked to
   the episode id, not discarded.
   Plus: unit tests for `machine`/`mapping` branch logic; `runOnboarding`
   atomicity still holds with real conversational input (extend Build 6 test).
9. `"Do not reach out"` channel: onboarding completes + seeds correctly, creates
   NO channel and fires NO OTP, Research still auto-fires (founder-lens finding).

## Risks

- **runOnboarding atomicity regression** (Constitution X) — the episode-content
  change touches the tx; re-verify the atomic-all-or-nothing test.
- **Path C model call** — Tier-2 boundary; faked in tests, live wiring is
  deploy-time debt (carry the ADR 0013 posture, do not block on live calls).
- **Session PII** — draft answers are founder PII pre-verification; 14-day sweep
  + the token is the only handle; no founder scope means access is package-only.
- **§10.3 untouched** — confirm the messaging runtime is not modified; the entry
  surface owns the draft, inbound reply-and-discard is unchanged.

## Definition of Done (ENGINEERING_OS §9)

Acceptance criteria met; 8+ tests green; Ponytail pass; `/review` + `/oracle`
per diff; `/cso` on OTP; Handbook Ch 3 synced with the resume policy + the
`narrativeSeeds` field; Decision Log = ADR 0015; §25.3 roadmap updated; migration
0014 reversible; clean tree; `/ship` commit; tag `build-9a-entry-surface`;
`/retro`; written next-step handoff. If context runs low before all four paths +
branches are tested, stop, do not tag, write a clean handoff naming which paths
are done.
