# 0009 — Messaging substrate: vendor-fallback correction, RLS exceptions, the untrusted-input envelope, and policy-driven initiation

Date: 2026-07-09 (Build 5) · Status: accepted

## Context

Build 5 wires the founder-facing surface: Photon Spectrum over its gRPC
stream, §19.4 identity resolution, ordered/deduped threads, §18.5.7-ledgered
sends, the §6.12-driven outbound initiation, and the thin Next.js shell. The
full design (3× adversarially reviewed, 9/10) lives in the session design doc;
this ADR records the durable architectural decisions.

## Decisions

1. **SMS/RCS fallback is tethr's routing decision, not Photon's.** Research
   against current vendor docs and the published SDK contradicted the
   handbook's "automatic SMS/RCS fallback" claim: Spectrum exposes service
   *detection* (`addresses.get`/`isIMessageAvailable`); nobody falls back for
   you. `sendFounderMessage` selects the primary verified identity, then the
   remaining channels in fixed preference order (iMessage → WhatsApp →
   SMS/RCS) excluding primary. A sibling identity on an already-verified
   address (same number, different channel) is auto-created inheriting
   `verified_at` — the **verification-inheritance rule**. Founder-visible
   behavior (one thread, automatic degradation) is unchanged; §10.2/Ch 18/
   Ch 21 amended to state who implements it.
2. **Two enumerated §18.5.4 RLS exceptions, both Build 5.** (a) Inbound
   resolution is pre-identification — a forced-RLS scoped query cannot
   bootstrap itself — so migration 0010 ships `resolve_channel_identity`, a
   narrow `security definer` function returning only (founder, identity id,
   verified) for exactly one (channel_type, address). (b) The
   delivery-reconciliation scan sweeps `action_ledger` cross-founder under
   service role for stale `pending` claims of `message.send` — the artifact
   that actually survives a workflow that died mid-send — and re-emits the
   reconciliation event with `runExternalAction`'s exact id format so
   incidents never double-ask.
3. **Inbound content is enveloped before any model tier sees it** (§18.5.6
   amended to record the CEO-directed rule): `EnvelopedContent` is a branded
   type only `envelopeInbound` can produce; embedded envelope markers are
   neutralized; event payloads carry ids, never bodies (founder content stays
   in the database, not in the workflow vendor's queue).
4. **The double-send guarantee rests on the ledger claim alone.** Inspection
   of `@spectrum-ts/core@9` showed the high-level `Space.send` has no
   `clientGuid` (transport dedup is an advanced-kit concept). Claim-before-
   dispatch already prevents re-dispatch; `ChannelPort.send` still carries
   the key for adapters that can forward it. Channel selection runs BEFORE
   the claim so flaky service detection can never masquerade as an ambiguous
   send; the thread row is its own durable step keyed to the same idempotency
   key (`sent` on executed, `pending` on needs-reconciliation); `failed`,
   `delivered`, `read` are dormant vocabulary until receipts are verified on
   a real line — the ledger's failure row is the failure record.
5. **One dedicated line per founder** (the §10.2 model). Photon's 50-new-
   conversations/line/day cap binds per founder; policy pacing keeps normal
   operation far under it. Tracked debt: a hard per-line counter before any
   shared-line configuration exists.
6. **Initiation wires the existing policy; it owns no scoring.**
   `registerInitiation` maps dimension reads to candidates by §6.12's own
   sentences — hard-nudge fit scales with *accountability responsiveness*,
   every contact candidate is dialed by *communication cadence*, timing
   sleeps to the *working rhythm* window when that read clears confidence
   0.5, and the *load & burnout* read rides into `decideAndRecord`'s veto —
   then acts on the decision via the ledgered send. "Ask" means hold: no
   contact is the conservative act. Deferred to Build 6 (with the write-path
   extractors): Tier-2 message composition through the tier runner (template
   compose today) and outcome-based `reweightPolicy` from founder responses
   (delivery is not efficacy).
7. **Cadence adjustments are ordinary calibration writes** (§4.5): an
   explicit directive about tethr's behavior ("ease off this week") is a
   `correction` (w=1.0, enough to move pacing); an offhand busy-mention is
   `stated` (w=0.4, deliberately too weak alone). Tier-1 parser injected;
   deterministic in tests.
8. **Unrecognized/unverified inbound drops the body.** The internal event
   carries (channel_type, address) only, deduped by platform message id;
   quarantining founderless content is a privacy surface we refuse until
   Build 6's onboarding linkage consumes the event.
9. **Tests run against an in-memory twin, not the vendor.** No cloud sandbox
   is documented; the `ChannelPort` seam has a deterministic in-memory
   implementation covering the definite/ambiguous failure taxonomy, and the
   Spectrum adapter is duck-typed against the narrow surface we call, pinned
   by fakes. Rejected: booting the real Spectrum runtime in tests (network
   coupling, week-old SDK churn). Real-wire verification is gated on a
   provisioned dedicated line (Business plan).
10. **The shell binds `TETHR_DEV_FOUNDER_ID` until Build 6.** Supabase Auth
    session → founder claim arrives with onboarding; every read is already
    RLS-scoped via `withFounderContext`, so auth drops in without data-layer
    changes. The §6.16 traits inspection page ships now (ADR 0007's
    deferral lands here).

## Consequences

- The stream runner (`scripts/messaging-runner.ts`) is a persistent process
  — the gRPC stream cannot live in Vercel functions or Inngest invocations.
  Production placement joins the deploy-staging ops item.
- Rejected: webhook-first inbound (contradicts the CEO-specified stream);
  routing embeddings-style automatic fallback inside the adapter (the §19.4
  identity model is the right owner); a relation of `messages.status` to
  delivery receipts we cannot observe yet.
- Tracked debt: per-line send counter (D5); Tier-2 compose + response-driven
  reweighting (Build 6); receipts/`delivered` verification on a real line;
  Photon-side webhook signature verification if the webhook intake is ever
  used (§18.5.2 — the stream is authenticated by the project credentials).
- Pre-tag review findings, fixed: the §18.5.6 brand now gates the cadence
  parser (takes `EnvelopedContent`, not string); the initiation payload's
  founderId is UUID-validated (ADR 0008's defect class); the
  unrecognized-inbound event carries an address HASH, not the raw address
  (PII never transits the workflow vendor); a redelivered inbound RE-EMITS
  its events under the same stable ids, healing the crash window between the
  rows committing and the events going out (engine id-dedup collapses the
  normal case).
- Pre-tag review findings, recorded as debt: (1) per-address rate limiting on
  the inbound stream before production traffic; (2) thread-row completeness
  under a crash after dispatch combined with an id-less event redelivery —
  the durable-replay contract covers real recovery, callers must pass event
  ids (initiation does), and the action ledger remains the authoritative send
  record either way; (3) agent-echo filtering (`sender.kind === "agent"`)
  must be verified on a real line — an unmarked echo would loop inbound;
  (4) a stale revealed read at negligible decayed confidence still outranks a
  fresh stated read in `readSide` — harmless under the confidence gate
  (low gate → hold), revisit with §6.15 tuning.
