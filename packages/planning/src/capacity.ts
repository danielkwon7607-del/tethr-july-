// Estimated-time sizing (§12.2): an Action's estimated_time is sized against
// the founder's available_time read (family A, §6.3/§6.9) so the plan fits real
// capacity. A time-constrained founder gets larger wall-clock estimates — the
// same task is spread thinner — and a low-confidence read is treated
// conservatively (more time allotted), consistent with the Build 6 cold-start
// posture: a single stated seed is low-confidence, so the first plan errs
// toward not over-promising speed.

/** One side of an available_time trait read (§6.4): estimate ∈ [0,1], confidence ∈ [0,1]. */
export type CapacityRead = { estimate: number | null; confidence: number } | undefined;

// When capacity is unknown, assume limited time (conservative), not full-time.
const CONSERVATIVE_PRIOR = 0.25;
const MAX_FACTOR = 3;
const CAP_HIGH = 0.8; // at/above this effective capacity, no inflation
const CAP_LOW = 0.1; // at/below this, maximum inflation

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Blend the read toward the conservative prior by confidence: a high-confidence
 * read is trusted as-is; a low-confidence one is pulled toward "assume limited
 * time". An absent read (trait never seeded) is fully conservative.
 */
export function effectiveCapacity(read: CapacityRead): number {
  if (!read || read.estimate === null) return CONSERVATIVE_PRIOR;
  const confidence = clamp(read.confidence, 0, 1);
  return clamp(read.estimate, 0, 1) * confidence + CONSERVATIVE_PRIOR * (1 - confidence);
}

/** 1.0 (ample capacity) → MAX_FACTOR (little/unknown capacity), linear between. */
export function capacityFactor(read: CapacityRead): number {
  const cap = clamp(effectiveCapacity(read), CAP_LOW, CAP_HIGH);
  return 1 + ((CAP_HIGH - cap) / (CAP_HIGH - CAP_LOW)) * (MAX_FACTOR - 1);
}

/** Size a base effort estimate by the founder's capacity; always ≥ 1 minute. */
export function sizeEstimateMinutes(baseMinutes: number, read: CapacityRead): number {
  return Math.max(1, Math.round(baseMinutes * capacityFactor(read)));
}
