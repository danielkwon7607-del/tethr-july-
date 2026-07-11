import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { CostGuard, FounderScopedRunner } from "./budget";
import {
  type ResearchQuery,
  type ResearchSource,
  SOURCE_SPECS,
  type SourceEvidence,
} from "./sources";

// Per-source quota + caching (Handbook Recommendation #6). Two mechanisms:
//   - Staleness-typed cache: a live-within-TTL row short-circuits the fetch AND
//     its cost; per-source TTLs (SOURCE_SPECS) match each signal's freshness.
//   - Fail-fast on 429: a source client throws QuotaExceededError on a provider
//     rate-limit; the pipeline skips that source's contribution rather than
//     hammering, and synthesizes over the sources that answered.
// Cost is charged only on a REAL fetch (a cache hit is free), and the charge is
// where budget/burnout back-pressure trips (ResearchPausedError stops the run).

/** Thrown by a source client on a provider 429/quota error — fail-fast, no retry. */
export class QuotaExceededError extends Error {
  constructor(public readonly source: string) {
    super(`quota exceeded for source ${source}`);
    this.name = "QuotaExceededError";
  }
}

export type CachedSourceDeps = {
  runScoped: FounderScopedRunner;
  founderId: string;
  costGuard: CostGuard;
  now?: () => Date;
};

function cacheKey(query: ResearchQuery): string {
  // Only the hash of the idea is stored, never the raw founder query text.
  return createHash("sha256").update(query.idea).digest("hex");
}

/**
 * Wrap a source with the staleness-typed cache + cost charge. A fresh cache row
 * returns immediately (no fetch, no cost). On a miss/stale, the source cost is
 * charged first (may throw ResearchPausedError → stop the run), then the source
 * is fetched (may throw QuotaExceededError → the pipeline skips it), then the
 * row is refreshed. Wrap the whole thing in a durable step so a replay does not
 * re-charge.
 */
export function withCache(source: ResearchSource, deps: CachedSourceDeps): ResearchSource {
  const spec = SOURCE_SPECS[source.id];
  if (!spec) throw new Error(`unknown source spec ${source.id}`);
  const now = deps.now ?? (() => new Date());
  return {
    id: source.id,
    signalType: source.signalType,
    async fetch(query) {
      const key = cacheKey(query);
      const cached = await deps.runScoped(
        deps.founderId,
        (trx) => trx<
          { payload: SourceEvidence[]; fetched_at: Date }[]
        >`select payload, fetched_at from research_cache
        where source = ${source.id} and cache_key = ${key}`,
      );
      const row = cached[0];
      if (row && now().getTime() - new Date(row.fetched_at).getTime() < spec.ttlMs) {
        return row.payload; // fresh within TTL — no fetch, no cost
      }

      await deps.costGuard.charge("source", source.id, spec.costMicros);
      const evidence = await source.fetch(query);

      await deps.runScoped(
        deps.founderId,
        (trx) => trx`
        insert into research_cache (source, cache_key, payload, fetched_at)
        values (${source.id}, ${key}, ${trx.json(evidence)}, ${now()})
        on conflict (founder_id, source, cache_key)
        do update set payload = excluded.payload, fetched_at = excluded.fetched_at`,
      );
      return evidence;
    },
  };
}
