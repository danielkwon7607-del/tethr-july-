// Validation event contracts (§8.2, §18.5.6 — ids only, never bodies). Defined
// in one module so the consumer (entry.ts) and the routing logic (pipeline.ts)
// share them without a circular import. Consumed events are owned here;
// Validation defines them locally rather than importing Planning/Research,
// matching the codebase's event-decoupling convention.

/** A plan forming prompts the first Validation design (§8.2). Consumed. */
export const PLAN_CREATED_EVENT = "plan.created";

/** A landed experiment result (customer send is Build 9; here stubbed/founder-reported). Consumed. */
export const VALIDATION_RESULT_EVENT = "validation.result";

/** Pass → the Plan advances (§13.3). Emitted. */
export const PLAN_ADVANCE_EVENT = "plan.advance";

/** Fail → re-planning (§13.3). Emitted. */
export const PLAN_REPLAN_EVENT = "plan.replan";

/** Pivot → re-enter Research (§13.3, Ch 11), through the Build 2 intake. Emitted. */
export const VALIDATION_PIVOT_EVENT = "validation.pivot";

export type ExperimentOutcome = "pass" | "fail" | "pivot";
