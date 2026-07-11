import type { TierRunner, WorkflowEngine, WorkflowStep } from "@tethr/orchestration";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  createCostGuard,
  type FounderScopedRunner,
  MODEL_COST_MICROS,
  type PauseReason,
  ResearchPausedError,
} from "./budget";
import { QuotaExceededError, withCache } from "./quota";
import type {
  ResearchQuery,
  ResearchSource,
  ResearchVerdict,
  SignalType,
  SourceEvidence,
} from "./sources";
import { deriveVerdict, type SynthesisScores, synthesizeScores } from "./synthesis";

// The four-stage research pipeline (Ch 11 §11.3): idea stress-test → competitor
// landscape → market-signal synthesis → verdict. Runs as durable steps on the
// orchestration engine, triggered from onboarding.completed (§3.4) — the
// founder never asks. Tier-1 is classification/extraction, Tier-2 is synthesis
// (Ch 20). Every source call is cache- and budget-guarded (never a raw SDK call
// in stage code, Rec #5/#6). Public Knowledge is untouched by construction — this
// package does not depend on it (Ch 7 boundary, dependency-test enforced).
//
// Back-pressure (budget or burnout) throws ResearchPausedError, caught at the
// top: the pipeline surfaces to the founder and writes NO verdict — never a
// silent degrade (§8.5). NOTE: like Build 2's live-Inngest e2e, hardening the
// pause against durable-retry semantics (returning it as a step value the way
// external-action.ts does for ambiguity) is deferred to the first deployed
// environment; against the in-memory engine the throw path is exact.

export const RESEARCH_COMPLETED_EVENT = "research.completed";
export const RESEARCH_PAUSED_EVENT = "research.paused";

const stressSchema = z.object({ assumptions: z.array(z.string().max(300)).max(10) });
const narrativeSchema = z.object({
  summary: z.string().min(1).max(2000),
  complaintThemes: z.array(z.string().max(200)).max(20),
  pivotSuggestions: z.array(z.string().max(200)).max(10),
});

function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

const STRESS_SYSTEM =
  "Pressure-test the founder's idea before research spends effort. Return ONLY JSON " +
  '{"assumptions":[string]} — the core assumptions whose failure would kill the idea. Max 10.';
const NARRATIVE_SYSTEM =
  "Synthesize the research evidence into a market read. Return ONLY JSON " +
  '{"summary":string,"complaintThemes":[string],"pivotSuggestions":[string]}. ' +
  "Weigh the typed signals against each other; do not average them.";

export type ResearchPipelineDeps = {
  sources: ResearchSource[];
  tierRunner: TierRunner;
  runScoped: FounderScopedRunner;
  engine: WorkflowEngine;
  budgetMicros?: number;
  burnoutPaused?: (founderId: string) => Promise<boolean>;
  now?: () => Date;
};

export type ResearchRun = { founderId: string; query: ResearchQuery; step: WorkflowStep };

export type ResearchResult =
  | { outcome: "verdict"; verdictId: string; verdict: ResearchVerdict; scores: SynthesisScores }
  | { outcome: "paused"; reason: PauseReason };

