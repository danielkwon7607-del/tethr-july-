# 0007 — Founder Model v0: evidence ledger, calibration mechanics, and the write path

Date: 2026-07-07 (Build 4) · Status: accepted

## Context

Build 4 implements handbook Ch 6 with the §6.15 calibration exactly as
specced: saturating confidence (k=0.5), per-family decay half-lives on
confidence, source weights (correction 1.0 / revealed 0.7 / proxy 0.5 /
stated 0.4), the stated-vs-revealed gate (0.3 / 0.5), bounded multiplicative
policy learning [0.5, 2.0], and the hard burnout veto. The shapes were already
Decision-Log commitments; this ADR records the implementation decisions the
handbook left open.

## Decisions

1. **`trait_observations` is the evidence ledger AND the instrumentation**
   (migration 0008). Every trait update is an appended observation row
   (source, estimate, corroborating, provenance, timestamp); confidence and
   estimates are recomputed from it on every write, so a Trait read is always
   explainable and re-derivable. Append-only for the app role. The same rows
   are the dataset for tuning the v0 constants. `policy_decisions` records
   every §6.15 scoring outcome (fit, gate, weight, score, act/ask, veto) for
   the same reason.
2. **v0 estimate mechanics (not handbook-fixed, recorded here):** a side's
   estimate is the evidence-weighted mean of its observations (weights =
   source × recency); an observation within **0.25** of the current estimate
   corroborates, farther conflicts (`CORROBORATION_BAND`, tunable). Conflicting
   evidence still pulls the mean while lowering confidence — §6.6's "falls
   when observations conflict" emerges mechanically.
3. **Two decay applications compose, not double-count:** at write time each
   observation's weight carries the decay term at its age (§6.15's
   `recency_factor`); at read time the stored confidence decays from
   `last_reinforced_at` (§6.6). Both formulas are applied literally where the
   handbook places them.
4. **Corrections update the revealed (action-governing) side** at weight 1.0.
   A correction is the founder telling tethr what is actually true; action
   policy follows revealed, so that is where it must land. Stated stays what
   the founder said about themselves (§6.7 — never silently overwritten).
5. **Supersession semantics.** Traits: one live row per (founder, dimension) —
   enforced by Build 1's partial unique index — each update invalidates the
   prior row bi-temporally. Graph: asserting a fact with the same (source
   entity, relation) but a different target invalidates the old edge;
   re-asserting the identical fact extends its provenance instead.
6. **Veto and threshold constants (v0, instrumented):** burnout veto engages
   at confidence > 0.5 with estimate ≥ 0.7 (top band); under veto,
   pace-increasing candidates are suppressed and intensity is capped to
   gentle (band 1 of 3). The action threshold is a caller-supplied parameter,
   not a baked constant — it is the loop's dial (Ch 8), and every decision is
   recorded either way. A lone fresh revealed observation (confidence ≈ 0.30)
   deliberately cannot trigger the veto: no veto on a guess, per §6.6
   corroboration.
7. **The write path takes extract/abstract as injected dependencies.**
   The workflow (extract → write-graph → abstract → update-traits → emit
   reconciliation events) runs as durable steps on the Build 2 engine, deduped
   by event id, under RLS via a founder-scoped runner. The extractors are
   Tier-1/2 model calls wired through the tier runner when onboarding (Build
   6) gives them real inputs; tests inject deterministic ones. Step results
   use JSON-safe wire types (`WireFact`, `WireObservation`) because they cross
   the durable memoization boundary.

## Consequences

- §6.16's inspection/correction surface has its data path:
  `listTraits`/`traitHistory` (estimates, confidences, provenance, evidence
  counts) and `applyCorrection`. The UI ships with the shell build.
- Rejected: storing confidence only and deriving estimates in SQL views
  (harder to test against §6.15's worked examples); LLM-governed memory writes
  (Ch 24 survey's failure mode — the pipeline is mechanical, models only
  propose facts/observations); a separate instrumentation store (the ledger
  already is one).
- Concurrent background writes to the same dimension fail loudly on the
  one-live-row unique index rather than corrupting — acceptable while the
  write path is per-founder serialized by episode; revisit if consolidation
  jobs ever run concurrently per founder.
