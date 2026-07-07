import type { Sql } from "postgres";
import {
  classifyObservation,
  confidenceFromEvidence,
  decayedConfidence,
  evidenceWeight,
  HALF_LIFE_WEEKS,
  netEvidence,
  type ObservationSource,
  reconciliationGate,
} from "./calibration";

// The Traits layer store (handbook §6.4–§6.7, §6.15). Every function expects
// a founder-scoped transaction (withFounderContext) — founder_id comes from
// the RLS context, never a parameter. Writes happen on the background path
// (§6.5); reads are cheap: the stored confidence plus read-time decay.
//
// v0 estimate mechanics (recorded in ADR 0007): a side's estimate is the
// evidence-weighted mean of its observations; confidence is the §6.15
// saturating formula over corroborating-minus-conflicting evidence. Both are
// recomputable from trait_observations, which is why supersession can be
// bi-temporal without losing anything.

export type TraitFamily =
  | "capacity"
  | "execution"
  | "risk_decision"
  | "market_customer"
  | "motivation_psychology"
  | "communication"
  | "skill_sophistication";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// §6.15 lists per-dimension half-lives for capacity and skill dimensions and
// per-family ones elsewhere; unlisted dimensions take a family default (v0:
// conservative for state-like capacity).
const FAMILY_FALLBACK_WEEKS: Record<TraitFamily, number> = {
  capacity: 2,
  execution: HALF_LIFE_WEEKS.execution,
  risk_decision: HALF_LIFE_WEEKS.risk_decision,
  market_customer: HALF_LIFE_WEEKS.market_customer,
  motivation_psychology: HALF_LIFE_WEEKS.motivation_psychology,
  communication: HALF_LIFE_WEEKS.communication,
  skill_sophistication: HALF_LIFE_WEEKS.skill_gaps,
};

export function resolveHalfLifeWeeks(family: TraitFamily, dimension: string): number {
  const perDimension = (HALF_LIFE_WEEKS as Record<string, number>)[dimension];
  return perDimension ?? FAMILY_FALLBACK_WEEKS[family];
}

export type SideRead = {
  /** Normalized [0,1]; null until any evidence exists for the side. */
  estimate: number | null;
  confidence: number;
};

export type TraitRead = {
  dimension: string;
  family: TraitFamily;
  stated: SideRead;
  revealed: SideRead;
  halfLifeWeeks: number;
  lastReinforcedAt: Date;
  provenanceEpisodeIds: string[];
};

type TraitRow = {
  id: string;
  family: TraitFamily;
  dimension: string;
  stated_estimate: number | null;
  stated_confidence: number;
  revealed_estimate: number | null;
  revealed_confidence: number;
  half_life_weeks: number;
  last_reinforced_at: Date;
  invalidated_at: Date | null;
  provenance_episode_ids: string[];
};

type ObservationRow = {
  source: ObservationSource;
  observed_estimate: number;
  corroborating: boolean;
  observed_at: Date;
};

const liveTrait = async (sql: Sql, dimension: string): Promise<TraitRow | undefined> =>
  (
    await sql<TraitRow[]>`
      select * from traits where dimension = ${dimension} and invalidated_at is null`
  )[0];

/** Stated observations feed the stated side; everything else is revealed (§6.7). */
const sideOf = (source: ObservationSource): "stated" | "revealed" =>
  source === "stated" ? "stated" : "revealed";

function recomputeSide(
  observations: readonly ObservationRow[],
  side: "stated" | "revealed",
  halfLifeWeeks: number,
  now: Date,
): SideRead {
  const sideObservations = observations.filter((row) => sideOf(row.source) === side);
  if (sideObservations.length === 0) return { estimate: null, confidence: 0 };
  const aged = sideObservations.map((row) => ({
    source: row.source,
    corroborating: row.corroborating,
    estimate: row.observed_estimate,
    ageWeeks: Math.max(0, now.getTime() - row.observed_at.getTime()) / MS_PER_WEEK,
  }));
  const confidence = confidenceFromEvidence(netEvidence(aged, halfLifeWeeks));
  // Evidence-weighted mean (weights = source × recency), ignoring polarity:
  // conflicting evidence still pulls the estimate while lowering confidence.
  let weightSum = 0;
  let weighted = 0;
  for (const item of aged) {
    const weight = evidenceWeight(item, halfLifeWeeks);
    weightSum += weight;
    weighted += weight * item.estimate;
  }
  return { estimate: weighted / weightSum, confidence };
}

export type NewObservation = {
  family: TraitFamily;
  dimension: string;
  source: ObservationSource;
  /** Normalized [0,1]. */
  estimate: number;
  provenanceEpisodeIds: readonly string[];
};

export type RecordResult = {
  trait: TraitRead;
  reconciliation: { fires: boolean; divergence: number };
};

/**
 * Record one observation and roll the trait forward: insert evidence, then
 * supersede the live read bi-temporally (§6.4 — invalidated, never deleted).
 */
