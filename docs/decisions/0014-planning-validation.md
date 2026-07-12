# 0014 — Planning & Validation: seams, sequencing, criteria immutability, risk selection

Date: 2026-07-11 (Build 8, Ch 12–13) · Status: accepted

## Context

Build 8 adds the two consumers of the Research verdict: `packages/planning`
(Ch 12) and `packages/validation` (Ch 13) — sibling owning subsystems
(Constitution XII), both Tier-2 generation grounded in Public Knowledge (Ch 7,
the two allowed consumers) and personalized by the Founder Model. Research is
the producer; Build 8 must complete the loop without leaving the
Research→Planning→Validation seam half-wired, and a pivot must never dead-end.
The canonical tables (`plans`, `actions`, `experiments`) already exist with the
five mandatory Action fields and five Experiment fields NOT NULL (migration
0004). The pre-code chain (/office-hours → /plan-ceo-review → /plan-eng-review)
plus a /codex-fallback adversarial pass (codex CLI unavailable — see debt)
shaped the decisions below.

## Decisions

### Event seams (§8.2, §18.5.6 — ids only, never bodies)

The stage transitions are internal events on the Build 2 engine, each consumer
defining its event-name constants locally rather than importing the producer
(the codebase's decoupling convention — research/entry.ts already defines
`onboarding.completed` locally):

- `research.completed` → Planning generates a Plan. Payload `{founderId,
  verdictId, verdict}`; the evidence/summary is read from the `verdicts` row
  under founder scope (the payload carries ids, not the evidence).
- `plan.created` → Validation designs the first Experiment ("a plan forming
  prompts the first Validation design", §8.2).
- `plan.action.pushback` → Planning records a deference observation **and**
  emits `plan.resequence` (re-sequencing wires through the internal intake,
  §12.4, the same shape as onboarding→research).
- `validation.result` → Validation ingests a stubbed/founder-reported result and
  routes it: `plan.advance` (pass), `plan.replan` (fail), or `validation.pivot`
  (pivot).
- **`validation.pivot` → Research re-enters** (§13.3, Ch 11). Research owns this
  consumer (`registerResearchPivotEntry`) — Validation only emits; it does not
  import Research. This is the anti-dead-end guarantee, tested end-to-end on both
  sides (Validation emits; Research re-researches).

A `pivot` **verdict** (from Research) is consumed by Planning like any verdict —
the Plan sequences the pivot direction (§11.4 "re-enters at Planning"); it does
not bounce back. Only a validation **result** of pivot re-enters Research. These
are distinct and both tested.

### Plan sequencing — a validated DAG, not a flat list (§12.1)

`sequence.ts` is a pure core (no DB, no model): `sequenceActions` assigns
`sequence_index` by topological level (`level = 1 + max(dep levels)`), so ties
are parallelizable and every dependency edge is **strictly** ordered by
construction. The /codex-fallback pass flagged the subtle failure modes, all now
guarded and unit-tested:

- **Strict `<`, not `<=`** on every dependency edge: `sequence_index` ties mean
  "parallelizable", so `<=` would admit a dependency running concurrently with
  its own dependency.
- **Cycle detection** (Kahn) on the edge set, independent of index (index
  monotonicity ≠ acyclicity); a self-edge is a trivial cycle.
- **Dependency membership**: every `depends_on` key must resolve within the same
  plan — Postgres cannot FK an array element, and Zod validates shape not
  cross-references, so this is the only guard against a dangling/hallucinated id.
- **Re-sequence ratchet** (§12.4): `resequence` freezes done/in_progress Actions
  at their current index and re-levels the rest strictly above their
  dependencies, then re-validates the whole plan (acyclicity, membership, strict
  order re-checked *after* the mutation).

### Estimated time sized against available_time (§12.2, §6.9)

`capacity.ts` sizes each estimate against the founder's `available_time` read:
low capacity inflates wall-clock estimates, and a low-confidence read is treated
conservatively (larger), consistent with Build 6 cold-start. Deterministic given
the trait; the model supplies only the base effort.

### Founder pushback → deference write (§6.3, §6.5)

Pushback is an override = **low deference**, recorded on the **revealed** side
(revealed beats stated for action policy, §6.7) at estimate 0.2 through the
Founder Model write path (`recordObservation`, family `risk_decision`). Tested:
a pushback event produces a `trait_observations` row.

### Experiment criteria immutability — enforced at the database (§13.2)

Migration 0013: a `BEFORE UPDATE` trigger on `experiments` raises if any
criteria column (`hypothesis`, `success_criteria`, `failure_criteria`,
`duration`, `sample_size`) changes once the row has left `designed` or a result
exists. The tight rule — criteria mutable **only** while the row both was and
remains `designed` with no result — admits pre-run design edits and forbids every
post-run edit, while leaving status transitions and the result write untouched.
Enforced at the lowest layer (Constitution IX); no app path can bypass it. This
is the structural mechanism against rationalizing a result after the fact.

### Highest-risk-assumption selection — inspectable, deterministic (§13.1)

`select.ts` mirrors the Research synthesis split (ADR 0013): the Tier-2 model
surfaces scored candidates, a pure rule decides. The /codex-fallback pass drove
two decisions:

- **Axis: `impact × failure_likelihood`, not `impact × uncertainty`.** "Risk" is
  the assumption whose failure most cheaply kills the idea = expected lethality.
  Raw "uncertainty" conflates *unknown* with *likely-false* — the assumption you
  are fairly sure is false is the one to test first, yet it would score low
  uncertainty. `failure_likelihood` = P(the assumption fails) gets that right.
  **Rejected:** raw uncertainty (mis-ranks a near-certain-but-lethal assumption)
  and a symmetric product read without the axis semantics pinned down. A
  lexicographic impact-first rule is noted as a tunable v0 alternative.
- **Multi-key comparator with an epsilon tie-band.** A naive scalar argmax keeps
  the first max seen and provably returns the *second*-highest on a tie; the
  comparator is `(risk desc, impact desc, index asc)`, with an epsilon band so
  float noise between policy-equal candidates does not skip the impact tiebreak.
  Zod `.min(0).max(1)` on both axes (reject malformed, no silent default), a
  non-empty guard, and a finite-winner assertion.

### Experiment sizing personalized by the Founder Model

`sizing.ts` scales the model's proposed `sample_size` to capacity (a constrained
or unknown-capacity founder runs a smaller first experiment) — distinct from
planning's time-inflation, and floored at 1 (the `sample_size > 0` constraint).

