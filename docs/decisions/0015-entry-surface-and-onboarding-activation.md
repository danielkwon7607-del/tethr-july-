# 0015 — Entry surface & onboarding activation (Build 9a)

Date: 2026-07-11 (Build 9a) · Status: accepted · CEO-approved (this session)

## Context

Builds 6/7 built `packages/onboarding` as a pure data-consuming library
(Constitution XII): `runOnboarding` takes a fully-populated `OnboardingInput`
and, in one atomic tx, creates the founder, seeds Company State + the cold-start
Founder Model, creates the channel **unverified**, inserts the OTP challenge,
then post-commit sends the code and emits `onboarding.completed`. No
conversational entry surface existed — it was deferred to this build (ADR 0011,
0012 §9). Build 9a builds that surface and activates onboarding through it.

Three load-bearing ambiguities were raised as Confusion-Protocol stops and
resolved by the CEO this session.

## Decisions

1. **The entry surface is a web conversational surface, not a messaging-native
   flow.** Q1–Q8 (the verbatim Path A/A2/B/C question set) run as a chat-style
   web UI, one question at a time — not a heavy form. On completion the surface
   calls `runOnboarding`, which creates the channel and fires the OTP; the
   founder texts the code back on their channel (§3.5, verified via the existing
   `handleInbound` unverified path); messaging becomes the primary relationship
   surface thereafter (§4.1).

   *Rejected — messaging-native onboarding* (founder texts tethr's number, Q&A
   runs over that inbound channel): would require **amending §10.3** (a
   CEO-approved Gate-0 boundary) to stop discarding unrecognized inbound, and
   would store free-text founder PII (origin story, fears) bound to an
   **unverified** address *before* OTP proves ownership — the exact exposure
   §10.3 was written to prevent. The web surface is the "entry boundary" §3.5
   already names; it keeps §10.3 and §18.5.2 intact and holds no PII on an
   unproven address.

   *Rejected — hybrid verify-then-ask*: would split `runOnboarding`'s single
   atomic seed tx and block Q2+ until the founder verifies (unverified channels
   take no tethr-initiated contact); most moving parts, highest regression risk
   to Build 6 atomicity.

2. **In-progress state is keyed on an opaque server-generated session token, not
   a Supabase auth user.** Auth session plumbing (`@supabase/ssr`) is unbuilt,
   tracked deploy-time debt (the shell still binds `TETHR_DEV_FOUNDER_ID`).
   Keying resume on the authenticated user would drag unbuilt auth into scope.
   Instead a new founder-scope-free `onboarding_sessions` table (migration 0014)
   holds the draft: token, path, partial answers, current step, and timestamps.
   This is **not** a channel identity and **not** a founder row — it is
   pre-founder draft state tied to a random token the founder holds (cookie), so
   §10.3 (which governs inbound identities keyed by address) does not apply.
   `OnboardingInput.authUserId` stays optional; when real auth lands it is passed
   through, but this build does not require it.

3. **Idempotent completion lives at the session layer.** On completion the
   session row records the created `founderId` and is marked completed; a
   replayed or double-submitted completion returns the stored founder instead of
   creating a second one. This does not rely on `authUserId` (Build 6's
   `runOnboarding` idempotency path), so it works without auth.

4. **Stalled onboarding expires after 14 days.** A session not completed within
   14 days of last activity is expired and its partial PII cleared (a reversible
   scheduled sweep). Balances resume-friendliness against not holding partial
   founder PII indefinitely. Resume before expiry returns the founder to the
   exact next unanswered question.

