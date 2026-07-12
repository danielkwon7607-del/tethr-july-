// Experiment sizing personalized by the Founder Model (§13, brief). The model
// proposes a sample size for sound experiment design (grounded in Public
// Knowledge); this scales it to the founder's real capacity — a
// resource-constrained founder runs a smaller first experiment, and an unknown
// or low-confidence capacity is treated conservatively (smaller), consistent
// with the Build 6 cold-start posture. Distinct from planning's time-inflation:
// here capacity scales sample size DOWN, not effort up.

/** One side of an available_time trait read (§6.4). */
export type CapacityRead = { estimate: number | null; confidence: number } | undefined;

const CONSERVATIVE_PRIOR = 0.25;
const MIN_SCALE = 0.3; // even a fully-constrained founder still runs a real test
const MIN_SAMPLE = 1; // experiments.sample_size has a > 0 constraint

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function effectiveCapacity(read: CapacityRead): number {
  if (!read || read.estimate === null) return CONSERVATIVE_PRIOR;
  const confidence = clamp01(read.confidence);
  return clamp01(read.estimate) * confidence + CONSERVATIVE_PRIOR * (1 - confidence);
}

/** Scale a base sample size to capacity: MIN_SCALE (constrained) → 1.0 (ample). */
export function sizeSampleForCapacity(baseSample: number, read: CapacityRead): number {
  const scale = MIN_SCALE + (1 - MIN_SCALE) * effectiveCapacity(read);
  return Math.max(MIN_SAMPLE, Math.round(baseSample * scale));
}
