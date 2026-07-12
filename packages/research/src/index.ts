export {
  type CostGuard,
  type CostGuardDeps,
  createCostGuard,
  DEFAULT_BUDGET_MICROS,
  type FounderScopedRunner,
  MODEL_COST_MICROS,
  type PauseReason,
  ResearchPausedError,
} from "./budget";
export {
  ONBOARDING_COMPLETED_EVENT,
  RESEARCH_ENTRY_WORKFLOW_ID,
  RESEARCH_PIVOT_WORKFLOW_ID,
  type ResearchEntryDeps,
  registerResearchEntry,
  registerResearchPivotEntry,
  VALIDATION_PIVOT_EVENT,
} from "./entry";
export { createHttpSources } from "./http-sources";
export {
  RESEARCH_COMPLETED_EVENT,
  RESEARCH_PAUSED_EVENT,
  type ResearchPipelineDeps,
  type ResearchResult,
  type ResearchRun,
  runResearchPipeline,
} from "./pipeline";
export { QuotaExceededError, withCache } from "./quota";
export {
  createFakeSource,
  type ResearchQuery,
  type ResearchSource,
  type ResearchVerdict,
  type SignalType,
  SOURCE_SPECS,
  type SourceEvidence,
  type SourceSpec,
} from "./sources";
export {
  COMPETITION_WEIGHTS,
  DEMAND_WEIGHTS,
  deriveVerdict,
  SATURATION,
  STRONG_DEMAND,
  type SynthesisScores,
  synthesizeScores,
  WEAK_DEMAND,
} from "./synthesis";
