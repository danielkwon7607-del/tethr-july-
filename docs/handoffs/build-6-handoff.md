# Handoff → Build 6 (Onboarding & Seeding)

*Written 2026-07-09 at the end of the Build 5 session. Next session: follow
EXECUTION.md's Startup Sequence, then execute Build 6 per ENGINEERING_OS §7
and the harness-link instructions below.*

## State you inherit

- **Milestones:** `build-0-foundation` → … → `build-4-founder-model` →
  `build-5-messaging` (d6d42bd), all pushed; 121 tests green locally with the
  scratch cluster; CI `checks` green, `deploy-staging` still red (debt).
- **Session gate work (before Build 5):** adversarial review of the Build 4
  graph layer fixed 3 P1s (ADR 0008, migration 0009): relation cardinality
  (`one`/`many`) with DB-enforced live-edge uniqueness, bounded `liveFacts`,
  normalized entity matching, and the write path now PROVES episode ownership
  under the claimed founder's RLS scope before writing.
- **packages/messaging** (Build 5, ADR 0009): §19.4 inbound resolution via
  the `resolve_channel_identity` security-definer resolver (migration 0010);
  ordered/deduped threads; the §18.5.6 untrusted-input envelope
  (`EnvelopedContent` — branded, model tiers cannot accept raw strings);
  ledgered `sendFounderMessage` (select-channel BEFORE claim; fallback =
  tethr routing over `detectServices`; verification-inheritance for sibling
  identities); `registerDeliveryScan` (sweeps stale `message.send` ledger
  claims, service-role, enumerated §18.5.4); `registerInitiation` — the
  §6.12 harness wiring (candidates from trait reads, scored by the EXISTING
  `decideAndRecord`, veto intact, timing via durable sleep to the working-
  rhythm window); cadence adjustments as calibration writes (correction vs
  stated rule); in-memory channel twin for tests; duck-typed Spectrum adapter
  pinned by fakes.
- **apps/web**: thin shell — Company State + §4.5 cadence surface, Plan,
  Experiment, §6.16 traits inspection — all RLS-scoped; founder binding is
  `TETHR_DEV_FOUNDER_ID` until Build 6 brings sessions. `next.config.ts`
  transpiles the workspace packages; `postgres`/`inngest` stay external.
- **scripts/messaging-runner.ts**: the persistent stream runner (gRPC stream
  ≠ request function). Same esbuild receipt as verify-build-3 (in-file).

## Build 6 scope (ENGINEERING_OS §7 + CEO instruction)

Three entry paths (idea / problem-only / none); §6.13 cold-start seeding at
low confidence on the §3.3 dimensions (capacity family A, process
sophistication G, customer-contact disposition D, communication preference
F); the automatic trigger into Research at the right point (Ch 3, Ch 8) with
the Research entry point STUBBED (wire the trigger through the internal-event
intake, not the pipeline). **Harness link (test the seam end-to-end):** the
dimensions seeded must be the ones `registerInitiation` reads —
`accountability_responsiveness`, `communication_cadence`, `working_rhythm`,
`load_burnout` are what the Build 5 policy consumes — so first contact is
personalized from the very first message and conservative under low cold-
start confidence (§6.13: low confidence → low gate → gentle/hold, already
mechanical). Acceptance: seed → policy read → initiation style, verified in
one test.

## Deferred INTO Build 6 (explicit, do not re-defer silently)

- **Write-path extractors**: `registerFounderModelWritePath` takes injected
  `extract`/`abstract`; production Tier-1/2 calls through `createTierRunner`
  arrive now (onboarding produces the first real episodes).
- **Tier-2 message composition** for initiation (template compose in
  `messaging-runner.ts` today) and **response-driven `reweightPolicy`**
  (delivery is not efficacy; founder responses are).
- **`messaging.unrecognized-inbound` consumer**: onboarding linkage. The
  event carries (channelType, addressHash — sha256) only; re-derive the hash
  from a candidate address to correlate. Verification before binding
  (§18.5.2); bodies of unrecognized messages are dropped by design.
