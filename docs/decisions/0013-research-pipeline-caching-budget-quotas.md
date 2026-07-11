# 0013 — Research pipeline: caching TTLs, cost budget, provider quotas & ToS

Date: 2026-07-10 (Build 7, Ch 11) · Status: accepted · CEO-approved source scope

## Context

Build 7 builds the Research pipeline (Ch 11): typed live sources → weighted
synthesis → `strong/weak/pivot` verdict, auto-triggered from onboarding. Handbook
Recommendations #5 (per-founder cost guardrails) and #6 (source quotas, caching,
ToS) close here as acceptance criteria. This ADR records the v0 constants and the
source-scope decision so they are tunable in one place, not scattered.

## Decisions

### Source scope (CEO, 2026-07-10)

- **xAI X Search** (primary, `live_sentiment`) and **Serper** (`web_presence`)
  are live — `XAI_API_KEY` / `SERPER_API_KEY` confirmed set. **Hacker News**
  (`technical_reception`) is free/keyless via the Algolia HN Search API.
- **Crunchbase is out of scope for Build 7** (enterprise pricing; deferred until
  funded). Its `funded_competition` signal is served by a **second Serper source
  (`serper_funding`)** using funding-specific query patterns (`"… funding round OR
  Series A OR raised venture"`). This is a **lower-fidelity stand-in** for
  structured Crunchbase funding data — noisier, no funding amounts/dates — to
  **revisit once budget allows**. The synthesis is unchanged: it keys on
  `signalType`, so `funded_competition` is agnostic to which provider produced it.

### Synthesis (Ch 11 §11.2) — synthesized, not averaged

Demand and competition are computed from **disjoint** signal sets, each a
weighted mean over only its informing signals, then combined by a non-linear
verdict rule — never one global average. v0 weights: demand = 0.65·sentiment +
0.35·technical; competition = 0.6·funded + 0.4·web. Verdict thresholds: strong
demand ≥ 0.6, weak demand < 0.35, saturation ≥ 0.7. The weighting is explicit and
unit-tested (`synthesis.test.ts`); the Tier-2 model produces the human-facing
narrative/complaint-themes/pivot-suggestions, not the decision.

### Cost budget (Rec #5)

- **Per-founder spend ledger** `research_spend` (migration 0012): every costed
  call — paid source fetch or model completion — appends a row (the audit trail);
  back-pressure reads `SUM(cost_micros)` against a per-founder cap.
- **v0 constants** (micro-dollars): models tier1 500, tier2 4000; sources xai
  5000, serper/serper_funding 1000 each, hackernews 0. Per-run budget cap 100000.
- **Back-pressure is check-before-charge**: an over-budget call never runs; the
  pipeline emits `research.paused` and writes **no verdict** — a graceful stop and
  founder-ask (§8.5), never a silent degrade. The **burnout veto (§6.14)** feeds
  the SAME pause path (injected `burnoutPaused`): an overloaded founder throttles
  the loop exactly as an over-budget one does. Both are tested.

### Quotas, caching & ToS (Rec #6)

- **Fail-fast on 429**: a source client throws `QuotaExceededError` on a provider
  rate-limit; the pipeline skips that source's contribution (no hammering, no
  inline retry) and synthesizes over the sources that answered. Tested per source.
- **Staleness-typed cache** `research_cache` (migration 0012), per-source TTL:
  xAI 6h (live sentiment goes stale fast), HN 24h, Serper 24h, serper_funding 7d
  (funding facts change slowly — the cadence Crunchbase would have had). A fresh
  cache row short-circuits the fetch AND its cost. Founder-scoped (not shared):
  the cache key derives from the founder's idea, so a shared table would leak one
  founder's research query into another's cache hit (privacy, §6.14) — the
  efficiency loss is acceptable at research QPS.
- **Provider ToS notes** (per §21, honor before scaling):
  - **xAI**: commercial API, paid per token + Live Search; usage under the xAI
    API terms. Store no more than needed; the pipeline keeps evidence links, not
    full post content.
  - **Serper**: google.serper.dev is a paid Google SERP proxy; respect its plan
    rate limits (fail-fast wired). Results are search snippets/links — cache and
    display as evidence links, do not redistribute in bulk.
  - **Hacker News (Algolia)**: free public API, generous but not unlimited — the
    same 429 fail-fast applies. Attribute to HN via the item link.
  - **Crunchbase**: not integrated (deferred). Note for the future: Crunchbase
    ToS restricts redistribution of funding data — a real integration must store
    per their license, unlike the Serper snippets used as the stand-in now.

### Model routing (Ch 20)

Tier-1 is classification/extraction, Tier-2 is synthesis (idea stress-test and
the market-signal narrative). Every model call goes through the injected
`TierRunner` (the model router), never a raw provider SDK; every source call goes
through the `ResearchSource` port centralized in `http-sources.ts` — no raw SDK
call in stage code (Rec #6).

## Consequences / tracked debt

- **Deploy-time wiring** (joins Build 6's deploy-staging debt): the live
  `registerResearchEntry` needs a concrete `ModelRouter` binding + the http
  sources built from real keys, exercisable only on a deployed environment. The
  acceptance suite runs against fakes (the Spectrum/ADR 0009 posture); a live
  source smoke is a deploy-time step.
- **Provider keys into the boot config schema** (§18.5.5 fail-fast): `XAI_API_KEY`
  and `SERPER_API_KEY` must be validated at boot before the live path runs.
- **Pause vs durable-retry**: back-pressure throws `ResearchPausedError`, exact
  against the in-memory engine. Hardening it against a durable engine's step-retry
  (returning pause as a step value, as `external-action.ts` does for ambiguity) is
  deferred to the first deployed environment — the same deferral class as Build 2's
  live-Inngest e2e.
- **Budget SUM/insert atomicity** (v0): concurrent charges could marginally
  overspend; negligible for a sequential per-founder pipeline. Revisit with
  `SELECT … FOR UPDATE` or an atomic counter if concurrency grows.
- **serper_funding fidelity**: a noisy stand-in for Crunchbase; revisit when
  budget allows a real funded-competition source.
