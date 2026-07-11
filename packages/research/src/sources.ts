// Typed research sources (Ch 11 §11.2). Each source carries a DIFFERENT type of
// signal — live sentiment vs technical reception vs web presence vs funded
// competition — and Research SYNTHESIZES across them (weighted per signal type,
// not averaged; see synthesis.ts). This module is the source seam: a typed port
// the pipeline calls, per-source specs (cost + cache TTL, Recs #5/#6), and the
// in-memory fake used by the acceptance suite. Real HTTP clients (http-sources.ts)
// are deploy-time and gated on provider keys — the same posture as the Spectrum
// adapter (ADR 0009): the port is pinned by fakes, real-wire verified on deploy.

export type SignalType =
  | "live_sentiment" // xAI X Search — real-time demand, sentiment, complaints
  | "technical_reception" // Hacker News — early-adopter / technical reaction
  | "web_presence" // Serper — competitor surface, market framing
  | "funded_competition"; // Serper funding queries — funded-competitor stand-in
// (Crunchbase deferred on cost, ADR 0013): funded_competition is served by a
// second Serper source using funding-specific query patterns — a lower-fidelity
// substitute for structured Crunchbase data, to revisit once budget allows.

export type ResearchVerdict = "strong_signal" | "weak_signal" | "pivot";

export type ResearchQuery = {
  /** The founder's idea or problem framing, from onboarding's Company State. */
  idea: string;
};

/** One piece of evidence from a source, evidence-linked by `url` (§11.4). */
export type SourceEvidence = {
  source: string;
  signalType: SignalType;
  title: string;
  url: string;
  /**
   * The source's normalized reading of ITS OWN signal, 0..1. For a
   * demand-bearing source (sentiment, technical) it is demand strength; for a
   * competition-bearing source (web, funding) it is competition density. The
   * synthesis maps these into disjoint dimensions — never a single average.
   */
  strength: number;
};

export type ResearchSource = {
  id: string;
  signalType: SignalType;
  fetch(query: ResearchQuery): Promise<SourceEvidence[]>;
};

export type SourceSpec = {
  id: string;
  signalType: SignalType;
  /** Per-fetch cost in micro-dollars (0 = free). Feeds the budget (Rec #5). */
  costMicros: number;
  /** Cache staleness window (Rec #6): live sentiment is short, funding is long. */
  ttlMs: number;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// v0 constants (recorded in ADR 0013). TTLs match the freshness each signal
// needs: X sentiment goes stale in hours, funding data holds for a week.
// Build 7 source scope (CEO, 2026-07-10): xAI + HN + two Serper sources.
// Crunchbase is deferred on cost; serper_funding is its funding-signal stand-in.
export const SOURCE_SPECS: Record<string, SourceSpec> = {
  xai: { id: "xai", signalType: "live_sentiment", costMicros: 5_000, ttlMs: 6 * HOUR },
  hackernews: { id: "hackernews", signalType: "technical_reception", costMicros: 0, ttlMs: DAY },
  serper: { id: "serper", signalType: "web_presence", costMicros: 1_000, ttlMs: DAY },
  // Same Serper API, funding-specific queries — the Crunchbase substitute. Longer
  // TTL: funding facts change slowly, matching Crunchbase's intended cadence.
  serper_funding: {
    id: "serper_funding",
    signalType: "funded_competition",
    costMicros: 1_000,
    ttlMs: 7 * DAY,
  },
};

/** Deterministic in-memory source for the acceptance suite (no live keys). */
export function createFakeSource(
  id: string,
  evidence: SourceEvidence[],
  options?: { onFetch?: () => void },
): ResearchSource {
  const spec = SOURCE_SPECS[id];
  if (!spec) throw new Error(`unknown source ${id}`);
  return {
    id,
    signalType: spec.signalType,
    async fetch() {
      options?.onFetch?.();
      return evidence;
    },
  };
}
