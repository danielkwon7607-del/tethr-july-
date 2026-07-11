# 0012 — Channel-ownership verification (OTP) & unrecognized-inbound reply-and-discard

Date: 2026-07-10 (Gate 0, pre-Build-7) · Status: accepted · CEO-approved

## Context

Build 6 (ADR 0011) left two un-handbooked gaps, flagged as Confusion-Protocol
stops rather than budget cuts:

- **§2a — channel verification.** Onboarding creates the founder's channel
  **unverified** (it proves no ownership of the address; a false `verified_at`
  is a channel-takeover primitive since inbound routes by `(channel_type,
  address)` + `verified_at`, §18.5.2). The verification mechanism was undecided.
- **The unrecognized-inbound consumer.** `UNRECOGNIZED_INBOUND_EVENT` fired and
  dropped the body; what to *do* with an inbound from an unknown address was
  unspecified (building the old "text-before-onboarding linkage" reading would
  have invented un-handbooked behavior).

The CEO approved closing both as handbook amendments (§3.5, §10.3) plus
implementation. This ADR records the architecture.

## Decisions

1. **OTP verification is a security-definer mutation** (`verify_channel_otp`,
   migration 0011) — the same enumerated §18.5.4 pre-identification exception
   class as `resolve_channel_identity`, here mutating. Verification happens
   *before* the channel is bound to a founder context, so a forced-RLS scoped
   query cannot bootstrap the `verified_at` stamp; §18.5.1 ("enforcement at the
   lowest layer that can hold it, database not app code") points to a definer
   function over app-layer service-role. It resolves the unverified identity,
   finds the newest live challenge, and — only on a hash match — atomically
   stamps `channel_identities.verified_at` and consumes the challenge; a miss
   increments `attempts`. Rejected: app-layer verify in the runner (moves the
   privileged mutation into app code, against §18.5.1).

2. **The code is HMAC-peppered; only the hash is stored.** `code_hash =
   HMAC-SHA256(secret, channel_identity_id || ':' || code)` (`packages/messaging/
   src/otp.ts`). The pepper is a server secret (§18.5.5), so a store leak alone
   cannot brute a 6-digit code; binding to the identity stops a hash minted for
   one channel being replayed against another. Plaintext is generated in memory,
   sent, and never persisted — not in the challenge row, not in the audit row
   (the `channel.verify-send` key carries no code), not in any event. Rejected:
   per-challenge salt (the app would need a DB round-trip to hash on verify);
   passing plaintext to SQL (exposure in statement logs).

3. **Brute-force controls: 5-attempt cap + 10-minute expiry.** A 10⁶ code space
   with ≤5 tries per short-lived challenge makes online guessing negligible; the
   cap is the real control, not the hash. The attempt cap (`< 5`) is duplicated
   between the SQL function and `OTP_MAX_ATTEMPTS`; the SQL is authoritative.

4. **Challenge lifecycle: in-tx, post-commit send (Option A).** The challenge
   hash row is INSERTed inside Build 6's atomic founder+channel+seeds tx, so a
   committed unverified channel always carries its challenge. The code is sent
   after commit (no external dispatch under an open transaction), through
   `runIrreversible` on a per-founder ledger, idempotent on the identity so a
   retry cannot re-send. Rejected: post-commit event-triggered challenge (looser
   coupling but the challenge is not atomic with the channel — the brief asked
   for the atomic reading).

5. **The OTP send is the one sanctioned exception to "unverified = no
   outbound."** `sendVerificationCode` is a distinct path from
   `sendFounderMessage` (which selects the verified primary), targeting exactly
   the identity being verified. The guard is bypassed structurally and only for
   the code.

6. **Unrecognized-inbound = reply-and-discard.** An inbound from an address with
   no matching `channel_identity` (`kind: unknown`) gets one onboarding-link
   reply and is discarded: no `messages` row, no phantom founder, no candidate-
   identity store. Onboarding is the entry point (Ch 3); storing speculative
   pre-onboarding identities is the privacy/identity-collision exposure the
   handbook doesn't sanction.

7. **The founderless reply reuses the one audit ledger via definers.** The reply
   is pre-identification (no founder), so it cannot carry a `founder_id`, but
   §18.5.7 still binds it. `claim_system_action` / `record_system_action_outcome`
   (migration 0011, security-definer) write null-founder `action_ledger` rows
   against a dedicated partial unique index (`action_ledger_system_claim` over
   `(action_type, idempotency_key) where founder_id is null`) — NULLs are
   distinct in the existing claim index, so a dedicated index is required for
   "one reply per key." Idempotency key is the address hash → one reply per
   address. Rejected: a parallel `onboarding_reply_log` table (a second audit
   store, against Constitution VII).

8. **The reply is sent inline from `handleInbound`, not via the event.**
   Replying needs the raw address, but ADR 0009 deliberately put only a *hash* in
   `UNRECOGNIZED_INBOUND_EVENT` (§18.5.6 minimization). Replying inline keeps the
   raw address in-process (never in a queue payload) — more aligned with §18.5.6
   than reversing that minimization. No workflow step is available there, so the
   ledger claim is the sole double-send guard (ADR 0009's "ledger-only" posture).

9. **The Build 5 conflation is corrected.** `kind: unverified` (a known channel
   awaiting OTP) no longer emits `UNRECOGNIZED_INBOUND_EVENT`; it attempts OTP
   and drops. "Unrecognized" now means `kind: unknown` (no matching channel)
   only. The Build 5 isolation test's assertion was updated to match (documented
   in the test).

## Security review (/cso, 2026-07-10)

Scoped to the Gate 0 diff. No CRITICAL/HIGH verified findings (8/10 gate).
Traced and cleared: brute-force (cap+expiry+space), replay (single-use +
identity-bound hash), plaintext (ephemeral, not persisted/audited/evented),
search_path hijack (all definers `set search_path = public`), function privilege
(`revoke all from public; grant execute to tethr_app`), the unverified→founder-
context invariant, idempotency, and the null-founder ledger scope.

**Tracked pre-production hardening (below the report gate):**
- Add `OTP_VERIFICATION_SECRET` to the boot-time config schema with fail-fast
  validation (§18.5.5) before wiring the OTP path to a deployed line. The path
  only activates when `deps.otp` is supplied, so this is a pre-prod requirement.
- A global rate-limit / daily cap on unrecognized-sender replies (cost/abuse;
  the per-address cap already exists). Depends on the signature-authenticated
  inbound stream (§18.5.2, Spectrum boundary, ADR 0009). Joins the per-address
  inbound rate-limiting debt in the Build 7 handoff.
- `FOR UPDATE` on the challenge select in `verify_channel_otp` to make the
  attempt-counter increment race-proof (benign today given cap+space).

## Consequences

- New founder-scoped table `channel_verifications` (forced RLS, per-table tested)
  and three security-definer functions, all reversible (migration 0011 down).
- Onboarding gains optional `otp`/`port`/`runScoped` deps; absent in unit
  contexts (Build 6 behavior preserved), supplied together in production.
- No resend/re-challenge path yet — a locked-out founder (5 wrong) needs a new
  challenge, which the entry-surface UI (Build 9, Gate 1) will drive.