5. **Gap A — `customerContactComfort` and `activeHourOfDay` are deferred to
   behavioral learning.** The final question copy asks neither. Both seed at
   NEUTRAL (0.5) in `seedProfile` (already the case) and are learned from
   revealed behavior once the founder is active (§6.7), consistent with §3.1 (no
   question that does not change tethr's behavior) and revealed > stated.
   `customer_contact_avoidance` is the highest-leverage dimension but is exactly
   the one §6.7 says to learn from behavior, not self-report.

6. **Gap B — `narrativeSeeds` persists in the onboarding episode content, with
   provenance.** New optional `OnboardingInput.narrativeSeeds` (`{ originStory?,
   fearedOutcome?, oneYearRegret?, statedBuilderSelf? }`) and `buildingContext?`
   (Path A2). These are free-text raw material for §6.7 stated-vs-revealed
   reconciliation, not trait estimates, so they are not `TraitSeed`s. They are
   written into the onboarding **episode** content (`episodes` — the append-only
   ground truth, §6.2) that `runOnboarding` already inserts, so they carry an
   episode id and are auditable and retrievable exactly like every other seed's
   provenance (§6.4). No new table (Constitution VII/III): the episode is the
   single source of this ground truth.

7. **Idempotent completion via `founders.onboarding_session_id`** (eng-lens,
   Constitution X). Because the CEO chose not to require auth, Build 6's
   `authUserId` idempotency guard is unavailable. `runOnboarding` gains an
   optional `onboardingSessionId`, stored on the founder row inside the creation
   tx and checked on retry exactly like `authUserId` — a double-submitted
   completion or a retry after the post-commit OTP send fails returns the
   existing founder, never a second. This closes both the concurrent-double-
   submit race and the crash-between-commit-and-record window (reconcile by
   `onboarding_session_id`). `runOnboarding` additionally catches the post-commit
   send failure and returns `{ founderId, verificationSent }` rather than
   throwing, so the entry layer (which owns the resend path per §3.5) always
   receives the founderId. The founder+seed tx atomicity is unchanged. Migration
   0014 adds the nullable-unique column. Rejected: overloading `auth_user_id`
   with a session token (pollutes a column with real-auth semantics); a session-
   status lock alone (leaves the post-commit crash window uncovered).

8. **Path C synthesis does not touch Public Knowledge** (eng-lens). §3.2's
   none-path surfaces a direction from the founder's own interests/frustrations;
   it is a Tier-2 call over the founder's answers, not a market-grounded one. Ch
   7 (Public Knowledge) is Planning/Validation-only and test-enforced (ADR 0006),
   so `packages/entry` must not import `@tethr/public-knowledge`.

9. **Path C re-entry = carryover, not a full re-ask** (implementation decision,
   confirm-overridable). §3.2's "founder picks one and continues as A or B" is
   under-specified on which questions get re-asked. Chosen: the picked candidate
   seeds the opening question (`ideaText`/`problemText`), and the hours,
   what-matters (→ one-year regret), and channel already collected in Path C
   carry over rather than being re-asked; the remaining path-specific questions
   (origin/fear/builder-self for A; problem framing for B) are asked next.
   Faithful to "re-enter the relevant question set" without double-asking. The
   CEO can override to a full re-ask or a self-contained Path C.

10. **"Email only" is unmodeled — flagged, not silently handled** (surfaced in
    build). `ChannelType` is `imessage | whatsapp | sms | rcs` (§10.2) — there
    is no email channel, and the messaging substrate cannot send email. So Q8's
    "Email only" currently behaves like "Do not reach out": the model seeds with
    no channel and no OTP, and the stated email preference is not captured
    (there is no field for it). Making email a real reach channel is a messaging-
    substrate + handbook change (§10.2) and is out of Build 9a scope; flagged for
    a CEO decision rather than invented.

11. **Path C origin preserves the process-sophistication signal** (CEO, post-review).
    Arriving via Path C — no idea at all — is itself a §3.2 process-sophistication
    signal, and it must not be lost the moment the founder picks a synthesized
    candidate and is routed into A/B. `pickCandidate` marks the re-routed state
    `originPath: "C"`; the mapping passes `originPath: "none"` into the seed input;
    and `seedProfile` starts `process_sophistication` at the midpoint between the
    resolved path's prior and the "none" prior (idea 0.55 → 0.375, problem 0.4 →
    0.3) — below the native A/B default, above the raw "none" prior (they do now
    hold an idea). No other seeded dimension changes, and native A/B founders
    (no `originPath`) are untouched. Rejected: seeding as the full resolved path
    (loses the origin signal); seeding as pure "none" (drops the idea they now
    hold, since `companyStateSeed` only stores an idea on the idea path).

## Review findings (/review + /oracle + /cso, pre-commit)

**Fixed in-review:**
- **`resend.ts` cross-founder challenge (P2).** `resendVerification` had taken the
  channel id/address from the caller; `channel_verifications` isolates on its own
  `founder_id` but not on whether the channel belongs to that founder, and
  `verify_channel_otp` resolves by `(channel_type, address)` + newest live
  challenge — a caller could have minted a challenge (code of their choosing)
  against another founder's channel. Now it resolves the founder's OWN unverified
  primary channel under RLS scope; callers cannot target another channel.
- **Completed-session PII (P3).** `markCompleted` now clears `state` (the answers
  are in the founder model + episode with provenance); `completeOnboarding`
  short-circuits an already-completed re-submit via `founders.onboarding_session_id`
  rather than re-mapping cleared state.

**Tracked (deploy-time / flagged, not fixed here):**
- The app's production DB role must be a **member of `tethr_app`** (runOnboarding
  does `set local role tethr_app`) and must be able to reach `onboarding_sessions`
  (owner/bypass, since it is service-role-only with no `tethr_app` grant). Same
  class as the existing deploy-staging role wiring.
- The onboarding cookie should set `secure` in production (HTTPS); it is
  `httpOnly`+`sameSite=lax` today.
- **Path C process-sophistication signal — RESOLVED (CEO, decision 11 below).**
  The origin is now preserved: a C founder routed into A/B is seeded below the
  native A/B default on that one dimension.
- **/oracle** ran as a Claude adversarial self-review. The Build 8 handoff said
  the codex CLI was absent; a pre-commit diagnostic found it **present**
  (`codex-cli 0.144.1`) — carried to the Build 9b handoff, where a true
  cross-model pass is mandated.

## Consequences

- New owning subsystem `packages/entry` (Constitution XII): the verbatim question
  set as data, the per-path state machine (incl. the A→A2 branch and Path C
  candidate-surfacing → re-entry-as-A-or-B), session persistence, answer →
  `OnboardingInput` field mapping, and completion into `runOnboarding`. Pure and
  DB-tested, independent of Next.js, so the four path integration tests run
  against the package, not the browser.
- New migration 0014 `onboarding_sessions` (reversible, no founder scope — it is
  pre-founder), with a scheduled 14-day expiry sweep.
- `OnboardingInput` gains `narrativeSeeds?` and `buildingContext?`;
  `runOnboarding` writes them into the onboarding episode content.
- The OTP resend/re-challenge path owed by ADR 0012 §9 is built here (a
  locked-out or code-not-received founder can request a fresh challenge).
- Path C candidate surfacing is a Tier-2 grounded model call (injected runner,
  faked in tests — same posture as planning/validation), synthesizing 3–5
  candidates from the founder's answers; the founder picks one and re-enters as
  Path A or B.
- apps/web gains a thin conversational onboarding route over `packages/entry`
  plus a minimal onboarding-status view (the first real UI — `/plan-design-review`
  and the design pipeline apply here).
