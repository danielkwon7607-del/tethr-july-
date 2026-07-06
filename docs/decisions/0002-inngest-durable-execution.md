# ADR-0002 — Inngest as the durable-execution vendor

**Date:** 2026-07-06 · **Status:** accepted (CEO-approved) · **Build:** 0

## Decision
Inngest is the first adapter behind `@tethr/orchestration`'s `WorkflowEngine`
abstraction (handbook §18.3). The abstraction is the contract: event/cron
triggers, durable named steps, `sleepUntil`. Code registers workflows against
the abstraction, never the Inngest SDK directly.

## Rationale
The proactive loop is event-shaped — three trigger intakes firing workflows —
which maps 1:1 to Inngest's event-subscription model with durable steps,
retries, and day-spanning `sleep until`. Fastest path for an early-stage team.

## Rejected
- Trigger.dev: strong runner-up; Apache-2.0 self-hostable, but its
  task-invocation mental model fits direct background jobs better than an
  event-driven loop, and self-hosting is not a present need.
- Temporal: the handbook's designated escape hatch if durability needs outgrow
  the managed class; not the starting choice.

Lock-in is bounded by design: one adapter file (`inngest-engine.ts`); a vendor
swap is a new adapter, not a migration.
