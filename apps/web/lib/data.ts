import { createDbClient, requireDatabaseUrl, type Sql, withFounderContext } from "@tethr/db";
import { type InspectableTrait, listTraits } from "@tethr/founder-model";
import { type ThreadMessage, threadFor } from "@tethr/messaging";

// Server-only data access for the shell (Ch 4): every read runs under the
// founder's RLS scope — the shell is a window onto founder-scoped rows, not
// a privileged view. Founder binding: Supabase Auth session → founder claim
// arrives with onboarding (Build 6, §18.5.2); until then the shell binds to
// an explicit TETHR_DEV_FOUNDER_ID and refuses to run without one.

let client: Sql | null = null;
const db = (): Sql => {
  client ??= createDbClient(requireDatabaseUrl(process.env), { max: 3 });
  return client;
};

export function requireFounderId(): string {
  const founderId = process.env.TETHR_DEV_FOUNDER_ID;
  if (!founderId) {
    throw new Error(
      "TETHR_DEV_FOUNDER_ID is not set — the shell needs a founder binding until onboarding (Build 6) provides authenticated sessions",
    );
  }
  return founderId;
}

const asFounder = <T>(work: (trx: Sql) => Promise<T>): Promise<T> =>
  withFounderContext(db(), requireFounderId(), work);

export type CompanyView = {
  companyName: string | null;
  stage: string;
  state: Record<string, unknown>;
  verdict: { verdict: string; summary: string; createdAt: Date } | null;
  cadence: {
    behavior: string;
    decision: string;
    vetoApplied: boolean;
    decidedAt: Date;
  } | null;
  thread: ThreadMessage[];
};

export async function getCompanyView(): Promise<CompanyView | null> {
  return asFounder(async (trx) => {
    const [company] = await trx<
      { company_name: string | null; stage: string; state: Record<string, unknown> }[]
    >`select company_name, stage, state from company_state`;
    const [verdict] = await trx<
      { verdict: string; summary: string; created_at: Date }[]
    >`select verdict, summary, created_at from verdicts order by created_at desc limit 1`;
    // §4.5 cadence surface: the current contact posture, read from the
    // instrumented policy decisions — a display, never a settings screen.
    const [decision] = await trx<
      { behavior: string; decision: string; veto_applied: boolean; created_at: Date }[]
    >`select behavior, decision, veto_applied, created_at
      from policy_decisions order by created_at desc limit 1`;
    const thread = await threadFor(trx, { limit: 8 });
    if (!company && !verdict && !decision && thread.length === 0) return null;
    return {
      companyName: company?.company_name ?? null,
      stage: company?.stage ?? "onboarding",
      state: company?.state ?? {},
      verdict: verdict
        ? { verdict: verdict.verdict, summary: verdict.summary, createdAt: verdict.created_at }
        : null,
      cadence: decision
        ? {
            behavior: decision.behavior,
            decision: decision.decision,
            vetoApplied: decision.veto_applied,
            decidedAt: decision.created_at,
          }
        : null,
      thread,
    };
  });
}

export type PlanView = {
  status: string;
  actions: {
    id: string;
    sequenceIndex: number;
    dependsOn: string[];
    action: string;
    founderRequirement: string;
    definitionOfDone: string;
    estimatedTime: string;
    status: string;
  }[];
};

export async function getPlanView(): Promise<PlanView | null> {
  return asFounder(async (trx) => {
    const [plan] = await trx<{ id: string; status: string }[]>`
      select id, status from plans where status = 'active'
      order by created_at desc limit 1`;
    if (!plan) return null;
    const actions = await trx<
      {
        id: string;
        sequence_index: number;
        depends_on_action_ids: string[];
        action: string;
        founder_requirement: string;
        definition_of_done: string;
        estimated_time: unknown;
        status: string;
      }[]
    >`select id, sequence_index, depends_on_action_ids, action, founder_requirement,
        definition_of_done, estimated_time, status
      from actions where plan_id = ${plan.id} order by sequence_index asc`;
    return {
      status: plan.status,
      actions: actions.map((row) => ({
        id: row.id,
        sequenceIndex: row.sequence_index,
        dependsOn: row.depends_on_action_ids,
        action: row.action,
        founderRequirement: row.founder_requirement,
        definitionOfDone: row.definition_of_done,
        estimatedTime: String(row.estimated_time),
        status: row.status,
      })),
    };
  });
}

export type ExperimentView = {
  hypothesis: string;
  successCriteria: string;
  failureCriteria: string;
  duration: string;
  sampleSize: number;
  status: string;
};

export async function getExperimentView(): Promise<ExperimentView | null> {
  return asFounder(async (trx) => {
    const [experiment] = await trx<
      {
        hypothesis: string;
        success_criteria: string;
        failure_criteria: string;
        duration: unknown;
        sample_size: number;
        status: string;
      }[]
    >`select hypothesis, success_criteria, failure_criteria, duration, sample_size, status
      from experiments order by created_at desc limit 1`;
    if (!experiment) return null;
    return {
      hypothesis: experiment.hypothesis,
      successCriteria: experiment.success_criteria,
      failureCriteria: experiment.failure_criteria,
      duration: String(experiment.duration),
      sampleSize: experiment.sample_size,
      status: experiment.status,
    };
  });
}

export async function getTraitsView(): Promise<InspectableTrait[]> {
  return asFounder((trx) => listTraits(trx));
}