- **Shell auth**: Supabase Auth session → founder claim replaces
  `TETHR_DEV_FOUNDER_ID`; the data layer is already RLS-scoped, so this is
  an identity-resolution change only.

## Open debt (tracked, not blocking)

- `deploy-staging` red since Build 0 (Vercel secrets, CEO). The messaging
  runner's production placement joins that conversation (ADR 0009).
- **G2/G3 blocked on the live DB password**: `TETHR_LIVE_DATABASE_URL` in
  `apps/web/.env` fails auth. The direct host `db.<ref>.supabase.co` is
  IPv6-only (unreachable from this machine); the working IPv4 path is the
  session pooler `aws-1-us-east-1.pooler.supabase.com:5432` with user
  `postgres.<ref>` — tenant found there, password rejected (tested raw and
  URL-decoded). User must reset the DB password and update the DSN. Then:
  run `verify-build-3.ts` (SQL index check) and do the prototype-schema
  quarantine (`legacy_` renames; ADR + Decision Log; beware live prototype
  tables named `messages`/`outreach` colliding with our chain).
- Photon dedicated line not yet provisioned (Business plan,
  app.photon.codes) — blocks real-wire tests only. On a real line, verify:
  agent-echo filtering (`sender.kind`), delivery receipts
  (`delivered`/`read` dormant vocabulary), and the 50-conversations/day cap.
- Per-address rate limiting on the inbound stream before production traffic.
- Per-line send counter before any shared-line configuration.
- ADR 0008/0009 debt lists (graph attribute drift, trait-ledger windowing,
  filtered-ANN under-fill, thread-row completeness under id-less redelivery,
  `readSide` stale-revealed nuance).

## Session-start facts that will save you time

- Scratch cluster receipt: `packages/db/README.md` (port 54329). NEVER point
  `TETHR_DATABASE_URL` at the live DB (db.test.ts drops the schema). A
  leftover dev database on the scratch cluster (e.g. `tethr_shell_dev`)
  makes db.test.ts's rollback fail on `drop role tethr_app` (cluster-wide
  role, cross-database dependency) — drop dev DBs before full runs.
- Shell dev loop: seed a founder + data, then
  `TETHR_ENV=local TETHR_DATABASE_URL=<scratch> TETHR_DEV_FOUNDER_ID=<id>
  npx next dev` in apps/web.
- Photon credentials are `PHOTON_PROJECT_ID`/`PHOTON_PROJECT_SECRET` in
  `apps/web/.env`; `loadMessagingConfig` reads exactly those names.
- Vendor SDK: npm `@spectrum-ts/core@9` + providers (NOT the `spectrum-ts`
  meta-package). High-level `Space.send` has NO clientGuid — the ledger
  claim is the double-send guarantee.
- The design doc for Build 5 (3× adversarially reviewed) is at
  `~/.gstack/projects/danielkwon7607-del-tethr-july-/niranjandeshpande-main-design-20260707-201503.md`.

## Process notes that proved out

- The pre-tag adversarial review gate caught real issues again: this session
  a fresh-context design review found the RLS bootstrap problem and a
  delivery scan aimed at a table that is empty in exactly the stuck case;
  the security review caught the raw-address PII leak and the unenveloped
  cadence-parser seam; the in-context correctness sweep (subagent died on
  session limit — the fallback works) caught the inbound
  crash-between-commit-and-emit event loss, which a test had accidentally
  enshrined as "dedup". Run the gate before every tag.
- Adversarial reviews of DESIGNS (before code) converge fast: 7/10 → 9/10 in
  two iterations, and the issues they catch are the expensive kind (wrong
  artifact observed, unread migrations, unverified vendor types).
- Webpack statically rewrites `new URL(<literal>, import.meta.url)` — that
  pattern in a workspace package breaks `next build` when transpiled.