export async function runResearchPipeline(
  deps: ResearchPipelineDeps,
  run: ResearchRun,
): Promise<ResearchResult> {
  const { founderId, query, step } = run;
  const costGuard = createCostGuard({
    runScoped: deps.runScoped,
    founderId,
    ...(deps.budgetMicros !== undefined ? { budgetMicros: deps.budgetMicros } : {}),
    ...(deps.burnoutPaused ? { burnoutPaused: deps.burnoutPaused } : {}),
  });
  const cached = deps.sources.map((source) =>
    withCache(source, {
      runScoped: deps.runScoped,
      founderId,
      costGuard,
      ...(deps.now ? { now: deps.now } : {}),
    }),
  );
  const bySignal = (types: SignalType[]) => cached.filter((s) => types.includes(s.signalType));

  const fetchStage = async (name: string, sources: ResearchSource[]): Promise<SourceEvidence[]> => {
    const all: SourceEvidence[] = [];
    for (const source of sources) {
      const items = await step.run(`${name}:${source.id}`, async () => {
        try {
          return await source.fetch(query);
        } catch (error) {
          // Fail-fast on a provider quota error: skip this source's contribution,
          // no hammering. A ResearchPausedError (budget/burnout) is NOT swallowed.
          if (error instanceof QuotaExceededError) return [] as SourceEvidence[];
          throw error;
        }
      });
      all.push(...items);
    }
    return all;
  };

  try {
    // Stage 1 — idea stress-test (Tier-2), before spending on sources.
    await step.run("stress-test", async () => {
      await costGuard.charge("model", "tier2", MODEL_COST_MICROS.tier2);
      const result = await deps.tierRunner.tier2({
        system: STRESS_SYSTEM,
        prompt: `Idea: ${query.idea}`,
      });
      return stressSchema.parse(parseModelJson(result.text)).assumptions;
    });

    // Stage 2 — competitor landscape (web presence + funded competition).
    const competition = await fetchStage(
      "competitor-landscape",
      bySignal(["web_presence", "funded_competition"]),
    );

    // Stage 3 — market-signal synthesis (live demand sources + Tier-2 narrative).
    const demand = await fetchStage(
      "market-signals",
      bySignal(["live_sentiment", "technical_reception"]),
    );
    const evidence = [...competition, ...demand];
    const scores = synthesizeScores(evidence);
    const narrative = await step.run("synthesize", async () => {
      await costGuard.charge("model", "tier2", MODEL_COST_MICROS.tier2);
      const result = await deps.tierRunner.tier2({
        system: NARRATIVE_SYSTEM,
        prompt: `Idea: ${query.idea}\nDemand ${scores.demand.toFixed(2)}, competition ${scores.competition.toFixed(2)}\nEvidence: ${JSON.stringify(evidence)}`,
      });
      return narrativeSchema.parse(parseModelJson(result.text));
    });

    // Stage 4 — verdict: the deterministic rule (not a model call), written with
    // its evidence links (§11.4), then Company State advances.
    const { verdict, rationale } = deriveVerdict(scores);
    const verdictId = await step.run("write-verdict", () =>
      deps.runScoped(founderId, async (trx) => {
        const [row] = await trx<{ id: string }[]>`
          insert into verdicts (verdict, summary, evidence)
          values (${verdict}, ${`${rationale}\n\n${narrative.summary}`}, ${trx.json(
            evidence.map((e) => ({
              source: e.source,
              signalType: e.signalType,
              title: e.title,
              url: e.url,
            })),
          )})
          returning id`;
        return (row as { id: string }).id;
      }),
    );
    await step.run("advance-state", () =>
      deps.runScoped(
        founderId,
        (trx) => trx`
        update company_state
        set stage = 'planning', state = state || ${trx.json({ verdictId, verdict })}, updated_at = now()
        where stage = 'researching'`,
      ),
    );
    await step.run("emit-completed", () =>
      deps.engine.send({
        name: RESEARCH_COMPLETED_EVENT,
        id: `research/${founderId}/${verdictId}`,
        data: { founderId, verdictId, verdict },
      }),
    );
    return { outcome: "verdict", verdictId, verdict, scores };
  } catch (error) {
    if (error instanceof ResearchPausedError) {
      // Degrade to asking (§8.5): surface to the founder, write no verdict.
      await step.run(`pause:${error.reason}`, () =>
        deps.engine.send({
          name: RESEARCH_PAUSED_EVENT,
          id: `research-paused/${founderId}/${error.reason}`,
          data: { founderId, reason: error.reason, spentMicros: error.spentMicros },
        }),
      );
      return { outcome: "paused", reason: error.reason };
    }
    throw error;
  }
}
