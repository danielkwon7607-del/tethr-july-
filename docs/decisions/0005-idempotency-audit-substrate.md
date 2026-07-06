# ADR-0005 — Idempotency + audit substrate in the foundation

**Date:** 2026-07-06 · **Status:** accepted · **Build:** 0

## Decision
`@tethr/core` ships `runIrreversible` from day one: every irreversible action
claims an idempotency key, is audited on every attempt (`executed` /
`duplicate` / `failed`), and passes its key into the external call so
downstream dedupe holds across partial failures (handbook §18.3, §5.3;
Constitution X). Build 0 provides in-memory adapters; Build 1 replaces them
with Postgres-backed ones behind the same `IdempotencyStore` / `AuditLog`
contracts.

## Rationale
Retrofitting idempotency after a send path exists is how double-sends ship
(ENGINEERING_OS §6). Putting the wrapper in the substrate means Builds 2–9
inherit the guarantee instead of reimplementing it.

## Semantics fixed here
- A duplicate key never re-executes and is itself audited.
- A failed action releases its claim; the retry re-uses the same key.
- The audit log records every attempt, not just successes (§5.4).
