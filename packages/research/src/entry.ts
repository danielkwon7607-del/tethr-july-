import type { WorkflowEngine } from "@tethr/orchestration";
import { type ResearchPipelineDeps, type ResearchResult, runResearchPipeline } from "./pipeline";

// The Research entry point (§3.4, Ch 11): auto-triggered from onboarding's
// `onboarding.completed` event — the founder never asks. This is the producer
// side of the proactive loop's first proof. Research owns this seam (Constitution
// XII: one owner per capability), consuming onboarding's event; onboarding does
// not invoke the pipeline. The trigger contract Build 6 stubbed is preserved:
// it fires on onboarding.completed, no user prompt.

export const ONBOARDING_COMPLETED_EVENT = "onboarding.completed";
// A validation pivot re-enters Research (§13.3, Ch 11). Research owns this
// consumer seam (Constitution XII) — Validation only emits the event; it does
// not import Research — the same shape as the onboarding→research seam.
export const VALIDATION_PIVOT_EVENT = "validation.pivot";
export const RESEARCH_ENTRY_WORKFLOW_ID = "research.pipeline";
export const RESEARCH_PIVOT_WORKFLOW_ID = "research.pivot-reentry";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResearchEntryDeps = ResearchPipelineDeps & {
  /** Observation seam for tests/instrumentation. */
  onComplete?: (result: ResearchResult, founderId: string) => void | Promise<void>;
};

function extractIdea(state: Record<string, unknown>): string | null {
  const idea = state.ideaHypothesis ?? state.problem ?? state.surfacedDirection;
  return typeof idea === "string" && idea.length > 0 ? idea : null;
}

export function registerResearchEntry(engine: WorkflowEngine, deps: ResearchEntryDeps): void {
  engine.register({
    id: RESEARCH_ENTRY_WORKFLOW_ID,
    trigger: { event: ONBOARDING_COMPLETED_EVENT },
    handler: async (event, step) => {
      // The payload's founderId decides the RLS scope — untrusted input (ADR
      // 0008's class); the UUID guard keeps that cheap-true, matching the
      // onboarding and initiation seams.
      const founderId = event.data.founderId as string;
      if (!founderId || !UUID_PATTERN.test(founderId)) {
        throw new Error(`${ONBOARDING_COMPLETED_EVENT} requires a UUID founderId`);
      }

      // §3.4: tethr is already at work — advance to researching at once, and read
      // the idea/problem to research from Company State (events carry ids, not
      // bodies — §18.5.6, so the idea is read under scope here, not passed in).
      const query = await step.run("enter-research", () =>
        deps.runScoped(founderId, async (trx) => {
          await trx`
            update company_state set stage = 'researching', updated_at = now()
            where stage = 'onboarding'`;
          const [row] = await trx<{ state: Record<string, unknown> }[]>`
            select state from company_state`;
          const idea = row ? extractIdea(row.state) : null;
          return idea ? { idea } : null;
        }),
      );

      // No researchable framing yet (path 'none' with no surfaced direction):
      // nothing to research. Leave the founder in `researching` for the entry
      // surface to draw one out (Build 9). Not an error — a real cold-start state.
      if (!query) return;

      const result = await runResearchPipeline(deps, { founderId, query, step });
      await deps.onComplete?.(result, founderId);
    },
  });
}

/**
 * Validation-pivot re-entry (§13.3, Ch 11): a pivot verdict from Validation
 * routes back into Research through the internal-event intake, so the loop never
 * dead-ends. It reshapes Company State back to `researching` and re-runs the
 * pipeline over the founder's (pivoted) idea in Company State — the founder-facing
 * capture of the new direction is Build 9's entry surface; here Research proves
 * the seam by re-researching. Idempotency is the engine's event-id dedup plus the
 * stage guard (only a founder past research re-enters).
 */
export function registerResearchPivotEntry(engine: WorkflowEngine, deps: ResearchEntryDeps): void {
  engine.register({
    id: RESEARCH_PIVOT_WORKFLOW_ID,
    trigger: { event: VALIDATION_PIVOT_EVENT },
    handler: async (event, step) => {
      const founderId = event.data.founderId as string;
      if (!founderId || !UUID_PATTERN.test(founderId)) {
        throw new Error(`${VALIDATION_PIVOT_EVENT} requires a UUID founderId`);
      }
      const query = await step.run("reenter-research", () =>
        deps.runScoped(founderId, async (trx) => {
          await trx`
            update company_state set stage = 'researching', updated_at = now()
            where stage = 'planning'`;
          const [row] = await trx<{ state: Record<string, unknown> }[]>`
            select state from company_state`;
          const idea = row ? extractIdea(row.state) : null;
          return idea ? { idea } : null;
        }),
      );
      if (!query) return;
      const result = await runResearchPipeline(deps, { founderId, query, step });
      await deps.onComplete?.(result, founderId);
    },
  });
}