### Result-ingestion scope

Build 8 builds the ingestion + routing against a stubbed/founder-reported result;
the customer-facing send that produces a real result is Build 9. `pass`/`fail`
emit their routed internal events (`plan.advance` / `plan.replan`) — the routing
is the Build 8 deliverable; the founder-facing consumption of those events is
Build 9. The `pivot` path is fully wired to Research and tested end-to-end.

## Post-implementation review (resolved before tag)

An independent code review (the /review gate) returned APPROVE, 0 CRITICAL / 0
HIGH. Resolved before tagging:

- **Result ingestion is replay-idempotent.** `ingestExperimentResult` now reads
  the experiment first: a redelivered result that finds the row already in the
  target status returns early (a durable at-least-once retry after the write
  committed but before the step checkpointed no longer throws); a *different*
  terminal status is a genuine conflict and still raises. Mirrors planning's
  `check-existing-plan` early-return pattern. Tested both ways.
- **One-active-plan-per-verdict is now DB-enforced** (partial unique index
  `plans_one_active_per_verdict`, migration 0013), not just an app-level
  check-before-insert — idempotency belongs at the lowest layer (Constitution IX).
- **Deferred by design (confirmed):** `plan.advance` / `plan.replan` have no
  consumer yet — the routing is the Build 8 deliverable; plan-side follow-through
  is Build 9.

## Consequences / tracked debt

- **/codex was not a true cross-model check.** The codex CLI is not installed;
  the mandated independent second opinion ran as a fresh-context Claude subagent.
  A real different-model pass on the sequencing + risk-selection logic is
  deploy-time debt — carry into Build 9.
- **B3 (falsifiability) is a cheap guard only.** Criteria immutability (0013) +
  a `success_criteria ≠ failure_criteria` check are v0. Machine-evaluable
  disjoint/covering criteria regions and auto-computed verdicts would be new
  product behavior (the handbook models criteria as text) — flagged for a Build 9
  handbook amendment, not invented here.
- **`plan.advance` / `plan.replan` have no consumer yet** — the routing is
  complete and tested; the plan-side follow-through is Build 9.
- **`parseModelJson` is now duplicated in four packages** (research,
  founder-model, planning, validation). Extract to `@tethr/core` when convenient
  (deferred — matching the existing 2-copy convention rather than refactoring
  research/founder-model out of scope).
