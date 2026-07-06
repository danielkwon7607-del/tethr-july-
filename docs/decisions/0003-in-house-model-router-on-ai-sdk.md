# ADR-0003 — Thin in-house model router on the Vercel AI SDK

**Date:** 2026-07-06 · **Status:** accepted (CEO-approved) · **Build:** 0

## Decision
`@tethr/model-router` owns tier routing, cross-provider fallback, and the
handbook §20.3 rule (failover is refused for an irreversible request that does
not carry its idempotency key). Provider access goes through the Vercel AI
SDK's provider adapters via one `aiSdkProvider` seam; no provider SDK is called
anywhere else (handbook §20.1).

## Rationale
TypeScript-native, no extra service, and no third-party aggregator in the
founder-data path — the Founder Model is the most sensitive asset in the system
(§6.14). The behaviors the handbook mandates (tiering, fallback, the
idempotency gate) are exactly the code we must own; the SDK supplies only the
provider plumbing.

## Rejected
- OpenRouter: fastest wide catalog, but a per-token margin and a third party in
  every call carrying founder context.
- LiteLLM: mature, but a Python proxy — a second runtime inside a TypeScript
  monorepo (ADR-0001).
