import type { WorkflowEngine, WorkflowEvent } from "@tethr/orchestration";
import type { Sql } from "postgres";

// §3.4 handoff to Research: the instant onboarding establishes enough, tethr
// triggers Research on its own — the founder does not ask. This is the
// product's first proof that it INITIATES rather than waits (§1.1, Ch 8). Per
// the Build 6 scope we wire the TRIGGER, not the pipeline: the Research entry
// point is a stub Build 7 replaces. Orchestration owns the stage transition
// (§8.2); the pipeline (sources → synthesis → verdict) is Ch 11 / Build 7.

export const ONBOARDING_COMPLETED_EVENT = "onboarding.completed";
export const RESEARCH_ENTRY_WORKFLOW_ID = "research.entry-stub";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FounderScopedRunner = <T>(
  founderId: string,
  work: (trx: Sql) => Promise<T>,
) => Promise<T>;

export type ResearchEntryDeps = {
  runScoped: FounderScopedRunner;
  /** Observation seam (tests, instrumentation); Build 7 supplies the pipeline. */
  onTriggered?: (data: WorkflowEvent["data"]) => void | Promise<void>;
};

/**
 * The stubbed Research entry point. On onboarding completion it advances the
 * company to `researching` — so §3.4's "onboarding ends with tethr already at
 * work" is observable in the shell — and hands off to `onTriggered`. Build 7
 * replaces the body with the real pipeline; the trigger contract stays.
 */
export function registerResearchEntryStub(engine: WorkflowEngine, deps: ResearchEntryDeps): void {
  engine.register({
    id: RESEARCH_ENTRY_WORKFLOW_ID,
    trigger: { event: ONBOARDING_COMPLETED_EVENT },
    handler: async (event) => {
      // The payload's founderId decides the RLS scope below — untrusted input
      // (ADR 0008's defect class). No external surface emits this today; the
      // UUID check keeps that cheap-true if one ever ships, matching initiation.
      const founderId = event.data.founderId as string;
      if (!founderId || !UUID_PATTERN.test(founderId)) {
        throw new Error(`${ONBOARDING_COMPLETED_EVENT} requires a UUID founderId`);
      }
      await deps.runScoped(founderId, async (trx) => {
        await trx`
          update company_state set stage = 'researching', updated_at = now()
          where stage = 'onboarding'`;
      });
      await deps.onTriggered?.(event.data);
    },
  });
}
