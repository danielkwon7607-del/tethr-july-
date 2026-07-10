# 0010 — Prototype schema quarantine: `legacy_` renames on the live database

Date: 2026-07-09 (Build 6 gate) · Status: accepted

## Context

The live Supabase project (`ftlvjpvgrufbvirqejzd`) predates our migration chain.
It holds a prototype schema built before this codebase, plus `rag_corpus` — the
Public Knowledge corpus we adopted in Build 3 (ADR 0006; 21,349 rows, verified
live again this session by `scripts/verify-build-3.ts`, all 10 checks green).

A live inventory this session (blocked until now on a bad DB password, reset and
corrected — the working path is the **session pooler**
`aws-1-us-east-1.pooler.supabase.com:5432`, user `postgres.<ref>`; the direct
host `db.<ref>.supabase.co` is IPv6-only and unreachable from our machines)
showed our migrations have **never been applied to live**. Of the 19 public base
tables, exactly one — `rag_corpus` — is ours. The other 18 are prototype:

```
competitors  feedback  founder_memory  founder_profile  founders  icp
iteration_backlog  launch  market_signals  messages  onboarding_state
outreach  plan_items  research  revenue  sessions  validation  waitlist
```

All empty except `waitlist` (22 rows). Every FK roots at prototype `founders`.
No views depend on them. Critically, **`founders` and `messages` sit at the exact
names our chain creates** (migrations 0001 and 0005) — the collision the Build 5
handoff flagged. At first live deploy, `create table founders` would hit the
prototype table.

## Decision

**Quarantine, don't drop.** All 18 prototype tables were renamed to a `legacy_`
prefix in a single transaction, with the post-state verified inside the same
transaction before commit (zero bare-named prototype tables remain; `rag_corpus`
untouched). Renaming is reversible by construction — the reverse is
`alter table legacy_X rename to X` — which is why it is the right quarantine
primitive over `DROP` (Constitution X, §6.16 invalidate-don't-delete ethos; the
`waitlist` rows survive). FK references, indexes, constraints, and RLS policies
follow the table by OID, so the rename is self-consistent with no dependent
breakage.

Executed through gstack `/careful` (live-DB mutation); the target list was named
explicitly, not derived by pattern, so the scope was reviewable.

## Consequences

- The live `public` schema now cleanly separates ours (`rag_corpus`) from
  quarantined prototype (`legacy_*`). First deploy applies our chain onto a clear
  namespace.
- **Reversal:** rename any `legacy_X` back to `X`. No data was moved or dropped.

## Tracked debt (for the first-deploy migration-baseline step)

- **Constraint/index names are not prefixed.** A rename moves the table but keeps
  constraint/index names: `legacy_founders` still owns `founders_pkey`, etc. When
  migration 0001 creates `founders` with `founders_pkey`, the constraint name
  collides. Quarantine deliberately stays table-scoped (the CEO instruction:
  "rename non-legacy prototype tables … rename, not drop"); resolving these names
  belongs to the migration-baseline step the Build 5 handoff already tracks (the
  live schema predates the chain). Options there: rename the `legacy_*`
  constraints too, or drop the quarantined tables once their reversibility window
  closes.
- The prototype may have had PostgREST/Supabase-API consumers; the prototype app
  is superseded (greenfield build), and the CEO directed the quarantine, so this
  is accepted.
