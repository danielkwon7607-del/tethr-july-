# 0008 — Graph edge hardening: relation cardinality, DB-enforced live-edge invariants, bounded fact reads

Date: 2026-07-07 (Build 5 gate) · Status: accepted

## Context

The Build 5 session opened with an adversarial review gate over the Build 4
graph layer (three parallel review subagents: correctness, RLS/isolation,
query patterns). Traversal RLS and invalidation filtering came back clean in
every hunt class. Three P1s and two P2s did not:

1. **Supersession race.** `assertFact` is read-then-write with no DB
   constraint behind it; two concurrent asserts on the same (source,
   relation) could each invalidate the old edge and each insert, leaving two
   live edges. `traits` already had the one-live-row partial unique index;
   `graph_edges` did not.
2. **Cardinality blindness.** ADR 0007's supersession rule ("same (source,
   relation), different target ⇒ invalidate") assumed every relation is
   single-valued. `works_with Alice` then `works_with Bob` silently
   invalidated the still-true Alice fact — a live fact wrongly invalidated.
3. **Unbounded fact reads.** `liveFacts` had no LIMIT (episodes cap at 8),
   and the live-fact set only grows with tenure; every §6.8 context read paid
   for it.
4. (P2) No index matched the supersession lookup's predicate.
5. (P2) Exact-string entity matching let extraction noise ("AI bookkeeping "
   vs "AI Bookkeeping") fabricate a second entity and a false "different
   target" supersession.

Plus one latent isolation gap: the §6.5 write path trusted
`event.data.founderId` as its RLS scope without verifying it owns
`event.data.episodeId` — a cross-founder *write* primitive the moment a real
emitter (Build 5 messaging) is wired.

## Decisions

1. **Edges carry a caller-declared `cardinality ∈ {one, many}`** (migration
   0009; default `one` preserves ADR 0007 semantics). `one`: a new target
   supersedes **every** live edge on (source, relation) — "the state is now
   exactly this". `many`: targets coexist; only the identical fact
   deduplicates (provenance-extend). A relation's cardinality is fixed by the
   extraction vocabulary (Build 6 wires the extractors); mixing cardinalities
   for one relation is a caller error, not a store concern. This narrows ADR
   0007 decision 5, which stated the blanket single-valued rule.
2. **The live-edge invariants are database-enforced**, not code conventions:
   a partial unique index on (founder_id, source_entity_id, relation) where
   live and `cardinality = 'one'`, and a partial unique index on
   (founder_id, source_entity_id, relation, target_entity_id) where live.
   Concurrent conflicting asserts now fail loudly and retry as durable steps
   — the same accepted behavior traits already had (ADR 0007). A third
   partial index (source_entity_id, relation) where live serves the
   supersession lookup.
3. **Entity matching normalizes**: case-insensitive, trimmed. First-seen
   casing is stored for display.
4. **`liveFacts` is bounded by default** (`DEFAULT_FACT_LIMIT = 100`,
   caller-overridable; `retrieveFounderContext` exposes `factLimit`).
5. **The write path proves episode ownership before writing** (new first
   durable step `verify-episode`): under the claimed founder's RLS scope,
   the episode must be visible and un-tombstoned, else the run fails. No
   service-role lookup needed — RLS itself is the oracle.

## Consequences

- `assertFact` returns `superseded: string[]` (was `string | null`) — a
  cardinality-`one` assert can supersede multiple legacy edges.
- Rejected: a relation-registry table for cardinality (heavier than the
  per-assert declaration while the vocabulary is still unborn); SELECT FOR
  UPDATE serialization (under READ COMMITTED the blocked transaction re-reads
  post-commit state and still double-inserts — the unique index is the only
  airtight guard); dropping supersession semantics entirely (would orphan
  the §6.4 "invalidate, don't delete" behavior the product depends on).

## Tracked debt (recorded, deliberately not fixed now)

- **Attributes drift on identical re-assertion:** provenance extends but
  `attributes` are not refreshed. Revisit when extractors (Build 6) emit
  meaningful attributes.
- **Trait-ledger recompute is unwindowed** (matches ADR 0007's recorded
  choice): per-write cost grows with lifetime observation count. Upgrade
  path when it matters: a windowed read (LIMIT / observed_at bound) on the
  existing index.
- **pgvector filtered-ANN under-fill:** episode similarity search filters
  (RLS founder scope, tombstones) apply after the HNSW scan; at large
  founder counts a founder's top-k can come back under-filled with no error.
  Revisit with per-founder partial indexes or iterative scan when founder
  count makes it measurable.
- **Sequential per-fact writes in the write path:** by design (background,
  bounded by one episode's extraction output).
- `graph_edges_source` (full index) kept alongside the new partial index for
  invalidated-history reads; delete if history queries never materialize.