export async function recordObservation(sql: Sql, input: NewObservation): Promise<RecordResult> {
  const now = new Date();
  const halfLifeWeeks = resolveHalfLifeWeeks(input.family, input.dimension);
  const current = await liveTrait(sql, input.dimension);
  const currentSide =
    sideOf(input.source) === "stated" ? current?.stated_estimate : current?.revealed_estimate;
  const corroborating = classifyObservation(input.estimate, currentSide ?? null);

  await sql`
    insert into trait_observations (family, dimension, source, observed_estimate, corroborating, provenance_episode_ids)
    values (${input.family}, ${input.dimension}, ${input.source}, ${input.estimate}, ${corroborating},
      ${input.provenanceEpisodeIds as string[]})`;

  const observations = await sql<ObservationRow[]>`
    select source, observed_estimate, corroborating, observed_at
    from trait_observations where dimension = ${input.dimension}`;

  const stated = recomputeSide(observations, "stated", halfLifeWeeks, now);
  const revealed = recomputeSide(observations, "revealed", halfLifeWeeks, now);
  const provenance = Array.from(
    new Set([...(current?.provenance_episode_ids ?? []), ...input.provenanceEpisodeIds]),
  );

  if (current) {
    await sql`
      update traits set invalidated_at = now(), valid_to = now() where id = ${current.id}`;
  }
  await sql`
    insert into traits (family, dimension, stated_estimate, stated_confidence,
      revealed_estimate, revealed_confidence, half_life_weeks, provenance_episode_ids)
    values (${input.family}, ${input.dimension},
      ${stated.estimate === null ? null : sql.json(stated.estimate)}, ${stated.confidence},
      ${revealed.estimate === null ? null : sql.json(revealed.estimate)}, ${revealed.confidence},
      ${halfLifeWeeks}, ${provenance})`;

  const trait: TraitRead = {
    dimension: input.dimension,
    family: input.family,
    stated,
    revealed,
    halfLifeWeeks,
    lastReinforcedAt: now,
    provenanceEpisodeIds: provenance,
  };
  return {
    trait,
    reconciliation:
      stated.estimate !== null && revealed.estimate !== null
        ? reconciliationGate({
            stated: stated.estimate,
            revealed: revealed.estimate,
            revealedConfidence: revealed.confidence,
          })
        : { fires: false, divergence: 0 },
  };
}

/** Corrections are first-class, highest-weight signals (§6.5). */
export const applyCorrection = (
  sql: Sql,
  input: Omit<NewObservation, "source">,
): Promise<RecordResult> => recordObservation(sql, { ...input, source: "correction" });

const toRead = (row: TraitRow, now: Date): TraitRead => {
  const ageWeeks = Math.max(0, now.getTime() - row.last_reinforced_at.getTime()) / MS_PER_WEEK;
  return {
    dimension: row.dimension,
    family: row.family,
    stated: {
      estimate: row.stated_estimate,
      confidence: decayedConfidence(row.stated_confidence, ageWeeks, row.half_life_weeks),
    },
    revealed: {
      estimate: row.revealed_estimate,
      confidence: decayedConfidence(row.revealed_confidence, ageWeeks, row.half_life_weeks),
    },
    halfLifeWeeks: row.half_life_weeks,
    lastReinforcedAt: row.last_reinforced_at,
    provenanceEpisodeIds: row.provenance_episode_ids,
  };
};

/** The live read with §6.6 decay applied to confidence at read time. */
export async function readTrait(sql: Sql, dimension: string): Promise<TraitRead | undefined> {
  const row = await liveTrait(sql, dimension);
  return row ? toRead(row, new Date()) : undefined;
}

export type InspectableTrait = TraitRead & { observationCount: number };

/** §6.16 inspection surface: every live read, its confidence, its evidence. */
export async function listTraits(sql: Sql): Promise<InspectableTrait[]> {
  const now = new Date();
  const rows = await sql<(TraitRow & { observation_count: string })[]>`
    select t.*, (select count(*) from trait_observations o where o.dimension = t.dimension)
      as observation_count
    from traits t where t.invalidated_at is null order by t.family, t.dimension`;
  return rows.map((row) => ({
    ...toRead(row, now),
    observationCount: Number(row.observation_count),
  }));
}

export type TraitHistoryEntry = TraitRead & { validTo: Date | null; invalidatedAt: Date | null };

/** Full bi-temporal history — how the read changed, and when tethr learned it. */
export async function traitHistory(sql: Sql, dimension: string): Promise<TraitHistoryEntry[]> {
  const now = new Date();
  const rows = await sql<(TraitRow & { valid_to: Date | null })[]>`
    select * from traits where dimension = ${dimension} order by ingested_at`;
  return rows.map((row) => ({
    ...toRead(row, now),
    validTo: row.valid_to,
    invalidatedAt: row.invalidated_at,
  }));
}
